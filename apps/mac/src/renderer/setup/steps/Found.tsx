// Step 2, Here's what I found: the library's place, and the installed agents with what reading their sign-in found.
// Setup chooses the best one, or a library's own while it works; with none that works, the one whose problem the person
// can fix, so its Notice says how at once. Use {agent} picks another, and asks it its one short question when nothing
// has said yet whether it works. A chosen agent that doesn't work says how to fix it, and a sign-in done in Terminal
// shows once the window has the focus again. With no agent at all, Found says how to install one and setup notices
// when it arrives. Change… picks another place.
// Looks good (Use this folder, when the folder holds files or a library already) makes the library there with the
// chosen agent. Zel waits on the stage.
import { Actions, Button, Group, GroupRow, Icon, Notice, Row, Stack, Text, Zel } from "@avanzel/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AGENT_INSTALLS, agentWorks, type AgentInstall, type LibraryFolder, type SetupAgent, type SetupSnapshot } from "../../../shared/ipc.ts";
import { agentLine, agentProblemTitle, isAgentProblem, ownLine, tooBroadLine, type AgentProblem } from "../copy.ts";
import { Frame, reveal, type StepProps } from "../frame.tsx";

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

/** How to install an agent, when this Mac has none (AGENT_INSTALLS), in the order Found lists them. */
const INSTALLS = (Object.keys(AGENT_INSTALLS) as AgentInstall[]).map((agent) => ({ agent, ...AGENT_INSTALLS[agent] }));

/** How long Copy says "Copied". */
const COPIED_MS = 2_000;

/** A chosen agent that doesn't work, and what its check found. */
interface Trouble {
  agent: SetupAgent;
  problem: AgentProblem;
}

export function Found({ snap, go }: StepProps) {
  // While Looks good works, the place shows what it did when pressed: the folder becomes a library before the step
  // moves on, which would otherwise change the row and the button for a moment. Other clicks do nothing until then,
  // so the library made, the agent saved and the step shown stay the ones the person chose.
  const [making, setMaking] = useState<SetupSnapshot | null>(null);
  const place = making ?? snap;
  const problem = snap.makeProblem;
  const chosen = snap.agents.find((agent) => agent.name === snap.agent) ?? null;
  // Check again keeps its Notice up, its button busy, while the agent is checked again: the focus stays on the
  // button, and nothing under it moves. The check's result then replaces the Notice, or ends it.
  const [rechecking, setRechecking] = useState<Trouble | null>(null);
  const checkingAgain = rechecking !== null && chosen?.name === rechecking.agent.name && chosen.status?.kind === "checking";
  const trouble: Trouble | null = chosen && isAgentProblem(chosen.status) ? { agent: chosen, problem: chosen.status } : checkingAgain ? rechecking : null;
  const noticeRef = useRef<HTMLDivElement>(null);
  const troubleRef = useRef<HTMLDivElement>(null);
  const chosenRef = useRef<HTMLSpanElement>(null);
  useEffect(() => reveal(noticeRef.current), [problem, making]);
  useEffect(() => reveal(chosenRef.current), [snap.agent]);
  useEffect(() => reveal(troubleRef.current), [trouble?.agent.name, trouble?.problem.kind]);
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
          {/* One primary per moment: while a Notice with actions shows, its last action is the primary. Only an agent
              known to work can file, so the button waits until there is one, and a place too broad for a library
              makes none. */}
          <Button
            variant={problem || trouble ? "secondary" : "primary"}
            disabled={!agentWorks(chosen?.status) || place.tooBroad}
            busy={making !== null}
            onClick={make}
          >
            {place.folder === "has-files" || place.folder === "library" ? "Use this folder" : "Looks good"}
          </Button>
        </>
      }
    >
      {/* 12 between the sections, as on Hello. Two agents and a new library fit; more scroll under the footer. */}
      <Stack gap={12}>
        <Text variant="heading">Here's what I found.</Text>
        <Group label="Your library">
          <GroupRow label={place.libraryLabel} description={place.tooBroad ? tooBroadLine(place.libraryLabel) : LIBRARY_LINE[place.folder]}>
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
                  {/* The agent's problem, newer and in the way of the footer's button, holds the primary while it shows. */}
                  <Button size="small" variant={trouble ? "secondary" : "primary"} onClick={chooseFolder}>Change…</Button>
                </Actions>
              }
            >
              {problem}
            </Notice>
          </div>
        )}
        {snap.noAgent && <NoAgent />}
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
        {trouble && (
          <div ref={troubleRef}>
            <Notice
              tone="error"
              title={agentProblemTitle(trouble.agent.label, trouble.problem)}
              actions={
                <Actions align="start">
                  {trouble.problem.kind === "signed-out" && (
                    <Button size="small" onClick={idle(() => api.openTerminal())}>Open Terminal</Button>
                  )}
                  <Button
                    size="small"
                    variant="primary"
                    busy={checkingAgain}
                    onClick={idle(() => {
                      setRechecking(trouble);
                      // An agent setup chose for its problem becomes the person's pick, so it stays chosen while its
                      // check runs again, rather than giving way to the next agent with a problem.
                      void api.chooseAgent(trouble.agent.name);
                      void window.avanzel.settings.checkAgent(trouble.agent.name);
                    })}
                  >
                    Check again
                  </Button>
                </Actions>
              }
            >
              {troubleBody(trouble)}
            </Notice>
          </div>
        )}
      </Stack>
    </Frame>
  );
}

/**
 * The body of a chosen agent's Notice: how to sign it in, what may be wrong, or what the agent said. A failure that said
 * nothing has none, so the Notice keeps no empty line for it.
 */
function troubleBody({ agent, problem }: Trouble): ReactNode {
  if (problem.kind === "timeout") return <>It may be busy. Check again, or use another agent.</>;
  if (problem.kind === "failed") return ownLine(problem.detail) || undefined;
  switch (agent.name) {
    case "claude":
      return <>Run <Text variant="code">claude</Text> once in Terminal and sign in, then check again.</>;
    case "codex":
      return <>Run <Text variant="code">codex login</Text> in Terminal, then check again.</>;
    default:
      return <>Sign in to {agent.label} in Terminal, then check again.</>;
  }
}

/**
 * With no agent installed: the no-agent Notice, and under it how to install Claude Code or Codex, each command with its
 * Copy. Meanwhile setup looks for an agent, and Found lists it once one is installed.
 */
function NoAgent() {
  const [copied, setCopied] = useState<AgentInstall | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  // Main copies the command it holds for the agent named: the page never says what goes on the clipboard.
  const copy = (agent: AgentInstall) => {
    api.copy(agent);
    setCopied(agent);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), COPIED_MS);
  };
  return (
    <Stack gap={12}>
      <Notice title="Avanzel needs an AI agent to do the filing.">
        Claude Code works best. Install one in Terminal, and I'll notice when it's ready.
      </Notice>
      {INSTALLS.map(({ agent, label, command }) => (
        // Named for its agent, so each of the two Copy buttons says whose command it copies.
        <div key={agent} role="group" aria-label={label}>
          <Stack gap={4}>
            <Row justify="between">
              <Text>{label}</Text>
              <Button size="small" onClick={() => copy(agent)}>{copied === agent ? "Copied" : "Copy"}</Button>
            </Row>
            <Text variant="code">{command}</Text>
          </Stack>
        </div>
      ))}
    </Stack>
  );
}
