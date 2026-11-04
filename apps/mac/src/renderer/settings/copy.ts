// Settings' words that panes share or make from values: the name of each pane on the toolbar, the library's line, a
// message ended as a sentence, the microphone's name, what the speech model row says, when Tonight files, and a
// scheduled review's schedule, last run and kind, with the checks its editor makes and what a failed save says, and what
// the window says of a change main refused.
import { SHELVES } from "@avanzel/ui";
import { DICTATION_PAGE, noSuchReview, type CursorKey, type CursorPermissionState, type PickOption, type SettingsPane, type SettingsSnapshot, type TaskInfo } from "../../shared/ipc.ts";
import { NO_GIT_LINE, ownLine } from "../../shared/problems.ts";

/** Each pane's name on the toolbar, which is also its heading. The scheduled reviews' pane keeps its id, "tasks". */
export const PANE_LABELS: Readonly<Record<SettingsPane, string>> = {
  general: "General",
  voice: "Voice",
  dictations: "Dictations",
  agents: "Agents",
  tasks: "Reviews",
  privacy: "Privacy",
};

/**
 * The library row's description, from LibraryInfo.shelves (the six shelves count; others don't), isGit, autoCommit and gitUsable.
 * It says only what is true of the library. A folder with no .git has no history to speak of. One that has, on a Mac that can't
 * run git (Apple's stub), has its history, but nothing commits there and nothing can be undone, which is the Mac's doing, not the
 * library's: it says so in the words setup does (NO_GIT_LINE). Only a library with git, on a Mac that runs it, promises Undo,
 * and not when the library's own settings turn automatic commits off.
 */
export function libraryLine(shelves: Readonly<Record<string, number>>, isGit: boolean, autoCommit: boolean, gitUsable: boolean): string {
  const pages = SHELVES.reduce((sum, shelf) => sum + (shelves[shelf] ?? 0), 0);
  const filled = pages === 0 ? "Your first thought will fill a shelf." : `${pages} ${pages === 1 ? "page" : "pages"} on six shelves.`;
  if (!isGit) return `${filled} This folder has no git history, so changes can't be undone.`;
  if (!gitUsable) return `${filled} ${NO_GIT_LINE}`;
  const undo = autoCommit
    ? "Every change is a commit you can undo."
    : "Automatic commits are off in this library's settings, so changes can't be undone from Avanzel.";
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

/** The keys dictating into any app can listen to, in the order the menu lists them, named as the keyboard names them. */
const CURSOR_KEYS: readonly { key: CursorKey; name: string }[] = [
  { key: "right-option", name: "Right Option" },
  { key: "left-option", name: "Left Option" },
  { key: "right-command", name: "Right Command" },
  { key: "right-control", name: "Right Control" },
];

export const cursorKeyName = (key: CursorKey): string => CURSOR_KEYS.find((entry) => entry.key === key)!.name;

/** Choose…'s menu for the dictation key, with the key in use checked. */
export function cursorKeyOptions(chosen: CursorKey): PickOption[] {
  return CURSOR_KEYS.map(({ key, name }) => ({ label: name, value: key, checked: key === chosen }));
}

/** The "Dictate into any app" switch's description: how it works, in one sentence. */
export const CURSOR_DICTATION_DESCRIPTION = "Tap the key once to start and once to finish. The words go where the cursor is.";

/** The Dictations pane when the history is empty: the one line, and how to start. */
export const DICTATIONS_EMPTY = "Nothing dictated yet.";
export const DICTATIONS_START = "Turn on Dictate into any app in Voice, then tap its key and speak. What you say shows here.";

/** Under a dictation whose words were not pasted: they were only copied, and Copy gives them again. */
export const DICTATION_NOT_INSERTED = "These words didn't go in. Copy them to paste yourself.";

/** The title of the Notice for a Delete the history refused; main's message says what is safe and the one fix. */
export const DICTATION_NOT_DELETED = "That dictation couldn't be deleted.";

/** The body of that Notice: what is safe, and the one fix. Defined in shared/ipc.ts, as main sends it too; re-exported for the pane. */
export { DELETE_FAILED_BODY } from "../../shared/ipc.ts";

/** Under the list, when the history holds more than it lists: how many older dictations there are, and that they are kept. */
export const olderDictationsLine = (older: number): string =>
  `${older === 1 ? "1 older dictation is" : `${older} older dictations are`} kept on this Mac.`;

/** The button that lists another page of older dictations. */
export const SHOW_MORE_DICTATIONS = `Show ${DICTATION_PAGE} more`;

/** The Notice for a Copy the clipboard refused: what happened, what is safe, and the one fix. */
export const DICTATION_NOT_COPIED = "Those words couldn't be copied.";
export const DICTATION_NOT_COPIED_BODY = "They are still in the history. Try copying them again.";

/**
 * When a dictation was said, in this Mac's time: "09:05" today, "Yesterday 23:59", "3 Nov 14:03" before that, and with the year
 * when it was not this year. A time that can't be read is nothing at all.
 */
export function dictationWhen(at: string, now: Date): string {
  const moment = new Date(at);
  if (Number.isNaN(moment.getTime())) return "";
  const time = `${twoDigits(moment.getHours())}:${twoDigits(moment.getMinutes())}`;
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(moment, now)) return time;
  if (sameDay(moment, new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return `Yesterday ${time}`;
  const year = moment.getFullYear() === now.getFullYear() ? "" : ` ${moment.getFullYear()}`;
  return `${moment.getDate()} ${MONTHS[moment.getMonth()]}${year} ${time}`;
}

/** Where a dictation went: the app, and its window's title, or else the page's site, when it has either. */
export function dictationPlace({ app, title, site }: { app: string; title: string | null; site: string | null }): { app: string; detail: string | null } {
  return { app: app || "An app Avanzel couldn't see", detail: title || site || null };
}

/** The key row's description: a tap on its own is what counts. */
export const CURSOR_KEY_DESCRIPTION = "Tap it on its own. Used with another key, it does nothing.";

/**
 * The status line under the dictation switch, from what macOS has granted, and the label of the button that fixes it (none when
 * nothing needs fixing, or when nothing can: a Mac without the helper). It says which permission is missing and why Avanzel wants it.
 */
export function cursorStatus(state: CursorPermissionState): { line: string; fix: string | null } {
  if (!state.available) return { line: "Dictating into any app isn't available on this Mac.", fix: null };
  const fix = "Open System Settings";
  if (!state.inputMonitoring && !state.accessibility) {
    return { line: "Avanzel needs Input Monitoring to see the key and Accessibility to type for you.", fix };
  }
  if (!state.inputMonitoring) return { line: "Avanzel needs Input Monitoring to see the key.", fix };
  if (!state.accessibility) return { line: "Avanzel needs Accessibility to type for you.", fix };
  return { line: "Avanzel can see the key and type for you.", fix: null };
}

/** The speech model row's description for the default model: which languages it hears, as a person would want to know, naming no model. */
export const SPEECH_MODEL_DESCRIPTION =
  "Turns your voice into text on this Mac, in 25 European languages including English, Ukrainian and Russian. Nothing is sent anywhere.";

/**
 * The Dictionary row's description: how a line is written, and that the heard-as entry is the sure way. A name whose sound is
 * short (Priya) is matched only by its heard-as entry; the engine's sound-alike match leaves it alone.
 */
export const DICTIONARY_DESCRIPTION =
  "One per line. Write a name the way it should appear. To fix a word the microphone gets wrong, add what it hears after an " +
  "equals sign: Ollama = Alema, Polymer. Short names such as Priya, and names with accents, are corrected only with an equals " +
  "entry. The names are also given to your filing agent.";

/**
 * The speech models the engine runs that hear English alone (Parakeet v2); the others, the default among them, hear 25 languages.
 * The engine doesn't say which is which, so a model it gains is told with the default's languages until it is listed here:
 * test/settings-copy.test.ts fails for a model that no one has classified.
 */
const ENGLISH_ONLY_MODELS: readonly string[] = ["nemo-parakeet-tdt-0.6b-v2"];

/**
 * The speech model row's description, true of the library's own [voice] settings (SettingsSnapshot.voice): the default model's
 * languages; English alone for the English-only model; and for a command, only that it is the library's command, since it
 * can hear any language and send the voice anywhere. A model the engine doesn't run keeps the general line: the Notice
 * under the row says its settings can't be used. It names no model.
 */
export function speechModelLine(voice: SettingsSnapshot["voice"]): string {
  if (voice.backend === "command") return "Turns your voice into text with the command in this library's settings.";
  if (ENGLISH_ONLY_MODELS.includes(voice.model)) return "Turns your voice into English text on this Mac. Nothing is sent anywhere.";
  return SPEECH_MODEL_DESCRIPTION;
}

/**
 * What Privacy says leaves this Mac: the voice stays unless the library's own settings hand it to a command, which can send it
 * anywhere, and then the pane says where it goes. The words, and any screen captured with a comment, go to the agent.
 */
export function leavesThisMacLine(voice: SettingsSnapshot["voice"]): string {
  const where = voice.backend === "command" ? "Your voice goes to the command in this library's settings." : "Your voice never leaves this Mac.";
  return `${where} Your words, and any screen you capture with a comment, go only to the agent you chose, the same way your code already does.`;
}

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

/** Whether Avanzel runs reviews of `kind`: the evening review and the weekly review do, a custom one doesn't yet. */
const runsKind = (kind: string): boolean => kind === "evening-review" || kind === "review";

/**
 * The body of the Notice under a review whose save failed: main's reason, then only what is true of the review as the
 * snapshot stores it, which the switch above the Notice shows too (`task`; never the editor's draft). Main refuses with
 * noSuchReview when it lists no such review any more: its file, tasks/{id}.md, is missing or can't be used, so it
 * doesn't run. Any other refusal leaves that file as it was (saveTask writes a whole new file, then renames it), so the
 * review stays off when it is off, runs as last saved when it is on and of a kind Avanzel runs, and is otherwise a custom
 * review Avanzel doesn't run, whose file hasn't changed.
 */
export function failedSaveLine(task: Pick<TaskInfo, "id" | "enabled" | "kind">, reason: string): string {
  let now: string;
  if (reason === noSuchReview(task.id)) now = `Its file, tasks/${task.id}.md, is missing or can't be used, so it doesn't run.`;
  else if (!task.enabled) now = "It stays off, as last saved.";
  else if (runsKind(task.kind)) now = "It still runs as last saved.";
  else now = "Its file hasn't changed.";
  return `${asSentence(reason)} ${now}`;
}

/** What a review of `kind` does, under its switch. A kind Avanzel doesn't run (runsKind) is a custom one. */
export function kindLine(kind: string): string {
  if (!runsKind(kind)) return "Avanzel doesn't run custom reviews yet.";
  return kind === "evening-review" ? "Files anything still in the inbox and writes a short summary." : "Looks over the whole library and writes a report in reviews/.";
}

/**
 * An IPC rejection's message without Electron's "Error invoking remote method '…': " and the error's class name
 * ("AvanzelError: "), so it reads as main wrote it.
 */
export function remoteMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, "");
}

/** The title of the Notice for a change main refused: what happened. */
export const CHANGE_NOT_SAVED = "That change wasn't saved.";

/** What the Notice of a change that wasn't saved ends with: nothing was written, so the setting is what it was. */
export const SETTING_KEPT = "The setting keeps its old value.";

/**
 * What a refused permission (EACCES, EPERM) means, as a sentence, by the IPC channel of the call it refused. Each says what
 * that call was working at when the disk or macOS said no.
 */
const ACCESS_REFUSED: Readonly<Record<string, string>> = {
  "settings:set-app": "Avanzel can't write to its own settings.",
  // Choosing a library reads the folder, and makes the library in it, before it writes anything of Avanzel's own: the folder is
  // what the permission was refused for.
  "settings:choose-library": "Avanzel can't use that folder.",
  "settings:set-library": "Avanzel can't write to the library's settings.",
  "settings:save-task": "Avanzel can't write to the library's settings.", // a review is a file of the library
};

/** A refused permission of a call that writes no setting (a run, a check, a request, a download), or of one this table doesn't know. */
const FILE_REFUSED = "Avanzel was refused access to a file it needs.";

/** `message` without the file a system error names: ", open '/lib/.avanzel/config.toml.1.tmp'" or ", rename '/a.tmp' -> '/a'". */
const withoutFiles = (message: string): string => message.replace(/,\s+\w+\s+'[^']*'(?:\s+->\s+'[^']*')?/g, "");

/**
 * Why a call main refused was refused, in plain words, as a sentence. An IPC rejection arrives as "Error invoking remote
 * method 'settings:set-library': Error: EACCES: …". A disk that won't take a write is told by what it means: a refused
 * permission is told by the call that met it (ACCESS_REFUSED: the library's settings, Avanzel's own, the folder chosen), and
 * plainly (FILE_REFUSED) for any other call; a full disk and a read-only one are told as they are. Any other message is told as
 * an agent's line is (`ownLine`: no "Error:" label, a capital, a full stop) after its prefix, its error's class and the file a
 * system error names go (`remoteMessage`, `withoutFiles`). An error with nothing to say adds nothing.
 */
export function plainCause(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const message = remoteMessage(error);
  switch (/\b(EACCES|EPERM|ENOSPC|EROFS)\b/.exec(message)?.[1]) {
    case "ENOSPC":
      return "The disk is full.";
    case "EROFS":
      return "The disk is read-only.";
    case "EACCES":
    case "EPERM":
      return ACCESS_REFUSED[/^Error invoking remote method '([^']*)'/.exec(raw)?.[1] ?? ""] ?? FILE_REFUSED;
  }
  return ownLine(withoutFiles(message));
}

/** The body of the Notice of a change that wasn't saved: why (`plainCause`), and that the setting is as it was. */
export function notSavedLine(error: unknown): string {
  return [plainCause(error), SETTING_KEPT].filter(Boolean).join(" ");
}

/**
 * The Notice for a call main refused. A change that saves a setting (no `title`) is headed CHANGE_NOT_SAVED, and its body says why
 * and what the setting keeps. Any other call, such as a check or a run, saves nothing, so it has a title of its own, what didn't
 * happen, and its body tells only why.
 */
export function refusedCall(error: unknown, title?: string): { title: string; body: string } {
  return title === undefined ? { title: CHANGE_NOT_SAVED, body: notSavedLine(error) } : { title, body: plainCause(error) };
}

/** The title of the Notice for a review that Run now couldn't start. */
export const reviewNotStarted = (review: string): string => `${review} didn't start.`;

/** The title of the Notice for an agent whose Check was refused. */
export const agentNotChecked = (agent: string): string => `${agent} couldn't be checked.`;

/** The title of the Notice for the checks the Agents pane makes as it opens, which are of every agent. */
export const AGENTS_NOT_CHECKED = "The agents couldn't be checked.";

/** The title of the Notice for an Allow… that macOS could not be asked. */
export const PERMISSION_NOT_ASKED = "Avanzel couldn't ask macOS.";

/** The title of the Notice for a Download, or the Try again of one that failed, that did not start. */
export const DOWNLOAD_NOT_STARTED = "The download didn't start.";
