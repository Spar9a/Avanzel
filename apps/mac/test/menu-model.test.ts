import { describe, expect, it } from "vitest";
import { buildMenuModel, formatWhen, menuLabel, type MenuInput } from "../src/main/menu-model.ts";
import { DEFAULT_SETTINGS } from "../src/main/store.ts";

const now = new Date(2026, 9, 20, 14, 3); // Tue 20 Oct 2026, 14:03 local

function input(overrides: Partial<MenuInput> = {}): MenuInput {
  return {
    libraryReady: true,
    inbox: 2,
    recent: [
      { title: "Launch the indie game dev podcast", shelf: "goals", path: "goals/launch.md" },
      { title: "Маленький сад на балконе", shelf: "ideas", path: "ideas/balcony-garden.md" },
    ],
    tasks: [
      { id: "evening-review", name: "Evening review", at: new Date(2026, 9, 20, 21, 0), enabled: true, running: false },
      { id: "weekly-review", name: "Weekly review", at: new Date(2026, 9, 25, 18, 0), enabled: true, running: false },
    ],
    recording: false,
    shortcuts: DEFAULT_SETTINGS.shortcuts,
    undoableReview: false,
    ...overrides,
  };
}

const labels = (items: ReturnType<typeof buildMenuModel>) =>
  items.flatMap((item) => (item.type === "separator" ? ["--"] : [item.label]));

describe("tray menu", () => {
  it("leads with the inbox count and the next shadow task", () => {
    const [head] = buildMenuModel(input(), now);
    expect(head).toMatchObject({ type: "header", label: "Avanzel" });
    expect(head && "sublabel" in head && head.sublabel).toBe("2 notes in the inbox. Next: Evening review at 21:00.");
  });

  it("offers the three captures with their shortcuts, recently filed pages and tasks", () => {
    const items = buildMenuModel(input(), now);
    expect(labels(items)).toEqual([
      "Avanzel", "--",
      "Record a thought", "Capture screen with a comment", "Type a thought…", "Ask your library…", "--",
      "Recently filed", "Launch the indie game dev podcast", "Маленький сад на балконе", "--",
      "Shadow tasks", "Evening review", "Weekly review", "--",
      "Open library", "Settings…", "Quit Avanzel",
    ]);
    const record = items.find((i) => i.type === "item" && i.label === "Record a thought");
    expect(record).toMatchObject({ action: "dictate", accelerator: "Alt+Space" });
    const weekly = items.find((i) => i.type === "item" && i.label === "Weekly review");
    expect(weekly).toMatchObject({ action: "task:weekly-review", detail: "Sun 18:00" });
  });

  it("turns the first item into Stop while recording", () => {
    const items = buildMenuModel(input({ recording: true }), now);
    expect(items.find((i) => i.type === "item" && i.action === "dictate")).toMatchObject({ label: "Stop recording" });
  });

  it("says an empty inbox plainly and offers undo after an evening review", () => {
    const items = buildMenuModel(input({ inbox: 0, undoableReview: true }), now);
    const head = items[0];
    expect(head && "sublabel" in head && head.sublabel).toBe("Inbox is empty. Next: Evening review at 21:00.");
    expect(labels(items)).toContain("Undo last evening review");
  });

  it("only offers setup when there is no library yet", () => {
    expect(labels(buildMenuModel(input({ libraryReady: false }), now))).toEqual([
      "Avanzel", "--", "Set up Avanzel…", "--", "Quit Avanzel",
    ]);
  });

  it("says why the library couldn't be opened", () => {
    const problem = "Avanzel couldn't open the library at /Users/me/Brain: EACCES: permission denied, mkdir '/Users/me/Brain/tasks'";
    const [head, ...rest] = buildMenuModel(input({ libraryReady: false, problem }), now);
    expect(head).toEqual({ type: "header", label: "Avanzel", sublabel: problem });
    expect(labels(rest)).toEqual(["--", "Set up Avanzel…", "--", "Quit Avanzel"]);
  });

  it("puts an item's detail in parentheses, since macOS menus don't line up tabs", () => {
    expect(menuLabel({ label: "Weekly review", detail: "Sun 18:00" })).toBe("Weekly review (Sun 18:00)");
    expect(menuLabel({ label: "Open library" })).toBe("Open library");
  });

  it("formats times relative to today", () => {
    expect(formatWhen(new Date(2026, 9, 20, 21, 0), now)).toBe("21:00");
    expect(formatWhen(new Date(2026, 9, 21, 9, 5), now)).toBe("Tomorrow 09:05");
    expect(formatWhen(new Date(2026, 9, 25, 18, 0), now)).toBe("Sun 18:00");
    expect(formatWhen(new Date(2026, 10, 2, 18, 0), now)).toBe("2 Nov 18:00");
  });
});
