// Settings' words that panes share or make from values: the name of each pane on the toolbar, the library's line, a
// message ended as a sentence, the microphone's name, what the speech model row says, when Tonight files, and a
// scheduled review's schedule, last run and kind, with the checks its editor makes and what a failed save says, and what
// the window says of a change main refused, and what the Updates group says of Avanzel's own update.
import { SHELVES } from "@avanzel/ui";
import {
  DICTATION_PAGE,
  noSuchReview,
  type CursorKey,
  type CursorPermissionState,
  type PickOption,
  type SettingsPane,
  type SettingsSnapshot,
  type TaskInfo,
  type UpdateSnapshot,
  type UpdateStatus,
  type UpdateWait,
} from "../../shared/ipc.ts";
import { NO_GIT_LINE, ownLine } from "../../shared/problems.ts";
import { CURSOR_KEYS, cursorKeyName } from "../../shared/transcribing.ts";

/** Each pane's name on the toolbar, which is also the window's title. The scheduled reviews' pane keeps its id, "tasks", and dictation's its "dictations". */
export const PANE_LABELS: Readonly<Record<SettingsPane, string>> = {
  general: "General",
  voice: "Voice",
  shortcuts: "Shortcuts",
  dictations: "Dictation",
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
  const filled = pages === 0 ? "Your first thought will fill a shelf." : `${pages} ${pages === 1 ? "note" : "notes"} on six shelves.`;
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
 * The microphone's pop-up menu: "System default" (value ""), then each device, named as microphoneName names it,
 * with the one in use checked. A chosen microphone that isn't connected leaves everything unchecked. Before the devices
 * are listed (`devices` null), the menu holds System default alone.
 */
export function microphoneOptions(id: string | null, devices: readonly InputDevice[] | null): PickOption[] {
  return [
    { label: "System default", value: "", checked: id === null },
    ...(devices ?? []).map((device, place) => ({ label: deviceName(device, place), value: device.deviceId, checked: device.deviceId === id })),
  ];
}

// The keys and their names are shared with the capsule, whose listening card names the key too.
export { cursorKeyName };

/** The dictation key's pop-up menu, with the key in use checked. */
export function cursorKeyOptions(chosen: CursorKey): PickOption[] {
  return CURSOR_KEYS.map(({ key, name }) => ({ label: name, value: key, checked: key === chosen }));
}

/** The "Dictate into any app" switch's description: how it works, in one sentence. */
export const CURSOR_DICTATION_DESCRIPTION = "Tap the key to start and again to finish, or press Esc to cancel. The words go where the cursor is.";

/**
 * The library log's switch: the person speaking ("I"), and where the words go. It says what the app does today: the agent can read
 * raw/ (the evening review's own reading of the day file is a later step, so it isn't promised). Forgetting and the git rule can't
 * reach what a sync tool has copied, which it says plainly once there is a day file for one to copy.
 */
export const DICTATION_LOG_LABEL = "Keep what I dictate in the library";
const DICTATION_LOG_DESCRIPTION = "Each dictation is also written to raw/dictations/ in the library, one file a day, kept out of git, where your agent can read it.";
const DICTATION_LOG_SYNC = "Copies made by sync tools such as Obsidian Sync or iCloud are outside this: a dictation you forget may stay in them.";

/** The library log's description: what it does, and with the log on, what forgetting can't reach. */
export function dictationLogLine(on: boolean): string {
  return on ? `${DICTATION_LOG_DESCRIPTION} ${DICTATION_LOG_SYNC}` : DICTATION_LOG_DESCRIPTION;
}

/** The Never kept group's note: a skipped app or site still gets the words but keeps none of them. */
export const SKIP_NOTE = "What you dictate there still goes in, but is never kept.";

/**
 * What a line of a skip list holds, under its field. A site can be told only where the browser says which page is open (front-app.ts:
 * Safari and the Chromium set); elsewhere the dictation is kept (cursor-policy.ts), and the line says so rather than promise more.
 */
export const SKIP_APPS_HELP = "Add an app by its bundle id, such as com.apple.Passwords.";
export const SKIP_SITES_HELP = "Add a website by its address, such as example.com. Safari and Chrome-based browsers say which site is open. Other browsers can't, so there a dictation is kept.";

/**
 * The apps a skip list comes with, by the name a person knows them by (DEFAULT_SKIP_APPS, in lower case as the privacy rule compares them).
 * Enpass has shipped under two ids, and the summary names it once. Any other app shows as the last part of its bundle id.
 */
const SKIP_APP_NAMES: Readonly<Record<string, string>> = {
  "com.1password.1password": "1Password",
  "com.agilebits.onepassword7": "1Password 7",
  "com.bitwarden.desktop": "Bitwarden",
  "com.apple.keychainaccess": "Keychain Access",
  "com.apple.passwords": "Passwords",
  "org.keepassxc.keepassxc": "KeePassXC",
  "com.lastpass.lastpass": "LastPass",
  "com.dashlane.dashlane": "Dashlane",
  "com.enpass.enpass": "Enpass",
  "in.sinew.enpass-desktop": "Enpass",
};

/** How many names a skip list's row shows before it counts the rest. */
const SUMMARY_NAMES = 3;

/** `names` once each, as a row says them: "None", "1Password, Bitwarden and Passwords", or the first three "and 6 more". */
function namesLine(names: readonly string[]): string {
  const once = [...new Set(names)];
  if (once.length === 0) return "None";
  if (once.length > SUMMARY_NAMES) return `${once.slice(0, SUMMARY_NAMES).join(", ")} and ${once.length - SUMMARY_NAMES} more`;
  if (once.length === 1) return once[0]!;
  return `${once.slice(0, -1).join(", ")} and ${once.at(-1)!}`;
}

/** What the apps' row says of the list the library keeps: the apps by name, not by bundle id, as a person knows them. */
export function skipAppsSummary(ids: readonly string[]): string {
  return namesLine(ids.map((id) => SKIP_APP_NAMES[id.toLowerCase()] ?? id.split(".").at(-1)!));
}

/** What the sites' row says of the list the library keeps, and where it holds: a promise of the row's own, as the field with its full reason may be shut. */
export const skipSitesSummary = (sites: readonly string[]): string => (sites.length ? `${namesLine(sites)}, in Safari and Chrome-based browsers` : namesLine(sites));

/** The Dictation pane when the history is empty: the one line, and how to start, which the switch above it changes. */
export const DICTATIONS_EMPTY = "Nothing dictated yet.";
export const dictationsStart = (enabled: boolean): string =>
  `${enabled ? "Tap the key and speak." : "Turn it on above, tap the key and speak."} What you say shows here.`;

/** The heading over the Dictation pane's history. */
export const DICTATIONS_RECENT = "Recent";

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

/** The Notice for a Copy the clipboard refused. Defined in shared/ipc.ts, as the menu tells it too; re-exported for the pane. */
export { DICTATION_NOT_COPIED, DICTATION_NOT_COPIED_BODY } from "../../shared/ipc.ts";

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
    return { line: "Avanzel needs Input Monitoring to see the key and Accessibility to paste for you.", fix };
  }
  if (!state.inputMonitoring) return { line: "Avanzel needs Input Monitoring to see the key.", fix };
  if (!state.accessibility) return { line: "Avanzel needs Accessibility to paste for you.", fix };
  return { line: "Avanzel can see the key and paste for you.", fix: null };
}

/** The speech model row's description for the default model: which languages it hears, as a person would want to know, naming no model. */
export const SPEECH_MODEL_DESCRIPTION =
  "Turns your voice into text on this Mac, in 25 European languages including English, Ukrainian and Russian. Nothing is sent anywhere.";

/**
 * The Dictionary row's description: how a line is written, and that the heard-as entry is the sure way. A name whose sound is
 * short (Priya) is matched only by its heard-as entry; the engine's sound-alike match leaves it alone.
 */
export const DICTIONARY_DESCRIPTION =
  "Add one at a time. Write a name the way it should appear. To fix a word the microphone gets wrong, add what it hears after an " +
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
 * When something past happened, as a sentence goes on: "today at 21:00", "yesterday at 21:00", "on Sunday at 21:00" for a day in
 * the last 6, "on 2 Oct at 21:00" before that ("on 30 Dec 2025 at 21:00" in another year). Formatted by hand, never with
 * toLocale*, so tests don't depend on locale.
 */
function pastWhen(then: Date, now: Date): string {
  const at = `at ${twoDigits(then.getHours())}:${twoDigits(then.getMinutes())}`;
  // Whole days between the two calendar days: a day that changes the clock is an hour short or long, which rounds away.
  const daysAgo = Math.round((midnight(now) - midnight(then)) / 86_400_000);
  if (daysAgo === 0) return `today ${at}`;
  if (daysAgo === 1) return `yesterday ${at}`;
  if (daysAgo > 1 && daysAgo < 7) return `on ${DAYS[then.getDay()]!.label} ${at}`;
  const year = then.getFullYear() === now.getFullYear() ? "" : ` ${then.getFullYear()}`;
  return `on ${then.getDate()} ${MONTHS[then.getMonth()]}${year} ${at}`;
}

/** "Running now…", "Not run yet.", or "Last run today at 21:00." and the rest of `pastWhen`'s ways of saying when. */
export function lastRunLine(task: Pick<TaskInfo, "running" | "lastRun">, now: Date): string {
  if (task.running) return "Running now…";
  if (!task.lastRun) return "Not run yet.";
  return `Last run ${pastWhen(new Date(task.lastRun), now)}.`;
}

/** The Updates row's name, in General: Avanzel and the version that runs, "Avanzel 0.2.0". */
export const versionLabel = (version: string): string => `Avanzel ${version}`;

/** An update that has downloaded: "Avanzel 0.3.1 is ready." */
export const updateReadyLine = (version: string): string => `Avanzel ${version} is ready.`;

/** What a restart to update waits for, as the line says it ends. A call's is the notes, as Stop taking notes ends them, not the call. */
const UPDATE_WAITS: Readonly<Record<UpdateWait, string>> = {
  recording: "the recording ends",
  transcription: "the recording is transcribed",
  filing: "the filing ends",
  call: "it stops taking notes on the call",
  answer: "the answer comes",
  save: "the answer is saved",
  review: "the review ends",
};

/** A restart to update asked for while something is in progress: it comes once that ends, and cuts nothing short. */
export const updateWaitLine = (wait: UpdateWait): string => `Avanzel restarts once ${UPDATE_WAITS[wait]}. Nothing is lost.`;

/** The button that calls off a restart to update that waits, leaving the update ready: as macOS defers its own updates. */
export const UPDATE_NOT_NOW = "Not now";

/** A restart to update that has begun. */
export const UPDATE_RESTARTING = "Restarting…";

/** What the panel's foot says of an update that is ready: that it is, what its restart waits for, or that the restart has begun. */
export function updateReadyState(status: Extract<UpdateStatus, { kind: "ready" }>): string {
  if (status.restarting) return UPDATE_RESTARTING;
  return status.waitingFor ? updateWaitLine(status.waitingFor) : updateReadyLine(status.version);
}

/**
 * The Updates row's line, under the version: what Avanzel's update is doing (`UpdateStatus`). A problem says what failed, then that the
 * next automatic check tries again, while Avanzel looks by itself (`automatic`, AppSettings.checkForUpdates); without, that nothing changed.
 */
export function updateLine(update: UpdateSnapshot, automatic: boolean, now: Date): string {
  const status = update.status;
  switch (status.kind) {
    case "off":
      return "This build doesn't check for updates.";
    case "idle":
      return "Not checked yet.";
    case "checking":
      return "Checking for updates…";
    case "current":
      return update.checkedAt ? `Up to date. Checked ${pastWhen(new Date(update.checkedAt), now)}.` : "Up to date.";
    case "downloading":
      return `Downloading Avanzel ${status.version}…`;
    case "ready":
      return status.restarting || status.waitingFor ? updateReadyState(status) : `${updateReadyLine(status.version)} It installs when you quit Avanzel.`;
    case "problem": {
      const failed = status.stage === "check" ? "check for updates" : status.stage === "download" ? "download the update" : "install the update";
      return `Avanzel couldn't ${failed}. ${automatic ? "It will try again later." : "Nothing has changed."}`;
    }
  }
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

/** The title of the Notice for a Check now, or the Try again of one that failed, that did not start. */
export const UPDATE_CHECK_NOT_STARTED = "The check for updates didn't start.";

/** The title of the Notice for a Restart to update that did not start. */
export const RESTART_NOT_STARTED = "Avanzel didn't restart.";

/** The title of the Notice for a Not now that didn't call off the restart that waits. */
export const RESTART_NOT_CALLED_OFF = "The restart wasn't called off.";
