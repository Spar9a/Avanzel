// avanzel-calltap: listens to what a Mac plays, the "them" side of a call, and writes it to stdout as raw 16 kHz mono
// signed 16-bit little-endian samples, the format the speech model reads. It taps the sound a chosen app plays (--pid), or
// everything the Mac plays when no app is named. The tap is silent to everyone else: the call app keeps playing as usual.
//
// Needs macOS 14.2 and the System Audio Recording permission. Status lines go to stderr as one JSON object each:
//   {"event":"started","sampleRate":48000,"channels":2}   the tap is running
//   {"event":"error","message":"..."}                      it could not start; the exit code is 1
//   {"event":"stopped","seconds":12.3}                     it ended on SIGINT, SIGTERM or --seconds
//
// Usage: avanzel-calltap [--pid <pid>] [--seconds <n>]
import AVFoundation
import AudioToolbox
import CoreAudio
import Foundation

func say(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object), let line = String(data: data, encoding: .utf8) else { return }
    FileHandle.standardError.write(Data((line + "\n").utf8))
}

func fail(_ message: String) -> Never {
    say(["event": "error", "message": message])
    exit(1)
}

func check(_ status: OSStatus, _ what: String) {
    if status != noErr { fail("\(what) failed (OSStatus \(status))") }
}

var pid: pid_t? = nil
var limit: Double? = nil
var args = CommandLine.arguments.dropFirst()
while let arg = args.popFirst() {
    switch arg {
    case "--pid": pid = args.popFirst().flatMap { pid_t($0) }
    case "--seconds": limit = args.popFirst().flatMap { Double($0) }
    default: fail("unknown argument \(arg)")
    }
}

guard #available(macOS 14.2, *) else { fail("call audio needs macOS 14.2 or later") }

func property<T>(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector, as type: T.Type, qualifier: UnsafeRawPointer? = nil, qualifierSize: UInt32 = 0) -> T? {
    var address = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var size = UInt32(MemoryLayout<T>.size)
    let value = UnsafeMutablePointer<T>.allocate(capacity: 1)
    defer { value.deallocate() }
    guard AudioObjectGetPropertyData(object, &address, qualifierSize, qualifier, &size, value) == noErr else { return nil }
    return value.pointee
}

// The tap: one app's output, or everything.
let description: CATapDescription
if let pid {
    var processPid = pid
    guard let process = property(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyTranslatePIDToProcessObject, as: AudioObjectID.self, qualifier: &processPid, qualifierSize: UInt32(MemoryLayout<pid_t>.size)), process != kAudioObjectUnknown else {
        fail("no app with process id \(pid) is playing sound")
    }
    description = CATapDescription(stereoMixdownOfProcesses: [process])
} else {
    description = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
}
description.uuid = UUID()
description.name = "Avanzel call tap"
description.muteBehavior = .unmuted
description.isPrivate = true

var tap = AudioObjectID(kAudioObjectUnknown)
check(AudioHardwareCreateProcessTap(description, &tap), "creating the tap")
guard var format = property(tap, kAudioTapPropertyFormat, as: AudioStreamBasicDescription.self) else { fail("reading the tap's format failed") }

// The aggregate device the tap listens through, anchored to the Mac's current output device.
guard let output = property(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDefaultSystemOutputDevice, as: AudioObjectID.self), output != kAudioObjectUnknown else { fail("this Mac has no output device") }
var uidAddress = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyDeviceUID, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
var uidSize = UInt32(MemoryLayout<CFString?>.size)
var outputUID: CFString? = nil
check(withUnsafeMutablePointer(to: &outputUID) { AudioObjectGetPropertyData(output, &uidAddress, 0, nil, &uidSize, $0) }, "reading the output device")
guard let outputUID else { fail("the output device has no id") }

let aggregate: [String: Any] = [
    kAudioAggregateDeviceNameKey: "Avanzel call tap",
    kAudioAggregateDeviceUIDKey: UUID().uuidString,
    kAudioAggregateDeviceMainSubDeviceKey: outputUID as String,
    kAudioAggregateDeviceIsPrivateKey: true,
    kAudioAggregateDeviceIsStackedKey: false,
    kAudioAggregateDeviceTapAutoStartKey: true,
    kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: outputUID as String]],
    kAudioAggregateDeviceTapListKey: [[kAudioSubTapDriftCompensationKey: true, kAudioSubTapUIDKey: description.uuid.uuidString]],
]
var device = AudioObjectID(kAudioObjectUnknown)
check(AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &device), "creating the listening device")

// Convert what arrives (usually 48 kHz stereo float) to 16 kHz mono 16-bit.
guard let inFormat = AVAudioFormat(streamDescription: &format),
      let outFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16_000, channels: 1, interleaved: true),
      let converter = AVAudioConverter(from: inFormat, to: outFormat) else { fail("the sound format is not one this can convert") }

let queue = DispatchQueue(label: "avanzel.calltap")
let out = FileHandle.standardOutput
var samples: Int64 = 0

var procID: AudioDeviceIOProcID? = nil
check(AudioDeviceCreateIOProcIDWithBlock(&procID, device, queue) { _, input, _, _, _ in
    guard let buffer = AVAudioPCMBuffer(pcmFormat: inFormat, bufferListNoCopy: input, deallocator: nil), buffer.frameLength > 0 else { return }
    let capacity = AVAudioFrameCount(Double(buffer.frameLength) * outFormat.sampleRate / inFormat.sampleRate) + 16
    guard let converted = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: capacity) else { return }
    var supplied = false
    var error: NSError?
    converter.convert(to: converted, error: &error) { _, status in
        if supplied { status.pointee = .noDataNow; return nil }
        supplied = true
        status.pointee = .haveData
        return buffer
    }
    guard error == nil, converted.frameLength > 0, let channel = converted.int16ChannelData else { return }
    samples += Int64(converted.frameLength)
    out.write(Data(bytes: channel[0], count: Int(converted.frameLength) * 2))
}, "starting to listen")
check(AudioDeviceStart(device, procID), "starting the listening device")
say(["event": "started", "sampleRate": format.mSampleRate, "channels": format.mChannelsPerFrame])

func finish() -> Never {
    if let procID { AudioDeviceStop(device, procID); AudioDeviceDestroyIOProcID(device, procID) }
    AudioHardwareDestroyAggregateDevice(device)
    AudioHardwareDestroyProcessTap(tap)
    say(["event": "stopped", "seconds": Double(samples) / 16_000])
    exit(0)
}

for signalNumber in [SIGINT, SIGTERM] {
    signal(signalNumber, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: .main)
    source.setEventHandler { finish() }
    source.resume()
}
if let limit {
    DispatchQueue.main.asyncAfter(deadline: .now() + limit) { finish() }
}
dispatchMain()
