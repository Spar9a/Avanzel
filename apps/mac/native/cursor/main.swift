// avanzel-cursor: the part of "dictate into any app" that only the Mac itself can do. It watches one modifier key (a tap of
// Right Option starts and ends a dictation), says what the focused app is and whether its cursor takes text, and sends the
// paste keystroke. It runs until its stdin ends or it gets SIGTERM or SIGINT.
//
// Everything is one JSON object per line. Commands come in on stdin, events and replies go out on stdout; diagnostics go to
// stderr. Needs the Input Monitoring permission (to see the key) and the Accessibility permission (to inspect and to paste).
//
// Out, stdout:
//   {"event":"ready","accessibility":true,"inputMonitoring":true}     once, at start
//   {"event":"modifier","key":"right-option","down":true}             a change of the watched key
//   {"event":"key"}                                                   any other key-down or mouse-down: what breaks a tap.
//                                                                     Sent only after a watch; it says nothing about which key.
//   {"event":"error","message":"..."}                                 also for a line that is not JSON or has no id and no cmd
//   {"id":1,"ok":true,...}  or  {"id":1,"ok":false,"message":"..."}   the reply to the command with that id; every success
//                                                                     reply carries "ok":true beside its fields. A line with an
//                                                                     id but no usable cmd gets an ok:false reply too.
//
// In, stdin:
//   {"id":1,"cmd":"watch","key":"right-option"}      key: right-option, left-option, right-command or right-control.
//                                                    Until the first watch, no modifier or key events are sent. Replies
//                                                    ok:false while Input Monitoring is missing, but the key stays chosen
//                                                    and works once a later watch or permissions command finds the permission.
//   {"id":2,"cmd":"permissions","prompt":false}      replies {"ok":true,"accessibility":bool,"inputMonitoring":bool};
//                                                    prompt:true asks macOS for both
//   {"id":3,"cmd":"inspect"}                         replies {"ok":true,"app":{"name","bundleId","pid"},"window":{"title"}|null,
//                                                    "element":{"role","secure","takesText":"yes"|"no"|"unknown"}|null}.
//                                                    Without Accessibility, or when nothing could be read, window and element
//                                                    are null. With no focused window, element is present with takesText "no",
//                                                    and its role is null when there is no focused element. Names and titles
//                                                    may be null too.
//   {"id":4,"cmd":"paste"}                           posts Command-V to the focused app; ok:false without Accessibility
//
// Without Input Monitoring the helper still starts (inputMonitoring:false) and answers every command but cannot see keys.
import AppKit
import ApplicationServices
import Foundation

let outputLock = NSLock()

func send(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.withoutEscapingSlashes]), let line = String(data: data, encoding: .utf8) else { return }
    outputLock.lock()
    fputs(line + "\n", stdout)
    fflush(stdout)
    outputLock.unlock()
}

func say(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object), let line = String(data: data, encoding: .utf8) else { return }
    FileHandle.standardError.write(Data((line + "\n").utf8))
}

func fail(_ message: String) -> Never {
    say(["event": "error", "message": message])
    exit(1)
}

signal(SIGPIPE, SIG_IGN)

// MARK: Watching

struct Watched {
    let name: String
    let code: Int64
    let deviceMask: UInt64 // the flag bit of this one physical key, which tells the left key from the right
}

let keys: [String: Watched] = [
    "right-option": Watched(name: "right-option", code: 61, deviceMask: 0x40),
    "left-option": Watched(name: "left-option", code: 58, deviceMask: 0x20),
    "right-command": Watched(name: "right-command", code: 54, deviceMask: 0x10),
    "right-control": Watched(name: "right-control", code: 62, deviceMask: 0x2000),
]

// Both are touched on the main thread only: the tap callback runs there, and a watch command hops there to set them.
var watched: Watched? = nil
var tap: CFMachPort? = nil

let tapCallback: CGEventTapCallBack = { _, type, event, _ in
    switch type {
    case .tapDisabledByTimeout, .tapDisabledByUserInput:
        if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
    case .flagsChanged:
        if let watched, event.getIntegerValueField(.keyboardEventKeycode) == watched.code {
            send(["event": "modifier", "key": watched.name, "down": event.flags.rawValue & watched.deviceMask != 0])
        }
    case .keyDown, .leftMouseDown, .rightMouseDown:
        if watched != nil { send(["event": "key"]) }
    default:
        break
    }
    return Unmanaged.passUnretained(event)
}

/// Starts listening. Without `force`, only when macOS already allows it, so that starting up never raises a permission dialog.
func installTap(force: Bool) {
    if tap != nil || (!force && !CGPreflightListenEventAccess()) { return }
    let mask: CGEventMask = [CGEventType.flagsChanged, .keyDown, .leftMouseDown, .rightMouseDown].reduce(0) { $0 | (1 << $1.rawValue) }
    guard let created = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly, eventsOfInterest: mask, callback: tapCallback, userInfo: nil) else { return }
    // A tap made without the permission can exist and still hear nothing, and would stay deaf after the grant. Drop it, so the
    // next call makes a fresh one.
    guard CGPreflightListenEventAccess() else {
        CFMachPortInvalidate(created)
        return
    }
    CFRunLoopAddSource(CFRunLoopGetMain(), CFMachPortCreateRunLoopSource(kCFAllocatorDefault, created, 0), .commonModes)
    CGEvent.tapEnable(tap: created, enable: true)
    tap = created
}

// MARK: Permissions

func accessibilityAllowed(prompt: Bool = false) -> Bool {
    if !prompt { return AXIsProcessTrusted() }
    return AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary)
}

/// Whether keys are heard now: macOS allows it and the tap (which is only ever kept while it was allowed) is running.
func listening() -> Bool {
    tap != nil && CGPreflightListenEventAccess()
}

func permissionState() -> [String: Any] {
    ["accessibility": AXIsProcessTrusted(), "inputMonitoring": listening()]
}

// MARK: Inspecting

let textRoles: Set<String> = ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"]
let notTextRoles: Set<String> = ["AXButton", "AXList", "AXOutline", "AXTable", "AXImage", "AXCheckBox", "AXRadioButton", "AXPopUpButton", "AXMenuItem", "AXSlider"]

func attribute(_ element: AXUIElement, _ name: String) -> (error: AXError, value: CFTypeRef?) {
    var value: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, name as CFString, &value)
    return (error, error == .success ? value : nil)
}

func text(_ element: AXUIElement, _ name: String) -> String? {
    attribute(element, name).value as? String
}

/// Where the cursor of the frontmost app is. Whatever macOS will not say comes back as null or "unknown", never as an error.
func inspect() -> [String: Any] {
    guard let front = NSWorkspace.shared.frontmostApplication else { return ["ok": false, "message": "No app is in front."] }
    var reply: [String: Any] = [
        "ok": true,
        "app": ["name": front.localizedName ?? NSNull(), "bundleId": front.bundleIdentifier ?? NSNull(), "pid": Int(front.processIdentifier)] as [String: Any],
        "window": NSNull(),
        "element": NSNull(),
    ]
    guard AXIsProcessTrusted() else { return reply }

    let app = AXUIElementCreateApplication(front.processIdentifier)
    AXUIElementSetMessagingTimeout(app, 0.5)

    // A window that is positively absent means nothing can take text; a failed question means we don't know.
    let focusedWindow = attribute(app, kAXFocusedWindowAttribute)
    var noWindow = false
    if let value = focusedWindow.value, CFGetTypeID(value) == AXUIElementGetTypeID() {
        let window = value as! AXUIElement
        AXUIElementSetMessagingTimeout(window, 0.5)
        reply["window"] = ["title": text(window, kAXTitleAttribute) ?? NSNull()] as [String: Any]
    } else if focusedWindow.error == .noValue {
        noWindow = true
    }

    let focusedElement = attribute(app, kAXFocusedUIElementAttribute)
    guard let value = focusedElement.value, CFGetTypeID(value) == AXUIElementGetTypeID() else {
        if noWindow { reply["element"] = ["role": NSNull(), "secure": false, "takesText": "no"] as [String: Any] }
        return reply
    }
    let element = value as! AXUIElement
    AXUIElementSetMessagingTimeout(element, 0.5)
    let role = text(element, kAXRoleAttribute)
    let secure = text(element, kAXSubroleAttribute) == "AXSecureTextField"
    let editable = attribute(element, "AXEditable").value as? Bool == true

    var takesText = "unknown"
    if noWindow {
        takesText = "no"
    } else if secure || editable || textRoles.contains(role ?? "") {
        takesText = "yes"
    } else if notTextRoles.contains(role ?? "") {
        takesText = "no"
    }
    reply["element"] = ["role": role ?? NSNull(), "secure": secure, "takesText": takesText] as [String: Any]
    return reply
}

// MARK: Pasting

func paste() -> [String: Any] {
    guard AXIsProcessTrusted() else { return ["ok": false, "message": "Avanzel is not allowed to control this Mac yet, so it can't paste."] }
    let source = CGEventSource(stateID: .hidSystemState)
    guard let down = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: true),
          let up = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: false) else {
        return ["ok": false, "message": "The paste keystroke could not be made."]
    }
    down.flags = .maskCommand
    up.flags = .maskCommand
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
    return ["ok": true]
}

// MARK: Commands

func run(_ command: String, _ request: [String: Any]) -> [String: Any] {
    switch command {
    case "watch":
        guard let name = request["key"] as? String, let key = keys[name] else { return ["ok": false, "message": "Unknown key. Use right-option, left-option, right-command or right-control."] }
        let heard: Bool = DispatchQueue.main.sync {
            watched = key
            installTap(force: true)
            return listening()
        }
        // The key stays chosen, and is heard once the tap can start (a later watch or permissions command retries it).
        if !heard { return ["ok": false, "message": "Avanzel is not allowed to watch the keyboard yet."] }
        return ["ok": true]
    case "permissions":
        if request["prompt"] as? Bool == true {
            _ = accessibilityAllowed(prompt: true)
            _ = CGRequestListenEventAccess()
            DispatchQueue.main.sync { installTap(force: true) }
        } else {
            DispatchQueue.main.sync { installTap(force: false) }
        }
        return DispatchQueue.main.sync { permissionState() }.merging(["ok": true]) { a, _ in a }
    case "inspect":
        return inspect()
    case "paste":
        return paste()
    default:
        return ["ok": false, "message": "Unknown command \(command)."]
    }
}

func handle(_ line: String) {
    guard let data = line.data(using: .utf8), let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
        send(["event": "error", "message": "That line is not a command."])
        return
    }
    guard let command = request["cmd"] as? String else {
        var reply: [String: Any] = ["ok": false, "message": "That line has no cmd."]
        if let id = request["id"] { reply["id"] = id } else { reply = ["event": "error", "message": "That line is not a command."] }
        send(reply)
        return
    }
    var reply = run(command, request)
    if let id = request["id"] { reply["id"] = id }
    send(reply)
}

// MARK: Start

var signalSources: [DispatchSourceSignal] = [] // kept, or they would be released and never fire
for signalNumber in [SIGINT, SIGTERM] {
    signal(signalNumber, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: .main)
    source.setEventHandler { exit(0) }
    source.resume()
    signalSources.append(source)
}

installTap(force: false)
send(["event": "ready", "accessibility": AXIsProcessTrusted(), "inputMonitoring": listening()])

let reader = Thread {
    while let line = readLine(strippingNewline: true) {
        if !line.trimmingCharacters(in: .whitespaces).isEmpty { handle(line) }
    }
    exit(0)
}
reader.start()
CFRunLoopRun()
