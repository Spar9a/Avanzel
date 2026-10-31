// The only door between the renderers and the main process: a typed, minimal `window.avanzel`.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { AvanzelBridge, CapsuleState, SettingsPane, SettingsSnapshot, SetupSnapshot, SoundName } from "../shared/ipc.ts";

function listen<T>(channel: string, callback: (value: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const bridge: AvanzelBridge = {
  capsule: {
    onState: (callback) => listen<CapsuleState>("capsule:state", callback),
    ready: () => ipcRenderer.send("capsule:ready"),
    onCommand: (callback) => listen<"start" | "stop" | "cancel">("capsule:command", callback),
    onSound: (callback) => listen<SoundName>("capsule:sound", callback),
    onSoundsSetting: (callback) => listen<boolean>("capsule:sounds-setting", callback),
    sendAudio: (samples) => ipcRenderer.invoke("capsule:audio", samples),
    reportMicError: (message) => ipcRenderer.send("capsule:mic-error", message),
    setInteractive: (interactive) => ipcRenderer.send("capsule:interactive", interactive),
    edit: () => ipcRenderer.send("capsule:edit"),
    editDraft: (text) => ipcRenderer.send("capsule:edit-draft", text),
    submitEdit: (text) => ipcRenderer.send("capsule:submit-edit", text),
    cancelEdit: () => ipcRenderer.send("capsule:cancel-edit"),
    cancelFiling: () => ipcRenderer.send("capsule:cancel-filing"),
    toggleFileMode: () => ipcRenderer.send("capsule:toggle-file-mode"),
    stopTranscribing: () => ipcRenderer.send("capsule:stop-transcribing"),
    undo: () => ipcRenderer.send("capsule:undo"),
    open: () => ipcRenderer.send("capsule:open"),
    openPage: (path) => ipcRenderer.send("capsule:open-page", path),
    dismiss: () => ipcRenderer.send("capsule:dismiss"),
    keepOpen: (keep) => ipcRenderer.send("capsule:keep-open", keep),
    openSettingsFor: (action) => ipcRenderer.send("capsule:open-settings-for", action),
    retryDownload: () => ipcRenderer.send("capsule:retry-download"),
    typeInstead: () => ipcRenderer.send("capsule:type-instead"),
    useShortcut: (key, accelerator) => ipcRenderer.send("capsule:use-shortcut", key, accelerator),
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    onChanged: (callback) => listen<SettingsSnapshot>("settings:changed", callback),
    onShowPane: (callback) => listen<SettingsPane>("settings:show-pane", callback),
    setApp: (patch) => ipcRenderer.invoke("settings:set-app", patch),
    mayPlaySounds: () => ipcRenderer.invoke("settings:may-play-sounds"),
    setLibrary: (patch) => ipcRenderer.invoke("settings:set-library", patch),
    chooseLibrary: () => ipcRenderer.invoke("settings:choose-library"),
    downloadModel: () => ipcRenderer.invoke("settings:download-model"),
    saveTask: (task) => ipcRenderer.invoke("settings:save-task", task),
    runTask: (id) => ipcRenderer.invoke("settings:run-task", id),
    checkAgents: () => ipcRenderer.invoke("settings:check-agents"),
    checkAgent: (name) => ipcRenderer.invoke("settings:check-agent", name),
    openLibrary: () => ipcRenderer.send("settings:open-library"),
    showLibrary: () => ipcRenderer.send("settings:show-library"),
    openSetup: () => ipcRenderer.send("settings:open-setup"),
    openPrivacy: (pane) => ipcRenderer.send("settings:open-privacy", pane),
    relaunch: () => ipcRenderer.send("settings:relaunch"),
    requestPermission: (kind) => ipcRenderer.invoke("settings:request-permission", kind),
    pick: (options, at) => ipcRenderer.invoke("settings:pick", options, at),
  },
  quick: {
    submit: (text) => ipcRenderer.invoke("quick:submit", text),
    close: () => ipcRenderer.send("quick:close"),
  },
  ask: {
    ask: (question) => ipcRenderer.invoke("ask:ask", question),
    save: (question, answer, library) => ipcRenderer.invoke("ask:save", question, answer, library),
    onProgress: (callback) => listen<string>("ask:progress", callback),
    cancel: () => ipcRenderer.send("ask:cancel"),
    openPage: (name) => ipcRenderer.send("ask:open-page", name),
    close: () => ipcRenderer.send("ask:close"),
    libraryPages: () => ipcRenderer.invoke("ask:library-pages"),
    suggestions: () => ipcRenderer.invoke("ask:suggestions"),
  },
  setup: {
    get: () => ipcRenderer.invoke("setup:get"),
    onChanged: (callback) => listen<SetupSnapshot>("setup:changed", callback),
    enter: (step) => ipcRenderer.invoke("setup:enter", step),
    chooseAgent: (name) => ipcRenderer.invoke("setup:choose-agent", name),
    createLibrary: () => ipcRenderer.invoke("setup:create-library"),
    chooseFolder: () => ipcRenderer.invoke("setup:choose-folder"),
    openTerminal: () => ipcRenderer.send("setup:open-terminal"),
    copy: (agent) => ipcRenderer.send("setup:copy", agent),
    installGit: () => ipcRenderer.send("setup:install-git"),
    useShortcut: (accelerator) => ipcRenderer.invoke("setup:use-shortcut", accelerator),
    reachForShortcut: () => ipcRenderer.send("setup:reach-for-shortcut"),
    typeThought: (words) => ipcRenderer.invoke("setup:type-thought", words),
    cancelFiling: () => ipcRenderer.send("setup:cancel-filing"),
    fileAgain: () => ipcRenderer.send("setup:file-again"),
    undo: () => ipcRenderer.send("setup:undo"),
    allowMicrophone: () => ipcRenderer.send("setup:allow-microphone"),
    tryAgain: () => ipcRenderer.send("setup:try-again"),
    fileAnyway: () => ipcRenderer.send("setup:file-anyway"),
    ask: (question) => ipcRenderer.invoke("setup:ask", question),
    skipAsk: () => ipcRenderer.send("setup:skip-ask"),
    finish: () => ipcRenderer.send("setup:finish"),
  },
  upHere: {
    get: () => ipcRenderer.invoke("up-here:get"),
    tryIt: () => ipcRenderer.send("up-here:try-it"),
    typeIt: () => ipcRenderer.send("up-here:type-it"),
    close: () => ipcRenderer.send("up-here:close"),
  },
};

contextBridge.exposeInMainWorld("avanzel", bridge);
