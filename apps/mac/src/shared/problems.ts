// What a person is told when something goes wrong, in one place: the capsule's card and the notifications (the main
// process) and setup's and Ask's windows (their renderers) all use these functions, so one problem reads the same wherever
// it shows. A problem is three parts: the title says what happened, the body says what is safe and anything else the
// person needs to know, and the window offers one fix. What a Stop says of how it ended is here too (`stoppedLine`): the
// capsule's Stopped card says it, and a notification says the same when that card is gone. How a line of an error becomes a
// sentence, and is cut to a card's room, is clip.ts's.
import { ownLine, shortReason } from "./clip.ts";

// An agent's own line as a sentence is clip.ts's (its clippers need it); the windows and the main process keep importing it from here.
export { ownLine };

/**
 * Why a filing didn't happen, as far as a person needs to tell: the agent hit its usage limit (`limit`), wants a sign-in
 * (`signin`), ran out of time (`timeout`), is not installed any more (`gone`: the library's own agent), or none is
 * (`missing`); or it failed some other way (`other`).
 */
export type FailureKind = "limit" | "signin" | "timeout" | "gone" | "missing" | "other";

/** What went wrong with an agent's run, ready to be told. */
export interface AgentFailure {
  kind: FailureKind;
  /** The agent's display name: "Claude Code". "Avanzel" when no agent can be named: the library's settings can't be read, say. */
  agent: string;
  /** What signs the agent in when typed in Terminal: "claude" or "codex"; null for any other agent. */
  command: string | null;
  /** When a usage limit resets, in epoch ms, if the agent said. */
  resetsAt: number | null;
  /** The run's time limit in seconds: what a timeout says it had. */
  seconds: number;
  /** The agent's own line about why the run failed, as the engine's errorLine gives it. */
  line: string;
}

/** A problem as a window tells it: the title, the body, and the part of the body the person types, if any. */
export interface Problem {
  title: string;
  body: string;
  /** The part of `body` the person types in Terminal. The windows and the capsule's card set it in code font; a notification takes a string, and shows it plain. */
  command?: string;
}

/**
 * What a failed run left behind in the library: its edits are kept as their own commit, or stay with no history to undo them
 * from; null when it left none.
 */
export type PartialEdits = "commit" | "uncommitted" | null;

/**
 * The failure of something Avanzel couldn't do that no agent failed at: a question it couldn't put (no library, settings it
 * can't read, a question the engine refuses). `line` is the message that says why. Told as another failure, named Avanzel.
 */
export function avanzelFailure(line: string): AgentFailure {
  return { kind: "other", agent: "Avanzel", command: null, resetsAt: null, seconds: 0, line };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
const DAY_MS = 86_400_000;
const two = (n: number) => String(n).padStart(2, "0");

/**
 * When a limit resets, as the cards say it, on the 24-hour clock of this Mac: "at 15:00" on the same day, "tomorrow at
 * 09:00", "on Monday at 09:00" two to six days ahead, and from a week ahead the date, "on 3 November at 09:00".
 */
export function resetPhrase(resetsAt: number, now: Date): string {
  const reset = new Date(resetsAt);
  const time = `${two(reset.getHours())}:${two(reset.getMinutes())}`;
  // Whole calendar days apart, counted on the dates themselves, so a day of 23 or 25 hours doesn't move the count.
  const days = Math.round(
    (Date.UTC(reset.getFullYear(), reset.getMonth(), reset.getDate()) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / DAY_MS,
  );
  if (days <= 0) return `at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  if (days < 7) return `on ${WEEKDAYS[reset.getDay()]} at ${time}`;
  return `on ${reset.getDate()} ${MONTHS[reset.getMonth()]} at ${time}`;
}

/** A time limit as the cards say it: seconds under a minute ("45 s"), else whole minutes ("15 min"); never "0 s". */
export function duration(seconds: number): string {
  const whole = Math.round(seconds);
  return whole < 60 ? `${Math.max(1, whole)} s` : `${Math.round(whole / 60)} min`;
}

/**
 * How a failure's agent is signed in when typed in Terminal, as the sentence that starts the instruction and the command in it
 * (what a window sets in code font); null for an agent that is signed in by hand.
 */
function signInOf(f: AgentFailure): { run: string; command: string } | null {
  if (f.command === "claude") return { run: "Run claude once in Terminal and sign in", command: "claude" };
  if (f.command === "codex") return { run: "Run codex login in Terminal", command: "codex login" };
  return null;
}

export interface FilingProblemOptions {
  /**
   * Where the engine kept the owner's words aside, as a library path, when it couldn't put them back in the inbox: the
   * body then says where they are, and that the inbox holds the agent's version.
   */
  where?: string;
  /** What the run left behind: its edits are kept as their own commit, or stay in the library with no history to undo them from. */
  partial?: PartialEdits;
  /**
   * What the body promises of a note that waits. "wait" (the default): the capsule and the notifications, when the app keeps a
   * wait for the limit's reset or a watch of the sign-in, which the body promises. "review": the same, when the app keeps
   * neither (another library is open, its run state can't be written, or the note was filed again and met the same thing): a
   * limit still names its reset, a sign-in is told as one signed in by hand, and only the evening review is promised.
   * "retry": setup, which starts neither, says to try again.
   */
  after?: "wait" | "review" | "retry";
  /** Whether the library's evening review is on. Off, a body that would end with its promise ends at "Your note is safe in the inbox." */
  eveningReview?: boolean;
  /**
   * The most characters of the agent's own line the body keeps, for a card that clips what it shows (the capsule's, and the
   * notification that tells the same words): a longer line is cut at a word and ends in "…", so the sentence that says what is
   * safe still follows it. The windows don't clip, and keep the whole line. Avanzel's own line, when no agent can be named (a
   * settings file it can't read), is no agent going on: it says what to mend, and is told whole.
   */
  lineMax?: number;
}

/** Sentences told one after the other: the ones there are, with a space between. */
function sentences(...parts: string[]): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * What a run left in the library that nothing recorded (a library without git, or with automatic commits off) is told in this one
 * sentence wherever it is told: a failed filing's card, a Stopped filing's card and notification, and setup's Cancel. It names the agent,
 * whose edits they are, as the sentence for edits that a commit holds does, and says only what is true: nothing recorded them, so nothing
 * can take them back; whether the library keeps any history of its own is not said.
 */
function leftoverEdits(agent: string): string {
  return `${agent}'s partial edits stay as they are, because nothing recorded them.`;
}

/** What a failed filing says, in the words of the copy table: the title, the body and, for a sign-in, the command to run. */
export function filingProblem(f: AgentFailure, now: Date, o: FilingProblemOptions = {}): Problem {
  const { where, partial = null, after = "wait", eveningReview = true, lineMax } = o;
  const safe = where ? `Your words are kept in ${where}, and the inbox holds the agent's version` : "Your note is safe in the inbox";
  // The sentence that says what is safe, ending with the evening review's promise while the library's review is on.
  const reassure = eveningReview ? `${safe}; the evening review will try again.` : `${safe}.`;
  const left =
    partial === "commit"
      ? ` ${f.agent}'s partial edits are kept as their own commit in the library's history.`
      : partial === "uncommitted"
        ? ` ${leftoverEdits(f.agent)}`
        : "";
  const done = (title: string, body: string, command?: string): Problem => ({ title, body: `${body}${left}`, ...(command ? { command } : {}) });

  switch (f.kind) {
    case "limit": {
      // A reset that has passed is no moment to wait for: it reads as one the agent didn't give.
      const resets = f.resetsAt !== null && f.resetsAt > now.getTime() ? resetPhrase(f.resetsAt, now) : null;
      const title = `${f.agent} has hit its usage limit.`;
      if (resets === null) return done(title, reassure);
      if (after === "review") return done(title, `It resets ${resets}. ${reassure}`);
      return done(title, `It resets ${resets}. ${safe}${after === "retry" ? "; try again then." : " and will be filed then."}`);
    }
    case "signin": {
      const title = `${f.agent} isn't signed in on this Mac.`;
      // With no watch to file the note once it is signed in, the words are those for an agent signed in by hand.
      const signIn = after === "review" ? null : signInOf(f);
      if (signIn === null) {
        return done(title, after === "retry" ? `Sign in to ${f.agent} in Terminal, then try again. ${safe}.` : `Sign in to ${f.agent} in Terminal. ${reassure}`);
      }
      const { run, command } = signIn;
      return done(title, after === "retry" ? `${run}, then try again. ${safe}.` : `${run}, and your note will be filed straight away.`, command);
    }
    case "timeout":
      return done(`${f.agent} took longer than ${duration(f.seconds)} and was stopped.`, reassure);
    case "gone":
      return done(`${f.agent} isn't installed on this Mac any more.`, `${safe}. Settings → Agents can choose another agent, or has its install command.`);
    case "missing":
      return done("Avanzel needs an AI agent to do the filing.", `${safe}. Claude Code works best, and Settings → Agents has its install command.`);
    case "other":
      return done(
        `${f.agent} couldn't file this note.`,
        [shortReason(f.line, f.agent === "Avanzel" ? undefined : lineMax), reassure].filter(Boolean).join(" "),
      );
  }
}

/**
 * The corrected words (File after Edit) couldn't be written to the inbox yet. Not an agent's failure: nothing ran. `lines` is
 * the error's last lines, which are one reason: joined into one, told as a sentence and cut to `lineMax` characters for a card that
 * clips and for the notification that says the same (see FilingProblemOptions.lineMax: such an error names two long paths, which are
 * never cut through, `shortReason`). What keeps the words follows it in the same paragraph, as in every other problem: the words are
 * kept in memory and saved to the inbox when Avanzel quits, and `originalKept` says the note they correct is still there.
 */
export function correctedWordsProblem(lines: string, originalKept: boolean, lineMax?: number): Problem {
  const original = originalKept ? "; the original note is still there" : "";
  const reason = lines.split("\n").map((line) => line.trim()).filter(Boolean).join(" ");
  return {
    title: "Your corrected words weren't saved yet.",
    body: sentences(shortReason(reason, lineMax), `Your corrected words are saved to the inbox when you quit${original}.`),
  };
}

/**
 * What the Ask window and setup's Ask step add to a problem: whether the Notice offers Open Terminal (`terminal`: the agent
 * isn't signed in) and whether its fix is Open Settings, on Agents (`settings`: the library's agent is gone, or none is installed).
 */
export interface AskProblem extends Problem {
  terminal: boolean;
  settings: boolean;
}

/** What a run that changed `files` files says, in place of "Your library hasn't changed.": the agent's changes are left as they are. */
function changedSentence(agent: string, files: number): string {
  return files === 1 ? `${agent} changed 1 file while answering; it's left as it is.` : `${agent} changed ${files} files while answering; they're left as they are.`;
}

/**
 * What a question that failed says, in the words of the copy table's Ask rows: the title says what happened, the body that the
 * library hasn't changed (or what the run changed, `changedFiles` files, which is left as it is) and then what to do, and the
 * window offers the fix `terminal` and `settings` name; any other failure, and a usage limit or a timeout, is fixed by asking again.
 * Nothing ran when no agent is installed, so that row says nothing of the library.
 */
export function askProblem(f: AgentFailure, changedFiles: number, now: Date): AskProblem {
  const safe = changedFiles > 0 ? changedSentence(f.agent, changedFiles) : "Your library hasn't changed.";
  const done = (title: string, body: string, offers: { command?: string; terminal?: boolean; settings?: boolean } = {}): AskProblem => ({
    title,
    body,
    ...(offers.command ? { command: offers.command } : {}),
    terminal: offers.terminal ?? false,
    settings: offers.settings ?? false,
  });

  switch (f.kind) {
    case "limit": {
      // A reset that has passed is no moment to wait for: it reads as one the agent didn't give.
      const resets = f.resetsAt !== null && f.resetsAt > now.getTime() ? resetPhrase(f.resetsAt, now) : null;
      return done(`${f.agent} has hit its usage limit.`, resets === null ? safe : `${safe} It resets ${resets}.`);
    }
    case "signin": {
      const title = `${f.agent} isn't signed in on this Mac.`;
      const signIn = signInOf(f);
      if (signIn === null) return done(title, `${safe} Sign in to ${f.agent} in Terminal, then ask again.`, { terminal: true });
      return done(title, `${safe} ${signIn.run}, then ask again.`, { command: signIn.command, terminal: true });
    }
    case "timeout":
      return done(`${f.agent} took longer than ${duration(f.seconds)} and was stopped.`, safe);
    case "gone":
      return done(`${f.agent} isn't installed on this Mac any more.`, `${safe} Settings → Agents can choose another agent, or has its install command.`, { settings: true });
    case "missing":
      return done("Avanzel needs an AI agent to answer.", "Claude Code works best, and Settings → Agents has its install command.", { settings: true });
    case "other":
      return done(`${f.agent} couldn't answer.`, [safe, ownLine(f.line)].filter(Boolean).join(" "));
  }
}

/**
 * What is safe while the speech model can't be had: typing works. It begins the sentence `downloadFailedProblem` says in the capsule's
 * card and in Settings → Voice, and the menu bar's item for the problem begins its second line with it (`speechProblemOf`).
 */
export const TYPING_WORKS_MEANWHILE = "Typing works meanwhile";

/**
 * What is safe while the library's voice settings can't be used: a typed thought is saved to the inbox. The sentence every place that
 * tells the problem says (`voiceSettingsProblem`: the capsule's card, Settings → Voice, and the menu bar's item).
 */
export const TYPED_THOUGHTS_SAVED = "Typed thoughts are still saved to the inbox.";

/**
 * A speech-model download that didn't finish, as the capsule and Settings → Voice tell it. `reason` is the engine's: the file
 * and why, without the URL it came from. Typing works meanwhile; `resumable` says part of the download was kept, so Try
 * again continues where it stopped, and otherwise it downloads the file again. It promises nothing of a recording, since
 * nothing records meanwhile.
 */
export function downloadFailedProblem(reason: string, resumable: boolean): Problem {
  const tryAgain = resumable ? "continues where it stopped" : "downloads it again";
  return {
    title: "The speech model didn't finish downloading.",
    body: [ownLine(reason), `${TYPING_WORKS_MEANWHILE}, and Try again ${tryAgain}.`].filter(Boolean).join(" "),
  };
}

/** Why git refused to take a filing back: usually a later change touched the same lines. */
const HISTORY_KEEPS_BOTH = "Usually a later change touched the same lines. The library's history keeps both versions.";

/** Undo, on the capsule's filed card or in setup, that git refused. There is nothing to fix: the card's Hide, or setup's Continue, goes on. */
export const undoRefused: Problem = {
  title: "This one can't be undone automatically.",
  body: HISTORY_KEEPS_BOTH,
};

/** The same refusal when it is the agent's first try that Edit couldn't take back, before the corrected words were filed. */
export const takeBackRefused: Problem = {
  title: "The agent's first try can't be taken back automatically.",
  body: HISTORY_KEEPS_BOTH,
};

/**
 * `takeBackRefused` with where the corrected words are: while the note is in the inbox (`inInbox`) it says so, and that the
 * evening review will have it only while the library's review is on (`eveningReview`), otherwise only that the note is safe.
 * A note that is no longer in the inbox (filed meanwhile) is said to be nowhere.
 */
export function takeBackRefusedProblem(inInbox: boolean, eveningReview: boolean): Problem {
  const where = !inInbox ? "" : eveningReview ? " The note waits in the inbox for the evening review." : " Your note is safe in the inbox.";
  return { title: takeBackRefused.title, body: `${takeBackRefused.body}${where}` };
}

/**
 * Stop, pressed on a filing the agent had finished by then, whose take-back git refused: the filing stands, and the history keeps both
 * versions. Not `undoRefused`, which says "this one" to a person who pressed Undo: it names Stop, which they pressed. The fix would
 * be to show the history, which nothing in the app can do, so there is none.
 */
export const stopRefused: Problem = {
  title: "Stop couldn't take back a filing that had finished.",
  body: HISTORY_KEEPS_BOTH,
};

/**
 * What a Stopped filing says of the words and the library. `partial`: the stopped run's edits stay, as their own commit, because
 * taking them back failed. `leftovers`: how many files the run changed that nothing recorded (a library without git, or with
 * automatic commits off), which stay as they are; it doesn't say how many. A run that changed nothing says so.
 */
export function cancelledLine(agent: string, partial: boolean, leftovers: number): string {
  if (partial) return `Your words are back in the inbox, untouched. ${agent}'s partial edits are kept as their own commit in the library's history.`;
  if (leftovers > 0) return `Your words are back in the inbox. ${leftoverEdits(agent)}`;
  return "Your words are back in the inbox, untouched, and nothing else changed.";
}

/**
 * `what`, a sentence without its end, with when the evening review does it (`review`, as `reviewTime` words it: "at 21:00", "on
 * Sundays at 18:00"), then a full stop. A review whose schedule can't be read ("") is named without a time. Null while the review is
 * off: nothing will do it, so no sentence promises it.
 */
export function reviewDoes(what: string, review: string | null): string | null {
  if (review === null) return null;
  return review === "" ? `${what}.` : `${what} ${review}.`;
}

/**
 * What a Stopped filing's card says under the words: what became of them and of the run's edits (`cancelledLine`), then when the
 * evening review files the words: "your words", for `cancelledLine` has just said what is in the inbox, and "it" would read as the
 * commit it may name, or the agent's edits. While the review is off, the first alone.
 */
export function stoppedLine(agent: string, partial: boolean, leftovers: number, review: string | null): string {
  const kept = cancelledLine(agent, partial, leftovers);
  const later = reviewDoes("The evening review files your words", review);
  return later === null ? kept : `${kept} ${later}`;
}

/**
 * A Stop whose card has gone (hidden, or replaced by another recording's) ended with the stopped run's edits staying: told in a
 * notification, in the card's own words. Null when the stop left the library as it was: the person hid the card, and there is
 * nothing to tell.
 */
export function stoppedNotice(agent: string, partial: boolean, leftovers: number, review: string | null): Problem | null {
  if (!partial && leftovers === 0) return null;
  return { title: "Stopped, but some edits stay in your library.", body: stoppedLine(agent, partial, leftovers, review) };
}

/**
 * Stop, pressed on a transcription that has run long, couldn't move the recording to the inbox, and `reason` says why (the error's
 * message, cut to `lineMax` characters for a card that clips). The transcription goes on as if Stop had not been pressed, so the
 * body says only where the recording is now (`where`: its library path, null when the library keeps no copy of it): not that it
 * stays, since a transcription that finds no words removes it.
 */
export function stopFailedProblem(reason: string, where: string | null, lineMax?: number): Problem {
  return {
    title: "Avanzel couldn't move the recording to the inbox.",
    body: sentences(
      shortReason(reason, lineMax),
      where === null ? "The transcription goes on, but no copy of your recording is saved." : `The transcription goes on, and your recording is in ${where}.`,
    ),
  };
}

/** What a recording's problem says is safe: the library path its recording is kept in (`kept`), or that nothing is. */
function recordingKept(kept: string | null): string {
  return kept === null ? "Nothing was saved." : `Your recording is kept in ${kept}.`;
}

/**
 * The screen couldn't be captured, or its screenshot claimed or written, and `reason` says why (an error's message; cut to `lineMax`
 * characters for a card that clips, or told whole when it is Avanzel's own). Whatever was claimed is removed first, so nothing was saved.
 */
export function screenCaptureProblem(reason: string, lineMax?: number): Problem {
  return { title: "Avanzel couldn't capture the screen.", body: sentences(shortReason(reason, lineMax), "Nothing was saved.") };
}

/**
 * A screen comment's screenshot was taken, but its recording couldn't start, and `reason` says why (as for `screenCaptureProblem`).
 * The screen was captured, so this is not that problem: it says what didn't happen. The screenshot is removed, so nothing was saved.
 */
export function commentNotStartedProblem(reason: string, lineMax?: number): Problem {
  return { title: "The screen comment couldn't start.", body: sentences(shortReason(reason, lineMax), "Nothing was saved.") };
}

/** The audio of a recording never reached Avanzel: nothing was recorded to keep. The fix is to choose the microphone. */
export const recordingLost: Problem = {
  title: "The recording didn't arrive.",
  body: "Nothing was saved. Is the right microphone selected?",
};

/**
 * A recording's words couldn't be made (`reason`, as for `screenCaptureProblem`). `kept`: where the library keeps the recording, as a
 * library path; null when it keeps none.
 */
export function unheardProblem(reason: string, kept: string | null, lineMax?: number): Problem {
  return { title: "The recording couldn't be turned into words.", body: sentences(shortReason(reason, lineMax), recordingKept(kept)) };
}

/**
 * A recording's words were made, or none were (a screen comment may have none: it is saved as "No comment"), but the save failed
 * (`reason`, `kept` and `lineMax` as for `unheardProblem`). For a dictation, it is the person's words that couldn't be saved. For a
 * screen comment (`screen`), whatever its words, it is the screen capture, and its screenshot is gone: nothing holds it, so it is
 * removed, which the body says before it says where the recording is kept, if it is.
 */
export function unsavedProblem(reason: string, kept: string | null, screen: boolean, lineMax?: number): Problem {
  const safe = !screen
    ? recordingKept(kept)
    : kept === null
      ? "The screenshot is gone, and nothing was saved."
      : `The screenshot is gone. ${recordingKept(kept)}`;
  return {
    title: screen ? "The screen capture couldn't be saved." : "Your words couldn't be saved.",
    body: sentences(shortReason(reason, lineMax), safe),
  };
}

/**
 * A thought typed in Quick couldn't be saved (`reason`, as for `screenCaptureProblem`). Its words are where they were typed: in Type
 * a thought, which the card's one fix opens again. The body names that window by its action's name, as the menu bar does (a shortcut
 * is a Kbd, which a plain string can't hold, and nothing in the app calls Quick a box).
 */
export function thoughtNotSavedProblem(reason: string, lineMax?: number): Problem {
  return { title: "That thought couldn't be saved.", body: sentences(shortReason(reason, lineMax), "Your words are still in “Type a thought”.") };
}

/**
 * The library's [voice] settings can't be used, and `reason` is what is wrong with them, told whole: it says what to mend. What is
 * safe meanwhile is what a typed thought always gets: it is saved to the inbox. Not that it is filed: a config file that doesn't
 * parse stops a filing too. Trying again can't help, since they are fixed in the config file; the capsule's fix is Settings → Voice,
 * and Settings → Voice tells it in these words.
 */
export function voiceSettingsProblem(reason: string): Problem {
  return { title: "Avanzel can't use the voice settings in this library's config file.", body: sentences(ownLine(reason), TYPED_THOUGHTS_SAVED) };
}

/**
 * A page Avanzel didn't open: `rel`, its library path, goes through a link (it is one, or a folder on its way is), and a link opens as
 * whatever it points at, by that file's own type, so a script an agent pointed it at would run. The person only asked for a page, so it
 * says so without alarm, and what is safe: nothing was opened. There is nothing to fix from here, so it offers nothing.
 */
export function linkedPageNotice(rel: string): Problem {
  return { title: "Avanzel didn't open that page.", body: `${rel} goes through a link, which could lead anywhere, so nothing was opened.` };
}

/**
 * What a library made without git costs, said wherever the app is about to make one: setup's Found under a new library or a
 * folder with files, and Settings' question about turning a folder with files into the library. This Mac has no usable git
 * (the engine's gitUsable) until Apple's Command Line Tools are installed.
 */
export const NO_GIT_LINE = "This Mac has no git yet, so changes can't be undone.";

/**
 * Why a place is too broad for a library (setup-model's tooBroad): it is one of the folders macOS keeps for itself (`system`:
 * /Applications, /usr, /tmp…, and the startup disk's root), or it holds far more than notes (`broad`: the home folder, a
 * folder macOS makes in it, /Volumes, another disk's root).
 */
export type TooBroad = "system" | "broad";

/**
 * Why a place can't be a library: the shelves, an AGENTS.md and git history would go over everything in it. `label` names the
 * place as a row does, "~/Documents", and `why` is tooBroad's. Inside a place that holds too much a folder will do; inside
 * macOS's own folders nothing can be made (or macOS doesn't keep it), so the person is sent to their home folder. Setup's
 * Found says it under the library's row, and Settings' Change… refuses with it.
 */
export function tooBroadLine(label: string, why: TooBroad): string {
  return why === "system"
    ? `${label} is one of macOS's own folders. Choose or make a folder in your home folder.`
    : `${label} is too broad for a library. Choose or make a folder inside it.`;
}
