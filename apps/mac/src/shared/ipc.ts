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
  | {
      kind: "filing";
      text: string;
      agent: string;
      transcribedIn: number | null;
      canEdit: boolean;
      detail?: string;
      /** Waiting for the library: another run (a question, a review, another Avanzel) has it. */
      waiting?: boolean;
    }
  | { kind: "editing"; text: string }
  | { kind: "filed"; agent: string; seconds: number; pages: FiledPage[]; canUndo: boolean; message: string }
  | { kind: "saved"; text: string; thumbnail?: string; context?: ScreenContext; note: string; detail?: string }
  | { kind: "error"; message: string; detail?: string; action?: "open-microphone-settings" | "open-screen-settings" | "open-settings" }
  /** The shortcut, while the speech models download: how far along they are, and typing instead. */
  | {
      kind: "preparing";
      receivedBytes: number;
      /** 0 while the size isn't known. */
      totalBytes: number;
    }
  /** The shortcut, after the speech models' download failed: typing instead, or Try again. */
  | { kind: "model-failed" };

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

/** What the check of an agent found (Settings → Agents), or that it is running. */
export type AgentStatus =
  | { kind: "checking" }
  | { kind: "signed-in"; seconds: number }
  | { kind: "replied"; seconds: number }
  | { kind: "signed-out" }
  | { kind: "timeout" }
  | {
      kind: "failed";
      /** The line of the agent's output that says why (the engine's errorLine), or why it couldn't start. */
      detail: string;
    };

export interface HarnessInfo {
  name: string;
  available: boolean;
  experimental: boolean;
  /** Its check reads its own sign-in command, which asks the model nothing; the others' check is a prompt. */
  freeCheck: boolean;
  /** Its last check in this app run, or null while it hasn't been checked. */
  status: AgentStatus | null;
}

export type ModelStatus =
  | { kind: "ready"; dir: string }
  | {
      kind: "missing";
      /** What downloading the missing speech models fetches; files in a Hugging Face cache aren't fetched again. */
      bytes: number;
    }
  | { kind: "downloading"; receivedBytes: number; totalBytes: number }
  | {
      kind: "error";
      /** download: the download failed, and trying again may work. settings: the library's [voice] settings can't be used, so nothing downloads. */
      cause: "download" | "settings";
      message: string;
    };

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

/** A file in tasks/ that can't be used as a shadow task, and why. */
export interface TaskFileProblem {
  /** Library-relative, e.g. "tasks/standup.md". */
  file: string;
  message: string;
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
  /** Why the library at `app.libraryPath` couldn't be opened, if it couldn't. */
  libraryProblem: string | null;
  defaultLibraryPath: string;
  harnesses: HarnessInfo[];
  selectedHarness: string | null;
  model: ModelStatus;
  permissions: { microphone: PermissionStatus; screen: PermissionStatus };
  tasks: TaskInfo[];
  taskProblems: TaskFileProblem[];
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
    /** Listening now: send the current state again (one sent while the page loaded is lost). */
    ready(): void;
    onCommand(callback: (command: "start" | "stop" | "cancel") => void): () => void;
    sendAudio(samples: Float32Array): Promise<void>;
    reportMicError(message: string): void;
    setInteractive(interactive: boolean): void;
    edit(): void;
    /** The editor's text, on every change: kept if Avanzel quits or a recording starts before File or Cancel. */
    editDraft(text: string): void;
    submitEdit(text: string): void;
    cancelEdit(): void;
    undo(): void;
    open(): void;
    dismiss(): void;
    keepOpen(keep: boolean): void;
    openSettingsFor(action: string): void;
    /** Try again, after the speech models' download failed: it starts over, and the capsule shows its progress. */
    retryDownload(): void;
    /** Type instead, while Avanzel can't listen yet: the capsule hides and Quick opens. */
    typeInstead(): void;
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
    /** Starts the free checks of installed agents not checked yet in this app run; their results arrive through onChanged. */
    checkAgents(): Promise<SettingsSnapshot>;
    /** Checks agent `name` again, its prompt included; the result arrives through onChanged. */
    checkAgent(name: string): Promise<SettingsSnapshot>;
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
    /** What the question in progress is doing now, e.g. waiting for a filing to finish, then looking through the library. */
    onProgress(callback: (message: string) => void): () => void;
    openPage(name: string): void;
    close(): void;
  };
}
