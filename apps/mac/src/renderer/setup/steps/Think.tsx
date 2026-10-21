// Step 3, What's on your mind this week?: the first thought. Here setup tests the shortcut with a real press. The stage
// draws it as keycaps, which press themselves twice as a hint each time the step opens: the step's one orchestrated
// moment, which Reduce Motion leaves out, the keycaps up from the start. A press says the shortcut is free. One another
// app holds is named at once. When the person reaches for the shortcut (its first modifier goes down) and no press
// follows within the wait, the step asks whether it did nothing; both offer free ones to use instead, or Settings →
// Voice when none is free.
// A press also records the thought with the real capsule. When macOS hasn't asked about the microphone yet, the
// microphone's primer comes first, and a microphone turned down says where to allow it. Zel listens on the stage while
// the capsule records; once the words exist, a mic check ("Testing, testing") gets a warm answer, and anything else moves
// on to its filing. A recording that goes wrong says so in setup's own words: what happened, what is safe, and Try
// again or typing. Until the speech models are here, the step says so and typing is the way. Type it instead opens a
// box for the thought, and File it hands the words to setup, which moves on to filing them.
// VoiceOver hears one short sentence as each moment comes (listening, the words being made, the answer to a mic check,
// a press heard): never the prompts, nor the seconds that count while the words are made.
import { Actions, Button, Card, Kbd, Notice, PermissionPrimer, Row, Spinner, Stack, Text, TextArea, Zel, type ZelMood } from "@avanzel/ui";
import { useEffect, useState, type ReactNode } from "react";
import { keyCaps, prettyAccelerator, reachKey, takenMessage } from "../../../main/shortcuts.ts";
import type { SetupPress, SetupThought } from "../../../shared/ipc.ts";
import { earsLine, recordingProblem, slowSeconds, TRANSCRIBING } from "../copy.ts";
import { Frame, useNow, type StepProps } from "../frame.tsx";

const api = window.avanzel.setup;

/** How often the transcribing line counts. */
const TICK_MS = 250;

/**
 * The keycaps' self-press, beat by beat: down at 700 ms for 200 ms, and again at 1600 ms. Each beat starts once the
 * one before it is drawn, so a busy Mac still shows both presses.
 */
const BEATS = [700, 200, 700, 200] as const;

/** Zel at each moment of the spoken thought: listening while the capsule records, thinking while the words are made, worried by a problem. */
const MOOD: Record<SetupThought["kind"], ZelMood> = {
  waiting: "idle",
  primer: "idle",
  listening: "listening",
  transcribing: "thinking",
  test: "idle",
  denied: "needs-you",
  failed: "needs-you",
};

export function Think({ snap, go }: StepProps) {
  const [still] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    if (still || beat >= BEATS.length) return;
    const timer = setTimeout(() => setBeat(beat + 1), BEATS[beat]);
    return () => clearTimeout(timer);
  }, [still, beat]);
  // The typed thought: its box is open, and File it is on its way to the controller.
  const [typing, setTyping] = useState(false);
  const [words, setWords] = useState("");
  const [sending, setSending] = useState(false);
  const { press, thought } = snap;
  // The press test waits for a press only once the person reaches for the shortcut: its first modifier goes down in the
  // window. Not in the box for a typed thought, where ⌥ types a character.
  const reach = reachKey(snap.shortcut);
  useEffect(() => {
    if (!reach) return;
    const onKey = (event: KeyboardEvent) => {
      const { target } = event;
      if (event.key !== reach || event.repeat || target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) return;
      api.reachForShortcut();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reach]);
  // The odd beats are down. Once a press is heard the hint has done its work, and the keycaps stay up.
  const pressed = !still && !press.heard && beat % 2 === 1;
  const shortcut = prettyAccelerator(snap.shortcut);
  // A thought taken moves the window on to its filing; one that isn't comes back as typeProblem, shown under the box.
  const file = () => {
    if (sending) return;
    setSending(true);
    const sent = () => setSending(false);
    void api.typeThought(words).then(sent, sent);
  };
  // The card the words will fill, the shortcut's keycaps, and Zel looking up at them. The microphone's primer has a Zel
  // of its own, so while it shows the stage has none.
  const stage = (
    <div className="think">
      <Card label="Thought" placeholder="Your words will appear here.">{thought.kind === "test" ? thought.words : undefined}</Card>
      <Row gap={6} justify="center">
        {keyCaps(snap.shortcut).map((cap, i) => (
          <Kbd key={i} size="key" pressed={pressed}>{cap}</Kbd>
        ))}
      </Row>
      {thought.kind !== "primer" && (
        <Row justify="end">
          <Zel mood={MOOD[thought.kind]} size="medium" look="up" />
        </Row>
      )}
    </div>
  );
  if (thought.kind === "primer") {
    // The primer is the step until macOS has asked: one button, Continue, and no Back beside it.
    return (
      <Frame model={snap.model} stage={stage}>
        <div className="think-primer">
          <PermissionPrimer kind="microphone" onContinue={() => api.allowMicrophone()} />
        </div>
      </Frame>
    );
  }
  // The step asks for the thought, none of which is under way: Back may leave it, and typing is offered. A press brings
  // the primer, the capsule's recording or a mic check's answer, each of which wants its own end first.
  const asking = thought.kind === "waiting" || thought.kind === "denied" || thought.kind === "failed";
  const talking = asking || thought.kind === "listening";
  const ears = asking && !snap.hears ? earsLine(snap.model) : null;
  // At most one Notice, the thought's own first. While one shows, its actions hold the primary, so Type it instead steps
  // back; until the ears are here, it is the way on otherwise. While the microphone is turned down, or a recording went
  // wrong, it is the Notice's own.
  const typeInstead = () => setTyping(true);
  let notice: ReactNode = null;
  if (thought.kind === "denied") notice = <DeniedNotice onType={typeInstead} />;
  else if (thought.kind === "failed") notice = <FailedNotice thought={thought} onType={typeInstead} />;
  else if (press.taken || press.silent) notice = <PressNotice press={press} accelerator={snap.shortcut} />;
  return (
    <Frame
      model={snap.model}
      stage={stage}
      actions={asking ? <Button variant="quiet" onClick={() => go("found")}>Back</Button> : undefined}
    >
      <Stack gap={12}>
        <Text variant="heading">What's on your mind this week?</Text>
        <div>
          <Lead thought={thought} shortcut={shortcut} />
          {talking && (
            <div className="think-line">
              <Text variant="footnote" tone="secondary">If you're stuck, try a goal, someone you work with, or an idea you keep coming back to.</Text>
            </div>
          )}
          {/* The press test's answer, which VoiceOver hears as it comes: a live region that stays in place, taking no
              room until it says something. */}
          <div role="status" className="think-heard">
            {talking && press.heard && <Text variant="footnote" tone="secondary">{`${shortcut} is free on this Mac, so it works in every app.`}</Text>}
          </div>
        </div>
        {thought.kind === "test" && (
          <Actions align="start">
            <Button onClick={() => api.fileAnyway()}>File it anyway</Button>
            <Button variant="primary" autoFocus onClick={() => api.tryAgain()}>Try again</Button>
          </Actions>
        )}
        {ears && <Text variant="callout">{ears}</Text>}
        {asking && (typing ? (
          // While the person types, File it is the moment's one primary, so a Notice waits until the box is put away.
          // The words stay in the box when it is.
          <Stack gap={8}>
            <TextArea
              label="Your thought"
              placeholder="What's on your mind?"
              value={words}
              onChange={setWords}
              onEnter={file}
              onEscape={() => setTyping(false)}
              description={snap.typeProblem ?? undefined}
              autoFocus
            />
            <Actions>
              <Button variant="quiet" onClick={() => setTyping(false)}>Cancel</Button>
              <Button variant="primary" busy={sending} onClick={file}>File it</Button>
            </Actions>
          </Stack>
        ) : (
          <>
            {notice}
            {thought.kind !== "denied" && thought.kind !== "failed" && (
              <Actions align="start">
                <Button variant={!snap.hears && notice === null ? "primary" : "secondary"} onClick={typeInstead}>Type it instead</Button>
              </Actions>
            )}
          </>
        ))}
      </Stack>
    </Frame>
  );
}

/**
 * The step's lead: where the spoken thought is, then what to do. Only where it is (`said`) sits in a live region, which
 * stays in place from one moment to the next, so VoiceOver hears one short sentence as each moment comes: never the
 * prompt and instructions, nor the seconds that count while the words are made, which follow it outside.
 */
function Lead({ thought, shortcut }: { thought: SetupThought; shortcut: string }) {
  const where = said(thought);
  const next = then(thought, shortcut);
  return (
    <Row gap={8}>
      {thought.kind === "transcribing" && <Spinner size="small" />}
      <div className="think-lead">
        <span role="status">{where}</span>
        {where && next ? " " : null}
        {next}
      </div>
    </Row>
  );
}

/** Where the spoken thought is, in one short sentence, as VoiceOver hears it; nothing while the step asks for it. */
function said(thought: SetupThought): ReactNode {
  switch (thought.kind) {
    case "listening":
      return <Text variant="callout" as="span">I'm listening.</Text>;
    case "transcribing":
      return <Text variant="callout" as="span">{TRANSCRIBING}</Text>;
    case "test":
      return <Text variant="voice" as="span">Heard you. Want to try a real thought?</Text>;
    default:
      return null;
  }
}

/** What follows that sentence: what to do now (Esc's cancel promised only while a recording runs), or how long the words take. */
function then(thought: SetupThought, shortcut: string): ReactNode {
  switch (thought.kind) {
    case "listening":
      return <Text variant="callout" as="span">Press <Kbd>{shortcut}</Kbd> again when you're done. Esc cancels.</Text>;
    case "transcribing":
      return <Seconds startedAt={thought.startedAt} />;
    case "test":
      return null;
    default:
      return (
        <Text variant="callout" as="span">
          Press <Kbd>{shortcut}</Kbd>, ramble for half a minute, then press it again. I'll sort it out.
        </Text>
      );
  }
}

/** How long the words have taken, once past 10 s: the only part of the step that redraws as they count. */
function Seconds({ startedAt }: { startedAt: number }) {
  const now = useNow(TICK_MS);
  const seconds = slowSeconds((now - startedAt) / 1000);
  return seconds ? <Text variant="callout" as="span" numeric>{seconds}</Text> : null;
}

/**
 * The microphone is turned down: where to allow it, with typing meanwhile. Its Type it instead stands in for the step's
 * own, so there is one button of that name.
 */
function DeniedNotice({ onType }: { onType: () => void }) {
  return (
    <Notice
      tone="error"
      title="Avanzel can't hear you yet."
      actions={
        <Actions align="start">
          <Button size="small" onClick={onType}>Type it instead</Button>
          <Button size="small" variant="primary" onClick={() => window.avanzel.settings.openPrivacy("microphone")}>Open System Settings</Button>
        </Actions>
      }
    >
      Allow it in System Settings, under Microphone.
    </Notice>
  );
}

/**
 * The recording or its words went wrong, in setup's own words (recordingProblem): what happened, what is safe, and the
 * way on, Try again or typing. Its Type it instead stands in for the step's own, so there is one button of that name.
 */
function FailedNotice({ thought, onType }: { thought: Extract<SetupThought, { kind: "failed" }>; onType: () => void }) {
  const { title, body } = recordingProblem(thought.problem, thought.kept);
  return (
    <Notice
      tone="error"
      title={title}
      actions={
        <Actions align="start">
          <Button size="small" onClick={onType}>Type it instead</Button>
          <Button size="small" variant="primary" onClick={() => api.tryAgain()}>Try again</Button>
        </Actions>
      }
    >
      {body}
    </Notice>
  );
}

/**
 * The Notice of a shortcut that may not work: another app holds it (an error), or no press followed the person's reach
 * for it within the wait, so another app may hold it though it registered. Each offers the free ones, the best last as
 * the primary, or Settings → Voice when none is free. Nothing while the shortcut works or the step still waits.
 */
function PressNotice({ press, accelerator }: { press: SetupPress; accelerator: string }) {
  if (!press.taken && !press.silent) return null;
  const free = press.alternatives.length > 0;
  const actions = (
    <Actions align="start">
      {free ? (
        press.alternatives
          .map((alternative, i) => (
            <Button key={alternative} size="small" variant={i === 0 ? "primary" : "secondary"} onClick={() => void api.useShortcut(alternative)}>
              {`Use ${prettyAccelerator(alternative)}`}
            </Button>
          ))
          .reverse()
      ) : (
        <Button size="small" variant="primary" onClick={() => window.avanzel.capsule.openSettingsFor("open-settings:voice")}>
          Open Settings
        </Button>
      )}
    </Actions>
  );
  if (press.taken) {
    return (
      <Notice tone="error" title={takenMessage(accelerator, press.holder)} actions={actions}>
        {free ? "Pick another shortcut." : "Pick another one in Settings → Voice."}
      </Notice>
    );
  }
  // With none free, the way out is Settings, and the holder isn't named.
  const maybe = `Another app may be using it${free && press.holder ? `, probably ${press.holder}` : ""}.`;
  return (
    <Notice title={`Did ${prettyAccelerator(accelerator)} do nothing?`} actions={actions}>
      {free ? `${maybe} Try another shortcut.` : `${maybe} Pick another one in Settings → Voice.`}
    </Notice>
  );
}
