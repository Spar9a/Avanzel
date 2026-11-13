import {
  folderProblem,
  MAX_SHELF_FOLDER,
  modelBytes,
  MODELS,
  SPEECH_MODELS,
  suggestFolder,
  VAD_MODEL,
} from "@avanzel/engine";
import { describe, expect, it } from "vitest";
import { DEFAULT_SKIP_APPS } from "../src/main/cursor-policy.ts";
import { shortcutRefusedLine } from "../src/renderer/settings/copy.ts";
import {
  agentNotChecked,
  AGENTS_NOT_CHECKED,
  asSentence,
  CHANGE_NOT_SAVED,
  CURSOR_DICTATION_DESCRIPTION,
  cursorKeyName,
  cursorKeyOptions,
  cursorStatus,
  DAYS,
  DELETE_FAILED_BODY,
  DICTATION_NOT_COPIED,
  DICTATION_NOT_COPIED_BODY,
  DICTATION_NOT_DELETED,
  DICTATION_NOT_INSERTED,
  dictationPlace,
  DICTATIONS_EMPTY,
  dictationsStart,
  dictationWhen,
  dictationLogLine,
  DICTATION_LOG_LABEL,
  DICTIONARY_DESCRIPTION,
  SKIP_APPS_HELP,
  skipAppsSummary,
  SKIP_NOTE,
  SKIP_SITES_HELP,
  skipSitesSummary,
  DOWNLOAD_NOT_STARTED,
  failedSaveLine,
  fileModeLine,
  FOLDER_LATIN_HINT,
  folderHint,
  folderLine,
  folderProblemText,
  kindLine,
  lastRunLine,
  leavesThisMacLine,
  libraryLine,
  ADD_DEFINITION,
  canRemoveShelf,
  definitionLine,
  handMadeFolderProblem,
  HAND_MADE_FOLDER_PROBLEM,
  SAY_WHAT_BELONGS,
  SHELF_CANCEL,
  SHELF_EDIT,
  SHELF_REMOVE,
  SUGGESTED_SAVE_LINE,
  ADD_SHELF,
  MAX_SHELF_FOLDER as APP_MAX_SHELF_FOLDER,
  NO_DEFINITION,
  removeShelfQuestion,
  SAVE_SHELF,
  shelfRowLine,
  SHELVES_EMPTY,
  SHELVES_LABEL,
  SHELVES_NOTE,
  microphoneName,
  microphoneOptions,
  notSavedLine,
  olderDictationsLine,
  PANE_LABELS,
  PERMISSION_NOT_ASKED,
  plainCause,
  refusedCall,
  remoteMessage,
  reviewNotStarted,
  scheduleParts,
  scheduleText,
  SETTING_KEPT,
  SHOW_MORE_DICTATIONS,
  speechModelLine,
  speechModelName,
  speechModelOption,
  speechSwitchFailedProblem,
  SPEECH_MODEL_COPY,
  SPEECH_MODEL_DESCRIPTION,
  RESTART_NOT_CALLED_OFF,
  RESTART_NOT_STARTED,
  UPDATE_CHECK_NOT_STARTED,
  UPDATE_NOT_NOW,
  UPDATE_RESTARTING,
  updateLine,
  updateReadyLine,
  updateReadyState,
  updateWaitLine,
  validTime,
  versionLabel,
  whenLine,
} from "../src/renderer/settings/copy.ts";
import { noSuchReview, SETTINGS_PANES, type UpdateSnapshot, type UpdateStatus, type UpdateWait } from "../src/shared/ipc.ts";
import { NO_GIT_LINE } from "../src/shared/problems.ts";

describe("settings copy", () => {
  it("the toolbar lists the panes in their order", () => {
    expect(SETTINGS_PANES.map((pane) => PANE_LABELS[pane])).toEqual(["General", "Voice", "Shortcuts", "Dictation", "Agents", "Reviews", "Privacy"]);
  });

  describe("the Dictations pane", () => {
    const now = new Date(2026, 10, 5, 15, 30); // Thu 5 Nov 2026, 15:30 local
    const at = (...parts: [number, number, number, number, number]) => new Date(...parts).toISOString();

    it("dictationWhen gives the time for today, and the day before it for any other", () => {
      expect(dictationWhen(at(2026, 10, 5, 9, 5), now)).toBe("09:05");
      expect(dictationWhen(at(2026, 10, 5, 0, 0), now)).toBe("00:00");
      expect(dictationWhen(at(2026, 10, 4, 23, 59), now)).toBe("Yesterday 23:59");
      expect(dictationWhen(at(2026, 10, 3, 14, 3), now)).toBe("3 Nov 14:03");
      expect(dictationWhen(at(2026, 0, 2, 8, 0), now)).toBe("2 Jan 08:00");
      expect(dictationWhen(at(2025, 11, 31, 22, 15), now)).toBe("31 Dec 2025 22:15");
    });

    it("dictationWhen gives a time that cannot be read as nothing, never as a date that isn't one", () => {
      expect(dictationWhen("yesterday-ish", now)).toBe("");
    });

    it("dictationPlace names the app, and its window's title or else the page's site", () => {
      expect(dictationPlace({ app: "Slack", title: "#general", site: null })).toEqual({ app: "Slack", detail: "#general" });
      expect(dictationPlace({ app: "Safari", title: null, site: "example.com" })).toEqual({ app: "Safari", detail: "example.com" });
      expect(dictationPlace({ app: "Safari", title: "A page", site: "example.com" })).toEqual({ app: "Safari", detail: "A page" });
      expect(dictationPlace({ app: "Notes", title: null, site: null })).toEqual({ app: "Notes", detail: null });
      // A dictation whose app was never known (the words were kept so they weren't lost) has no name to give.
      expect(dictationPlace({ app: "", title: null, site: null })).toEqual({ app: "An app Avanzel couldn't see", detail: null });
    });

    it("olderDictationsLine counts the dictations the list leaves out, one or many", () => {
      expect(olderDictationsLine(1)).toBe("1 older dictation is kept on this Mac.");
      expect(olderDictationsLine(5)).toBe("5 older dictations are kept on this Mac.");
      expect(olderDictationsLine(1234)).toBe("1234 older dictations are kept on this Mac.");
      expect(SHOW_MORE_DICTATIONS).toBe("Show 100 more");
    });

    it("the delete Notice's body says what is safe and offers one fix, in the words main sends", () => {
      expect(DELETE_FAILED_BODY).toBe("It is still in the history. Try deleting it again.");
      expect(DELETE_FAILED_BODY).not.toMatch(/!|Oops|Sorry|\.\.\./);
    });

    it("the empty line and its invitation, the note and the Notice's title are plain sentences", () => {
      expect(DICTATIONS_EMPTY).toBe("Nothing dictated yet.");
      for (const line of [DICTATIONS_EMPTY, dictationsStart(true), dictationsStart(false), DICTATION_NOT_INSERTED, DICTATION_NOT_DELETED, DICTATION_NOT_COPIED, DICTATION_NOT_COPIED_BODY]) {
        expect(line).toMatch(/^[A-Z]/);
        expect(line).toMatch(/\.$/);
        expect(line).not.toMatch(/!|Oops|Sorry|\.\.\./);
        expect(line).not.toMatch(/\b(he|she|his|her)\b/i);
      }
      // The switch is right above it, so it says only what is left to do.
      expect(dictationsStart(false)).toBe("Turn it on above, tap the key and speak. What you say shows here.");
      expect(dictationsStart(true)).toBe("Tap the key and speak. What you say shows here.");
      expect(DICTATION_NOT_INSERTED).toBe("These words didn't go in. Copy them to paste yourself.");
      expect(DICTATION_NOT_DELETED).toBe("That dictation couldn't be deleted.");
    });
  });

  it("libraryLine counts the six shelves' pages and says whether changes can be undone", () => {
    const shelves = { goals: 12, ideas: 41, problems: 9, memories: 18, people: 27, topics: 21 };
    expect(libraryLine(shelves, true, true, true)).toBe("128 notes on six shelves. Every change is a commit you can undo.");
    expect(libraryLine({ ideas: 1 }, true, true, true)).toBe("1 note on six shelves. Every change is a commit you can undo.");
    expect(libraryLine({}, true, true, true)).toBe("Your first thought will fill a shelf. Every change is a commit you can undo.");
    // Pages on any other shelf count, and the shelf makes the count seven.
    expect(libraryLine({ ideas: 2, projects: 5 }, false, true, true)).toBe("7 notes on 7 shelves. This folder has no git history, so changes can't be undone.");
  });

  it("libraryLine counts a shelf beyond the six only when it holds a page", () => {
    const six = { goals: 12, ideas: 41, problems: 9, memories: 18, people: 27, topics: 21 };
    expect(libraryLine({ ...six, projects: 2 }, true, true, true)).toBe("130 notes on 7 shelves. Every change is a commit you can undo.");
    expect(libraryLine({ ...six, meetings: 1, projects: 2, reading: 1 }, true, true, true)).toBe("132 notes on 9 shelves. Every change is a commit you can undo.");
    expect(libraryLine({ ideas: 1, meetings: 1 }, true, true, true)).toBe("2 notes on 7 shelves. Every change is a commit you can undo.");
    // A shelf with no pages raises nothing, and says nothing.
    expect(libraryLine({ ...six, projects: 0, meetings: 0 }, true, true, true)).toBe("128 notes on six shelves. Every change is a commit you can undo.");
    expect(libraryLine({ projects: 0 }, true, true, true)).toBe("Your first thought will fill a shelf. Every change is a commit you can undo.");
    expect(libraryLine({ projects: 3 }, true, true, true)).toBe("3 notes on 7 shelves. Every change is a commit you can undo.");
  });

  it("libraryLine says so when the library's settings turn automatic commits off, since then no change is a commit", () => {
    const off = "Automatic commits are off in this library's settings, so changes can't be undone from Avanzel.";
    expect(libraryLine({ ideas: 1 }, true, false, true)).toBe(`1 note on six shelves. ${off}`);
    expect(libraryLine({}, true, false, true)).toBe(`Your first thought will fill a shelf. ${off}`);
    // It is a sentence for a library with git. One without keeps its no-git line, whatever it says of automatic commits.
    const noGit = "This folder has no git history, so changes can't be undone.";
    expect(libraryLine({ ideas: 2 }, false, false, true)).toBe(`2 notes on six shelves. ${noGit}`);
    expect(libraryLine({ ideas: 2 }, false, true, true)).toBe(`2 notes on six shelves. ${noGit}`);
  });

  it("libraryLine tells a Mac that can't run git from a folder that has no history", () => {
    // A .git folder on a Mac whose only git is Apple's stub: the history is there, and this Mac can neither add to it nor undo from it.
    expect(NO_GIT_LINE).toBe("This Mac has no git yet, so changes can't be undone.");
    expect(libraryLine({ ideas: 1 }, true, true, false)).toBe("1 note on six shelves. This Mac has no git yet, so changes can't be undone.");
    // Whatever the library's settings say of automatic commits: nothing commits on such a Mac, so that line doesn't come into it.
    expect(libraryLine({}, true, false, false)).toBe("Your first thought will fill a shelf. This Mac has no git yet, so changes can't be undone.");
    // A folder with no .git has no history to speak of, on a Mac that can run git or not: it keeps its own line.
    const noHistory = "This folder has no git history, so changes can't be undone.";
    expect(libraryLine({ ideas: 2 }, false, true, false)).toBe(`2 notes on six shelves. ${noHistory}`);
    expect(libraryLine({ ideas: 2 }, false, false, false)).toBe(`2 notes on six shelves. ${noHistory}`);
  });

  it("asSentence ends a line with a full stop once", () => {
    expect(asSentence("Avanzel couldn't open the library at /x: EACCES: permission denied, mkdir '/x/tasks'")).toBe(
      "Avanzel couldn't open the library at /x: EACCES: permission denied, mkdir '/x/tasks'.",
    );
    expect(asSentence("Done.")).toBe("Done.");
    expect(asSentence("Is it open?")).toBe("Is it open?");
    expect(asSentence("Waiting…")).toBe("Waiting…");
  });

  it("the microphone is named as the menu names it", () => {
    const unnamed = [{ deviceId: "a", label: "" }, { deviceId: "b", label: "" }];
    expect(microphoneName(null, unnamed)).toBe("System default");
    expect(microphoneName("b", unnamed)).toBe("Microphone 2");
    expect(microphoneName("gone", unnamed)).toBe("Microphone not connected");
    expect(microphoneName("gone", [])).toBe("Microphone not connected");
    // A device with a name goes by it, and one without goes by its place in the list.
    const mixed = [{ deviceId: "a", label: "MacBook Pro Microphone" }, { deviceId: "b", label: "" }];
    expect(microphoneName("a", mixed)).toBe("MacBook Pro Microphone");
    expect(microphoneName("b", mixed)).toBe("Microphone 2");

    // The menu: System default first, then each device named the same way, with only the one in use checked.
    const options = microphoneOptions("b", unnamed);
    expect(options[0]).toEqual({ label: "System default", value: "", checked: false });
    expect(options.map((option) => option.label)).toEqual(["System default", "Microphone 1", "Microphone 2"]);
    expect(options.filter((option) => option.checked).map((option) => option.value)).toEqual(["b"]);
    expect(microphoneOptions(null, mixed).map((option) => [option.label, option.checked])).toEqual([
      ["System default", true],
      ["MacBook Pro Microphone", false],
      ["Microphone 2", false],
    ]);
    // A microphone that isn't connected leaves nothing checked, System default included: the row says so.
    expect(microphoneOptions("gone", mixed).some((option) => option.checked)).toBe(false);
  });

  it("a chosen microphone isn't called missing before the devices are listed", () => {
    // The page lists them after it opens. Until then a chosen microphone has no name to give, and isn't known to be gone.
    expect(microphoneName("b", null)).toBe("Microphone");
    expect(microphoneName(null, null)).toBe("System default");
    // The menu holds only System default meanwhile, checked when no microphone is chosen.
    expect(microphoneOptions("b", null)).toEqual([{ label: "System default", value: "", checked: false }]);
    expect(microphoneOptions(null, null)).toEqual([{ label: "System default", value: "", checked: true }]);
    // Once they are listed, a chosen microphone that isn't among them is gone, even from an empty list.
    expect(microphoneName("b", [])).toBe("Microphone not connected");
  });

  it("speechModelLine names the model in use and the languages it hears, and for a command only that it is the library's", () => {
    expect(speechModelLine({ backend: "onnx-asr", model: "nemo-parakeet-tdt-0.6b-v3" })).toBe(
      "NVIDIA Parakeet TDT 0.6B v3 turns your voice into text on this Mac, in 25 European languages including English, Ukrainian and Russian. Nothing is sent anywhere.",
    );
    expect(speechModelLine({ backend: "onnx-asr", model: "moondream-parakeet-ultra-0.6b" })).toBe(
      "Moondream Parakeet Ultra 0.6B turns your voice into text on this Mac, in 25 European languages including English, Ukrainian and Russian. Nothing is sent anywhere.",
    );
    expect(speechModelLine({ backend: "onnx-asr", model: "nemo-parakeet-tdt-0.6b-v2" })).toBe(
      "NVIDIA Parakeet TDT 0.6B v2 turns your voice into text on this Mac, in English only. Nothing is sent anywhere.",
    );
    // A command is whatever the library's settings run: it promises neither a language nor that nothing leaves the Mac.
    const command = "Turns your voice into text with the command in this library's settings.";
    expect(speechModelLine({ backend: "command", model: "" })).toBe(command);
    expect(speechModelLine({ backend: "command", model: "nemo-parakeet-tdt-0.6b-v2" })).toBe(command);
    // A model the engine doesn't run is told by the Notice under the row: this line claims no name and no languages for it.
    expect(speechModelLine({ backend: "onnx-asr", model: "parakeet-v9" })).toBe(SPEECH_MODEL_DESCRIPTION);
    expect(SPEECH_MODEL_DESCRIPTION).toBe("Turns your voice into text on this Mac. Nothing is sent anywhere.");
  });

  it("every speech model the engine runs has its name, maker and languages, in the engine's order", () => {
    // The engine has no such fields, so this is where they are decided: a model added to the engine fails here until it is added.
    expect(Object.keys(SPEECH_MODEL_COPY)).toEqual([...SPEECH_MODELS]);
    expect(SPEECH_MODELS).toEqual(Object.keys(MODELS).filter((id) => id !== VAD_MODEL));
    expect(Object.values(SPEECH_MODEL_COPY).map((copy) => `${copy.maker} ${copy.name}: ${copy.languages}`)).toEqual([
      "NVIDIA Parakeet TDT 0.6B v3: 25 European languages",
      "Moondream Parakeet Ultra 0.6B: 25 European languages",
      "NVIDIA Parakeet TDT 0.6B v2: English only",
    ]);
    expect(speechModelName("nemo-parakeet-tdt-0.6b-v2")).toBe("Parakeet TDT 0.6B v2");
  });

  it("speechModelOption gives the name, the languages and the size, and says a model not on this Mac is downloaded", () => {
    const english = "nemo-parakeet-tdt-0.6b-v2";
    expect(speechModelOption({ id: english, bytes: modelBytes(english), onThisMac: true })).toBe("Parakeet TDT 0.6B v2: English only, 661 MB");
    expect(speechModelOption({ id: english, bytes: modelBytes(english), onThisMac: false })).toBe("Parakeet TDT 0.6B v2: English only, 661 MB to download");
    expect(speechModelOption({ id: "nemo-parakeet-tdt-0.6b-v3", bytes: 670_480_039, onThisMac: true })).toBe(
      "Parakeet TDT 0.6B v3: 25 European languages, 670 MB",
    );
    // A size the snapshot couldn't tell (a quantization the engine doesn't know) isn't given; a model with no copy yet goes by the engine's name.
    expect(speechModelOption({ id: english, bytes: 0, onThisMac: false })).toBe("Parakeet TDT 0.6B v2: English only");
    expect(speechModelOption({ id: "parakeet-v9", bytes: 0, onThisMac: false })).toBe("parakeet-v9");
  });

  it("a chosen speech model whose download stopped says why, that the model in use goes on, and what Try again does", () => {
    expect(speechSwitchFailedProblem("The file wasn't found (404).", true)).toEqual({
      title: "The new speech model didn't finish downloading.",
      body: "The file wasn't found (404). Avanzel goes on hearing with the model in use, and Try again continues where it stopped.",
    });
    expect(speechSwitchFailedProblem("", false).body).toBe("Avanzel goes on hearing with the model in use, and Try again downloads it again.");
  });

  it("leavesThisMacLine says the voice stays on this Mac, unless the library's settings hand it to a command", () => {
    const words = "Your words, and any screen you capture with a comment, go only to the agent you chose, the same way your code already does.";
    // The default model and the English-only one run here: nothing of the voice goes anywhere.
    for (const model of ["nemo-parakeet-tdt-0.6b-v3", "nemo-parakeet-tdt-0.6b-v2"]) {
      expect(leavesThisMacLine({ backend: "onnx-asr", model })).toBe(`Your voice never leaves this Mac. ${words}`);
    }
    // A command is the library's own, and can send the voice anywhere: Privacy says where it goes, and doesn't promise it stays.
    expect(leavesThisMacLine({ backend: "command", model: "" })).toBe(`Your voice goes to the command in this library's settings. ${words}`);
    expect(leavesThisMacLine({ backend: "command", model: "" })).not.toMatch(/never leaves/);
  });

  it("a change main refused is told as what happened, why, and what the setting keeps, without Electron's prefix", () => {
    expect(CHANGE_NOT_SAVED).toBe("That change wasn't saved.");
    expect(SETTING_KEPT).toBe("The setting keeps its old value.");
    // The error's class goes with the prefix, and a message that is a sentence already keeps its stop.
    expect(
      notSavedLine(
        new Error("Error invoking remote method 'settings:choose-library': AvanzelError: /Applications is one of macOS's own folders. Choose or make a folder in your home folder."),
      ),
    ).toBe("/Applications is one of macOS's own folders. Choose or make a folder in your home folder. The setting keeps its old value.");
    // As an agent's line is told: no "Error:" label, a capital, a full stop.
    expect(notSavedLine(new Error("Error invoking remote method 'settings:set-app': Error: error: something odd"))).toBe(
      "Something odd. The setting keeps its old value.",
    );
    expect(notSavedLine("gone")).toBe("Gone. The setting keeps its old value.");
    // An error with nothing to say adds nothing to what the setting keeps.
    expect(notSavedLine(new Error(""))).toBe("The setting keeps its old value.");
  });

  it("a dictionary main won't keep is told plainly, and the Dictionary row says how a line is written", () => {
    expect(
      notSavedLine(
        new Error(
          "Error invoking remote method 'settings:set-library': AvanzelError: The dictionary has 501 lines, and 500 is the most it can hold. Remove the lines you use least.",
        ),
      ),
    ).toBe("The dictionary has 501 lines, and 500 is the most it can hold. Remove the lines you use least. The setting keeps its old value.");
    expect(DICTIONARY_DESCRIPTION).toBe(
      "Add one at a time. Write a name the way it should appear. To fix a word the microphone gets wrong, add what it hears after an equals sign: Ollama = Alema, Polymer. Short names such as Priya, and names with accents, are corrected only with an equals entry. The names are also given to your filing agent.",
    );
  });

  describe("the plain cause of a refusal", () => {
    const refused = (channel: string, message: string) => new Error(`Error invoking remote method '${channel}': Error: ${message}`);
    const LIBRARY = "Avanzel can't write to the library's settings.";
    const OWN = "Avanzel can't write to its own settings.";
    const FOLDER = "Avanzel can't use that folder.";
    const FILE = "Avanzel was refused access to a file it needs.";

    it("names what a refused permission was for, by the call: the library's settings, Avanzel's own, or the folder chosen", () => {
      const tmp = "open '/Users/ana/Avanzel/.avanzel/config.toml.1234.tmp'";
      expect(plainCause(refused("settings:set-library", `EACCES: permission denied, ${tmp}`))).toBe(LIBRARY);
      expect(plainCause(refused("settings:save-task", "EPERM: operation not permitted, rename '/lib/tasks/a.md.1.tmp' -> '/lib/tasks/a.md'"))).toBe(LIBRARY);
      // An app setting is Avanzel's own: its shortcuts, when it files, the microphone, opening at login.
      expect(plainCause(refused("settings:set-app", "EACCES: permission denied, open '/Users/ana/Library/Application Support/Avanzel/settings.json.tmp'"))).toBe(OWN);
      expect(notSavedLine(refused("settings:set-library", `EACCES: permission denied, ${tmp}`))).toBe(`${LIBRARY} ${SETTING_KEPT}`);
      expect(notSavedLine(refused("settings:set-app", "EACCES: permission denied, open '/x/settings.json.tmp'"))).toBe(`${OWN} ${SETTING_KEPT}`);
    });

    it("blames the folder, not Avanzel's settings, when the permission refused came as a library was chosen", () => {
      // Choosing a library reads the folder, and makes the library in it, before anything of Avanzel's own is written.
      expect(plainCause(refused("settings:choose-library", "EACCES: permission denied, scandir '/Volumes/Backups/Brain'"))).toBe(FOLDER);
      expect(plainCause(refused("settings:choose-library", "EPERM: operation not permitted, mkdir '/Volumes/Backups/Brain/inbox'"))).toBe(FOLDER);
      expect(notSavedLine(refused("settings:choose-library", "EACCES: permission denied, scandir '/Volumes/Backups/Brain'"))).toBe(
        `${FOLDER} ${SETTING_KEPT}`,
      );
      // Nothing in the sentence says what was written, or where.
      expect(FOLDER).not.toMatch(/settings|write/);
    });

    it("says the disk is full or read-only, whatever was being written", () => {
      for (const channel of ["settings:set-library", "settings:set-app", "settings:save-task", "settings:run-task"]) {
        expect(plainCause(refused(channel, "ENOSPC: no space left on device, write"))).toBe("The disk is full.");
        expect(plainCause(refused(channel, "EROFS: read-only file system, open '/Volumes/Brain/.avanzel/config.toml.1.tmp'"))).toBe("The disk is read-only.");
      }
    });

    it("tells any other system error as its message, without the file it names", () => {
      expect(plainCause(refused("settings:set-app", "EISDIR: illegal operation on a directory, open '/data/settings.json.tmp'"))).toBe(
        "EISDIR: illegal operation on a directory.",
      );
      expect(plainCause(refused("settings:set-library", "ENOENT: no such file or directory, rename '/a/c.toml.1.tmp' -> '/a/c.toml'"))).toBe(
        "ENOENT: no such file or directory.",
      );
      // No path or temporary file name is left to read.
      for (const message of ["EBUSY: resource busy or locked, open '/x/y.tmp'", "EMFILE: too many open files, open '/x/y.tmp'"]) {
        expect(plainCause(refused("settings:set-app", message))).not.toMatch(/\/|\.tmp|'/);
      }
    });

    it("says no more than that a file was refused, in a plain sentence, for a call that writes no setting", () => {
      // Run now, Check, Allow… and the download's Try again: nothing in what they say is a code, a file or a setting.
      for (const [channel, message] of [
        ["settings:run-task", "EACCES: permission denied, open '/data/run-state.json.1.tmp'"],
        ["settings:check-agent", "EPERM: operation not permitted, open '/data/agents.json'"],
        ["settings:check-agents", "EACCES: permission denied, spawn"],
        ["settings:request-permission", "EPERM: operation not permitted, open '/data/tcc.db'"],
        ["settings:download-model", "EACCES: permission denied, mkdir '/Users/ana/Library/Application Support/Avanzel/models'"],
      ] as const) {
        expect(plainCause(refused(channel, message)), channel).toBe(FILE);
      }
      expect(FILE).not.toMatch(/EACCES|EPERM|settings/);
    });

    it("keeps the words of a refusal that is Avanzel's own, and the folder the person chose in them", () => {
      expect(
        plainCause(refused("settings:choose-library", "/Applications is one of macOS's own folders. Choose or make a folder in your home folder.")),
      ).toBe("/Applications is one of macOS's own folders. Choose or make a folder in your home folder.");
      expect(plainCause(refused("settings:save-task", "No scheduled review called x."))).toBe("No scheduled review called x.");
    });

    it("reads an error that isn't an IPC rejection the same way, and nothing as nothing", () => {
      expect(plainCause(new Error("ENOSPC: no space left on device"))).toBe("The disk is full.");
      expect(plainCause(new Error("EACCES: permission denied, open '/x/y.tmp'"))).toBe(FILE); // no channel: nothing to name but the file
      expect(plainCause(new Error(""))).toBe("");
      expect(plainCause("gone")).toBe("Gone.");
    });
  });

  describe("a refused call's Notice", () => {
    const error = new Error("Error invoking remote method 'settings:set-library': Error: EACCES: permission denied, open '/lib/.avanzel/config.toml.1.tmp'");

    it("is headed “That change wasn't saved.” for a change, whose body says what the setting keeps", () => {
      expect(refusedCall(error)).toEqual({
        title: CHANGE_NOT_SAVED,
        body: "Avanzel can't write to the library's settings. The setting keeps its old value.",
      });
    });

    it("has a title of its own for a call that saves nothing, and tells only why", () => {
      expect(refusedCall(error, "Weekly review didn't start.")).toEqual({
        title: "Weekly review didn't start.",
        body: "Avanzel can't write to the library's settings.",
      });
      expect(refusedCall(new Error("Error invoking remote method 'settings:run-task': Error: EACCES: permission denied, open '/x/run-state.json.tmp'"), "Weekly review didn't start.")).toEqual({
        title: "Weekly review didn't start.",
        body: "Avanzel was refused access to a file it needs.",
      });
    });

    it("names what didn't happen, in sentence case, with a full stop", () => {
      expect(reviewNotStarted("Weekly review")).toBe("Weekly review didn't start.");
      expect(reviewNotStarted("Evening review")).toBe("Evening review didn't start.");
      expect(agentNotChecked("Claude Code")).toBe("Claude Code couldn't be checked.");
      expect(AGENTS_NOT_CHECKED).toBe("The agents couldn't be checked.");
      expect(PERMISSION_NOT_ASKED).toBe("Avanzel couldn't ask macOS.");
      expect(DOWNLOAD_NOT_STARTED).toBe("The download didn't start.");
      for (const title of [reviewNotStarted("Weekly review"), agentNotChecked("Codex"), AGENTS_NOT_CHECKED, PERMISSION_NOT_ASKED, DOWNLOAD_NOT_STARTED]) {
        expect(title).toMatch(/^\p{Lu}[^.]*\.$/u);
        expect(title).not.toMatch(/saved|change/i); // none of them saves a setting
      }
    });
  });
});

describe("a scheduled review's copy", () => {
  // A Friday, at noon.
  const now = new Date(2026, 9, 23, 12, 0);
  const ranAt = (date: Date) => ({ running: false, lastRun: date.toISOString() });

  it("whenLine says when a review runs, and leaves a schedule it can't read as it is", () => {
    expect(whenLine("daily 21:00")).toBe("Every day at 21:00");
    expect(whenLine("weekly sun 18:00")).toBe("Sundays at 18:00");
    expect(whenLine("weekly sat 07:05")).toBe("Saturdays at 07:05");
    expect(whenLine("monthly 1 09:00")).toBe("monthly 1 09:00");
  });

  it("lastRunLine says whether a review runs now, and when it last ran, nearest first", () => {
    expect(lastRunLine({ running: true, lastRun: null }, now)).toBe("Running now…");
    expect(lastRunLine({ running: true, lastRun: new Date(2026, 9, 22, 21, 0).toISOString() }, now)).toBe("Running now…");
    expect(lastRunLine({ running: false, lastRun: null }, now)).toBe("Not run yet.");
    expect(lastRunLine(ranAt(new Date(2026, 9, 23, 9, 5)), now)).toBe("Last run today at 09:05.");
    expect(lastRunLine(ranAt(new Date(2026, 9, 22, 21, 0)), now)).toBe("Last run yesterday at 21:00.");
    expect(lastRunLine(ranAt(new Date(2026, 9, 18, 18, 0)), now)).toBe("Last run on Sunday at 18:00.");
    // Six days back is still named by its weekday; a week back would be today's, so it goes by its date.
    expect(lastRunLine(ranAt(new Date(2026, 9, 17, 6, 30)), now)).toBe("Last run on Saturday at 06:30.");
    expect(lastRunLine(ranAt(new Date(2026, 9, 16, 21, 0)), now)).toBe("Last run on 16 Oct at 21:00.");
    expect(lastRunLine(ranAt(new Date(2026, 9, 2, 18, 0)), now)).toBe("Last run on 2 Oct at 18:00.");
    // A run in another year says which.
    expect(lastRunLine(ranAt(new Date(2025, 11, 30, 21, 0)), now)).toBe("Last run on 30 Dec 2025 at 21:00.");
  });

  it("validTime takes HH:MM as a schedule does, zero-padded, and nothing else", () => {
    expect(validTime(" 7:30 ")).toBe("07:30");
    expect(validTime("21:00")).toBe("21:00");
    expect(validTime("0:00")).toBe("00:00");
    for (const text of ["24:00", "21:60", "9", "9:5", "", "7.30", "07:30 pm", "123:00"]) expect(validTime(text)).toBeNull();
  });

  it("scheduleParts and scheduleText take a schedule apart and put it back", () => {
    const weekly = scheduleParts("weekly sun 18:00");
    expect(weekly).toEqual({ every: "weekly", day: "sun", time: "18:00" });
    expect(scheduleText(weekly.every, weekly.day, weekly.time)).toBe("weekly sun 18:00");
    // A daily review starts the day from Sunday, for when it is made weekly.
    const daily = scheduleParts("daily 21:00");
    expect(daily).toEqual({ every: "daily", day: "sun", time: "21:00" });
    expect(scheduleText(daily.every, daily.day, daily.time)).toBe("daily 21:00");
    expect(scheduleText("weekly", "mon", "07:30")).toBe("weekly mon 07:30");
    expect(scheduleText("daily", "mon", "07:30")).toBe("daily 07:30");
  });

  it("DAYS lists the week from Sunday, by name", () => {
    expect(DAYS.map((day) => day.value)).toEqual(["sun", "mon", "tue", "wed", "thu", "fri", "sat"]);
    expect(DAYS.map((day) => day.label)).toEqual(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
  });

  it("fileModeLine says when Tonight files only while the evening review is on", () => {
    // On, daily: at its time.
    expect(fileModeLine({ schedule: "daily 21:00", enabled: true })).toBe(
      "Right away uses your agent now. Tonight waits for the evening review at 21:00.",
    );
    // On, but not daily: its schedule as the Reviews pane words it.
    expect(fileModeLine({ schedule: "weekly sun 18:00", enabled: true })).toBe(
      "Right away uses your agent now. Tonight waits for the evening review, Sundays at 18:00.",
    );
    // Off, or a library without one: new thoughts stay in the inbox until it runs.
    const off = "Right away uses your agent now. Tonight keeps new thoughts in the inbox until the evening review runs.";
    expect(fileModeLine({ schedule: "daily 21:00", enabled: false })).toBe(off);
    expect(fileModeLine(null)).toBe(off);
  });

  it("failedSaveLine says only what is true of the review as stored", () => {
    const evening = { id: "evening-review", kind: "evening-review", enabled: true };
    // Main lists no review of that id: its file is missing, or can't be used, and it doesn't run.
    expect(noSuchReview("evening-review")).toBe("No scheduled review called evening-review.");
    expect(failedSaveLine(evening, noSuchReview("evening-review"))).toBe(
      "No scheduled review called evening-review. Its file, tasks/evening-review.md, is missing or can't be used, so it doesn't run.",
    );
    // Stored as off, as the switch above the Notice shows: it stays off.
    expect(failedSaveLine({ ...evening, enabled: false }, "EACCES: permission denied")).toBe("EACCES: permission denied. It stays off, as last saved.");
    // On, and a kind Avanzel runs: it runs as stored.
    expect(failedSaveLine(evening, "EACCES: permission denied")).toBe("EACCES: permission denied. It still runs as last saved.");
    expect(failedSaveLine({ id: "weekly-review", kind: "review", enabled: true }, "EROFS: read-only file system")).toBe(
      "EROFS: read-only file system. It still runs as last saved.",
    );
    // On, but custom: Avanzel doesn't run it, and its file is as it was.
    expect(failedSaveLine({ id: "standup", kind: "custom", enabled: true }, "EACCES: permission denied")).toBe(
      "EACCES: permission denied. Its file hasn't changed.",
    );
  });

  it("kindLine says what each kind of review does", () => {
    expect(kindLine("evening-review")).toBe("Files anything still in the inbox and writes a short summary.");
    expect(kindLine("review")).toBe("Looks over the whole library and writes a report in reviews/.");
    expect(kindLine("custom")).toBe("Avanzel doesn't run custom reviews yet.");
  });

  it("remoteMessage keeps only what went wrong from an IPC rejection", () => {
    expect(
      remoteMessage(new Error("Error invoking remote method 'settings:save-task': AvanzelError: No scheduled review called x.")),
    ).toBe("No scheduled review called x.");
    expect(remoteMessage(new Error("Error invoking remote method 'settings:save-task': Error: EACCES: permission denied"))).toBe(
      "EACCES: permission denied",
    );
    expect(remoteMessage(new Error("No scheduled review called x."))).toBe("No scheduled review called x.");
    expect(remoteMessage("gone")).toBe("gone");
  });

  it("the keys dictation can use are named as the keyboard names them, with the chosen one checked", () => {
    expect(cursorKeyOptions("left-option").map((option) => [option.label, option.value, option.checked])).toEqual([
      ["Right Option", "right-option", false],
      ["Left Option", "left-option", true],
      ["Right Command", "right-command", false],
      ["Right Control", "right-control", false],
    ]);
    expect(cursorKeyName("right-control")).toBe("Right Control");
  });

  it("the dictation switch says in one calm sentence how it works", () => {
    expect(CURSOR_DICTATION_DESCRIPTION).toBe("Tap the key to start and again to finish, or press Esc to cancel. The words go where the cursor is.");
  });

  it("the library log's switch says where the words go and that they stay out of git, and once it is on, that sync tools' copies are outside it", () => {
    expect(DICTATION_LOG_LABEL).toBe("Keep what I dictate in the library");
    expect(dictationLogLine(false)).toBe("Each dictation is also written to raw/dictations/ in the library, one file a day, kept out of git, where your agent can read it.");
    expect(dictationLogLine(true)).toBe(
      "Each dictation is also written to raw/dictations/ in the library, one file a day, kept out of git, where your agent can read it. " +
        "Copies made by sync tools such as Obsidian Sync or iCloud are outside this: a dictation you forget may stay in them.",
    );
  });

  it("the skip lists say that what is said there still goes in but is never kept, and what a line holds", () => {
    expect(SKIP_NOTE).toBe("What you dictate there still goes in, but is never kept.");
    expect(SKIP_APPS_HELP).toBe("Add an app by its bundle id, such as com.apple.Passwords.");
    // Only the browsers that say which page is open can skip a site; the line doesn't promise more.
    expect(SKIP_SITES_HELP).toBe("Add a website by its address, such as example.com. Safari and Chrome-based browsers say which site is open. Other browsers can't, so there a dictation is kept.");
    for (const line of [dictationLogLine(true), SKIP_NOTE, SKIP_APPS_HELP, SKIP_SITES_HELP]) {
      expect(line).toMatch(/^[A-Z][^!]*\.$/);
      expect(line).not.toMatch(/Oops|Sorry/);
    }
  });

  describe("what a skip list's row says of it", () => {
    it("names every app the list comes with as a person knows it, Enpass once under its two ids, and counts what doesn't fit", () => {
      expect(skipAppsSummary(DEFAULT_SKIP_APPS)).toBe("1Password, 1Password 7, Bitwarden and 6 more");
      expect(DEFAULT_SKIP_APPS.map((id) => skipAppsSummary([id]))).toEqual([
        "1Password",
        "1Password 7",
        "Bitwarden",
        "Keychain Access",
        "Passwords",
        "KeePassXC",
        "LastPass",
        "Dashlane",
        "Enpass",
        "Enpass",
      ]);
      expect(skipAppsSummary(["com.enpass.Enpass", "in.sinew.Enpass-Desktop"])).toBe("Enpass");
    });

    it("ignores capitals, as the rule does, and shows an app it can't name as the end of its id", () => {
      expect(skipAppsSummary([])).toBe("None");
      expect(skipAppsSummary(["COM.BITWARDEN.DESKTOP", "com.acme.Notes"])).toBe("Bitwarden and Notes");
      expect(skipAppsSummary(["com.acme.Notes", "com.acme.Mail", "com.acme.Chat"])).toBe("Notes, Mail and Chat");
    });

    it("names the sites as the library keeps them, and where the list can hold, as the field with its reason may be shut", () => {
      expect(skipSitesSummary([])).toBe("None");
      expect(skipSitesSummary(["bank.example"])).toBe("bank.example, in Safari and Chrome-based browsers");
      expect(skipSitesSummary(["a.example", "b.example", "c.example", "d.example"])).toBe("a.example, b.example, c.example and 1 more, in Safari and Chrome-based browsers");
    });
  });

  describe("cursorStatus", () => {
    const sees = { available: true, accessibility: true, inputMonitoring: true };

    it("says all is well when both permissions are granted, with nothing to press", () => {
      expect(cursorStatus(sees)).toEqual({ line: "Avanzel can see the key and paste for you.", fix: null });
    });

    it("names the one permission that is missing, with a button that opens its pane", () => {
      expect(cursorStatus({ ...sees, inputMonitoring: false })).toEqual({
        line: "Avanzel needs Input Monitoring to see the key.",
        fix: "Open System Settings",
      });
      expect(cursorStatus({ ...sees, accessibility: false })).toEqual({
        line: "Avanzel needs Accessibility to paste for you.",
        fix: "Open System Settings",
      });
    });

    it("names both in one sentence when both are missing", () => {
      expect(cursorStatus({ available: true, accessibility: false, inputMonitoring: false })).toEqual({
        line: "Avanzel needs Input Monitoring to see the key and Accessibility to paste for you.",
        fix: "Open System Settings",
      });
    });

    it("says it is not available on a Mac without the helper, and offers nothing to press", () => {
      // The permissions mean nothing then, whatever they say.
      expect(cursorStatus({ available: false, accessibility: false, inputMonitoring: false })).toEqual({
        line: "Dictating into any app isn't available on this Mac.",
        fix: null,
      });
    });

    it("keeps to the copy rules: sentence case, a full stop, no exclamation mark", () => {
      const lines = [
        CURSOR_DICTATION_DESCRIPTION,
        ...[
          sees,
          { ...sees, inputMonitoring: false },
          { ...sees, accessibility: false },
          { available: true, accessibility: false, inputMonitoring: false },
          { available: false, accessibility: false, inputMonitoring: false },
        ].map((state) => cursorStatus(state).line),
      ];
      for (const line of lines) {
        expect(line).toMatch(/^[A-Z][^!]*\.$/);
        expect(line.length).toBeLessThan(100);
        expect(line).not.toMatch(/\b[A-Z]{2,}\b|Oops|Sorry/);
      }
    });
  });
});

describe("what the Updates group says of Avanzel's own update", () => {
  // A Friday, at noon.
  const now = new Date(2026, 9, 23, 12, 0);
  const update = (status: UpdateStatus, checkedAt: Date | null = null): UpdateSnapshot => ({ version: "0.2.0", status, checkedAt: checkedAt?.toISOString() ?? null });
  const ready = { kind: "ready", version: "0.3.1", waitingFor: null, restarting: false } as const;
  const WAITS: readonly UpdateWait[] = ["recording", "transcription", "filing", "call", "answer", "save", "review"];

  it("names the row by the version that runs", () => {
    expect(versionLabel("0.2.0")).toBe("Avanzel 0.2.0");
  });

  it("says what the update is doing, from nothing checked yet to a download's version", () => {
    expect(updateLine(update({ kind: "off" }), true, now)).toBe("This build doesn't check for updates.");
    expect(updateLine(update({ kind: "idle" }), true, now)).toBe("Not checked yet.");
    expect(updateLine(update({ kind: "checking" }), true, now)).toBe("Checking for updates…");
    expect(updateLine(update({ kind: "downloading", version: "0.3.1", percent: 42 }), true, now)).toBe("Downloading Avanzel 0.3.1…");
  });

  it("says it is up to date with when the feed last answered, as a review's last run says when", () => {
    expect(updateLine(update({ kind: "current" }, new Date(2026, 9, 23, 9, 5)), true, now)).toBe("Up to date. Checked today at 09:05.");
    expect(updateLine(update({ kind: "current" }, new Date(2026, 9, 22, 21, 0)), true, now)).toBe("Up to date. Checked yesterday at 21:00.");
    expect(updateLine(update({ kind: "current" }, new Date(2026, 9, 18, 18, 0)), true, now)).toBe("Up to date. Checked on Sunday at 18:00.");
    expect(updateLine(update({ kind: "current" }, new Date(2026, 9, 2, 18, 0)), true, now)).toBe("Up to date. Checked on 2 Oct at 18:00.");
    expect(updateLine(update({ kind: "current" }), true, now)).toBe("Up to date.");
  });

  it("says an update that is ready installs on quit, and what a restart that was asked for waits for", () => {
    expect(updateReadyLine("0.3.1")).toBe("Avanzel 0.3.1 is ready.");
    expect(updateLine(update(ready), true, now)).toBe("Avanzel 0.3.1 is ready. It installs when you quit Avanzel.");
    expect(updateLine(update({ ...ready, waitingFor: "filing" }), true, now)).toBe("Avanzel restarts once the filing ends. Nothing is lost.");
    expect(updateLine(update({ ...ready, restarting: true }), true, now)).toBe("Restarting…");
    expect(UPDATE_RESTARTING).toBe("Restarting…");
    // The panel's foot says the same, shorter while nothing was asked.
    expect(updateReadyState(ready)).toBe("Avanzel 0.3.1 is ready.");
    expect(updateReadyState({ ...ready, waitingFor: "call" })).toBe("Avanzel restarts once it stops taking notes on the call. Nothing is lost.");
    expect(updateReadyState({ ...ready, restarting: true })).toBe("Restarting…");
  });

  it("names each piece of work a restart waits for", () => {
    expect(WAITS.map(updateWaitLine)).toEqual([
      "Avanzel restarts once the recording ends. Nothing is lost.",
      "Avanzel restarts once the recording is transcribed. Nothing is lost.",
      "Avanzel restarts once the filing ends. Nothing is lost.",
      "Avanzel restarts once it stops taking notes on the call. Nothing is lost.",
      "Avanzel restarts once the answer comes. Nothing is lost.",
      "Avanzel restarts once the answer is saved. Nothing is lost.",
      "Avanzel restarts once the review ends. Nothing is lost.",
    ]);
  });

  it("tells a problem by what failed, and promises to try again only while Avanzel looks by itself", () => {
    expect(updateLine(update({ kind: "problem", stage: "check" }), true, now)).toBe("Avanzel couldn't check for updates. It will try again later.");
    expect(updateLine(update({ kind: "problem", stage: "download" }), true, now)).toBe("Avanzel couldn't download the update. It will try again later.");
    expect(updateLine(update({ kind: "problem", stage: "install" }), true, now)).toBe("Avanzel couldn't install the update. It will try again later.");
    expect(updateLine(update({ kind: "problem", stage: "check" }), false, now)).toBe("Avanzel couldn't check for updates. Nothing has changed.");
  });

  it("keeps to the copy rules: sentence case, the one-character ellipsis, no exclamation mark, no shouting", () => {
    const statuses: UpdateStatus[] = [
      { kind: "off" },
      { kind: "idle" },
      { kind: "checking" },
      { kind: "current" },
      { kind: "downloading", version: "0.3.1", percent: 7 },
      ready,
      { ...ready, restarting: true },
      ...WAITS.map((waitingFor) => ({ ...ready, waitingFor })),
      { kind: "problem", stage: "check" },
      { kind: "problem", stage: "download" },
      { kind: "problem", stage: "install" },
    ];
    const lines = [
      ...statuses.flatMap((status) => [updateLine(update(status, now), true, now), updateLine(update(status, now), false, now)]),
      UPDATE_CHECK_NOT_STARTED,
      RESTART_NOT_STARTED,
      RESTART_NOT_CALLED_OFF,
    ];
    // Not now is a button's label: sentence case, no full stop. It is the words macOS puts on its own deferred updates.
    expect(UPDATE_NOT_NOW).toBe("Not now");
    for (const line of lines) {
      expect(line).toMatch(/^\p{Lu}/u);
      expect(line).toMatch(/[.…]$/);
      expect(line).not.toContain("!");
      expect(line).not.toContain("...");
      expect(line).not.toMatch(/\b[A-Z]{2,}\b|Oops|Sorry|successfully/);
    }
  });
});

describe("Settings → Your shelves", () => {
  // The renderer can't import the engine, so it keeps its own copy of the folder rule. These hold the copy equal to the engine's.
  const FOLDERS = [
    "projects", "side-quests-2", "a".repeat(40), "Projects", "-a", "a--b", "a-", "a".repeat(41), "", "my projects", "проекты",
    "goals", "ideas", "problems", "memories", "people", "topics", "meetings", "inbox", "raw", "reviews", "tasks", ".x", "x_y",
  ];
  const TAKEN: readonly (readonly string[])[] = [[], ["projects"], ["other", "side-quests-2"]];

  it("makes the folder to suggest as the engine does", () => {
    for (const name of ["My Projects", "Проекты", "", "  Side   quests, 2! ", "Café à Paris", "a b c d e f g h", "x".repeat(60), "Ideas 💡"]) {
      expect(folderHint(name)).toBe(suggestFolder(name));
    }
    expect(folderHint("My Projects")).toBe("my-projects");
  });

  it("asks for a folder typed in Latin letters when the name has none, and nothing crashes", () => {
    expect(folderHint("Проекты")).toBe("");
    expect(FOLDER_LATIN_HINT).toBe("Type a folder name in Latin letters, such as projects.");
    // The hint shows for a name with no folder to suggest, and for no name at all it stays quiet.
    expect(folderLine("Проекты", "", [])).toBe(FOLDER_LATIN_HINT);
    expect(folderLine("", "", [])).toBeUndefined();
    expect(folderLine("My Projects", "my-projects", [])).toBeUndefined();
  });

  it("tells a folder's problem in the engine's words", () => {
    for (const taken of TAKEN) {
      for (const folder of FOLDERS) {
        expect(folderProblemText(folder, taken)).toBe(folderProblem(folder, taken));
      }
    }
    expect(folderLine("Projects", "ideas", [])).toBe(folderProblem("ideas", []));
    expect(folderLine("Projects", "projects", ["projects"])).toContain("already exists");
  });

  it("holds the folder limit the engine holds", () => {
    expect(APP_MAX_SHELF_FOLDER).toBe(MAX_SHELF_FOLDER);
  });

  it("has the group's words", () => {
    expect(SHELVES_LABEL).toBe("Your shelves");
    expect(SHELVES_NOTE).toBe("Shelves you add here are in your library's AGENTS.md, and the librarian files onto them.");
    expect(SHELVES_EMPTY).toBe("None yet.");
    expect(ADD_SHELF).toBe("Add shelf");
    expect(SAVE_SHELF).toBe("Save shelf");
    expect(NO_DEFINITION).toBe("No definition yet");
    expect(ADD_DEFINITION).toBe("Add definition");
    expect(removeShelfQuestion("Projects", true)).toBe("Remove the Projects shelf? Its folder is empty, so nothing else changes.");
    expect(removeShelfQuestion("Trips", false)).toBe("Remove the Trips shelf? Its folder keeps the files that aren't pages.");
  });

  it("offers Remove only on an own shelf with no pages, as the engine only removes those", () => {
    expect(canRemoveShelf({ definition: "Work with a goal.", pages: 0 })).toBe(true);
    // A folder that holds files that aren't pages is still offered: the folder and those files stay, and its question says so.
    const notEmpty = { definition: "Work with a goal.", pages: 0, empty: false };
    expect(canRemoveShelf(notEmpty)).toBe(true);
    expect(canRemoveShelf({ definition: "Work with a goal.", pages: 3 })).toBe(false);
    // A folder made by hand has no definition: it is no shelf of the owner's yet, and the engine has none to remove.
    expect(canRemoveShelf({ definition: "", pages: 0 })).toBe(false);
    expect(canRemoveShelf({ definition: "", pages: 2 })).toBe(false);
  });

  it("says why a hand-made folder whose name breaks the folder rule can't be given a definition", () => {
    expect(HAND_MADE_FOLDER_PROBLEM).toBe(
      "This folder's name can't be a shelf's. Rename it in Finder with lowercase Latin letters, digits and dashes, then add a definition.",
    );
    for (const folder of ["Projects", "my projects", "проекты", "a--b", ".hidden", "a".repeat(41), "x_y"]) {
      expect(handMadeFolderProblem(folder)).toBe(HAND_MADE_FOLDER_PROBLEM);
      expect(folderProblem(folder, [])).not.toBeNull();
    }
    for (const folder of ["projects", "side-quests-2", "a".repeat(40)]) {
      expect(handMadeFolderProblem(folder)).toBeNull();
      expect(folderProblem(folder, [])).toBeNull();
    }
  });

  it("says what Save does when the form was opened from a suggestion", () => {
    expect(SUGGESTED_SAVE_LINE).toBe("Saving makes the shelf and moves the page it was suggested for onto it.");
  });

  it("asks for the definition once a name is typed, and not before", () => {
    expect(SAY_WHAT_BELONGS).toBe("Say what belongs on it to save the shelf.");
    expect(definitionLine("Projects", "")).toBe(SAY_WHAT_BELONGS);
    expect(definitionLine("Projects", "   ")).toBe(SAY_WHAT_BELONGS);
    expect(definitionLine("", "")).toBeUndefined();
    expect(definitionLine("Projects", "Work with a goal.")).toBeUndefined();
  });

  it("keeps the form's button words", () => {
    expect([SHELF_CANCEL, SHELF_EDIT, SHELF_REMOVE]).toEqual(["Cancel", "Edit", "Remove"]);
  });

  it("describes a shelf by its definition and its pages", () => {
    expect(shelfRowLine("Work with a goal.", 0)).toBe("Work with a goal. · 0 pages");
    expect(shelfRowLine("Work with a goal.", 1)).toBe("Work with a goal. · 1 page");
    expect(shelfRowLine("", 12)).toBe("No definition yet · 12 pages");
  });
});

describe("shortcutRefusedLine", () => {
  it("says why ⌘ and ⇧ alone aren't taken, and offers the same keys with ⌥", () => {
    expect(shortcutRefusedLine("Alt+Shift+R")).toBe("A shortcut needs ⌃ or ⌥, as apps use ⌘ and ⇧ for their own. Try ⌥⇧R.");
    expect(shortcutRefusedLine("Alt+K")).toBe("A shortcut needs ⌃ or ⌥, as apps use ⌘ and ⇧ for their own. Try ⌥K.");
  });
});
