// The contract between the main process and the renderers (capsule, settings, quick-type, ask).

export interface FiledPage {
  title: string;
  /** First folder of the page path, e.g. "goals". */
  shelf: string;
  /** Library-relative path, e.g. "goals/run-a-marathon.md". */
  path: string;
}

export interface ScreenContext {
  app?: string;
  title?: string;
  url?: string;
}

export type CapsuleMode = "dictate" | "comment";

export type CapsuleState =
  | { kind: "hidden" }
  | { kind: "listening"; mode: CapsuleMode; startedAt: number; fakeMic: boolean; microphoneId: string | null; thumbnail?: string }
  | { kind: "transcribing"; mode: CapsuleMode }
  | { kind: "filing"; text: string; agent: string; transcribedIn: number | null; canEdit: boolean }
  | { kind: "editing"; text: string }
  | { kind: "filed"; agent: string; seconds: number; pages: FiledPage[]; canUndo: boolean; message: string }
  | { kind: "saved"; text: string; thumbnail?: string; context?: ScreenContext; note: string }
  | { kind: "error"; message: string; detail?: string; action?: "open-microphone-settings" | "open-screen-settings" | "open-settings" };

export interface Shortcuts {
  dictate: string;
  capture: string;
  type: string;
  ask: string;
}

export type FileMode = "now" | "evening";

export interface AppSettings {
  version: 1;
  libraryPath: string | null;
  shortcuts: Shortcuts;
  fileMode: FileMode;
  microphoneId: string | null;
  launchAtLogin: boolean;
}

export type PermissionStatus = "granted" | "denied" | "not-determined" | "restricted" | "unknown";

export interface HarnessInfo {
  name: string;
  available: boolean;
  experimental: boolean;
}

export type ModelStatus =
  | { kind: "ready"; dir: string }
  | { kind: "missing" }
  | { kind: "downloading"; receivedBytes: number; totalBytes: number }
  | { kind: "error"; message: string };

export interface TaskInfo {
  id: string;
  name: string;
  schedule: string;
  kind: string;
  agent: string;
  enabled: boolean;
  instructions: string;
  lastRun: string | null;
  nextRun: string | null;
  running: boolean;
}

export interface LibraryInfo {
  path: string;
  exists: boolean;
  isGit: boolean;
  inbox: number;
  shelves: Record<string, number>;
  harness: string;
  models: Record<string, string>;
  timeoutSeconds: number;
}

/** Everything the settings window shows, in one snapshot. */
export interface SettingsSnapshot {
  app: AppSettings;
  library: LibraryInfo | null;
  defaultLibraryPath: string;
  harnesses: HarnessInfo[];
  selectedHarness: string | null;
  model: ModelStatus;
  permissions: { microphone: PermissionStatus; screen: PermissionStatus };
  tasks: TaskInfo[];
  shortcutProblems: Partial<Record<keyof Shortcuts, string>>;
  obsidian: boolean;
}

export interface AskResult {
  ok: boolean;
  answer: string;
  agent: string;
  seconds: number;
}

/** Preload bridge exposed as `window.avanzel`. */
export interface AvanzelBridge {
  capsule: {
    onState(callback: (state: CapsuleState) => void): () => void;
    onCommand(callback: (command: "start" | "stop" | "cancel") => void): () => void;
    sendAudio(samples: Float32Array): Promise<void>;
    reportMicError(message: string): void;
    setInteractive(interactive: boolean): void;
    edit(): void;
    submitEdit(text: string): void;
    cancelEdit(): void;
    undo(): void;
    open(): void;
    dismiss(): void;
    keepOpen(keep: boolean): void;
    openSettingsFor(action: string): void;
  };
  settings: {
    get(): Promise<SettingsSnapshot>;
    onChanged(callback: (snapshot: SettingsSnapshot) => void): () => void;
    setApp(patch: Partial<AppSettings>): Promise<SettingsSnapshot>;
    setLibrary(patch: { harness?: string; models?: Record<string, string>; timeoutSeconds?: number }): Promise<SettingsSnapshot>;
    chooseLibrary(): Promise<SettingsSnapshot>;
    createLibrary(path: string): Promise<SettingsSnapshot>;
    downloadModel(): Promise<SettingsSnapshot>;
    saveTask(task: Pick<TaskInfo, "id" | "name" | "schedule" | "agent" | "enabled" | "instructions">): Promise<SettingsSnapshot>;
    runTask(id: string): Promise<SettingsSnapshot>;
    openLibrary(): void;
    openPrivacy(pane: "microphone" | "screen"): void;
    requestPermission(kind: "microphone" | "screen"): Promise<SettingsSnapshot>;
  };
  quick: {
    submit(text: string): Promise<void>;
    close(): void;
  };
  ask: {
    ask(question: string): Promise<AskResult>;
    openPage(name: string): void;
    close(): void;
  };
}
