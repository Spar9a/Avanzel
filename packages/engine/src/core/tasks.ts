// Shadow tasks: runs Avanzel starts on its own (the evening review, a weekly review, the owner's
// own). Each is a Markdown file in `tasks/` — frontmatter for the schedule, agent and tools, the body
// for the owner's standing instructions. When a task last ran is the app's business, not the file's.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { AvanzelError } from "../types.ts";
import { flowItems, frontmatterFields, splitFrontmatter, yamlScalar } from "./frontmatter.ts";
import { template, templatesDir } from "./templates.ts";
import type { Vault } from "./vault.ts";

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
export const TASK_KINDS = ["evening-review", "review", "custom"] as const;

export type Weekday = (typeof WEEKDAYS)[number];
export type TaskKind = (typeof TASK_KINDS)[number];

/** "daily 21:00" or "weekly sun 18:00", in local time. */
export type Schedule =
  | { every: "daily"; hour: number; minute: number }
  | { every: "weekly"; day: Weekday; hour: number; minute: number };

export interface ShadowTask {
  /** The file name without `.md`. */
  id: string;
  path: string;
  name: string;
  schedule: Schedule;
  kind: TaskKind;
  /** "auto" or a harness name. */
  agent: string;
  tools: string[];
  enabled: boolean;
  /** The owner's standing instructions (the file's body). */
  instructions: string;
}

export function parseSchedule(text: string): Schedule {
  const words = text.trim().toLowerCase().split(/\s+/);
  const time = /^(\d{1,2}):(\d{2})$/.exec(words.at(-1) ?? "");
  const hour = Number(time?.[1]);
  const minute = Number(time?.[2]);
  if (time && hour < 24 && minute < 60) {
    if (words.length === 2 && words[0] === "daily") return { every: "daily", hour, minute };
    const day = words.length === 3 && words[0] === "weekly" ? weekday(words[1] ?? "") : null;
    if (day) return { every: "weekly", day, hour, minute };
  }
  throw new AvanzelError(
    `Unknown schedule "${text}": use "daily HH:MM" or "weekly <sun|mon|tue|wed|thu|fri|sat> HH:MM".`,
  );
}

export function formatSchedule(schedule: Schedule): string {
  const time = `${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`;
  return schedule.every === "daily" ? `daily ${time}` : `weekly ${schedule.day} ${time}`;
}

/** The most recent scheduled time at or before `now`. */
export function lastDue(schedule: Schedule, now: Date): Date {
  const back = schedule.every === "weekly" ? (now.getDay() - WEEKDAYS.indexOf(schedule.day) + 7) % 7 : 0;
  const candidate = scheduledOn(now, -back, schedule);
  return candidate <= now ? candidate : scheduledOn(now, -back - period(schedule), schedule);
}

/** The first scheduled time after `now`. */
export function nextRun(schedule: Schedule, now: Date): Date {
  const ahead = schedule.every === "weekly" ? (WEEKDAYS.indexOf(schedule.day) - now.getDay() + 7) % 7 : 0;
  const candidate = scheduledOn(now, ahead, schedule);
  return candidate > now ? candidate : scheduledOn(now, ahead + period(schedule), schedule);
}

export function loadTasks(vault: Vault): ShadowTask[] {
  const folder = tasksDir(vault);
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((name) => name.endsWith(".md") && !name.startsWith("."))
    .sort()
    .map((name) => parseTask(join(folder, name)));
}

/** Write `tasks/<id>.md`; returns its path. */
export function saveTask(vault: Vault, task: ShadowTask): string {
  if (!/^[^./\\][^/\\]*$/.test(task.id)) throw new AvanzelError(`"${task.id}" cannot be a task file name.`);
  const folder = tasksDir(vault);
  mkdirSync(folder, { recursive: true });
  const path = join(folder, `${task.id}.md`);
  const text = [
    "---",
    `name: ${yamlScalar(task.name)}`,
    `schedule: ${formatSchedule(task.schedule)}`,
    `kind: ${task.kind}`,
    `agent: ${yamlScalar(task.agent)}`,
    `tools: [${task.tools.map((tool) => yamlScalar(tool, true)).join(", ")}]`,
    `enabled: ${task.enabled}`,
    "---",
    "",
    `${task.instructions.trim()}\n`,
  ].join("\n");
  writeFileSync(path, text, "utf8");
  return path;
}

/**
 * Give a library the default tasks (evening review, weekly review) the first time it is opened by
 * this engine: only when it has no `tasks/` folder, so a task the owner deleted stays deleted.
 */
export function ensureDefaultTasks(vault: Vault): ShadowTask[] {
  const folder = tasksDir(vault);
  if (existsSync(folder)) return [];
  mkdirSync(folder, { recursive: true });
  const names = readdirSync(join(templatesDir(), "tasks")).filter((name) => name.endsWith(".md"));
  for (const name of names.sort()) writeFileSync(join(folder, name), template(`tasks/${name}`), "utf8");
  return loadTasks(vault);
}

function tasksDir(vault: Vault): string {
  return join(vault.root, "tasks");
}

function parseTask(path: string): ShadowTask {
  const fail = (problem: string): never => {
    throw new AvanzelError(`${path}: ${problem}`);
  };
  let text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  if (text.endsWith("\n---")) text += "\n";
  const [front, body] = splitFrontmatter(text);
  if (!front) fail("a task starts with a --- block holding at least `schedule:` (e.g. daily 21:00).");
  const fields = frontmatterFields(front);
  const scheduleText = fields.get("schedule") ?? fail('`schedule` is missing (e.g. "daily 21:00").');
  let schedule: Schedule;
  try {
    schedule = parseSchedule(scheduleText);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  const kind = fields.get("kind") ?? "custom";
  if (!isTaskKind(kind)) return fail(`\`kind\` must be one of ${TASK_KINDS.join(", ")}.`);
  const enabled = fields.get("enabled") ?? "true";
  if (enabled !== "true" && enabled !== "false") return fail("`enabled` must be true or false.");
  const id = basename(path, ".md");
  return {
    id,
    path,
    name: fields.get("name") || id,
    schedule,
    kind,
    agent: fields.get("agent") || "auto",
    tools: flowItems(fields.get("tools") ?? ""),
    enabled: enabled === "true",
    instructions: body.trim(),
  };
}

function isTaskKind(kind: string): kind is TaskKind {
  return (TASK_KINDS as readonly string[]).includes(kind);
}

function weekday(word: string): Weekday | null {
  const index = Math.max(WEEKDAYS.indexOf(word as Weekday), WEEKDAY_NAMES.indexOf(word));
  return WEEKDAYS[index] ?? null;
}

function period(schedule: Schedule): number {
  return schedule.every === "weekly" ? 7 : 1;
}

/** The scheduled wall-clock time on the local day `days` from `base`'s (DST-safe). */
function scheduledOn(base: Date, days: number, schedule: Schedule): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days, schedule.hour, schedule.minute);
}
