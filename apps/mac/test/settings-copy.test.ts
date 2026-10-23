import { describe, expect, it } from "vitest";
import {
  asSentence,
  DAYS,
  failedSaveLine,
  fileModeLine,
  kindLine,
  lastRunLine,
  libraryLine,
  microphoneName,
  microphoneOptions,
  PANE_LABELS,
  remoteMessage,
  scheduleParts,
  scheduleText,
  SPEECH_MODEL_DESCRIPTION,
  validTime,
  whenLine,
} from "../src/renderer/settings/copy.ts";
import { noSuchReview, SETTINGS_PANES } from "../src/shared/ipc.ts";

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

  it("the speech model row says which languages it hears, and names no model", () => {
    expect(SPEECH_MODEL_DESCRIPTION).toBe(
      "Turns your voice into text on this Mac, in 25 European languages including English, Ukrainian and Russian. Nothing is sent anywhere.",
    );
    // The languages are for the person to know; which model hears them is the app's business.
    expect(SPEECH_MODEL_DESCRIPTION).not.toMatch(/parakeet|whisper|silero|nemo/i);
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

  it("failedSaveLine says what is true of a review whose save failed", () => {
    // Main still lists the review, and refused for another reason: it runs as it was last saved.
    expect(failedSaveLine("weekly-review", "EACCES: permission denied")).toBe("EACCES: permission denied. It still runs as last saved.");
    // Main lists no review of that id any more: its file is gone, and it no longer runs.
    expect(noSuchReview("weekly-review")).toBe("No scheduled review called weekly-review.");
    expect(failedSaveLine("weekly-review", noSuchReview("weekly-review"))).toBe(
      "No scheduled review called weekly-review. Its file is gone, so it no longer runs.",
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
});
