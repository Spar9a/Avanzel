// The contract between the main process and the renderers (capsule, settings, quick-type, ask, setup).

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

/** The panes of the Settings window, in the order of its sidebar. */
export const SETTINGS_PANES = ["general", "voice", "agents", "tasks", "tools", "privacy"] as const;
export type SettingsPane = (typeof SETTINGS_PANES)[number];
export const isSettingsPane = (value: unknown): value is SettingsPane => SETTINGS_PANES.some((pane) => pane === value);

/** The steps of the setup window, in order. */
export const SETUP_STEPS = ["hello", "found", "think", "filing", "ask", "done"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];
export const isSetupStep = (value: unknown): value is SetupStep => SETUP_STEPS.some((step) => step === value);

/** What is at the library's place now. */
export type LibraryFolder = "missing" | "empty" | "has-files" | "library";

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
  /** `action`: where the card's Open Settings button goes: a pane of System Settings, or Avanzel's Settings on the pane that fixes it. */
  | { kind: "error"; message: string; detail?: string; action?: "open-microphone-settings" | "open-screen-settings" | `open-settings:${SettingsPane}` }
  /** The shortcut, while the speech models download: how far along they are, and typing instead. */
  | {
      kind: "preparing";
      receivedBytes: number;
      /** 0 while the size isn't known. */
      totalBytes: number;
    }
  /** The shortcut, after the speech models' download failed: typing instead, or Try again. */
  | { kind: "model-failed" }
  /**
   * At launch or when a library is set up, once per shortcut, and as the shortcuts change while it shows: another app
   * holds `key`'s shortcut, `accelerator`.
   */
  | {
      kind: "shortcut-taken";
      key: keyof Shortcuts;
      accelerator: string;
      /** The app that probably holds it: a running app whose default shortcut it is. */
      holder: string | null;
      /** Free shortcuts to use instead, best first; with none, the notice offers Settings. */
      alternatives: string[];
    }
  /** A free shortcut picked on that notice works: `key` now uses `accelerator`. It hides by itself. */
  | { kind: "shortcut-picked"; key: keyof Shortcuts; accelerator: string };

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
  | {
      kind: "signed-out";
      /** The line of the agent's reply that asked to sign in; empty when its own sign-in command said so. */
      detail: string;
    }
  | { kind: "timeout" }
  | {
      kind: "failed";
      /** The line of the agent's output that says why (the engine's errorLine), or why it couldn't start. */
      detail: string;
    };

/** Whether a check found that its agent works: it is signed in, or it replied. Setup files only with one that does. */
export const agentWorks = (status: AgentStatus | null | undefined): boolean => status?.kind === "signed-in" || status?.kind === "replied";

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
  /** For each shortcut another app holds, the free ones to use instead, best first (empty when none of them is free). */
  shortcutAlternatives: Partial<Record<keyof Shortcuts, string[]>>;
  obsidian: boolean;
}

/** An installed agent, as setup lists it under "Who should do the filing?". */
export interface SetupAgent {
  /** The harness name: "claude". */
  name: string;
  /** "Claude Code" (harnessName). */
  label: string;
  /** Its check reads its own sign-in; the others are asked one short question when picked. */
  freeCheck: boolean;
  /** What its check found in this app run; null while it hasn't been checked. */
  status: AgentStatus | null;
}

/** How the press of Record a thought's shortcut went on the first-thought step. */
export interface SetupPress {
  /** Registering it failed: another app holds it. */
  taken: boolean;
  /** A press arrived since the step asked for one: the shortcut works. */
  heard: boolean;
  /** No press arrived within the wait (3 s), and none since. */
  silent: boolean;
  /** The running app whose default shortcut it is, if one is running. */
  holder: string | null;
  /** Free shortcuts to use instead, best first: filled when taken or silent. */
  alternatives: string[];
}

/**
 * The first spoken thought, from the press to its words, on the first-thought step. The capsule records it; once the
 * words exist, a thought moves on to its filing (`filing`), and only a mic check stays here.
 */
export type SetupThought =
  /** Nothing is under way: the step asks for a press. */
  | { kind: "waiting" }
  /** macOS hasn't asked about the microphone yet: the primer says it will, and Continue has it ask. */
  | { kind: "primer" }
  /** The microphone is turned down (or restricted): the step says where to allow it. */
  | { kind: "denied" }
  /** The capsule records it; `startedAt` is the recording's Date.now(). */
  | { kind: "listening"; startedAt: number }
  /** The recording has stopped, and its words are being made; `startedAt` is the stop's Date.now(). */
  | { kind: "transcribing"; startedAt: number }
  /** Its words are a mic check ("Testing, testing"), kept in the inbox until File it anyway or Try again. */
  | { kind: "test"; words: string }
  /** The recording or its transcription went wrong, as the capsule's card would have said. */
  | { kind: "failed"; message: string; detail: string | null };

/**
 * The line a setup filing fails with when its note left the inbox before its agent could start, as when another Avanzel
 * filed it meanwhile: the words aren't in the inbox then, and filing that note again can't work.
 */
export const NOTE_GONE = "The note isn't in the inbox any more.";

/** The first thought's filing, in the setup window. */
export type SetupFiling =
  | {
      kind: "running";
      words: string;
      agent: string;
      /** Date.now() at the start: when the filing began, or when its wait for the library ended. */
      startedAt: number;
      /** Another run has the library. */
      waiting: boolean;
      /** Cancel was pressed; it is stopping. */
      cancelling: boolean;
    }
  | {
      kind: "filed";
      words: string;
      agent: string;
      seconds: number;
      /** New pages first. */
      pages: FiledPage[];
      /** How many of pages are new. */
      created: number;
      /** The engine put the words back. */
      restored: boolean;
      /** The filing is its own commit. */
      canUndo: boolean;
      /** Undo was pressed, and the filing is being taken back. */
      undoing: boolean;
      /** Git refused to take the filing back: a later change touched what it wrote. */
      undoRefused: boolean;
    }
  /** Undo took the filing back: its pages are gone, and its words are in the inbox again. */
  | { kind: "undone"; words: string }
  | {
      kind: "cancelled";
      words: string;
      /** Whose run was stopped: the copy names it when its partial edits stay. */
      agent: string;
      /** What the stopped run did stays, as its own commit. */
      partial: boolean;
    }
  | {
      kind: "failed";
      words: string;
      agent: string;
      /** The harness name, "claude". */
      harness: string;
      /** errorLine of the failure, or NOTE_GONE. */
      line: string;
      /** That line asks to sign in. */
      signedOut: boolean;
    };

/** A question on the Ask step, from the moment it is asked. */
export type SetupAnswer =
  /** The library's agent is answering it; `startedAt` is Date.now() when it began, or when its wait for the library ended. */
  | {
      kind: "asking";
      question: string;
      startedAt: number;
      /** Another run (the filing in progress, say) has the library. */
      waiting: boolean;
    }
  /** The answer's lines (answerSources), and the pages its [[links]] name that are in the library. */
  | { kind: "answered"; question: string; paragraphs: string[]; sources: FiledPage[] }
  /** The agent couldn't answer: `line` says why (errorLine). */
  | { kind: "failed"; question: string; agent: string; line: string };

/** Everything the setup window shows, in one snapshot (setup:changed). Later tasks add fields. */
export interface SetupSnapshot {
  /** Where Looks good makes or uses the library: the stored libraryPath, else ~/Avanzel, until Change… picks another. */
  libraryPath: string;
  /** libraryPath with the home folder as "~". */
  libraryLabel: string;
  folder: LibraryFolder;
  /** A library is open. */
  libraryReady: boolean;
  model: ModelStatus;
  /** Record a thought's shortcut, "Alt+Space". */
  shortcut: string;
  /**
   * Set me up found no agent installed on this Mac, and setup looks for one until it comes: Found says how to install
   * one. False before Set me up, and once one is installed.
   */
  noAgent: boolean;
  /**
   * The agents installed when Set me up was pressed, in the harness table's order; none before. With none installed
   * then, the ones installed since, once setup notices the first.
   */
  agents: SetupAgent[];
  /**
   * The agent that will file: the person's pick, else the library's own when the folder is one and its agent works,
   * else the best one known to work (bestAgent); null while there is none.
   */
  agent: string | null;
  /** Why Looks good couldn't make or use the library at libraryPath; null until a try fails, and again once one works or Change… picks a folder. */
  makeProblem: string | null;
  /**
   * The first-thought step's test of `shortcut`: whether another app holds it, or else whether a press arrived. It starts
   * over each time the step is entered and each time the shortcut changes there.
   */
  press: SetupPress;
  /** The first thought's filing, from the moment the thought is handed over; null before. */
  filing: SetupFiling | null;
  /** Why a typed thought wasn't taken (empty words, or a capture that couldn't be written); null once one is. */
  typeProblem: string | null;
  /** The first spoken thought on the first-thought step; waiting until a press, and again once its words are handed over. */
  thought: SetupThought;
  /** Setup can turn speech into words: the speech models are ready, or AVANZEL_FAKE_TRANSCRIPT stands in for them. */
  hears: boolean;
  /** A page opens in Obsidian: it is installed, and the library is a vault of its (obsidianUrl). */
  opensInObsidian: boolean;
  /**
   * The question the Ask step suggests about the first filing's pages (suggestQuestion), while they stand: null before
   * the filing is filed, once an undo of it has begun, and when it wrote no page.
   */
  suggestion: string | null;
  /** The question on the Ask step and how it went; null until one is asked, and again after Skip. */
  answer: SetupAnswer | null;
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
    /** Use, on the notice of a taken shortcut: `accelerator` becomes `key`'s shortcut. */
    useShortcut(key: keyof Shortcuts, accelerator: string): void;
  };
  settings: {
    get(): Promise<SettingsSnapshot>;
    onChanged(callback: (snapshot: SettingsSnapshot) => void): () => void;
    /** Settings is open and something else (an error card's Open Settings) asks for another pane. */
    onShowPane(callback: (pane: SettingsPane) => void): () => void;
    setApp(patch: Partial<AppSettings>): Promise<SettingsSnapshot>;
    setLibrary(patch: { harness?: string; models?: Record<string, string>; timeoutSeconds?: number }): Promise<SettingsSnapshot>;
    chooseLibrary(): Promise<SettingsSnapshot>;
    createLibrary(path: string): Promise<SettingsSnapshot>;
    downloadModel(): Promise<SettingsSnapshot>;
    saveTask(task: Pick<TaskInfo, "id" | "name" | "schedule" | "agent" | "enabled" | "instructions">): Promise<SettingsSnapshot>;
    runTask(id: string): Promise<SettingsSnapshot>;
    /**
     * Starts the free checks of installed agents not checked yet in this app run, which never ask the model; their
     * results arrive through onChanged.
     */
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
  setup: {
    get(): Promise<SetupSnapshot>;
    onChanged(callback: (snapshot: SetupSnapshot) => void): () => void;
    /** The window shows `step` now; the controller hangs what each step starts on it. */
    enter(step: SetupStep): Promise<SetupSnapshot>;
    /**
     * Use {agent}, on Found: installed agent `name` files from now on; setup:changed follows. One that nothing has said
     * yet works (no sign-in command, or one that couldn't be read) is asked its one short question; its result follows too.
     */
    chooseAgent(name: string): Promise<SetupSnapshot>;
    /**
     * Looks good, or Use this folder, on Found: the library at libraryPath is made, or the folder there used, with the
     * chosen agent. It resolves once that is done; a problem comes back as makeProblem.
     */
    createLibrary(): Promise<SetupSnapshot>;
    /** Change…, on Found: the folder picker, whose choice becomes libraryPath. Nothing is made yet. */
    chooseFolder(): Promise<SetupSnapshot>;
    /** Open Terminal, on a signed-out agent's Notice: Terminal opens, for the person to sign the agent in. */
    openTerminal(): void;
    /** Copy, beside an install command on Found: `text` goes to the clipboard. */
    copy(text: string): void;
    /**
     * Use {shortcut}, on the first-thought step's Notice of a taken or silent shortcut: `accelerator` becomes Record a
     * thought's shortcut, and the step listens for a press of it afresh; setup:changed follows.
     */
    useShortcut(accelerator: string): Promise<SetupSnapshot>;
    /**
     * File it, on the first-thought step's typing rows: `words` become a note in the inbox, which setup files while the
     * window shows it; setup:changed follows. Words it can't take come back as typeProblem: nothing is thrown.
     */
    typeThought(words: string): Promise<SetupSnapshot>;
    /** Cancel, while the first thought is filed: its agent stops, and what it did is taken back. */
    cancelFiling(): void;
    /** File it again, or Try again, once a filing has stopped short or been undone: the same note is filed in a new run. */
    fileAgain(): void;
    /** Undo, or ⌘Z, once the first thought is filed: the filing is taken back, and its words return to the inbox. */
    undo(): void;
    /** Continue, on the microphone's primer: macOS asks, and a grant starts the recording; setup:changed follows. */
    allowMicrophone(): void;
    /**
     * Try again, on a mic check's answer or a recording problem's Notice: a mic check's note and its recording leave the
     * library, and the step asks for the thought afresh; setup:changed follows.
     */
    tryAgain(): void;
    /** File it anyway, on a mic check's answer: its note is filed as the first thought; setup:changed follows. */
    fileAnyway(): void;
    /**
     * The suggestion, or Return in Ask your library, on the Ask step: the library's agent answers `question`, read-only,
     * one question at a time. setup:changed follows as it goes; it resolves once the answer, or the failure, is in.
     */
    ask(question: string): Promise<SetupSnapshot>;
    /** Skip, on the Ask step: the question being answered is given up, and the answer cleared. */
    skipAsk(): void;
  };
}
