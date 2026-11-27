// avanzel-calltap: listens to what a Mac plays, the "them" side of a call, and writes it to stdout as raw 16 kHz mono
// signed 16-bit little-endian samples, the format the speech model reads. It taps the sound the chosen apps play (--pid,
// which may repeat: a call app and its sound-playing helpers), or everything the Mac plays when no app is named. The tap is silent to everyone else: the call app keeps playing as usual.
// --exclude, which may repeat too, leaves a process out of everything the Mac plays, so Avanzel doesn't hear its own sounds.
// A pid with no audio object is skipped without a word. With --pid it changes nothing: the named apps are all that is heard.
//
// Needs macOS 14.2 and the System Audio Recording permission. Status lines go to stderr as one JSON object each:
//   {"event":"waiting"}                                    none of the named pids has an audio object yet; it retries
//                                                          once a second for up to 10 s (said once)
//   {"event":"started","sampleRate":48000,"channels":2}   the tap is running; sampleRate is the rate the sound is read at
//   {"event":"error","message":"..."}                      it could not start; the exit code is 1
//   {"event":"stopped","seconds":12.3}                     it ended on SIGINT, SIGTERM or --seconds, or, with --pid, once
//                                                          every named pid has exited (the call app quit)
//
// A pid that never gets an audio object is skipped. Only when none of them does it fail with
// "no app you named is playing sound".
//
// With --watch-mic it taps nothing and opens nothing: it says which processes hold the microphone, from Core Audio, and
// needs no permission. It prints one line when it starts and another each time the set changes, until SIGINT or SIGTERM:
//   {"event":"mic","holders":[{"pid":1234,"bundle":"com.google.Chrome.helper","appPid":1200,"app":"Google Chrome","path":"/Applications/Google Chrome.app"}]}
//   {"event":"stopped"}
// holders is sorted by pid. bundle, appPid, app and path are null when unknown. appPid is the outermost parent of the pid
// (below launchd) that is a running .app, its own pid included: the app the person sees, not its helper.
//
// Usage: avanzel-calltap [--pid <pid>]... [--exclude <pid>]... [--seconds <n>]
//        avanzel-calltap --watch-mic
import AVFoundation
import AppKit
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

var pids: [pid_t] = []
var excluded: [pid_t] = []
var watchMic = false
var limit: Double? = nil
var args = CommandLine.arguments.dropFirst()
while let arg = args.popFirst() {
    switch arg {
    case "--pid":
        guard let value = args.popFirst().flatMap({ pid_t($0) }) else { fail("--pid needs a process id") }
        pids.append(value)
    case "--exclude":
        guard let value = args.popFirst().flatMap({ pid_t($0) }) else { fail("--exclude needs a process id") }
        excluded.append(value)
    case "--watch-mic": watchMic = true
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

// The objects a property lists, trimmed to what was returned. Nil when it can't be read, which is not the same as none.
func objectList(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> [AudioObjectID]? {
    var address = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(object, &address, 0, nil, &size) == noErr else { return nil }
    if size == 0 { return [] }
    var objects = [AudioObjectID](repeating: kAudioObjectUnknown, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(object, &address, 0, nil, &size, &objects) == noErr else { return nil }
    return Array(objects.prefix(Int(size) / MemoryLayout<AudioObjectID>.size))
}

// The audio process object of each named pid; a pid that is not playing sound has none.
func audioProcesses(_ pids: [pid_t]) -> [AudioObjectID] {
    pids.compactMap { pid in
        var processPid = pid
        let process = property(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyTranslatePIDToProcessObject, as: AudioObjectID.self, qualifier: &processPid, qualifierSize: UInt32(MemoryLayout<pid_t>.size))
        return process == kAudioObjectUnknown ? nil : process
    }
}

// The watch: which processes have the microphone open right now, polled once a second. Polling is enough for the 5 s hold
// before a call is offered, and has no listeners to keep in step.
func parentPid(_ pid: pid_t) -> pid_t? {
    var info = proc_bsdinfo()
    let size = Int32(MemoryLayout<proc_bsdinfo>.size)
    guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size else { return nil }
    return pid_t(info.pbi_ppid)
}

// The outermost app on the way up from a pid, below launchd. A call app's helper holds the microphone, the person knows the app.
func owningApp(_ pid: pid_t) -> NSRunningApplication? {
    var found: NSRunningApplication? = nil
    var current: pid_t? = pid
    var steps = 0
    while let candidate = current, candidate > 1, steps < 32 {
        if let app = NSRunningApplication(processIdentifier: candidate), app.bundleURL?.path.hasSuffix(".app") == true { found = app }
        current = parentPid(candidate)
        steps += 1
    }
    return found
}

// Nil when Core Audio's process list can't be read: a passing failure, which must not read as nobody holding the microphone.
func micHolders() -> [(pid: pid_t, bundle: String?)]? {
    guard let objects = objectList(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyProcessObjectList) else { return nil }
    var holders: [(pid: pid_t, bundle: String?)] = []
    for object in objects {
        guard let running = property(object, kAudioProcessPropertyIsRunningInput, as: UInt32.self), running != 0,
              let pid = property(object, kAudioProcessPropertyPID, as: pid_t.self) else { continue }
        var bundleAddress = AudioObjectPropertyAddress(mSelector: kAudioProcessPropertyBundleID, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var bundleSize = UInt32(MemoryLayout<CFString?>.size)
        var bundle: CFString? = nil
        let status = withUnsafeMutablePointer(to: &bundle) { AudioObjectGetPropertyData(object, &bundleAddress, 0, nil, &bundleSize, $0) }
        // A process with no bundle id reads as an empty string; that is unknown too.
        let name = status == noErr ? (bundle as String?) : nil
        holders.append((pid, name?.isEmpty == false ? name : nil))
    }
    return holders.sorted { $0.pid < $1.pid }
}

// One JSON string, written by hand so the keys keep their order and a missing value is null; the strings are escaped by JSONSerialization.
func json(_ value: Any?) -> String {
    switch value {
    case let text as String:
        guard let data = try? JSONSerialization.data(withJSONObject: text, options: [.fragmentsAllowed, .withoutEscapingSlashes]) else { return "null" }
        return String(data: data, encoding: .utf8) ?? "null"
    case let number as pid_t: return String(number)
    default: return "null"
    }
}

if watchMic {
    var last: String? = nil
    let poll = {
        // A tick that couldn't read the list says nothing; the next one tries again.
        guard let found = micHolders() else { return }
        let holders = found.map { holder -> String in
            let app = owningApp(holder.pid)
            return "{\"pid\":\(holder.pid),\"bundle\":\(json(holder.bundle)),\"appPid\":\(json(app?.processIdentifier)),\"app\":\(json(app?.localizedName)),\"path\":\(json(app?.bundleURL?.path))}"
        }
        let line = "{\"event\":\"mic\",\"holders\":[\(holders.joined(separator: ","))]}"
        if line == last { return }
        last = line
        FileHandle.standardError.write(Data((line + "\n").utf8))
    }
    poll()
    let timer = DispatchSource.makeTimerSource(queue: .main)
    timer.schedule(deadline: .now() + 1, repeating: 1)
    timer.setEventHandler(handler: poll)
    timer.resume()
    // The sources are kept here, or they would be released and never fire.
    var stops: [DispatchSourceSignal] = []
    for signalNumber in [SIGINT, SIGTERM] {
        signal(signalNumber, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: .main)
        source.setEventHandler { say(["event": "stopped"]); exit(0) }
        source.resume()
        stops.append(source)
    }
    dispatchMain()
}

// The tap: the named apps' output, or everything.
let description: CATapDescription
if !pids.isEmpty {
    var processes = audioProcesses(pids)
    if processes.isEmpty {
        say(["event": "waiting"])
        for _ in 0..<10 where processes.isEmpty {
            Thread.sleep(forTimeInterval: 1)
            processes = audioProcesses(pids)
        }
    }
    if processes.isEmpty { fail("no app you named is playing sound") }
    description = CATapDescription(stereoMixdownOfProcesses: processes)
} else {
    description = CATapDescription(stereoGlobalTapButExcludeProcesses: audioProcesses(excluded))
}
description.uuid = UUID()
description.name = "Avanzel call tap"
description.muteBehavior = .unmuted
description.isPrivate = true

var tap = AudioObjectID(kAudioObjectUnknown)
check(AudioHardwareCreateProcessTap(description, &tap), "creating the tap")
guard var format = property(tap, kAudioTapPropertyFormat, as: AudioStreamBasicDescription.self) else { fail("reading the tap's format failed") }

// The Mac's own speakers or headphone jack: the first built-in device that has output streams.
func builtInOutput() -> AudioObjectID? {
    guard let devices = objectList(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDevices) else { return nil }
    return devices.first { device in
        guard property(device, kAudioDevicePropertyTransportType, as: UInt32.self) == kAudioDeviceTransportTypeBuiltIn else { return false }
        var address = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreams, mScope: kAudioObjectPropertyScopeOutput, mElement: kAudioObjectPropertyElementMain)
        var size: UInt32 = 0
        return AudioObjectGetPropertyDataSize(device, &address, 0, nil, &size) == noErr && size > 0
    }
}

// The aggregate device the tap listens through, anchored to the Mac's built-in output. The aggregate's clock follows its main
// sub-device, and AirPods change rate (24 kHz in call mode, 48 kHz otherwise), so anchored on them the other side came out at
// double speed. The built-in output keeps its rate, and the tap still hears every app whatever device it plays on. Only a Mac
// with no built-in output (some desktops) falls back to the current output device.
guard let output = builtInOutput() ?? property(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDefaultSystemOutputDevice, as: AudioObjectID.self), output != kAudioObjectUnknown else { fail("this Mac has no output device") }
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

// The sound arrives at the aggregate's rate, which can differ from the tap's own format. Read at the wrong rate it plays too
// fast or too slow, so the converter is built from the rate the aggregate really runs at.
if let rate = property(device, kAudioDevicePropertyNominalSampleRate, as: Float64.self), rate.isFinite, rate > 0, rate != format.mSampleRate {
    format.mSampleRate = rate
}

// Convert what arrives (usually 48 kHz stereo float) to 16 kHz mono 16-bit.
guard let inFormat = AVAudioFormat(streamDescription: &format),
      let outFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16_000, channels: 1, interleaved: true),
      let converter = AVAudioConverter(from: inFormat, to: outFormat) else { fail("the sound format is not one this can convert") }

let queue = DispatchQueue(label: "avanzel.calltap")
let out = FileHandle.standardOutput
var samples: Int64 = 0

var procID: AudioDeviceIOProcID? = nil
// Converts one list of the tap's sound and writes it out. The list and its memory are only valid during the IOProc call.
func writeConverted(_ list: UnsafePointer<AudioBufferList>) {
    guard let buffer = AVAudioPCMBuffer(pcmFormat: inFormat, bufferListNoCopy: list, deallocator: nil), buffer.frameLength > 0 else { return }
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
}

check(AudioDeviceCreateIOProcIDWithBlock(&procID, device, queue) { _, input, _, _, _ in
    // A device with its own input, such as a USB headset, hands over its microphone's buffer as well as the tap's. A list of two
    // doesn't fit the tap's format, so nothing was heard. The tap's stream is the last buffer: it goes on alone, in a list of
    // one that lives until the conversion is done.
    let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input))
    guard buffers.count > 1, let last = buffers.last else { return writeConverted(input) }
    var single = AudioBufferList(mNumberBuffers: 1, mBuffers: last)
    withUnsafeMutablePointer(to: &single) { writeConverted($0) }
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

// With named apps, the tap ends by itself once every one of their pids has exited: the call app quit, and its call with it. The
// sources are kept here, or they would be released and never fire. Everything the Mac plays has no pid to watch.
var exitWatches: [DispatchSourceProcess] = []
if !pids.isEmpty {
    var alive = Set(pids)
    let exited = { (pid: pid_t) in
        alive.remove(pid)
        if alive.isEmpty { finish() }
    }
    for pid in Set(pids) {
        let watch = DispatchSource.makeProcessSource(identifier: pid, eventMask: .exit, queue: .main)
        watch.setEventHandler { exited(pid) }
        watch.resume()
        exitWatches.append(watch)
        // One that exited before its watch began would never say so: ask the system whether it is still there.
        if kill(pid, 0) != 0 && errno == ESRCH { DispatchQueue.main.async { exited(pid) } }
    }
}
dispatchMain()
