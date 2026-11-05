// avanzel-cursor: the part of "dictate into any app" that only the Mac itself can do. It watches one modifier key (a tap of
// Right Option starts and ends a dictation), says what the focused app is and whether its cursor takes text, and pastes text
// through the clipboard, giving the person's clipboard back after. It runs until its stdin ends or it gets SIGTERM or SIGINT.
//
// Everything is one JSON object per line. Commands come in on stdin, events and replies go out on stdout; diagnostics go to
// stderr. Needs the Input Monitoring permission (to see the key) and the Accessibility permission (to inspect and to paste).
//
// Out, stdout:
//   {"event":"ready","accessibility":true,"inputMonitoring":true}     once, at start
//   {"event":"modifier","key":"right-option","down":true}             a change of the watched key
//   {"event":"key"}                                                   any other key-down, mouse-down, or change of another
//                                                                     modifier (shift, command, control, the other option, fn,
//                                                                     caps lock): what breaks a tap. Sent only after a watch; it
//                                                                     says nothing about which key.
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
//   {"id":3,"cmd":"inspect","keep":true}             replies {"ok":true,"app":{"name","bundleId","pid"},"window":{"title"}|null,
//                                                    "element":{"role","secure","takesText":"yes"|"no"|"unknown"}|null}.
//                                                    The app is the one the keys go to (Accessibility's focused application,
//                                                    which finds Spotlight-like panels), else the frontmost one. Without
//                                                    Accessibility, or when nothing could be read, window and element are null.
//                                                    With no focused window, element is present with takesText "no", and its
//                                                    role is null when there is no focused element. Names and titles may be
//                                                    null too. "secure" is also true while macOS's secure keyboard entry is on
//                                                    (a password field, a terminal's Secure Keyboard Entry); then element is
//                                                    never null. keep:true (optional) remembers the focused window, for "same".
//   {"id":4,"cmd":"same"}                            replies {"ok":true,"same":true|false|null}: whether the window that has
//                                                    focus now is the one the last inspect with keep:true found (the same
//                                                    Accessibility element, in the same app). null when nothing was kept or the
//                                                    focused window can't be read now.
//   {"id":5,"cmd":"paste","text":"...","holdMs":400} pastes text into the focused app: keeps every item of the clipboard with
//                                                    all its types, puts the text there marked transient and concealed (so
//                                                    clipboard managers skip it), sends Command-V with the key that types "v"
//                                                    in the current layout, waits holdMs (default 400), then puts the kept
//                                                    clipboard back, unless something else was copied meanwhile. Replies
//                                                    {"ok":true,"restored":bool}. On a failure the clipboard is put back
//                                                    first, then ok:false. Without text it only posts Command-V. ok:false
//                                                    without Accessibility.
//
// Without Input Monitoring the helper still starts (inputMonitoring:false) and answers every command but cannot see keys.
import AppKit
import ApplicationServices
import Carbon
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

// The flag bit of each physical modifier key: left and right control, shift, command and option.
let allModifierBits: UInt64 = 0x1 | 0x2 | 0x4 | 0x8 | 0x10 | 0x20 | 0x40 | 0x2000

// Both are touched on the main thread only: the tap callback runs there, and a watch command hops there to set them.
var watched: Watched? = nil
var tap: CFMachPort? = nil

let tapCallback: CGEventTapCallBack = { _, type, event, _ in
    switch type {
    case .tapDisabledByTimeout, .tapDisabledByUserInput:
        if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
    case .flagsChanged:
        guard let watched else { break }
        if event.getIntegerValueField(.keyboardEventKeycode) == watched.code {
            let down = event.flags.rawValue & watched.deviceMask != 0
            send(["event": "modifier", "key": watched.name, "down": down])
            // Another modifier already held as this one goes down (Shift first, then Right Option): a chord from the start. The
            // `key` follows the press, because a press clears any earlier break.
            if down && event.flags.rawValue & allModifierBits & ~watched.deviceMask != 0 { send(["event": "key"]) }
        } else {
            // Another modifier (⌥⇧ to switch layouts, ⌥⌘ for a shortcut): the watched key is part of a chord, not tapped.
            send(["event": "key"])
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

/// An Accessibility element out of an attribute's value, or nil when the value is something else or missing.
func element(_ value: CFTypeRef?) -> AXUIElement? {
    guard let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return (value as! AXUIElement)
}

/// The app the keys go to: Accessibility's focused application, which is also a non-activating panel's (Spotlight, Raycast, 1Password
/// Quick Access are never "frontmost"), else the frontmost app.
func focusedApp() -> NSRunningApplication? {
    if AXIsProcessTrusted() {
        let systemWide = AXUIElementCreateSystemWide()
        AXUIElementSetMessagingTimeout(systemWide, 0.5)
        if let app = element(attribute(systemWide, kAXFocusedApplicationAttribute).value) {
            var pid: pid_t = 0
            if AXUIElementGetPid(app, &pid) == .success, pid > 0, let running = NSRunningApplication(processIdentifier: pid) { return running }
        }
    }
    return NSWorkspace.shared.frontmostApplication
}

// The window the last inspect with keep:true found, and its app, for "same". Touched only on the reader thread, which runs every
// command in turn.
var keptWindow: AXUIElement? = nil
var keptPid: pid_t? = nil

/// Where the cursor of the focused app is. Whatever macOS will not say comes back as null or "unknown", never as an error. `keep`
/// remembers the focused window (or that it couldn't be read) for `same`.
// The icons given so far, by bundle id: `inspect` with `icon` is asked about once a second while a dictation listens.
// Touched only on the thread that reads the commands.
var icons: [String: String] = [:]

/// The app's icon as a 64 px square PNG in base64, or null when it has none to give.
func iconOf(_ app: NSRunningApplication) -> Any {
    let key = app.bundleIdentifier ?? String(app.processIdentifier)
    if let known = icons[key] { return known }
    let encoded: String? = DispatchQueue.main.sync {
        guard let image = app.icon,
              let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 64, pixelsHigh: 64, bitsPerSample: 8, samplesPerPixel: 4,
                                            hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
              let context = NSGraphicsContext(bitmapImageRep: bitmap) else { return nil }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        image.draw(in: NSRect(x: 0, y: 0, width: 64, height: 64))
        NSGraphicsContext.restoreGraphicsState()
        return bitmap.representation(using: .png, properties: [:])?.base64EncodedString()
    }
    guard let encoded else { return NSNull() }
    icons[key] = encoded
    return encoded
}

func inspect(keep: Bool, icon: Bool = false) -> [String: Any] {
    if keep {
        keptWindow = nil
        keptPid = nil
    }
    guard let front = focusedApp() else { return ["ok": false, "message": "No app is in front."] }
    if keep { keptPid = front.processIdentifier }
    // Secure keyboard entry (a password field, a terminal's Secure Keyboard Entry) is on for the whole Mac: whatever has focus, what is
    // said now is kept nowhere.
    let secureInput = IsSecureEventInputEnabled()
    let unreadableButSecure: [String: Any] = ["role": NSNull(), "secure": true, "takesText": "unknown"]
    var reply: [String: Any] = [
        "ok": true,
        "app": ["name": front.localizedName ?? NSNull(), "bundleId": front.bundleIdentifier ?? NSNull(), "pid": Int(front.processIdentifier), "icon": icon ? iconOf(front) : NSNull()] as [String: Any],
        "window": NSNull(),
        "element": secureInput ? unreadableButSecure : NSNull(),
    ]
    guard AXIsProcessTrusted() else { return reply }

    let app = AXUIElementCreateApplication(front.processIdentifier)
    AXUIElementSetMessagingTimeout(app, 0.5)

    // A window that is positively absent means nothing can take text; a failed question means we don't know.
    let focusedWindow = attribute(app, kAXFocusedWindowAttribute)
    var noWindow = false
    if let window = element(focusedWindow.value) {
        AXUIElementSetMessagingTimeout(window, 0.5)
        reply["window"] = ["title": text(window, kAXTitleAttribute) ?? NSNull()] as [String: Any]
        if keep { keptWindow = window }
    } else if focusedWindow.error == .noValue {
        noWindow = true
    }

    guard let focused = element(attribute(app, kAXFocusedUIElementAttribute).value) else {
        if noWindow { reply["element"] = ["role": NSNull(), "secure": secureInput, "takesText": "no"] as [String: Any] }
        return reply
    }
    AXUIElementSetMessagingTimeout(focused, 0.5)
    let role = text(focused, kAXRoleAttribute)
    let secureField = text(focused, kAXSubroleAttribute) == "AXSecureTextField"
    let editable = attribute(focused, "AXEditable").value as? Bool == true

    var takesText = "unknown"
    if noWindow {
        takesText = "no"
    } else if secureField || editable || textRoles.contains(role ?? "") {
        takesText = "yes"
    } else if notTextRoles.contains(role ?? "") {
        takesText = "no"
    }
    reply["element"] = ["role": role ?? NSNull(), "secure": secureField || secureInput, "takesText": takesText] as [String: Any]
    return reply
}

/// Whether the focused window now is the one `inspect(keep: true)` kept: the same Accessibility element (CFEqual) in the same app.
/// null when nothing was kept, or the window in focus now can't be read.
func same() -> [String: Any] {
    guard let keptPid else { return ["ok": true, "same": NSNull()] }
    guard let front = focusedApp() else { return ["ok": true, "same": NSNull()] }
    if front.processIdentifier != keptPid { return ["ok": true, "same": false] }
    guard let kept = keptWindow, AXIsProcessTrusted() else { return ["ok": true, "same": NSNull()] }
    let app = AXUIElementCreateApplication(front.processIdentifier)
    AXUIElementSetMessagingTimeout(app, 0.5)
    guard let now = element(attribute(app, kAXFocusedWindowAttribute).value) else { return ["ok": true, "same": NSNull()] }
    return ["ok": true, "same": CFEqual(kept, now)]
}

// MARK: Pasting

/// Marks from nspasteboard.org: the text is only passing through (transient), is not to be shown or kept (concealed), and was not
/// copied by the person (auto-generated). Clipboard managers (Maccy, Raycast, Alfred, Paste) skip what carries them.
let markerTypes = ["org.nspasteboard.TransientType", "org.nspasteboard.ConcealedType", "org.nspasteboard.AutoGeneratedType"].map { NSPasteboard.PasteboardType($0) }

/// Every item on a pasteboard, each with all its types and their data, in order.
typealias PasteboardSnapshot = [[(NSPasteboard.PasteboardType, Data)]]

func snapshot(_ pasteboard: NSPasteboard) -> PasteboardSnapshot {
    (pasteboard.pasteboardItems ?? []).map { item in item.types.compactMap { type in item.data(forType: type).map { (type, $0) } } }
}

/// Puts a snapshot back as it was: every item, every type. A snapshot of an empty pasteboard leaves it empty.
@discardableResult
func restore(_ kept: PasteboardSnapshot, to pasteboard: NSPasteboard) -> Bool {
    pasteboard.clearContents()
    let items = kept.filter { !$0.isEmpty }.map { pairs -> NSPasteboardItem in
        let item = NSPasteboardItem()
        for (type, data) in pairs { item.setData(data, forType: type) }
        return item
    }
    return items.isEmpty || pasteboard.writeObjects(items)
}

/// Puts `text` alone on the pasteboard, marked as passing through.
func writeMarked(_ text: String, to pasteboard: NSPasteboard) -> Bool {
    pasteboard.clearContents()
    let item = NSPasteboardItem()
    guard item.setString(text, forType: .string) else { return false }
    for marker in markerTypes { item.setData(Data(), forType: marker) }
    return pasteboard.writeObjects([item])
}

/// The key that gives `character` with Command held in a keyboard layout (Dvorak puts "v" elsewhere; "Dvorak - QWERTY ⌘" puts it back
/// for shortcuts), or nil when no key does or the layout has no key data.
func keyCode(typing character: String, in source: TISInputSource?) -> CGKeyCode? {
    guard let source, let pointer = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData) else { return nil }
    let data = Unmanaged<CFData>.fromOpaque(pointer).takeUnretainedValue()
    guard let bytes = CFDataGetBytePtr(data) else { return nil }
    let layout = UnsafeRawPointer(bytes).assumingMemoryBound(to: UCKeyboardLayout.self)
    let keyboardType = UInt32(LMGetKbdType())
    for code in 0..<128 {
        var deadKeys: UInt32 = 0
        var length = 0
        var chars = [UniChar](repeating: 0, count: 4)
        let status = UCKeyTranslate(layout, UInt16(code), UInt16(kUCKeyActionDown), UInt32((cmdKey >> 8) & 0xFF), keyboardType,
                                    OptionBits(kUCKeyTranslateNoDeadKeysMask), &deadKeys, chars.count, &length, &chars)
        if status == noErr, length == 1, String(utf16CodeUnits: chars, count: length).lowercased() == character { return CGKeyCode(code) }
    }
    return nil
}

/// The key code of Command-V as apps will read it: the "v" of the current layout, else of the layout shortcuts fall back to when the
/// current one types no Latin letters (Russian, say), else the "v" of US QWERTY (9).
func pasteKeyCode() -> CGKeyCode {
    // The text input sources are asked on the main thread, as macOS requires.
    DispatchQueue.main.sync {
        keyCode(typing: "v", in: TISCopyCurrentKeyboardLayoutInputSource()?.takeRetainedValue())
            ?? keyCode(typing: "v", in: TISCopyCurrentASCIICapableKeyboardLayoutInputSource()?.takeRetainedValue())
            ?? 9
    }
}

/// Posts Command-`code` to the focused app; false when the keystroke couldn't be made.
func postCommand(_ code: CGKeyCode) -> Bool {
    let source = CGEventSource(stateID: .hidSystemState)
    guard let down = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true),
          let up = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false) else { return false }
    down.flags = .maskCommand
    up.flags = .maskCommand
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
    return true
}

func paste(_ request: [String: Any]) -> [String: Any] {
    guard AXIsProcessTrusted() else { return ["ok": false, "message": "Avanzel is not allowed to control this Mac yet, so it can't paste."] }
    let unmade: [String: Any] = ["ok": false, "message": "The paste keystroke could not be made."]
    guard let text = request["text"] as? String else { return postCommand(pasteKeyCode()) ? ["ok": true] : unmade }
    let hold = max(0, min((request["holdMs"] as? Double) ?? 400, 5000)) / 1000
    let code = pasteKeyCode()
    let pasteboard = NSPasteboard.general
    // The pasteboard is used on the main thread; the wait between is spent on this one, so the key tap keeps running.
    let (kept, written): (PasteboardSnapshot, Int?) = DispatchQueue.main.sync {
        let kept = snapshot(pasteboard)
        return (kept, writeMarked(text, to: pasteboard) ? pasteboard.changeCount : nil)
    }
    guard let written, postCommand(code) else {
        DispatchQueue.main.sync { _ = restore(kept, to: pasteboard) }
        return written == nil ? ["ok": false, "message": "The words couldn't be put on the clipboard."] : unmade
    }
    // The app reads the clipboard when it gets round to the keystroke; a busy one takes a while.
    Thread.sleep(forTimeInterval: hold)
    let restored: Bool = DispatchQueue.main.sync {
        // Someone copied something meanwhile: that is theirs now, and stays.
        guard pasteboard.changeCount == written else { return false }
        return restore(kept, to: pasteboard)
    }
    return ["ok": true, "restored": restored]
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
        return inspect(keep: request["keep"] as? Bool == true, icon: request["icon"] as? Bool == true)
    case "same":
        return same()
    case "paste":
        return paste(request)
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
