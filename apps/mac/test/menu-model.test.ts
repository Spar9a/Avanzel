import { describe, expect, it } from "vitest";
import {
  buildMenuModel,
  dictationRow,
  filedLine,
  formatWhen,
  MENU_DICTATIONS,
  menuLabel,
  menuRows,
  reviewProgress,
  speechProblemOf,
  waitingLine,
  type MenuDictation,
  type MenuInput,
  type MenuItemModel,
  type MenuTask,
} from "../src/main/menu-model.ts";
import { DEFAULT_SETTINGS } from "../src/main/store.ts";
import { downloadFailedProblem, TYPED_THOUGHTS_SAVED, TYPING_WORKS_MEANWHILE, voiceSettingsProblem } from "../src/shared/problems.ts";

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
    callNotes: "off",
    cutShortCalls: 0,
    shortcuts: DEFAULT_SETTINGS.shortcuts,
    unregisteredShortcuts: [],
    undoableReview: false,
    undoableFiling: false,
    showableReceipt: false,
    hasReceipt: false,
    recentDictations: [],
    cursorDictation: null,
    ...overrides,
  };
}

/** The menu's rows as it first opens: a submenu by its name, without what is in it. */
const labels = (items: readonly MenuItemModel[]) => items.flatMap((item) => (item.type === "separator" ? ["--"] : [item.label]));

/** What is in the submenu named `label`, or nothing when the menu has no such submenu. */
const submenu = (items: readonly MenuItemModel[], label: string): MenuItemModel[] =>
  items.flatMap((item) => (item.type === "submenu" && item.label === label ? item.items : []));

/** The row for `action`, wherever it lives. */
const row = (items: readonly MenuItemModel[], action: string) => menuRows(items).find((item) => item.action === action);

/** The section between the actions and the settings: what has been done and what is to come. */
const section = (items: readonly MenuItemModel[]) => {
  const all = labels(items);
  const from = all.indexOf("Ask your library…") + 2;
  return all.slice(from, all.indexOf("--", from));
};

describe("tray menu", () => {
  it("leads with how today went, which opens the inbox, and what waits under it", () => {
    const [head] = buildMenuModel(input(), now);
    expect(head).toEqual({
      type: "item",
      label: "3 thoughts filed today",
      action: "open-inbox",
      sublabel: "2 in the inbox · Evening review at 21:00",
    });
  });

  it("counts the inbox, and says nothing of an empty one", () => {
    expect(buildMenuModel(input({ inbox: 1 }), now)[0]).toMatchObject({ action: "open-inbox", sublabel: "1 in the inbox · Evening review at 21:00" });
    expect(buildMenuModel(input({ inbox: 7 }), now)[0]).toMatchObject({ sublabel: "7 in the inbox · Evening review at 21:00" });
    const [head] = buildMenuModel(input({ inbox: 0 }), now);
    expect(head).toEqual({ type: "item", label: "3 thoughts filed today", action: "open-library", sublabel: "Evening review at 21:00" });
    expect(JSON.stringify(buildMenuModel(input({ inbox: 0 }), now))).not.toMatch(/Inbox is empty|Next:|in the inbox/);
  });

  it("opens the inbox only while its second line names the inbox, and the library when it doesn't", () => {
    // The click goes where the words say: with a note waiting, "2 in the inbox" is under the head, and the click opens the inbox.
    for (const inbox of [1, 2, 40]) {
      const [head] = buildMenuModel(input({ inbox }), now);
      expect(head, `${inbox} in the inbox`).toMatchObject({ action: "open-inbox", sublabel: expect.stringMatching(/in the inbox/) });
    }
    // With the inbox empty the words no longer mention it, so the click opens the library: an empty folder to look at would say nothing.
    const [empty] = buildMenuModel(input({ inbox: 0 }), now);
    expect(empty).toMatchObject({ action: "open-library" });
    expect(JSON.stringify(empty)).not.toMatch(/inbox/i);
    // However the rest of the head reads, the action follows the second line alone.
    for (const overrides of [{ filedToday: 0 }, { filedToday: 1 }, { tasks: [] }, { recording: true }, { undoableReview: true }, { recent: [] }]) {
      expect(buildMenuModel(input({ ...overrides, inbox: 0 }), now)[0], JSON.stringify(overrides)).toMatchObject({ action: "open-library" });
      expect(buildMenuModel(input({ ...overrides, inbox: 3 }), now)[0], JSON.stringify(overrides)).toMatchObject({ action: "open-inbox" });
    }
  });

  describe("the head says how today went", () => {
    const head = (overrides: Partial<MenuInput>, at = now) => buildMenuModel(input({ inbox: 0, ...overrides }), at)[0];
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
      expect(head({ filedToday: 0 })).toMatchObject({ label: "Nothing filed today", sublabel: "Evening review at 21:00" });
      expect(head({ filedToday: 1 })).toMatchObject({ label: "1 thought filed today" });
      expect(head({ filedToday: 3 })).toMatchObject({ label: "3 thoughts filed today" });
      expect(head({ filedToday: 12 })).toMatchObject({ label: "12 thoughts filed today" });
    });

    it("says tomorrow once today's evening review time has passed", () => {
      const late = new Date(2026, 9, 20, 21, 30);
      const tomorrow = { ...eveningAt(21), at: new Date(2026, 9, 21, 21, 0) };
      expect(head({ filedToday: 0, tasks: [tomorrow] }, late)).toMatchObject({ sublabel: "Evening review tomorrow at 21:00" });
    });

    it("has no second line with no evening review and nothing in the inbox", () => {
      expect(head({ filedToday: 3, tasks: [] })).toEqual({ type: "item", label: "3 thoughts filed today", action: "open-library" });
      // One that is switched off isn't one.
      expect(head({ tasks: [{ ...eveningAt(21), enabled: false, at: null }, weekly] })).not.toHaveProperty("sublabel");
      expect(head({ tasks: [{ ...eveningAt(21), enabled: false }, weekly] })).not.toHaveProperty("sublabel");
    });

    it("leaves a weekly review out of it: only the evening review is named", () => {
      expect(head({ tasks: [weekly] })).not.toHaveProperty("sublabel");
      // The weekly review is the soonest, and still isn't named.
      expect(head({ tasks: [{ ...weekly, at: new Date(2026, 9, 20, 15, 0) }, eveningAt(21)] })).toMatchObject({ sublabel: "Evening review at 21:00" });
      const custom = { ...weekly, id: "custom-1", kind: "custom", name: "Reading list" };
      expect(head({ tasks: [custom] })).not.toHaveProperty("sublabel");
    });

    it("names the evening review by its own name", () => {
      const renamed = { ...eveningAt(21), name: "Nightly sweep" };
      expect(head({ tasks: [renamed] })).toMatchObject({ sublabel: "Nightly sweep at 21:00" });
      expect(head({ tasks: [{ ...renamed, at: new Date(2026, 9, 21, 21, 0) }] }, new Date(2026, 9, 20, 22, 0))).toMatchObject({ sublabel: "Nightly sweep tomorrow at 21:00" });
    });

    it("doesn't name an enabled review that has no time to say", () => {
      expect(head({ tasks: [{ ...eveningAt(21), at: null }] })).not.toHaveProperty("sublabel");
      expect(head({ tasks: [{ ...eveningAt(21), at: null }, weekly] })).not.toHaveProperty("sublabel");
    });

    it("names the soonest of two evening reviews, as the next one is picked", () => {
      const later = { ...eveningAt(22, 30), id: "evening-2", name: "Late sweep" };
      expect(head({ tasks: [later, eveningAt(21)] })).toMatchObject({ sublabel: "Evening review at 21:00" });
      expect(head({ tasks: [eveningAt(21), later] })).toMatchObject({ sublabel: "Evening review at 21:00" });
      // A switched-off one is skipped, however soon it would be.
      expect(head({ tasks: [{ ...eveningAt(15), enabled: false, at: null }, later] })).toMatchObject({ sublabel: "Late sweep at 22:30" });
    });

    it("says a review further off as the menu says it elsewhere", () => {
      expect(head({ tasks: [{ ...eveningAt(18), at: new Date(2026, 9, 25, 18, 0) }] })).toMatchObject({ sublabel: "Evening review on Sun at 18:00" });
      expect(head({ tasks: [{ ...eveningAt(18), at: new Date(2026, 10, 2, 18, 0) }] })).toMatchObject({ sublabel: "Evening review on 2 Nov at 18:00" });
    });

    it("never says Letter: there is no letter yet", () => {
      for (const filedToday of [0, 1, 3]) {
        expect(JSON.stringify(buildMenuModel(input({ filedToday }), now))).not.toMatch(/letter/i);
      }
    });

    it("is the same while recording, with an undo on offer, or with nothing filed yet", () => {
      expect(buildMenuModel(input({ recording: true, undoableReview: true, recent: [] }), now)[0]).toMatchObject({
        label: "3 thoughts filed today",
        action: "open-inbox",
      });
    });
  });

  describe("filedLine and waitingLine", () => {
    const evening = (at: Date | null, name = "Evening review"): MenuTask => ({ id: "evening-review", name, kind: "evening-review", at, enabled: true, running: false });

    it("counts", () => {
      expect(filedLine(0)).toBe("Nothing filed today");
      expect(filedLine(1)).toBe("1 thought filed today");
      expect(filedLine(3)).toBe("3 thoughts filed today");
    });

    it("says what waits, then names the review and when, each only when there is one", () => {
      expect(waitingLine(0, undefined, now)).toBeUndefined();
      expect(waitingLine(2, undefined, now)).toBe("2 in the inbox");
      expect(waitingLine(0, evening(new Date(2026, 9, 20, 21, 0)), now)).toBe("Evening review at 21:00");
      expect(waitingLine(2, evening(new Date(2026, 9, 21, 21, 0)), now)).toBe("2 in the inbox · Evening review tomorrow at 21:00");
      expect(waitingLine(1, evening(new Date(2026, 9, 20, 21, 5), "Nightly sweep"), now)).toBe("1 in the inbox · Nightly sweep at 21:05");
    });

    it("names no review that has no time", () => {
      expect(waitingLine(0, evening(null), now)).toBeUndefined();
    });
  });

  it("has no section headers: what is rare is in a submenu, by its name", () => {
    const menu = buildMenuModel(input({ undoableReview: true }), now);
    expect(menu.filter((item) => (item.type as string) === "header")).toEqual([]);
    expect(menu.filter((item) => item.type === "submenu").map((item) => (item as { label: string }).label)).toEqual(["Recently filed", "Scheduled reviews"]);
  });

  it("offers the captures with their shortcuts, then a submenu of the pages filed and one of the reviews, then the settings", () => {
    const items = buildMenuModel(input(), now);
    expect(labels(items)).toEqual([
      "3 thoughts filed today", "--",
      "Record a thought", "Capture screen…", "Type a thought…", "Ask your library…", "--",
      "Recently filed", "Scheduled reviews", "--",
      "Open library", "Settings…", "Quit Avanzel",
    ]);
    expect(row(items, "dictate")).toMatchObject({ label: "Record a thought", accelerator: "Alt+Space" });
    expect(row(items, "capture")).toMatchObject({ label: "Capture screen…", accelerator: "Alt+Shift+S" });
    expect(labels(submenu(items, "Recently filed"))).toEqual(["Launch the indie game dev podcast", "Маленький сад на балконе"]);
    expect(labels(submenu(items, "Scheduled reviews"))).toEqual(["Evening review", "Weekly review"]);
    expect(row(items, "task:weekly-review")).toMatchObject({ label: "Weekly review", detail: "Sun 18:00" });
  });

  it("menuRows reads every row in order, with a submenu's in its place", () => {
    const rows = menuRows(buildMenuModel(input({ undoableFiling: true }), now)).map((item) => item.label);
    expect(rows).toEqual([
      "3 thoughts filed today",
      "Record a thought", "Capture screen…", "Type a thought…", "Ask your library…",
      "Undo the last filing",
      "Launch the indie game dev podcast", "Маленький сад на балконе",
      "Evening review", "Weekly review",
      "Open library", "Settings…", "Quit Avanzel",
    ]);
  });

  describe("a review's detail", () => {
    const review = (task: Partial<MenuTask>) => {
      const tasks: MenuTask[] = [
        { id: "evening-review", name: "Evening review", kind: "evening-review", at: new Date(2026, 9, 20, 21, 0), enabled: true, running: false, ...task },
      ];
      return row(buildMenuModel(input({ tasks }), now), "task:evening-review");
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
      expect(review({ running: true, progress: "Filing 1 of 2" })).toMatchObject({ label: "Evening review", detail: "Filing 1 of 2" });
      expect(review({ running: true, progress: "Filing 5 of 5" })).toMatchObject({ detail: "Filing 5 of 5" });
    });

    it("is its time again once it has stopped, whatever count it was left with", () => {
      expect(review({ running: false, progress: "Filing 2 of 2" })).toMatchObject({ detail: "21:00" });
    });

    it("keeps the label plain and puts the count in parentheses where the tray draws it", () => {
      const item = review({ running: true, progress: "Filing 2 of 5" });
      expect(item).toMatchObject({ type: "item", label: "Evening review", action: "task:evening-review", detail: "Filing 2 of 5" });
      expect(menuLabel(item as { label: string; detail?: string })).toBe("Evening review (Filing 2 of 5)");
    });
  });

  describe("reviewProgress", () => {
    it("says what the review is doing and how far, capitalised like the other details (Running…, Off, 21:00)", () => {
      expect(reviewProgress(1, 2)).toBe("Filing 1 of 2");
      expect(reviewProgress(5, 5)).toBe("Filing 5 of 5");
      expect(reviewProgress(1, 1)).toBe("Filing 1 of 1");
    });

    it("never lets the total fall short of the count: a capture that arrives meanwhile raises it", () => {
      expect(reviewProgress(3, 2)).toBe("Filing 3 of 3");
      expect(reviewProgress(1, 0)).toBe("Filing 1 of 1");
    });

    it("reads as a detail in the menu, in parentheses after the review's name", () => {
      expect(menuLabel({ label: "Evening review", detail: reviewProgress(1, 2) })).toBe("Evening review (Filing 1 of 2)");
    });
  });

  describe("Recently filed shows each page's shelf", () => {
    const recent = (overrides: Partial<MenuInput> = {}) => submenu(buildMenuModel(input(overrides), now), "Recently filed");

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

    it("puts what is safe and where to go under it, when it is told", () => {
      const sublabel = "Typing works meanwhile. Try again in Settings → Voice.";
      const items = buildMenuModel(input({ speechProblem: downloading, speechSublabel: sublabel }), now);
      expect(items[1]).toEqual({ type: "item", label: downloading, action: "open-settings:voice", sublabel });
    });

    it("is an item that can be read, not dimmed", () => {
      const [, item] = buildMenuModel(input({ speechProblem: downloading }), now);
      expect(item).not.toHaveProperty("enabled", false);
    });

    it("is there only while there is a problem", () => {
      const items = buildMenuModel(input({ speechProblem: null }), now);
      expect(items[1]).toEqual({ type: "separator" });
      expect(JSON.stringify(items)).not.toContain("open-settings");
      // And a second line alone, with no problem to put it under, shows nothing.
      expect(JSON.stringify(buildMenuModel(input({ speechProblem: null, speechSublabel: "Try again" }), now))).not.toContain("Try again");
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

  describe("with nothing filed yet", () => {
    // Nothing filed yet: no page to list, none counted today, and no filing to undo.
    const empty = (overrides: Partial<MenuInput> = {}) => buildMenuModel(input({ recent: [], filedToday: 0, ...overrides }), now);
    /** The row that invites a first thought; none when the menu has no such row. */
    const invitation = (items: readonly MenuItemModel[]) => menuRows(items).find((item) => item.label.startsWith("Nothing filed yet"));

    it("invites a first thought out in the open: an enabled item that records one, naming the real shortcut", () => {
      const items = empty();
      expect(labels(items)).toEqual([
        "Nothing filed today", "--",
        "Record a thought", "Capture screen…", "Type a thought…", "Ask your library…", "--",
        "Nothing filed yet. Press ⌥Space and say hello.", "Scheduled reviews", "--",
        "Open library", "Settings…", "Quit Avanzel",
      ]);
      // Exactly an item that does what Record a thought does: enabled (macOS draws a disabled one too dim to read), and
      // with no accelerator of its own, since its words name the shortcut already.
      expect(invitation(items)).toEqual({ type: "item", label: "Nothing filed yet. Press ⌥Space and say hello.", action: "dictate" });
      expect(submenu(items, "Recently filed")).toEqual([]);
    });

    it("is no page and is not dimmed: its action opens nothing, and it is never disabled", () => {
      const item = invitation(empty());
      expect(item).toMatchObject({ type: "item", action: "dictate" });
      expect(item).not.toMatchObject({ action: expect.stringMatching(/^open:/) });
      expect(item).not.toHaveProperty("enabled", false);
    });

    it("names the dictate shortcut the person has chosen", () => {
      const shortcuts = { ...DEFAULT_SETTINGS.shortcuts, dictate: "Control+Alt+R" };
      expect(invitation(empty({ shortcuts }))).toMatchObject({ label: "Nothing filed yet. Press ⌃⌥R and say hello.", action: "dictate" });
    });

    it("without a dictate shortcut, one that didn't register or none at all, says to record a thought", () => {
      const noShortcut = { type: "item", label: "Nothing filed yet. Record a thought and say hello.", action: "dictate" };
      expect(invitation(empty({ unregisteredShortcuts: ["dictate"] }))).toEqual(noShortcut);
      expect(invitation(empty({ shortcuts: { ...DEFAULT_SETTINGS.shortcuts, dictate: "" } }))).toEqual(noShortcut);
    });

    it("gives way to the pages once there are some, and is not there for a library that isn't ready", () => {
      expect(invitation(buildMenuModel(input(), now))).toBeUndefined();
      expect(labels(buildMenuModel(input({ recent: [], libraryReady: false }), now))).toEqual(["Set up Avanzel…", "--", "Quit Avanzel"]);
    });

    // A filing that wrote no page (the agent only logged the note) is counted in the head and leaves nothing to list: the invitation
    // would say the opposite of the head, and of an Undo of that filing.
    it("is not there once a thought has been filed today, though no page was, and a submenu with nothing to show isn't either", () => {
      const items = empty({ filedToday: 1 });
      expect(labels(items)).toEqual([
        "1 thought filed today", "--",
        "Record a thought", "Capture screen…", "Type a thought…", "Ask your library…", "--",
        "Scheduled reviews", "--",
        "Open library", "Settings…", "Quit Avanzel",
      ]);
      expect(JSON.stringify(items)).not.toContain("Nothing filed yet");
    });

    it("is not there while a filing can be undone, even one filed on another day", () => {
      for (const filedToday of [0, 1]) {
        const items = empty({ filedToday, undoableFiling: true });
        expect(section(items)).toEqual(["Undo the last filing", "Scheduled reviews"]);
        expect(JSON.stringify(items)).not.toContain("Nothing filed yet");
      }
    });

    it("leaves no empty section when the library has no reviews either", () => {
      expect(labels(empty({ filedToday: 1, tasks: [] }))).toEqual([
        "1 thought filed today", "--",
        "Record a thought", "Capture screen…", "Type a thought…", "Ask your library…", "--",
        "Open library", "Settings…", "Quit Avanzel",
      ]);
    });
  });

  describe("Recent dictations", () => {
    const said = (id: string, text: string, app = "Slack", at = "2026-10-20T13:30:00"): MenuDictation => ({ id, text, app, at });
    const dictations = [said("a", "Ask Dana about the launch checklist"), said("b", "Remember the keys", "T3 Code", "2026-10-19T23:59:00")];
    const forget = { type: "item", label: "Forget the last dictation", action: "forget-dictation" };
    const history = { type: "item", label: "Open history…", action: "open-settings:dictations" };

    it("lists them under the pages filed, each copied by a click, with where it went and when, then what acts on the history", () => {
      const items = buildMenuModel(input({ recentDictations: dictations }), now);
      expect(section(items)).toEqual(["Recently filed", "Recent dictations", "Scheduled reviews"]);
      expect(submenu(items, "Recent dictations")).toEqual([
        { type: "item", label: "Ask Dana about the launch checklist", action: "copy-dictation:a", sublabel: "Slack · 13:30" },
        { type: "item", label: "Remember the keys", action: "copy-dictation:b", sublabel: "T3 Code · Yesterday 23:59" },
        { type: "separator" },
        forget,
        history,
      ]);
    });

    it("isn't there while the history is empty, and the rest of the menu is the same either way", () => {
      const without = buildMenuModel(input(), now);
      expect(JSON.stringify(without)).not.toMatch(/forget-dictation|copy-dictation|open-settings:dictations/);
      const withIt = buildMenuModel(input({ recentDictations: dictations }), now);
      expect(withIt.filter((item) => item.type !== "submenu" || item.label !== "Recent dictations")).toEqual(without);
    });

    it("lists the newest three at most", () => {
      const many = Array.from({ length: 5 }, (_, i) => said(`d${i}`, `Thought ${i}`));
      expect(MENU_DICTATIONS).toBe(3);
      const rows = submenu(buildMenuModel(input({ recentDictations: many }), now), "Recent dictations");
      expect(labels(rows)).toEqual(["Thought 0", "Thought 1", "Thought 2", "--", "Forget the last dictation", "Open history…"]);
    });

    it("says what it knows of where one went", () => {
      const at = (dictation: MenuDictation) => submenu(buildMenuModel(input({ recentDictations: [dictation] }), now), "Recent dictations")[0];
      expect(at(said("a", "Hello", ""))).toMatchObject({ sublabel: "13:30" });
      expect(at(said("a", "Hello", "Mail", "not a time"))).toMatchObject({ sublabel: "Mail" });
      expect(at(said("a", "Hello", "", "not a time"))).not.toHaveProperty("sublabel");
    });

    it("isn't offered where there is no library: setup or Settings come first", () => {
      expect(JSON.stringify(buildMenuModel(input({ libraryReady: false, recentDictations: dictations }), now))).not.toContain("Recent dictations");
    });

    it("dictationRow keeps a row on one line and cuts a long one at a whole character", () => {
      expect(dictationRow("Short words")).toBe("Short words");
      expect(dictationRow("  Two\nlines   and\tspaces ")).toBe("Two lines and spaces");
      expect(dictationRow("a".repeat(44))).toBe("a".repeat(44));
      expect(dictationRow("a".repeat(45))).toBe(`${"a".repeat(44)}…`);
      expect(dictationRow(`${"a".repeat(43)} and more`)).toBe(`${"a".repeat(43)}…`); // no space before the ellipsis
      expect(dictationRow(`${"a".repeat(43)}🌿🌿🌿`)).toBe(`${"a".repeat(43)}🌿…`); // a character of two units stays whole
    });
  });

  describe("Dictate into any app", () => {
    it("is a row with a check, its key beside it, above the settings", () => {
      const items = buildMenuModel(input({ cursorDictation: { enabled: true, key: "Right Option" } }), now);
      expect(labels(items).slice(-5)).toEqual(["--", "Dictate into any app", "Open library", "Settings…", "Quit Avanzel"]);
      const toggle = row(items, "toggle-dictation");
      expect(toggle).toEqual({ type: "item", label: "Dictate into any app", action: "toggle-dictation", detail: "Right Option", checked: true });
      expect(menuLabel(toggle as { label: string; detail?: string })).toBe("Dictate into any app (Right Option)");
    });

    it("has no check while it is off, and names the key chosen", () => {
      expect(row(buildMenuModel(input({ cursorDictation: { enabled: false, key: "Left Option" } }), now), "toggle-dictation")).toMatchObject({ detail: "Left Option", checked: false });
    });

    it("isn't there on a Mac that can't, or where there is no library", () => {
      expect(row(buildMenuModel(input({ cursorDictation: null }), now), "toggle-dictation")).toBeUndefined();
      expect(row(buildMenuModel(input({ libraryReady: false, cursorDictation: { enabled: true, key: "Right Option" } }), now), "toggle-dictation")).toBeUndefined();
    });

    it("is the only row with a check", () => {
      const items = buildMenuModel(input({ undoableFiling: true, undoableReview: true, showableReceipt: true, hasReceipt: true, cursorDictation: { enabled: false, key: "Right Option" } }), now);
      expect(menuRows(items).filter((item) => "checked" in item).map((item) => item.action)).toEqual(["toggle-dictation"]);
    });
  });

  describe("Undo the last filing", () => {
    const undo = { type: "item", label: "Undo the last filing", action: "undo-filing", accelerator: "Alt+Shift+Z" };
    const withUndo = (overrides: Partial<MenuInput> = {}) => buildMenuModel(input({ undoableFiling: true, ...overrides }), now);

    it("leads the section after the actions, out in the open, with its shortcut", () => {
      const items = withUndo();
      expect(labels(items)).toEqual([
        "3 thoughts filed today", "--",
        "Record a thought", "Capture screen…", "Type a thought…", "Ask your library…", "--",
        "Undo the last filing", "Recently filed", "Scheduled reviews", "--",
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

    it("is there with no page to list: a filing that wrote none can still be undone", () => {
      // A filing that wrote no page (the agent only logged the note) leaves no page to list. "Nothing filed yet" would contradict the
      // head's count and the Undo.
      const empty = withUndo({ recent: [], filedToday: 1 });
      expect(labels(empty)[0]).toBe("1 thought filed today");
      expect(section(empty)).toEqual(["Undo the last filing", "Scheduled reviews"]);
    });

    it("is an item that can be read, not dimmed, with its shortcut and no shelf or sublabel", () => {
      const item = row(withUndo(), "undo-filing");
      expect(item).toEqual(undo);
      expect(item).not.toHaveProperty("enabled", false);
      // The shortcut is shown while it works: one that didn't register is not, as it is for the other four.
      const unregistered = row(withUndo({ unregisteredShortcuts: ["undo"] }), "undo-filing");
      expect(unregistered).toEqual({ type: "item", label: "Undo the last filing", action: "undo-filing" });
      expect(unregistered).not.toHaveProperty("accelerator");
    });

    it("is not offered where there is no library: setup or Settings come first", () => {
      expect(labels(buildMenuModel(input({ libraryReady: false, undoableFiling: true }), now))).toEqual(["Set up Avanzel…", "--", "Quit Avanzel"]);
    });

    it("sits apart from the evening review's own Undo, which is with the reviews", () => {
      const items = withUndo({ undoableReview: true });
      expect(labels(items)).toContain("Undo the last filing");
      expect(labels(submenu(items, "Scheduled reviews"))).toEqual(["Evening review", "Weekly review", "--", "Undo the last evening review"]);
      expect(row(items, "undo-review")).toEqual({ type: "item", label: "Undo the last evening review", action: "undo-review" });
    });

    it("keeps the review's Undo offered in a library with no reviews to list", () => {
      expect(labels(submenu(buildMenuModel(input({ tasks: [], undoableReview: true }), now), "Scheduled reviews"))).toEqual(["Undo the last evening review"]);
    });
  });

  describe("Show the last receipt", () => {
    const receipt = { type: "item", label: "Show the last receipt", action: "show-receipt" };
    const withReceipt = (overrides: Partial<MenuInput> = {}) => buildMenuModel(input({ showableReceipt: true, hasReceipt: true, ...overrides }), now);

    it("ends Recently filed, under the pages", () => {
      const items = withReceipt({ undoableFiling: true });
      expect(labels(submenu(items, "Recently filed"))).toEqual(["Launch the indie game dev podcast", "Маленький сад на балконе", "--", "Show the last receipt"]);
      expect(row(items, "show-receipt")).toEqual(receipt);
    });

    it("is all the submenu holds where the invitation would be", () => {
      const items = withReceipt({ recent: [], filedToday: 0 });
      expect(labels(submenu(items, "Recently filed"))).toEqual(["Show the last receipt"]);
      expect(JSON.stringify(items)).not.toContain("Nothing filed yet");
    });

    // The invitation looks at whether the library has a receipt, not at whether it can be shown now: `showableReceipt` is false during
    // every recording, filing and review, and the invitation would come back for the length of each run in a library whose only
    // filing was noted on an earlier day (N6).
    it("keeps the invitation away while a run hides it", () => {
      const items = buildMenuModel(input({ recent: [], filedToday: 0, hasReceipt: true, showableReceipt: false }), now);
      expect(labels(items)).not.toContain("Recently filed");
      expect(JSON.stringify(items)).not.toContain("Nothing filed yet");
      expect(section(items)).toEqual(["Scheduled reviews"]);
      // And with no receipt at all the invitation is there, as it was.
      expect(section(buildMenuModel(input({ recent: [], filedToday: 0 }), now))).toEqual(["Nothing filed yet. Press ⌥Space and say hello.", "Scheduled reviews"]);
    });

    it("is only there while a receipt can be shown", () => {
      for (const items of [buildMenuModel(input(), now), buildMenuModel(input({ showableReceipt: false }), now), buildMenuModel(input({ hasReceipt: true }), now)]) {
        expect(JSON.stringify(items)).not.toContain("show-receipt");
      }
    });

    it("is an item that can be read, with no shortcut, shelf or sublabel", () => {
      const item = row(withReceipt(), "show-receipt");
      expect(item).toEqual(receipt);
      expect(item).not.toHaveProperty("enabled", false);
    });

    it("is not offered where there is no library: setup or Settings come first", () => {
      expect(labels(buildMenuModel(input({ libraryReady: false, showableReceipt: true, hasReceipt: true }), now))).toEqual(["Set up Avanzel…", "--", "Quit Avanzel"]);
    });
  });

  it("a shortcut that didn't register is not shown in the menu", () => {
    const items = buildMenuModel(input({ unregisteredShortcuts: ["dictate"] }), now);
    expect(row(items, "dictate")).toEqual({ type: "item", label: "Record a thought", action: "dictate" });
    expect(row(items, "capture")).toMatchObject({ accelerator: "Alt+Shift+S" });
    expect(row(items, "type")).toMatchObject({ accelerator: "Alt+Shift+Space" });
    expect(row(items, "ask")).toMatchObject({ accelerator: "Alt+Shift+A" });
  });

  it("turns the first item into Stop while recording", () => {
    expect(row(buildMenuModel(input({ recording: true }), now), "dictate")).toMatchObject({ label: "Stop recording" });
  });

  it("offers notes on a call right under Capture screen…, and Stop taking notes while a call runs", () => {
    const ready = labels(buildMenuModel(input({ callNotes: "ready" }), now));
    expect(ready.slice(ready.indexOf("Capture screen…"), ready.indexOf("Capture screen…") + 2)).toEqual(["Capture screen…", "Take notes on a call…"]);
    expect(ready).not.toContain("Stop taking notes");
    expect(row(buildMenuModel(input({ callNotes: "ready" }), now), "call-notes")).toEqual({ type: "item", label: "Take notes on a call…", action: "call-notes" });

    const running = labels(buildMenuModel(input({ callNotes: "running" }), now));
    expect(running.slice(running.indexOf("Capture screen…"), running.indexOf("Capture screen…") + 2)).toEqual(["Capture screen…", "Stop taking notes"]);
    expect(running).not.toContain("Take notes on a call…");
    expect(row(buildMenuModel(input({ callNotes: "running" }), now), "call-notes-stop")).toEqual({ type: "item", label: "Stop taking notes", action: "call-notes-stop" });

    const off = labels(buildMenuModel(input({ callNotes: "off" }), now));
    expect(off).not.toContain("Take notes on a call…");
    expect(off).not.toContain("Stop taking notes");
    // Without a library the menu only sets one up, whatever the call says.
    expect(labels(buildMenuModel(input({ libraryReady: false, callNotes: "ready" }), now))).toEqual(["Set up Avanzel…", "--", "Quit Avanzel"]);
  });

  it("offers to finish a call that was cut short right under Take notes on a call…, only while one waits", () => {
    const CUT_SHORT = "Finish notes for a call that was cut short";
    const waiting = labels(buildMenuModel(input({ callNotes: "ready", cutShortCalls: 2 }), now));
    expect(waiting.slice(waiting.indexOf("Take notes on a call…"), waiting.indexOf("Take notes on a call…") + 2)).toEqual([
      "Take notes on a call…",
      CUT_SHORT,
    ]);
    expect(waiting.filter((label) => label === CUT_SHORT)).toHaveLength(1); // one row, however many wait
    expect(row(buildMenuModel(input({ callNotes: "ready", cutShortCalls: 1 }), now), "finish-cut-short")).toEqual({
      type: "item",
      label: CUT_SHORT,
      action: "finish-cut-short",
    });
    expect(labels(buildMenuModel(input({ callNotes: "ready", cutShortCalls: 0 }), now))).not.toContain(CUT_SHORT);
    // Without a library the menu only sets one up.
    expect(labels(buildMenuModel(input({ libraryReady: false, cutShortCalls: 1 }), now))).not.toContain(CUT_SHORT);
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
    expect(formatWhen(new Date(2026, 9, 19, 23, 59), now)).toBe("Yesterday 23:59");
    expect(formatWhen(new Date(2026, 9, 25, 18, 0), now)).toBe("Sun 18:00");
    expect(formatWhen(new Date(2026, 10, 2, 18, 0), now)).toBe("2 Nov 18:00");
    expect(formatWhen(new Date(2026, 9, 12, 8, 0), now)).toBe("12 Oct 08:00");
  });
});

describe("speechProblemOf", () => {
  it("names a download that didn't finish with the capsule's own title, and says what is safe and where to try again", () => {
    const kept = speechProblemOf({ kind: "error", cause: "download", message: "silero_vad.onnx: the connection dropped", resumable: true });
    expect(kept).toEqual({
      title: "The speech model didn't finish downloading.",
      sublabel: "Typing works meanwhile. Try again in Settings → Voice.",
    });
    // Whether part of the download was kept is for Settings → Voice to say, beside its Try again: the menu says the same either way.
    const gone = speechProblemOf({ kind: "error", cause: "download", message: "silero_vad.onnx: what arrived was damaged", resumable: false });
    expect(gone).toEqual(kept);
    // The title and what is safe are the card's and Settings → Voice's own: one builder, wherever the problem is told.
    for (const resumable of [true, false]) {
      const told = downloadFailedProblem("anything", resumable);
      expect(told.title).toBe(kept?.title);
      expect(told.body).toContain(`${TYPING_WORKS_MEANWHILE}, and Try again`);
      expect(kept?.sublabel.startsWith(`${TYPING_WORKS_MEANWHILE}. `)).toBe(true);
    }
  });

  it("names voice settings Avanzel can't use with the capsule's own title, and says what is safe and where they are fixed", () => {
    const problem = speechProblemOf({ kind: "error", cause: "settings", message: "Speech model 'parakeet-v9' is not supported", resumable: false });
    expect(problem).toEqual({
      title: "Avanzel can't use the voice settings in this library's config file.",
      sublabel: "Typed thoughts are still saved to the inbox. Fix the config file.",
    });
    const told = voiceSettingsProblem("anything");
    expect(problem?.title).toBe(told.title);
    expect(told.body).toContain(TYPED_THOUGHTS_SAVED);
    expect(problem?.sublabel.startsWith(`${TYPED_THOUGHTS_SAVED} `)).toBe(true);
  });

  it("leaves what Try again does, whether it continues or starts over, to Settings → Voice", () => {
    for (const resumable of [true, false]) {
      const download = speechProblemOf({ kind: "error", cause: "download", message: "x", resumable });
      expect(download?.sublabel, `resumable ${resumable}`).not.toMatch(/continues|starts the download|downloads it again/);
    }
  });

  it("is nothing while the model is ready, on its way, or still to be fetched", () => {
    expect(speechProblemOf({ kind: "ready", dir: "/models/parakeet" })).toBeNull();
    expect(speechProblemOf({ kind: "missing", bytes: 673_000_000 })).toBeNull();
    expect(speechProblemOf({ kind: "downloading", receivedBytes: 1, totalBytes: 2 })).toBeNull();
  });

  it("says nothing the copy rules forbid: sentence case, no exclamation mark, never Letter", () => {
    for (const cause of ["download", "settings"] as const) {
      const problem = speechProblemOf({ kind: "error", cause, message: "x", resumable: true });
      for (const line of [problem?.title ?? "", problem?.sublabel ?? ""]) {
        expect(line).toMatch(/^[A-Z]/);
        expect(line).toMatch(/\.$/);
        expect(line).not.toMatch(/!|oops|letter/i);
      }
    }
  });
});
