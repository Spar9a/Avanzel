import { describe, expect, it } from "vitest";
import { asSentence, libraryLine, microphoneName, microphoneOptions, PANE_LABELS } from "../src/renderer/settings/copy.ts";
import { SETTINGS_PANES } from "../src/shared/ipc.ts";

describe("settings copy", () => {
  it("the toolbar lists the panes in their order", () => {
    expect(SETTINGS_PANES.map((pane) => PANE_LABELS[pane])).toEqual(["General", "Voice", "Agents", "Reviews", "Privacy"]);
  });

  it("libraryLine counts the six shelves' pages and says whether changes can be undone", () => {
    const shelves = { goals: 12, ideas: 41, problems: 9, memories: 18, people: 27, topics: 21 };
    expect(libraryLine(shelves, true)).toBe("128 pages on six shelves. Every change is a commit you can undo.");
    expect(libraryLine({ ideas: 1 }, true)).toBe("1 page on six shelves. Every change is a commit you can undo.");
    expect(libraryLine({}, true)).toBe("Your first thought will fill a shelf. Every change is a commit you can undo.");
    // A folder of the library's own that isn't one of the six shelves doesn't count.
    expect(libraryLine({ ideas: 2, projects: 5 }, false)).toBe("2 pages on six shelves. This folder has no git history, so changes can't be undone.");
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
});
