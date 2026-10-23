// Settings → Agents: every agent Avanzel knows, listed as setup lists them, with what its check found. Use makes an agent
// the one that files and answers, Check asks it again, and an agent this Mac doesn't have offers its install command,
// where it has one. The last row hands the choice back to Avanzel, and the agent in use names its model. Each control
// applies at once. The pane needs a library: without one the shell draws NoLibrary in its place.
import { Button, Group, GroupRow, Icon, Row, Stack, Text, TextField } from "@avanzel/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { harnessName } from "../../../main/jobs.ts";
import { AGENT_INSTALLS, isAgentProblem, type AgentInstall, type HarnessInfo } from "../../../shared/ipc.ts";
import { agentLine, ownLine } from "../../setup/copy.ts";
import type { PaneProps } from "../parts.tsx";

const api = window.avanzel.settings;

/** How long an install command's button says "Copied". */
const COPIED_MS = 2_000;

/** Whether Avanzel can say how to install agent `name` (a key of AGENT_INSTALLS): Claude Code and Codex. */
const isInstallable = (name: string): name is AgentInstall => Object.hasOwn(AGENT_INSTALLS, name);

/** A problem's ink: red for the agent in use, which files and answers, and secondary for the others. */
type ProblemTone = "danger" | "secondary";

/** After "Not signed in.": how to sign in to agent `name`, with the command for the agents that have one. */
function signInHint(name: string, tone: ProblemTone): ReactNode {
  if (name === "claude") return <>Run <Text variant="code" tone={tone}>claude</Text> once in Terminal and sign in.</>;
  if (name === "codex") return <>Run <Text variant="code" tone={tone}>codex login</Text> in Terminal.</>;
  return `Sign in to ${harnessName(name)} in Terminal.`;
}

/** What a row says of its agent: that it isn't installed, or what its check found ("Installed" until one has). */
function statusWords(agent: HarnessInfo, tone: ProblemTone): ReactNode {
  if (!agent.available) return "Not installed";
  const status = agent.status;
  if (status?.kind !== "signed-out") return agentLine(status);
  // A reply that asked to sign in follows the hint with its own words; a sign-in command's answer is the hint alone.
  const own = ownLine(status.detail);
  return <>Not signed in. {signInHint(agent.name, tone)}{own && ` ${own}`}</>;
}

interface AgentRowProps {
  agent: HarnessInfo;
  /** The library's choice is this agent. */
  chosen: boolean;
  /** This is the agent that files and answers, which a problem is red for. */
  inUse: boolean;
  /** Its check has had a result, so its button reads "Check again", also while it is checked again. */
  checked: boolean;
  /** The person has pressed its Check, so VoiceOver hears its status as it changes. */
  asked: boolean;
  /** Its install command was copied a moment ago. */
  copied: boolean;
  onUse(): void;
  onCheck(): void;
  onCopy(agent: AgentInstall): void;
}

/**
 * One agent's row: its status, "Best results" for Claude Code, Chosen or Use, then Check (installed) or Copy install
 * command (not installed, with a command to give). The controls are one group named for the agent, so VoiceOver says
 * whose Check it is and tests find the row's buttons by it. The library's own agent is Chosen even when it isn't installed,
 * so its "Not installed" shows as its problem.
 */
function AgentRow({ agent, chosen, inUse, checked, asked, copied, onUse, onCheck, onCopy }: AgentRowProps): ReactNode {
  const { name, available } = agent;
  const label = harnessName(name);
  const checking = available && agent.status?.kind === "checking";
  const checkedBefore = checked || (available && agent.status !== null && !checking);
  const problem = !available || isAgentProblem(agent.status);
  const tone: ProblemTone = inUse && problem ? "danger" : "secondary";
  return (
    <GroupRow label={label} description={agent.experimental ? "Experimental" : undefined}>
      <div role="group" aria-label={label}>
        <Row gap={8}>
          {/* Once the person has pressed Check, VoiceOver hears each change of it as the check runs and ends. The sign-in
              reads the pane makes by itself as it opens are news nobody asked for, so until then it says nothing. */}
          <span className="settings-status" role={asked ? "status" : undefined}>
            <Text variant="footnote" tone={tone} as="span">{statusWords(agent, tone)}</Text>
          </span>
          {name === "claude" && <Text variant="caption" tone="accent">Best results</Text>}
          {chosen ? (
            <Icon name="check" label="Chosen" />
          ) : (
            available && <Button size="small" variant="secondary" onClick={onUse}>{`Use ${label}`}</Button>
          )}
          {available ? (
            // Busy rather than disabled while it checks, so it keeps the focus.
            <Button size="small" variant="secondary" busy={checking} onClick={onCheck}>{checkedBefore ? "Check again" : "Check"}</Button>
          ) : (
            isInstallable(name) && <Button size="small" variant="secondary" onClick={() => onCopy(name)}>{copied ? "Copied" : "Copy install command"}</Button>
          )}
        </Row>
      </div>
    </GroupRow>
  );
}

interface ModelGroupProps {
  /** The agent in use, by name: "claude". */
  agent: string;
  /** The library's models, by agent name. */
  models: Readonly<Record<string, string>>;
  onChange: PaneProps["onChange"];
}

/**
 * The model group of the agent in use: its model, typed, saved when Return is pressed and when the focus leaves the field.
 * A model left empty is not kept, so the agent runs with its own default. The draft is the field's text until then, and
 * the pane keys this by its agent, so another agent's group starts from its own saved model.
 */
function ModelGroup({ agent, models, onChange }: ModelGroupProps): ReactNode {
  const label = harnessName(agent);
  const saved = models[agent] ?? "";
  const [draft, setDraft] = useState(saved);
  const save = async () => {
    const model = draft.trim();
    if (model === saved) return;
    const next = { ...models, [agent]: model };
    onChange(await api.setLibrary({ models: Object.fromEntries(Object.entries(next).filter(([, value]) => value.trim())) }));
  };
  return (
    <Group label={label}>
      {/* The row says what an empty field means, so the field has no placeholder: in a Group, its ink reads under AA in dark. */}
      <GroupRow label="Model" description="A smaller model often files just as well and costs less. Leave it empty to use the agent's own default.">
        {/* TextField takes no onBlur, so the box around it hears the focus leave (React's onBlur bubbles). */}
        <div className="settings-field" onBlur={() => void save()}>
          <TextField label={`${label} model`} labelHidden value={draft} onChange={setDraft} onEnter={() => void save()} />
        </div>
      </GroupRow>
    </Group>
  );
}

/** The Agents pane: each agent with its check, the choice of which one files, and the model of the one in use. */
export function Agents({ snap, onChange }: PaneProps): ReactNode {
  const lib = snap.library;
  // Agents whose check has had a result: while one is checked again, its button still reads "Check again".
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());
  const results = snap.harnesses.filter((h) => h.status && h.status.kind !== "checking" && !checked.has(h.name));
  if (results.length) setChecked(new Set([...checked, ...results.map((h) => h.name)]));
  // Agents whose Check the person has pressed, the way `checked` keeps those with a result: only their statuses are announced.
  const [asked, setAsked] = useState<ReadonlySet<string>>(() => new Set());
  // The agent whose install command was copied, for COPIED_MS.
  const [copied, setCopied] = useState<AgentInstall | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    // Only the free checks, which read a sign-in and never ask the model: a prompt waits for Check.
    void api.checkAgents().then(onChange);
    return () => clearTimeout(timer.current);
  }, []);
  // The shell draws this pane only while a library is open, so this only narrows the type. It stands below every hook.
  if (!lib) return null;
  // The agent that files and answers: the library's, or the one Automatic picks.
  const inUse = lib.harness === "auto" ? snap.selectedHarness : lib.harness;

  const use = async (harness: string) => onChange(await api.setLibrary({ harness }));
  // Main copies the command it holds for the agent named: the page never says what goes on the clipboard.
  const copy = (agent: AgentInstall) => {
    window.avanzel.setup.copy(agent);
    setCopied(agent);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), COPIED_MS);
  };
  return (
    <Stack gap={20}>
      <Group
        label="Who files your thoughts"
        note="Avanzel runs the agent inside your library folder, with your own sign-in and plan. Checking Claude Code or Codex reads their sign-in; other agents are asked one short question."
      >
        {snap.harnesses.map((agent) => (
          <AgentRow
            key={agent.name}
            agent={agent}
            chosen={lib.harness === agent.name}
            inUse={agent.name === inUse}
            checked={checked.has(agent.name)}
            asked={asked.has(agent.name)}
            copied={copied === agent.name}
            onUse={() => void use(agent.name)}
            onCheck={async () => {
              setAsked((last) => new Set(last).add(agent.name));
              onChange(await api.checkAgent(agent.name));
            }}
            onCopy={copy}
          />
        ))}
        <GroupRow label="Choose automatically" description="Avanzel uses the best agent installed: Claude Code first.">
          <div role="group" aria-label="Choose automatically">
            {lib.harness === "auto" ? (
              <Icon name="check" label="Chosen" />
            ) : (
              <Button size="small" variant="secondary" onClick={() => void use("auto")}>Use automatic</Button>
            )}
          </div>
        </GroupRow>
      </Group>
      {inUse && <ModelGroup key={inUse} agent={inUse} models={lib.models} onChange={onChange} />}
    </Stack>
  );
}
