import { describe, expect, it } from "vitest";
import { buildMenuModel, formatWhen, menuLabel, speechProblemOf, statusLine, type MenuInput, type MenuTask } from "../src/main/menu-model.ts";
import { DEFAULT_SETTINGS } from "../src/main/store.ts";
import { downloadFailedProblem, voiceSettingsProblem } from "../src/shared/problems.ts";

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
      { id: "evening-review", name: "Evening review", kind: "evening-review", at: new Date(2026, 9, 20, 21, 0), enabled: true, running: false },
      { id: "weekly-review", name: "Weekly review", kind: "review", at: new Date(2026, 9, 25, 18, 0), enabled: true, running: false },
    ],
    filedToday: 3,
    speechProblem: null,
    recording: false,
    shortcuts: DEFAULT_SETTINGS.shortcuts,
    unregisteredShortcuts: [],
    undoableReview: false,
    undoableFiling: false,
    ...overrides,
  };
}

const labels = (items: ReturnType<typeof buildMenuModel>) =>
  items.flatMap((item) => (item.type === "separator" ? ["--"] : [item.label]));

describe("tray menu", () => {
  it("leads with how today went, which opens the inbox, and the inbox count under it", () => {
    const [head] = buildMenuModel(input(), now);
    expect(head).toEqual({
      type: "item",
      label: "3 thoughts filed today. Evening review at 21:00.",
      action: "open-inbox",
      sublabel: "2 notes in the inbox",
    });
  });

  it("counts a single note in the inbox, and puts no sublabel on an empty one", () => {
    expect(buildMenuModel(input({ inbox: 1 }), now)[0]).toMatchObject({ action: "open-inbox", sublabel: "1 note in the inbox" });
    expect(buildMenuModel(input({ inbox: 7 }), now)[0]).toMatchObject({ sublabel: "7 notes in the inbox" });
    const [head] = buildMenuModel(input({ inbox: 0 }), now);
    expect(head).toEqual({ type: "item", label: "3 thoughts filed today. Evening review at 21:00.", action: "open-inbox" });
    expect(head).not.toHaveProperty("sublabel");
    expect(JSON.stringify(buildMenuModel(input({ inbox: 0 }), now))).not.toMatch(/Inbox is empty|Next:/);
  });

  describe("the head says how today went", () => {
    const head = (overrides: Partial<MenuInput>, at = now) => buildMenuModel(input(overrides), at)[0];
    const eveningAt = (hour: number, minute = 0): MenuTask => ({
      id: "evening-review",
      name: "Evening review",
      kind: "evening-review",
      at: new Date(2026, 9, 20, hour, minute),
      enabled: true,
      running: false,
    });
    const weekly = input().tasks[1]!;

    it("counts today's filings: none, one, or many", () => {
      expect(head({ filedToday: 0 })).toMatchObject({ label: "Nothing filed today. Evening review at 21:00." });
      expect(head({ filedToday: 1 })).toMatchObject({ label: "1 thought filed today. Evening review at 21:00." });
      expect(head({ filedToday: 3 })).toMatchObject({ label: "3 thoughts filed today. Evening review at 21:00." });
      expect(head({ filedToday: 12 })).toMatchObject({ label: "12 thoughts filed today. Evening review at 21:00." });
    });

    it("says tomorrow once today's evening review time has passed", () => {
      const late = new Date(2026, 9, 20, 21, 30);
      const tomorrow = { ...eveningAt(21), at: new Date(2026, 9, 21, 21, 0) };
      expect(head({ filedToday: 0, tasks: [tomorrow] }, late)).toMatchObject({ label: "Nothing filed today. Evening review tomorrow at 21:00." });
      expect(head({ filedToday: 1, tasks: [tomorrow] }, late)).toMatchObject({ label: "1 thought filed today. Evening review tomorrow at 21:00." });
      expect(head({ filedToday: 3, tasks: [tomorrow] }, late)).toMatchObject({ label: "3 thoughts filed today. Evening review tomorrow at 21:00." });
    });

    it("says only how today went when there is no evening review", () => {
      expect(head({ filedToday: 0, tasks: [] })).toMatchObject({ label: "Nothing filed today." });
      expect(head({ filedToday: 1, tasks: [] })).toMatchObject({ label: "1 thought filed today." });
      expect(head({ filedToday: 3, tasks: [] })).toMatchObject({ label: "3 thoughts filed today." });
      // One that is switched off isn't one.
      expect(head({ filedToday: 3, tasks: [{ ...eveningAt(21), enabled: false, at: null }, weekly] })).toMatchObject({ label: "3 thoughts filed today." });
      expect(head({ filedToday: 3, tasks: [{ ...eveningAt(21), enabled: false }, weekly] })).toMatchObject({ label: "3 thoughts filed today." });
    });

    it("leaves a weekly review out of it: only the evening review is named", () => {
      expect(head({ filedToday: 3, tasks: [weekly] })).toMatchObject({ label: "3 thoughts filed today." });
      // The weekly review is the soonest, and still isn't named.
      expect(head({ filedToday: 3, tasks: [{ ...weekly, at: new Date(2026, 9, 20, 15, 0) }, eveningAt(21)] })).toMatchObject({
        label: "3 thoughts filed today. Evening review at 21:00.",
      });
      const custom = { ...weekly, id: "custom-1", kind: "custom", name: "Reading list" };
      expect(head({ filedToday: 0, tasks: [custom] })).toMatchObject({ label: "Nothing filed today." });
    });

    it("names the evening review by its own name", () => {
      const renamed = { ...eveningAt(21), name: "Nightly sweep" };
      expect(head({ filedToday: 3, tasks: [renamed] })).toMatchObject({ label: "3 thoughts filed today. Nightly sweep at 21:00." });
      expect(head({ filedToday: 0, tasks: [{ ...renamed, at: new Date(2026, 9, 21, 21, 0) }] }, new Date(2026, 9, 20, 22, 0))).toMatchObject({
        label: "Nothing filed today. Nightly sweep tomorrow at 21:00.",
      });
    });

    it("doesn't name an enabled review that has no time to say", () => {
      expect(head({ filedToday: 3, tasks: [{ ...eveningAt(21), at: null }] })).toMatchObject({ label: "3 thoughts filed today." });
      expect(head({ filedToday: 1, tasks: [{ ...eveningAt(21), at: null }, weekly] })).toMatchObject({ label: "1 thought filed today." });
    });

    it("names the soonest of two evening reviews, as the next one is picked", () => {
      const later = { ...eveningAt(22, 30), id: "evening-2", name: "Late sweep" };
      expect(head({ filedToday: 2, tasks: [later, eveningAt(21)] })).toMatchObject({ label: "2 thoughts filed today. Evening review at 21:00." });
      expect(head({ filedToday: 2, tasks: [eveningAt(21), later] })).toMatchObject({ label: "2 thoughts filed today. Evening review at 21:00." });
      // A switched-off one is skipped, however soon it would be.
      expect(head({ filedToday: 2, tasks: [{ ...eveningAt(15), enabled: false, at: null }, later] })).toMatchObject({
        label: "2 thoughts filed today. Late sweep at 22:30.",
      });
    });

    it("says a review further off as the menu says it elsewhere", () => {
      const sunday = { ...eveningAt(18), at: new Date(2026, 9, 25, 18, 0) };
      expect(head({ filedToday: 1, tasks: [sunday] })).toMatchObject({ label: "1 thought filed today. Evening review on Sun at 18:00." });
      const later = { ...eveningAt(18), at: new Date(2026, 10, 2, 18, 0) };
      expect(head({ filedToday: 1, tasks: [later] })).toMatchObject({ label: "1 thought filed today. Evening review on 2 Nov at 18:00." });
    });

    it("never says Letter: there is no letter yet", () => {
      for (const filedToday of [0, 1, 3]) {
        expect(JSON.stringify(buildMenuModel(input({ filedToday }), now))).not.toMatch(/letter/i);
      }
    });

    it("is the same while recording, with an undo on offer, or with nothing filed yet", () => {
      expect(head({ recording: true, undoableReview: true, recent: [] })).toMatchObject({
        label: "3 thoughts filed today. Evening review at 21:00.",
        action: "open-inbox",
      });
    });
  });

  describe("statusLine", () => {
    const evening = (at: Date | null, name = "Evening review"): MenuTask => ({ id: "evening-review", name, kind: "evening-review", at, enabled: true, running: false });

    it("counts, then names the review and when", () => {
      expect(statusLine(0, undefined, now)).toBe("Nothing filed today.");
      expect(statusLine(1, undefined, now)).toBe("1 thought filed today.");
      expect(statusLine(3, undefined, now)).toBe("3 thoughts filed today.");
      expect(statusLine(3, evening(new Date(2026, 9, 20, 21, 0)), now)).toBe("3 thoughts filed today. Evening review at 21:00.");
      expect(statusLine(1, evening(new Date(2026, 9, 21, 21, 0)), now)).toBe("1 thought filed today. Evening review tomorrow at 21:00.");
      expect(statusLine(0, evening(new Date(2026, 9, 20, 21, 5), "Nightly sweep"), now)).toBe("Nothing filed today. Nightly sweep at 21:05.");
    });

    it("names no review that has no time", () => {
      expect(statusLine(3, evening(null), now)).toBe("3 thoughts filed today.");
    });
  });

  it("titles Recently filed and Scheduled reviews with section headers", () => {
    const headers = buildMenuModel(input(), now).filter((item) => item.type === "header");
    expect(headers).toEqual([{ type: "header", label: "Recently filed" }, { type: "header", label: "Scheduled reviews" }]);
  });

  it("keeps sublabels off headers, with or without a library", () => {
    for (const menu of [buildMenuModel(input({ undoableReview: true }), now), buildMenuModel(input({ libraryReady: false }), now)]) {
      expect(menu.filter((item) => item.type === "header" && "sublabel" in item)).toEqual([]);
    }
  });

  it("offers the three captures with their shortcuts, recently filed pages and tasks", () => {
    const items = buildMenuModel(input(), now);
    expect(labels(items)).toEqual([
      "3 thoughts filed today. Evening review at 21:00.", "--",
      "Record a thought", "Capture screen with a comment", "Type a thought…", "Ask your library…", "--",
      "Recently filed", "Launch the indie game dev podcast", "Маленький сад на балконе", "--",
      "Scheduled reviews", "Evening review", "Weekly review", "--",
      "Open library", "Settings…", "Quit Avanzel",
    ]);
    const record = items.find((i) => i.type === "item" && i.label === "Record a thought");
    expect(record).toMatchObject({ action: "dictate", accelerator: "Alt+Space" });
    const weekly = items.find((i) => i.type === "item" && i.label === "Weekly review");
    expect(weekly).toMatchObject({ action: "task:weekly-review", detail: "Sun 18:00" });
  });

  describe("a review's detail", () => {
    const review = (task: Partial<MenuTask>) => {
      const tasks: MenuTask[] = [
        { id: "evening-review", name: "Evening review", kind: "evening-review", at: new Date(2026, 9, 20, 21, 0), enabled: true, running: false, ...task },
      ];
      return buildMenuModel(input({ tasks }), now).find((item) => item.type === "item" && item.action === "task:evening-review");
    };

    it("is the time it runs next while it isn't running", () => {
      expect(review({})).toMatchObject({ label: "Evening review", detail: "21:00" });
      expect(review({ at: new Date(2026, 9, 21, 21, 0) })).toMatchObject({ detail: "Tomorrow 21:00" });
    });

    it("says Off for a review that is off", () => {
      expect(review({ enabled: false, at: null })).toMatchObject({ label: "Evening review", detail: "Off" });
    });

    it("says Running… while it runs and has begun no capture", () => {
      expect(review({ running: true })).toMatchObject({ label: "Evening review", detail: "Running…" });
    });

    it("says how far a running review is, in place of Running…", () => {
      expect(review({ running: true, progress: "1 of 2" })).toMatchObject({ label: "Evening review", detail: "1 of 2" });
      expect(review({ running: true, progress: "5 of 5" })).toMatchObject({ detail: "5 of 5" });
    });

    it("is its time again once it has stopped, whatever count it was left with", () => {
      expect(review({ running: false, progress: "2 of 2" })).toMatchObject({ detail: "21:00" });
    });

    it("keeps the label plain and puts the count in parentheses where the tray draws it", () => {
      const item = review({ running: true, progress: "2 of 5" });
      expect(item).toMatchObject({ type: "item", label: "Evening review", action: "task:evening-review", detail: "2 of 5" });
      expect(menuLabel(item as { label: string; detail?: string })).toBe("Evening review (2 of 5)");
    });
  });

  describe("Recently filed shows each page's shelf", () => {
    const recent = (overrides: Partial<MenuInput> = {}) => {
      const items = buildMenuModel(input(overrides), now);
      const at = items.findIndex((item) => item.type === "header" && item.label === "Recently filed");
      return items.slice(at + 1, items.findIndex((item, i) => i > at && item.type === "separator"));
    };

    it("keeps each item's shelf, and gives it the shelf's name as its sublabel", () => {
      expect(recent()).toEqual([
        { type: "item", label: "Launch the indie game dev podcast", action: "open:goals/launch.md", shelf: "goals", sublabel: "Goals" },
        { type: "item", label: "Маленький сад на балконе", action: "open:ideas/balcony-garden.md", shelf: "ideas", sublabel: "Ideas" },
      ]);
    });

    it("names every shelf as the design system does", () => {
      const pages = ["goals", "ideas", "problems", "memories", "people", "topics"].map((shelf) => ({ title: `A ${shelf} page`, shelf, path: `${shelf}/page.md` }));
      expect(recent({ recent: pages.slice(0, 3) }).map((item) => item.type === "item" && item.sublabel)).toEqual(["Goals", "Ideas", "Problems"]);
      expect(recent({ recent: pages.slice(3) }).map((item) => item.type === "item" && item.sublabel)).toEqual(["Memories", "People", "Topics"]);
    });

    it("gives a page off the shelves its folder's name, as the person made it", () => {
      const off = [
        { title: "Trip plan", shelf: "projects", path: "projects/trip.md" },
        { title: "Quarter report", shelf: "Work notes", path: "Work notes/report.md" },
      ];
      expect(recent({ recent: off })).toEqual([
        { type: "item", label: "Trip plan", action: "open:projects/trip.md", shelf: "projects", sublabel: "projects" },
        { type: "item", label: "Quarter report", action: "open:Work notes/report.md", shelf: "Work notes", sublabel: "Work notes" },
      ]);
    });

    it("takes a folder named like something every object has for a folder, not a shelf", () => {
      const [item] = recent({ recent: [{ title: "Odd", shelf: "constructor", path: "constructor/odd.md" }] });
      expect(item).toMatchObject({ shelf: "constructor", sublabel: "constructor" });
    });

    it("puts no sublabel on a page that has no folder", () => {
      const [item] = recent({ recent: [{ title: "Loose", shelf: "", path: "loose.md" }] });
      expect(item).toMatchObject({ label: "Loose", action: "open:loose.md" });
      expect(item).not.toHaveProperty("sublabel");
    });

    it("shows the three newest only", () => {
      const pages = Array.from({ length: 5 }, (_, i) => ({ title: `Page ${i}`, shelf: "topics", path: `topics/${i}.md` }));
      expect(recent({ recent: pages }).map((item) => item.type === "item" && item.label)).toEqual(["Page 0", "Page 1", "Page 2"]);
    });
  });

  describe("a speech model that can't be used", () => {
    const downloading = "The speech model didn't finish downloading.";
    const settings = "Avanzel can't use the voice settings in this library's config file.";

    it("follows the head, and opens Settings on Voice", () => {
      for (const speechProblem of [downloading, settings]) {
        const items = buildMenuModel(input({ speechProblem }), now);
        expect(items[0]).toMatchObject({ action: "open-inbox" });
        expect(items[1]).toEqual({ type: "item", label: speechProblem, action: "open-settings:voice" });
        expect(items[2]).toEqual({ type: "separator" });
      }
    });

    it("says what trying again does, when it is told", () => {
      const retry = "Try again in Settings → Voice. It continues where it stopped.";
      const items = buildMenuModel(input({ speechProblem: downloading, speechRetry: retry }), now);
      expect(items[1]).toEqual({ type: "item", label: downloading, action: "open-settings:voice", sublabel: retry });
    });

    it("is an item that can be read, not dimmed", () => {
      const [, item] = buildMenuModel(input({ speechProblem: downloading }), now);
      expect(item).not.toHaveProperty("enabled", false);
    });

    it("is there only while there is a problem", () => {
      const items = buildMenuModel(input({ speechProblem: null }), now);
      expect(items[1]).toEqual({ type: "separator" });
      expect(JSON.stringify(items)).not.toContain("open-settings");
      // And a retry line alone, with no problem to put it under, shows nothing.
      expect(JSON.stringify(buildMenuModel(input({ speechProblem: null, speechRetry: "Try again" }), now))).not.toContain("Try again");
    });

    it("leaves the rest of the menu as it is", () => {
      const without = buildMenuModel(input(), now);
      const withIt = buildMenuModel(input({ speechProblem: downloading }), now);
      expect(withIt.filter((item) => item !== withIt[1])).toEqual(without);
    });

    it("is not offered where there is no library: setup or Settings come first", () => {
      expect(labels(buildMenuModel(input({ libraryReady: false, speechProblem: downloading }), now))).toEqual(["Set up Avanzel…", "--", "Quit Avanzel"]);
    });
  });

  describe("Recently filed, with nothing filed yet", () => {
    const empty = (overrides: Partial<MenuInput> = {}) => buildMenuModel(input({ recent: [], ...overrides }), now);
    /** The item right under the Recently filed header; none when the menu has no such header. */
    const underHeader = (items: ReturnType<typeof buildMenuModel>) => {
      const at = items.findIndex((item) => item.type === "header" && item.label === "Recently filed");
      return at === -1 ? undefined : items[at + 1];
    };

    it("keeps the header and invites a first thought: an enabled item that records one, naming the real shortcut", () => {
      const items = empty();
      expect(labels(items)).toEqual([
        "3 thoughts filed today. Evening review at 21:00.", "--",
        "Record a thought", "Capture screen with a comment", "Type a thought…", "Ask your library…", "--",
        "Recently filed", "Nothing filed yet. Press ⌥Space and say hello.", "--",
        "Scheduled reviews", "Evening review", "Weekly review", "--",
        "Open library", "Settings…", "Quit Avanzel",
      ]);
      // Exactly an item that does what Record a thought does: enabled (macOS draws a disabled one too dim to read), and
      // with no accelerator of its own, since its words name the shortcut already.
      expect(underHeader(items)).toEqual({ type: "item", label: "Nothing filed yet. Press ⌥Space and say hello.", action: "dictate" });
    });

    it("is no page and is not dimmed: its action opens nothing, and it is never disabled", () => {
      const item = underHeader(empty());
      expect(item).toMatchObject({ type: "item", action: "dictate" });
      expect(item).not.toMatchObject({ action: expect.stringMatching(/^open:/) });
      expect(item).not.toHaveProperty("enabled", false);
    });

    it("names the dictate shortcut the person has chosen", () => {
      const shortcuts = { ...DEFAULT_SETTINGS.shortcuts, dictate: "Control+Alt+R" };
      expect(underHeader(empty({ shortcuts }))).toMatchObject({ label: "Nothing filed yet. Press ⌃⌥R and say hello.", action: "dictate" });
    });

    it("without a dictate shortcut, one that didn't register or none at all, says to record a thought", () => {
      const noShortcut = { type: "item", label: "Nothing filed yet. Record a thought and say hello.", action: "dictate" };
      expect(underHeader(empty({ unregisteredShortcuts: ["dictate"] }))).toEqual(noShortcut);
      expect(underHeader(empty({ shortcuts: { ...DEFAULT_SETTINGS.shortcuts, dictate: "" } }))).toEqual(noShortcut);
    });

    it("gives way to the pages once there are some, and is not there for a library that isn't ready", () => {
      expect(labels(buildMenuModel(input(), now))).not.toContain("Nothing filed yet. Press ⌥Space and say hello.");
      expect(labels(buildMenuModel(input({ recent: [], libraryReady: false }), now))).toEqual(["Set up Avanzel…", "--", "Quit Avanzel"]);
    });
  });

  describe("Undo the last filing", () => {
    const undo = { type: "item", label: "Undo the last filing", action: "undo-filing" };
    const withUndo = (overrides: Partial<MenuInput> = {}) => buildMenuModel(input({ undoableFiling: true, ...overrides }), now);

    it("follows the recently filed pages, and is the last item of that section", () => {
      const items = withUndo();
      expect(labels(items)).toEqual([
        "3 thoughts filed today. Evening review at 21:00.", "--",
        "Record a thought", "Capture screen with a comment", "Type a thought…", "Ask your library…", "--",
        "Recently filed", "Launch the indie game dev podcast", "Маленький сад на балконе", "Undo the last filing", "--",
        "Scheduled reviews", "Evening review", "Weekly review", "--",
        "Open library", "Settings…", "Quit Avanzel",
      ]);
      expect(items.filter((item) => item.type === "item" && item.action === "undo-filing")).toEqual([undo]);
    });

    it("is only there while the last filing can be undone", () => {
      for (const items of [buildMenuModel(input(), now), buildMenuModel(input({ undoableFiling: false }), now)]) {
        expect(labels(items)).not.toContain("Undo the last filing");
        expect(JSON.stringify(items)).not.toContain("undo-filing");
      }
    });

    it("leaves the rest of the menu as it is", () => {
      const without = buildMenuModel(input(), now);
      const items = withUndo();
      expect(items.filter((item) => item.type !== "item" || item.action !== "undo-filing")).toEqual(without);
    });

    it("closes the section after three pages at most, or after the invitation while there are none", () => {
      const pages = Array.from({ length: 5 }, (_, i) => ({ title: `Page ${i}`, shelf: "topics", path: `topics/${i}.md` }));
      expect(labels(withUndo({ recent: pages })).slice(7, 12)).toEqual(["Recently filed", "Page 0", "Page 1", "Page 2", "Undo the last filing"]);
      // A filing that wrote no page (the agent only logged the note) leaves the invitation to a first thought where the pages go: the
      // filing can still be undone, and the item is after whatever that section holds.
      const empty = labels(withUndo({ recent: [] }));
      expect(empty.slice(7, 10)).toEqual(["Recently filed", "Nothing filed yet. Press ⌥Space and say hello.", "Undo the last filing"]);
    });

    it("is an item that can be read, not dimmed, with no shortcut, shelf or sublabel of its own", () => {
      const item = withUndo().find((one) => one.type === "item" && one.action === "undo-filing");
      expect(item).toEqual(undo);
      expect(item).not.toHaveProperty("enabled", false);
    });

    it("is not offered where there is no library: setup or Settings come first", () => {
      expect(labels(buildMenuModel(input({ libraryReady: false, undoableFiling: true }), now))).toEqual(["Set up Avanzel…", "--", "Quit Avanzel"]);
    });

    it("sits beside the evening review's own Undo, which it does not replace", () => {
      const items = withUndo({ undoableReview: true });
      expect(labels(items)).toContain("Undo the last filing");
      expect(labels(items)).toContain("Undo last evening review");
      expect(items.filter((item) => item.type === "item" && item.action === "undo-review")).toEqual([
        { type: "item", label: "Undo last evening review", action: "undo-review" },
      ]);
    });
  });

  it("a shortcut that didn't register is not shown in the menu", () => {
    const items = buildMenuModel(input({ unregisteredShortcuts: ["dictate"] }), now);
    const item = (action: string) => items.find((i) => i.type === "item" && i.action === action);
    expect(item("dictate")).toEqual({ type: "item", label: "Record a thought", action: "dictate" });
    expect(item("capture")).toMatchObject({ accelerator: "Alt+Shift+S" });
    expect(item("type")).toMatchObject({ accelerator: "Alt+Shift+Space" });
    expect(item("ask")).toMatchObject({ accelerator: "Alt+Shift+A" });
  });

  it("turns the first item into Stop while recording", () => {
    const items = buildMenuModel(input({ recording: true }), now);
    expect(items.find((i) => i.type === "item" && i.action === "dictate")).toMatchObject({ label: "Stop recording" });
  });

  it("says nothing of an empty inbox, and offers undo after an evening review", () => {
    const items = buildMenuModel(input({ inbox: 0, undoableReview: true }), now);
    expect(items[0]).toEqual({ type: "item", label: "3 thoughts filed today. Evening review at 21:00.", action: "open-inbox" });
    expect(labels(items)).toContain("Undo last evening review");
  });

  it("only offers setup when there is no library yet", () => {
    const items = buildMenuModel(input({ libraryReady: false }), now);
    expect(labels(items)).toEqual(["Set up Avanzel…", "--", "Quit Avanzel"]);
    expect(items[0]).toEqual({ type: "item", label: "Set up Avanzel…", action: "setup", sublabel: "Choose a folder for your library to start." });
  });

  it("says why the library couldn't be opened, and opens Settings, where it is fixed", () => {
    const problem = "Avanzel couldn't open the library at /Users/me/Brain: EACCES: permission denied, mkdir '/Users/me/Brain/tasks'";
    const [head, ...rest] = buildMenuModel(input({ libraryReady: false, problem }), now);
    expect(head).toEqual({ type: "item", label: "Set up Avanzel…", action: "settings", sublabel: problem });
    expect(labels(rest)).toEqual(["--", "Quit Avanzel"]);
  });

  it("names a library that isn't there any more, and opens Settings, where it is chosen again or set up anew", () => {
    const [head, ...rest] = buildMenuModel(input({ libraryReady: false, missingLibrary: "~/Avanzel" }), now);
    expect(head).toEqual({ type: "item", label: "Set up Avanzel…", action: "settings", sublabel: "Can't find your library at ~/Avanzel." });
    expect(labels(rest)).toEqual(["--", "Quit Avanzel"]);
    // The place is named as the person knows it, wherever it is.
    expect(buildMenuModel(input({ libraryReady: false, missingLibrary: "/Volumes/Backup/Brain" }), now)[0]).toMatchObject({
      action: "settings",
      sublabel: "Can't find your library at /Volumes/Backup/Brain.",
    });
    // A library that is there but couldn't be opened says why instead; with neither, setup makes one.
    const problem = "Avanzel couldn't open the library at /Users/me/Brain: EACCES";
    expect(buildMenuModel(input({ libraryReady: false, problem, missingLibrary: "~/Brain" }), now)[0]).toMatchObject({ action: "settings", sublabel: problem });
    expect(buildMenuModel(input({ libraryReady: false, missingLibrary: null }), now)[0]).toMatchObject({ action: "setup" });
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

describe("speechProblemOf", () => {
  it("names a download that didn't finish with the capsule's own title, and says what Try again does", () => {
    const kept = speechProblemOf({ kind: "error", cause: "download", message: "silero_vad.onnx: the connection dropped", resumable: true });
    expect(kept).toEqual({
      title: "The speech model didn't finish downloading.",
      retry: "Try again in Settings → Voice. It continues where it stopped.",
    });
    const gone = speechProblemOf({ kind: "error", cause: "download", message: "silero_vad.onnx: what arrived was damaged", resumable: false });
    expect(gone).toEqual({
      title: "The speech model didn't finish downloading.",
      retry: "Try again in Settings → Voice. It starts the download over.",
    });
    // The title is the card's: one builder, wherever the problem is told.
    expect(kept?.title).toBe(downloadFailedProblem("anything", true).title);
    expect(gone?.title).toBe(downloadFailedProblem("anything", false).title);
  });

  it("names voice settings Avanzel can't use with the capsule's own title, and says they are read again", () => {
    const problem = speechProblemOf({ kind: "error", cause: "settings", message: "Speech model 'parakeet-v9' is not supported", resumable: false });
    expect(problem).toEqual({
      title: "Avanzel can't use the voice settings in this library's config file.",
      retry: "Fix the config file. Avanzel reads it again within a minute.",
    });
    expect(problem?.title).toBe(voiceSettingsProblem("anything").title);
  });

  it("is nothing while the model is ready, on its way, or still to be fetched", () => {
    expect(speechProblemOf({ kind: "ready", dir: "/models/parakeet" })).toBeNull();
    expect(speechProblemOf({ kind: "missing", bytes: 673_000_000 })).toBeNull();
    expect(speechProblemOf({ kind: "downloading", receivedBytes: 1, totalBytes: 2 })).toBeNull();
  });

  it("says nothing the copy rules forbid: sentence case, no exclamation mark, never Letter", () => {
    for (const cause of ["download", "settings"] as const) {
      const problem = speechProblemOf({ kind: "error", cause, message: "x", resumable: true });
      for (const line of [problem?.title ?? "", problem?.retry ?? ""]) {
        expect(line).toMatch(/^[A-Z]/);
        expect(line).toMatch(/\.$/);
        expect(line).not.toMatch(/!|oops|letter/i);
      }
    }
  });
});
