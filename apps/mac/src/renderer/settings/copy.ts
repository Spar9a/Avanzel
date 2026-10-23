// Settings' words that panes share or make from values: the name of each pane on the toolbar, the library's line, a
// message ended as a sentence, the microphone's name, what the speech model row says, when Tonight files, and a
// scheduled review's schedule, last run and kind, with the checks its editor makes and what a failed save says.
import { SHELVES } from "@avanzel/ui";
import { noSuchReview, type PickOption, type SettingsPane, type TaskInfo } from "../../shared/ipc.ts";

/** Each pane's name on the toolbar, which is also its heading. The scheduled reviews' pane keeps its id, "tasks". */
export const PANE_LABELS: Readonly<Record<SettingsPane, string>> = {
  general: "General",
  voice: "Voice",
  agents: "Agents",
  tasks: "Reviews",
  privacy: "Privacy",
};

/** The library row's description, from LibraryInfo.shelves (the six shelves count; others don't) and isGit. */
export function libraryLine(shelves: Readonly<Record<string, number>>, isGit: boolean): string {
  const pages = SHELVES.reduce((sum, shelf) => sum + (shelves[shelf] ?? 0), 0);
  const filled = pages === 0 ? "Your first thought will fill a shelf." : `${pages} ${pages === 1 ? "page" : "pages"} on six shelves.`;
  const undo = isGit ? "Every change is a commit you can undo." : "This folder has no git history, so changes can't be undone.";
  return `${filled} ${undo}`;
}

/** `text` ending as a sentence: a full stop added, unless it ends in ".", "?" or "…". */
export function asSentence(text: string): string {
  return /[.?…]$/.test(text) ? text : `${text}.`;
}

/** An audio input the page can list: what enumerateDevices gives for one, less the "default" entry. */
export interface InputDevice { deviceId: string; label: string }

/** The device's own name, or its place in the list when it has none. */
function deviceName(device: InputDevice, index: number): string {
  return device.label || `Microphone ${index + 1}`;
}

/**
 * The microphone in use, by name: "System default" for none chosen, the device's name (or "Microphone 2" by its place
 * in the list, when it has none), or "Microphone not connected" for a chosen one the list doesn't hold. `devices` is
 * null until the page has listed them, and a chosen microphone is then only "Microphone": it has no name to give yet,
 * and can't be called missing before anyone has looked.
 */
export function microphoneName(id: string | null, devices: readonly InputDevice[] | null): string {
  if (id === null) return "System default";
  if (devices === null) return "Microphone";
  const place = devices.findIndex((device) => device.deviceId === id);
  return place === -1 ? "Microphone not connected" : deviceName(devices[place]!, place);
}

/**
 * Choose…'s menu for the microphone: "System default" (value ""), then each device, named as microphoneName names it,
 * with the one in use checked. A chosen microphone that isn't connected leaves everything unchecked. Before the devices
 * are listed (`devices` null), the menu holds System default alone.
 */
export function microphoneOptions(id: string | null, devices: readonly InputDevice[] | null): PickOption[] {
  return [
    { label: "System default", value: "", checked: id === null },
    ...(devices ?? []).map((device, place) => ({ label: deviceName(device, place), value: device.deviceId, checked: device.deviceId === id })),
  ];
}

/** The speech model row's description: which languages it hears, as a person would want to know, naming no model. */
export const SPEECH_MODEL_DESCRIPTION =
  "Turns your voice into text on this Mac, in 25 European languages including English, Ukrainian and Russian. Nothing is sent anywhere.";

/** The days a weekly review runs on, from Sunday: as a schedule writes each one ("sun"), and by its name. */
export const DAYS: readonly { value: string; label: string }[] = [
  { value: "sun", label: "Sunday" },
  { value: "mon", label: "Monday" },
  { value: "tue", label: "Tuesday" },
  { value: "wed", label: "Wednesday" },
  { value: "thu", label: "Thursday" },
  { value: "fri", label: "Friday" },
  { value: "sat", label: "Saturday" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Two digits, as a clock shows hours and minutes. */
const twoDigits = (n: number) => String(n).padStart(2, "0");

/**
 * A review's schedule as its editor holds it: how often, the day, and the time. `schedule` is as main sends it ("daily
 * 21:00", "weekly sun 18:00"). A daily one's day is Sunday, the day it runs on if it is made weekly.
 */
export function scheduleParts(schedule: string): { every: "daily" | "weekly"; day: string; time: string } {
  const [every, ...rest] = schedule.trim().split(/\s+/);
  if (every === "weekly") return { every: "weekly", day: rest[0] ?? "sun", time: rest[1] ?? "" };
  return { every: "daily", day: "sun", time: rest[0] ?? "" };
}

/** The schedule a review's Save writes, as main reads it: "daily 07:30", "weekly mon 07:30". */
export function scheduleText(every: "daily" | "weekly", day: string, time: string): string {
  return every === "weekly" ? `weekly ${day} ${time}` : `daily ${time}`;
}

/** A daily schedule as main sends it, with its time: "daily 21:00". */
const DAILY = /^daily (\d\d:\d\d)$/;

/** When a review runs, as its row says it: "Every day at 21:00", "Sundays at 18:00". Any other schedule stays as given. */
export function whenLine(schedule: string): string {
  const daily = DAILY.exec(schedule);
  if (daily) return `Every day at ${daily[1]}`;
  const weekly = /^weekly (\w+) (\d\d:\d\d)$/.exec(schedule);
  const day = DAYS.find((each) => each.value === weekly?.[1]);
  return weekly && day ? `${day.label}s at ${weekly[2]}` : schedule;
}

/**
 * The description of General's "File each thought", from the library's evening review (null when it has none). Tonight
 * says when the review files only while it is on: at its time when it runs daily, or by its schedule as the Reviews pane
 * words it. While it is off, or missing, new thoughts wait in the inbox until it runs.
 */
export function fileModeLine(evening: Pick<TaskInfo, "schedule" | "enabled"> | null): string {
  const now = "Right away uses your agent now.";
  if (!evening?.enabled) return `${now} Tonight keeps new thoughts in the inbox until the evening review runs.`;
  const daily = DAILY.exec(evening.schedule);
  return daily
    ? `${now} Tonight waits for the evening review at ${daily[1]}.`
    : `${now} Tonight waits for the evening review, ${whenLine(evening.schedule)}.`;
}

/** The local midnight that starts `date`'s day. */
const midnight = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/**
 * "Running now…", "Not run yet.", or "Last run today at 21:00." / "yesterday at …" / "on Sunday at …" for a run in the
 * last 6 days / "on 2 Oct at …" before that ("on 30 Dec 2025 at …" in another year). Formatted by hand, never with
 * toLocale*, so tests don't depend on locale.
 */
export function lastRunLine(task: Pick<TaskInfo, "running" | "lastRun">, now: Date): string {
  if (task.running) return "Running now…";
  if (!task.lastRun) return "Not run yet.";
  const ran = new Date(task.lastRun);
  const at = `at ${twoDigits(ran.getHours())}:${twoDigits(ran.getMinutes())}.`;
  // Whole days between the two calendar days: a day that changes the clock is an hour short or long, which rounds away.
  const daysAgo = Math.round((midnight(now) - midnight(ran)) / 86_400_000);
  if (daysAgo === 0) return `Last run today ${at}`;
  if (daysAgo === 1) return `Last run yesterday ${at}`;
  if (daysAgo > 1 && daysAgo < 7) return `Last run on ${DAYS[ran.getDay()]!.label} ${at}`;
  const year = ran.getFullYear() === now.getFullYear() ? "" : ` ${ran.getFullYear()}`;
  return `Last run on ${ran.getDate()} ${MONTHS[ran.getMonth()]}${year} ${at}`;
}

/** HH:MM with an hour under 24 and minutes under 60, as parseSchedule takes it, zero-padded ("7:30" → "07:30"); else null. */
export function validTime(text: string): string | null {
  const time = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!time) return null;
  const hour = Number(time[1]);
  const minute = Number(time[2]);
  return hour < 24 && minute < 60 ? `${twoDigits(hour)}:${twoDigits(minute)}` : null;
}

/**
 * The body of the Notice under review `id` when its save failed: main's reason, then only what is true of the review
 * now. Main refuses with noSuchReview when it lists no such review any more, its file having gone: then it no longer
 * runs. Any other refusal leaves the review as it was, so it runs as it was last saved.
 */
export function failedSaveLine(id: string, reason: string): string {
  const gone = reason === noSuchReview(id);
  return `${asSentence(reason)} ${gone ? "Its file is gone, so it no longer runs." : "It still runs as last saved."}`;
}

/** What a review of `kind` does, under its switch. A kind Avanzel doesn't run is a custom one. */
export function kindLine(kind: string): string {
  if (kind === "evening-review") return "Files anything still in the inbox and writes a short summary.";
  if (kind === "review") return "Looks over the whole library and writes a report in reviews/.";
  return "Avanzel doesn't run custom reviews yet.";
}

/**
 * An IPC rejection's message without Electron's "Error invoking remote method '…': " and the error's class name
 * ("AvanzelError: "), so it reads as main wrote it.
 */
export function remoteMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, "");
}
