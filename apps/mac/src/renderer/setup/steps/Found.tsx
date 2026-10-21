// Step 2, Here's what I found: the library's place, and the installed agents with what reading their sign-in found.
// Setup chooses the best one, Use {agent} picks another, and Change… another place. Looks good (Use this folder, when
// the folder holds files or a library already) makes the library there with the chosen agent. Zel waits on the stage.
import { Actions, Button, Group, GroupRow, Icon, Notice, Stack, Text, Zel } from "@avanzel/ui";
import { useEffect, useRef, useState } from "react";
import type { LibraryFolder, SetupSnapshot } from "../../../shared/ipc.ts";
import { agentLine } from "../copy.ts";
import { Frame, type StepProps } from "../frame.tsx";

const api = window.avanzel.setup;

/** What is at the library's place, as the row under it says. */
const LIBRARY_LINE: Record<LibraryFolder, string> = {
  missing: "A new library: Markdown files with git history.",
  empty: "A new library: Markdown files with git history.",
  "has-files": "This folder has files already. I'll add the shelves, an AGENTS.md for your agent, and git history that keeps them.",
  library: "This folder is already an Avanzel library.",
};

/** The agents whose harness keeps them inside the library folder (harness.ts: Claude Code's file tools, OpenCode's opencode.json). */
const CONFINED = new Set(["claude", "opencode"]);

/** Whether the chosen agent is known to work: its sign-in reads as signed in, or it replied. */
function chosenWorks(snap: SetupSnapshot): boolean {
  const status = snap.agents.find((agent) => agent.name === snap.agent)?.status;
  return status?.kind === "signed-in" || status?.kind === "replied";
}

/**
 * Brings `el` into the middle of the step when any of it is out of view: the step scrolls when it holds more than fits
 * (four agents, a folder with files and a problem), and what needs the person mustn't be cut off at its edge.
 */
function reveal(el: Element | null): void {
  const view = el?.closest("main")?.getBoundingClientRect();
  const box = el?.getBoundingClientRect();
  if (el && view && box && (box.top < view.top || box.bottom > view.bottom)) el.scrollIntoView({ block: "center" });
}

export function Found({ snap, go }: StepProps) {
  // While Looks good works, the place shows what it did when pressed: the folder becomes a library before the step
  // moves on, which would otherwise change the row and the button for a moment. Other clicks do nothing until then,
  // so the library made, the agent saved and the step shown stay the ones the person chose.
  const [making, setMaking] = useState<SetupSnapshot | null>(null);
  const place = making ?? snap;
  const problem = snap.makeProblem;
  const noticeRef = useRef<HTMLDivElement>(null);
  const chosenRef = useRef<HTMLSpanElement>(null);
  useEffect(() => reveal(noticeRef.current), [problem, making]);
  useEffect(() => reveal(chosenRef.current), [snap.agent]);
  const idle = (action: () => void) => () => {
    if (!making) action();
  };
  const make = () => {
    setMaking(snap);
    void api.createLibrary().then(
      (next) => {
        setMaking(null);
        if (next.libraryReady && next.makeProblem === null) go("think");
      },
      () => setMaking(null),
    );
  };
  const chooseFolder = idle(() => void api.chooseFolder());
  return (
    <Frame
      model={snap.model}
      stage={
        <div className="found">
          <Zel mood="idle" size="large" />
        </div>
      }
      actions={
        <>
          <Button variant="quiet" onClick={idle(() => go("hello"))}>Back</Button>
          {/* One primary per moment: while the problem's Notice shows, its Change… is the primary. */}
          <Button variant={problem ? "secondary" : "primary"} disabled={!chosenWorks(snap)} busy={making !== null} onClick={make}>
            {place.folder === "has-files" || place.folder === "library" ? "Use this folder" : "Looks good"}
          </Button>
        </>
      }
    >
      {/* 12 between the sections, as on Hello. Two agents and a new library fit; more scroll under the footer. */}
      <Stack gap={12}>
        <Text variant="heading">Here's what I found.</Text>
        <Group label="Your library">
          <GroupRow label={place.libraryLabel} description={LIBRARY_LINE[place.folder]}>
            {/* While the problem shows, its own Change… is the way out: no screen has two buttons of one name. */}
            {!problem && <Button size="small" onClick={chooseFolder}>Change…</Button>}
          </GroupRow>
        </Group>
        {problem && (
          <div ref={noticeRef}>
            <Notice
              tone="error"
              title={`I couldn't make the library at ${snap.libraryLabel}.`}
              actions={
                <Actions align="start">
                  <Button size="small" variant="primary" onClick={chooseFolder}>Change…</Button>
                </Actions>
              }
            >
              {problem}
            </Notice>
          </div>
        )}
        {snap.agents.length > 0 && (
          // The footnote is the agents' small print too: it sits under the group's note as the note sits under the group.
          <Stack gap={6}>
            <Group
              label="Who should do the filing?"
              note="Checking Claude Code or Codex reads their sign-in. Other agents are asked one short question when you pick them."
            >
              {snap.agents.map((agent) => (
                <GroupRow key={agent.name} label={agent.label} description={agentLine(agent.status)}>
                  {agent.name === "claude" && <Text variant="caption" tone="accent">Best results</Text>}
                  {agent.name === snap.agent ? (
                    <span ref={chosenRef} className="found-chosen">
                      <Icon name="check" label="Chosen" />
                    </span>
                  ) : (
                    <Button size="small" onClick={idle(() => void api.chooseAgent(agent.name))}>{`Use ${agent.label}`}</Button>
                  )}
                </GroupRow>
              ))}
            </Group>
            {snap.agent !== null && CONFINED.has(snap.agent) && (
              <div className="found-footnote">
                <Text variant="footnote" tone="secondary">Your agent works only inside the library folder: no shell, no web.</Text>
              </div>
            )}
          </Stack>
        )}
      </Stack>
    </Frame>
  );
}
