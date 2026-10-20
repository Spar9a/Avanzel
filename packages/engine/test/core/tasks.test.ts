import { linkSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureDefaultTasks,
  formatSchedule,
  lastDue,
  loadTasks,
  loadTasksReport,
  nextRun,
  parseSchedule,
  saveTask,
  type ShadowTask,
} from "../../src/core/tasks.ts";
import { Vault } from "../../src/core/vault.ts";
import { AvanzelError } from "../../src/types.ts";
import { useTmp, write } from "./helpers.ts";

const at = (iso: string) => new Date(iso);

describe("schedules", () => {
  it("parse daily and weekly schedules and format them back (tasks_parse_and_due_times)", () => {
    expect(parseSchedule("daily 21:00")).toEqual({ every: "daily", hour: 21, minute: 0 });
    expect(parseSchedule("weekly sun 18:00")).toEqual({ every: "weekly", day: "sun", hour: 18, minute: 0 });
    expect(parseSchedule("  Weekly  Friday 7:05 ")).toEqual({ every: "weekly", day: "fri", hour: 7, minute: 5 });
    expect(formatSchedule(parseSchedule("weekly sun 18:00"))).toBe("weekly sun 18:00");
    expect(formatSchedule({ every: "daily", hour: 7, minute: 5 })).toBe("daily 07:05");
  });

  it.each(["", "daily", "daily 24:00", "daily 9:60", "hourly 10:00", "weekly someday 10:00", "weekly 10:00", "daily 21:00 pm"])(
    "reject %j",
    (text) => {
      expect(() => parseSchedule(text)).toThrow(AvanzelError);
    },
  );

  it("know when they were last due and when they run next (tasks_parse_and_due_times)", () => {
    const daily = parseSchedule("daily 21:00");
    expect(lastDue(daily, at("2026-10-20T14:03:12+04:00"))).toEqual(at("2026-10-19T21:00:00+04:00"));
    expect(lastDue(daily, at("2026-10-20T21:00:00+04:00"))).toEqual(at("2026-10-20T21:00:00+04:00"));
    expect(nextRun(daily, at("2026-10-20T14:03:12+04:00"))).toEqual(at("2026-10-20T21:00:00+04:00"));
    expect(nextRun(daily, at("2026-10-20T21:00:00+04:00"))).toEqual(at("2026-10-21T21:00:00+04:00"));

    const weekly = parseSchedule("weekly sun 18:00"); // 2026-10-20 is a Tuesday
    expect(lastDue(weekly, at("2026-10-20T14:03:12+04:00"))).toEqual(at("2026-10-18T18:00:00+04:00"));
    expect(nextRun(weekly, at("2026-10-20T14:03:12+04:00"))).toEqual(at("2026-10-25T18:00:00+04:00"));
    expect(lastDue(weekly, at("2026-10-25T17:59:59+04:00"))).toEqual(at("2026-10-18T18:00:00+04:00"));
    expect(lastDue(weekly, at("2026-10-25T18:00:00+04:00"))).toEqual(at("2026-10-25T18:00:00+04:00"));
    expect(nextRun(weekly, at("2026-10-25T18:00:00+04:00"))).toEqual(at("2026-11-01T18:00:00+04:00"));
  });

  it("keep the wall-clock time across a daylight-saving change", () => {
    vi.stubEnv("TZ", "Europe/Berlin"); // clocks go back at 03:00 on Sunday 2026-10-25
    expect(nextRun(parseSchedule("daily 21:00"), at("2026-10-24T22:00:00+02:00"))).toEqual(at("2026-10-25T21:00:00+01:00"));
    expect(lastDue(parseSchedule("weekly sun 18:00"), at("2026-10-26T09:00:00+01:00"))).toEqual(
      at("2026-10-25T18:00:00+01:00"),
    );
  });

  it("make a missed task run once, however many runs were missed (missed_run_runs_once)", () => {
    // The app keeps each task's last run; a task is due when its last scheduled time is after it.
    const daily = parseSchedule("daily 21:00");
    const due = (lastRun: Date, now: Date) => lastDue(daily, now) > lastRun;
    let lastRun = at("2026-10-16T21:00:05+04:00");
    const wake = at("2026-10-20T09:00:00+04:00"); // asleep through four evenings
    expect(due(lastRun, wake)).toBe(true);
    lastRun = wake;
    expect(due(lastRun, at("2026-10-20T09:01:00+04:00"))).toBe(false);
    expect(due(lastRun, at("2026-10-20T20:59:59+04:00"))).toBe(false);
    expect(due(lastRun, at("2026-10-20T21:00:00+04:00"))).toBe(true);
  });
});

describe("task files", () => {
  const tmp = useTmp();
  let vault: Vault;

  beforeEach(async () => {
    vault = await Vault.init(join(tmp(), "lib"), { git: false });
  });

  it("start as the two defaults", () => {
    const [evening, weekly, ...rest] = loadTasks(vault);
    expect(rest).toEqual([]);
    expect(evening).toEqual({
      id: "evening-review",
      path: join(vault.root, "tasks", "evening-review.md"),
      name: "Evening review",
      schedule: { every: "daily", hour: 21, minute: 0 },
      kind: "evening-review",
      agent: "auto",
      tools: ["library"],
      enabled: true,
      instructions: expect.stringMatching(/^File everything that came into the inbox today: .*belongs to\.$/s),
    });
    expect(weekly).toMatchObject({
      id: "weekly-review",
      name: "Weekly review",
      schedule: { every: "weekly", day: "sun", hour: 18, minute: 0 },
      kind: "review",
      enabled: true,
    });
  });

  it("save and load back", () => {
    const task: ShadowTask = {
      id: "standup",
      path: "",
      name: "Morning: plan #1",
      schedule: parseSchedule("weekly mon 08:30"),
      kind: "custom",
      agent: "codex",
      tools: ["library", "web search"],
      enabled: false,
      instructions: "Line one.\n\nLine two with ${dollar} and\n---\ndashes.",
    };
    const path = saveTask(vault, task);
    expect(path).toBe(join(vault.root, "tasks", "standup.md"));
    expect(readFileSync(path, "utf8")).toContain("\nschedule: weekly mon 08:30\nkind: custom\n");
    expect(loadTasks(vault).find((loaded) => loaded.id === "standup")).toEqual({ ...task, path });
  });

  it("refuse an id that is not a plain file name", () => {
    const task = { ...loadTasks(vault)[0]!, id: "../escape" };
    expect(() => saveTask(vault, task)).toThrow(AvanzelError);
  });

  it("get defaults only on the first run, so deleting one sticks", () => {
    rmSync(join(vault.root, "tasks", "weekly-review.md"));
    expect(ensureDefaultTasks(vault)).toEqual([]);
    expect(loadTasks(vault).map((task) => task.id)).toEqual(["evening-review"]);
    rmSync(join(vault.root, "tasks"), { recursive: true });
    expect(ensureDefaultTasks(vault).map((task) => task.id)).toEqual(["evening-review", "weekly-review"]);
  });

  it("fill in what a hand-written task leaves out", () => {
    write(vault.root, "tasks/minimal.md", "---\nschedule: daily 07:00\n---\nSay hi.\n");
    expect(loadTasks(vault).find((task) => task.id === "minimal")).toMatchObject({
      name: "minimal",
      kind: "custom",
      agent: "auto",
      tools: [],
      enabled: true,
      instructions: "Say hi.",
    });
  });

  it.each([
    ["no frontmatter", "Just words.\n", "starts with a --- block"],
    ["no schedule", "---\nname: X\n---\nDo things.\n", "`schedule` is missing"],
    ["a bad schedule", "---\nschedule: sometimes\n---\nDo things.\n", 'Unknown schedule "sometimes"'],
    ["an unknown kind", "---\nschedule: daily 07:00\nkind: party\n---\nDo things.\n", "`kind` must be one of"],
    ["a non-boolean enabled", "---\nschedule: daily 07:00\nenabled: maybe\n---\nDo things.\n", "`enabled` must be true or false"],
  ])("report a file with %s, and still load the others", (_, text, problem) => {
    const broken = write(vault.root, "tasks/broken.md", text);
    const report = loadTasksReport(vault);
    expect(report.tasks.map((task) => task.id)).toEqual(["evening-review", "weekly-review"]);
    expect(report.problems).toEqual([{ file: broken, message: expect.stringContaining(problem) }]);
    expect(loadTasks(vault).map((task) => task.id)).toEqual(["evening-review", "weekly-review"]);
  });

  it("report a task file that can't be read at all, rather than throw", () => {
    mkdirSync(join(vault.root, "tasks", "folder.md"));
    const report = loadTasksReport(vault);
    expect(report.tasks.map((task) => task.id)).toEqual(["evening-review", "weekly-review"]);
    expect(report.problems).toEqual([{ file: join(vault.root, "tasks", "folder.md"), message: expect.stringContaining("EISDIR") }]);
  });

  it("are saved whole: a new file is renamed into place, never written into", () => {
    // A file another name shares (a hard link) shows whether saving wrote into the old file.
    const evening = loadTasks(vault)[0]!;
    const shared = write(vault.root, "elsewhere.md", "not a task\n");
    rmSync(evening.path);
    linkSync(shared, evening.path);
    saveTask(vault, { ...evening, instructions: "Saved whole." });
    expect(readFileSync(shared, "utf8")).toBe("not a task\n");
    expect(loadTasks(vault).find((task) => task.id === "evening-review")?.instructions).toBe("Saved whole.");
    expect(readdirSync(join(vault.root, "tasks")).sort()).toEqual(["evening-review.md", "weekly-review.md"]);
  });
});
