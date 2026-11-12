// Settings → Agents: every agent Avanzel knows, listed as setup lists them, with what its check found under its name. Use makes an
// agent the one that files and answers, and an agent this Mac doesn't have offers its install command, where it has one. The last row
// hands the choice back to Avanzel, one Check agents asks all of them again, and the agent in use names its model: picked from a list for
// an agent that lists its models (Codex, OpenCode) or whose aliases Avanzel knows (Claude Code), typed for any other. Each control applies at once. The pane needs a library: without one the shell
// draws NoLibrary in its place.
import { Actions, Button, ChoiceRow, Group, GroupReveal, GroupRow, Notice, Row, Stack, Switch, Text, TextField } from "@avanzel/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { harnessName } from "../../../main/jobs.ts";
import {
  AGENT_INSTALLS,
  isAgentProblem,
  PRIVATE_AGENTS,
  PRIVATE_API_LABELS,
  type AgentInstall,
  type HarnessInfo,
  type LibraryInfo,
  type PickOption,
  type PrivateInfo,
} from "../../../shared/ipc.ts";
import { agentLine, ownLine } from "../../setup/copy.ts";
import { agentNotChecked, AGENTS_NOT_CHECKED } from "../copy.ts";
import { attemptChange, PickButton, type PaneProps } from "../parts.tsx";

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
  /** The person has pressed Check agents, so VoiceOver hears its status as it changes. */
  asked: boolean;
  /** Its install command was copied a moment ago. */
  copied: boolean;
  onUse(): void;
  onCopy(agent: AgentInstall): void;
}

/**
 * One agent's row: its status under its name, "Best results" for Claude Code, Chosen or Use, and Copy install command where it isn't
 * installed and has a command to give. The controls are one group named for the agent, so VoiceOver says whose Use it is and tests find
 * the row's buttons by it. The library's own agent is Chosen even when it isn't installed, so its "Not installed" shows as its problem.
 */
function AgentRow({ agent, chosen, inUse, asked, copied, onUse, onCopy }: AgentRowProps): ReactNode {
  const { name, available } = agent;
  const problem = !available || isAgentProblem(agent.status);
  const tone: ProblemTone = inUse && problem ? "danger" : "secondary";
  return (
    <ChoiceRow
      label={harnessName(name)}
      description={
        <Text variant="footnote" tone={tone} as="span">
          {agent.experimental && "Experimental. "}
          {statusWords(agent, tone)}
        </Text>
      }
      // Once the person has pressed Check agents, VoiceOver hears each agent by name as its check runs and ends. The sign-in reads the
      // pane makes by itself as it opens are news nobody asked for, so until then it says nothing.
      live={asked}
      badge={name === "claude" ? "Best results" : undefined}
      chosen={chosen}
      unavailable={!available}
      chooseLabel="Use"
      onChoose={onUse}
    >
      {!available && isInstallable(name) && <Button size="small" variant="secondary" onClick={() => onCopy(name)}>{copied ? "Copied" : "Copy install command"}</Button>}
    </ChoiceRow>
  );
}

/** The first choice of a model list: no model is kept, and the agent runs with its own default. */
const AGENT_DEFAULT = "Agent's default";

/**
 * The models Avanzel offers for an agent, by agent name. Claude Code has no command that lists its models, so these are the aliases
 * its `--model` takes for the latest model of each family (`claude --help`: "an alias for the latest model (e.g. 'fable', 'opus', or
 * 'sonnet')"), which stay current as new models come out. An agent not here lists its models itself (`HarnessInfo.models`) or has
 * its model typed.
 */
const MODEL_CHOICES: Readonly<Record<string, readonly { value: string; label: string }[]>> = {
  claude: [
    { value: "fable", label: "Fable" },
    { value: "opus", label: "Opus" },
    { value: "sonnet", label: "Sonnet" },
    { value: "haiku", label: "Haiku" },
  ],
};

/**
 * The list to choose from: the agent's default first (value ""), then the known models, and a model saved before that the list
 * doesn't have, as it was typed, so choosing nothing loses it. The saved one is checked.
 */
export function modelOptions(choices: readonly { value: string; label: string }[], saved: string): PickOption[] {
  const known = choices.some((c) => c.value === saved);
  return [
    { value: "", label: AGENT_DEFAULT, checked: saved === "" },
    ...choices.map((c) => ({ ...c, checked: c.value === saved })),
    ...(saved && !known ? [{ value: saved, label: saved, checked: true }] : []),
  ];
}

interface ModelGroupProps extends Pick<PaneProps, "onChange" | "attempt"> {
  /** The agent in use, by name: "claude". */
  agent: string;
  /** The library's models, by agent name. */
  models: Readonly<Record<string, string>>;
  /** The models the agent says it can run (`HarnessInfo.models`), empty when it lists none. */
  listed: readonly { value: string; label: string }[];
}

/**
 * The model group of the agent in use: its model, typed, saved when Return is pressed and when the focus leaves the field.
 * A model left empty is not kept, so the agent runs with its own default. The draft is the field's text until then, and
 * the pane keys this by its agent, so another agent's group starts from its own saved model. A save main refuses leaves the
 * draft as typed, and the window says it wasn't saved: the field is not what the library holds, and pressing Return or
 * leaving the field tries again.
 */
function ModelGroup({ agent, models, listed, onChange, attempt }: ModelGroupProps): ReactNode {
  const label = harnessName(agent);
  const saved = models[agent] ?? "";
  const [draft, setDraft] = useState(saved);
  const saveModel = async (model: string) => {
    if (model === saved) return;
    const next = { ...models, [agent]: model };
    await attemptChange({ onChange, attempt }, () =>
      api.setLibrary({ models: Object.fromEntries(Object.entries(next).filter(([, value]) => value.trim())) }),
    );
  };
  const save = () => saveModel(draft.trim());
  // An agent whose models are known, its own list first and Avanzel's aliases next, picks one from a list; any other agent's model is typed.
  const choices = listed.length ? listed : MODEL_CHOICES[agent];
  if (choices) {
    const options = modelOptions(choices, saved);
    const chosen = options.find((o) => o.checked)?.label ?? AGENT_DEFAULT;
    return (
      <Group label={label}>
        <GroupRow label="Model" description="A smaller model often files just as well and costs less.">
          <PickButton label={`${label} model`} value={chosen} options={options} onChoose={(value) => void saveModel(value)} />
        </GroupRow>
      </Group>
    );
  }
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

/** The context sizes offered for a private model, in tokens: what its server holds in one conversation. */
const CONTEXT_SIZES: readonly number[] = [16_384, 32_768, 65_536, 131_072, 262_144];

const tokens = (count: number) => `${count.toLocaleString("en-US")} tokens`;

/** The words of a list of agents: "pi or OpenCode". */
const orList = (names: readonly string[]) => names.map(harnessName).join(" or ");

interface PrivateGroupProps extends Pick<PaneProps, "onChange" | "attempt"> {
  lib: LibraryInfo;
  /** The agent in use, by name, or null when none is. */
  inUse: string | null;
  harnesses: readonly HarnessInfo[];
}

/**
 * The private model: a switch, and under it, while it is on, what the library's agent is run against instead of its maker's models.
 * The kind of server says which agents can be used (pi and OpenCode for OpenAI chat completions, Claude Code for Anthropic Messages,
 * Codex for OpenAI Responses), so choosing a kind, or turning it on, moves the library to an installed agent that speaks it when the
 * one in use doesn't. The address and the model are typed and saved when Return is pressed or the focus leaves the field, as the model
 * of an agent is. The key is never typed or shown: Generate makes one, Paste takes the clipboard's, Copy gives it to the server and
 * Remove forgets it; main keeps it in the Keychain. A private model that can't run with the agent in use says why in a Notice.
 */
function PrivateGroup({ lib, inUse, harnesses, onChange, attempt }: PrivateGroupProps): ReactNode {
  const model = lib.private;
  const keySaved = lib.privateKeySaved;
  const [address, setAddress] = useState(model.baseUrl);
  const [name, setName] = useState(model.model);
  const change = (patch: Partial<PrivateInfo>, harness?: string) =>
    attemptChange({ onChange, attempt }, () => api.setLibrary({ private: patch, ...(harness ? { harness } : {}) }));
  const installed = (kind: PrivateInfo["api"]) =>
    PRIVATE_AGENTS[kind].filter((agent) => harnesses.some((h) => h.name === agent && h.available));
  const withAgent = (kind: PrivateInfo["api"]): string | undefined => {
    const first = installed(kind)[0];
    return first && !(inUse && PRIVATE_AGENTS[kind].includes(inUse)) ? first : undefined;
  };
  const save = (field: "baseUrl" | "model", value: string) => {
    if (value.trim() !== model[field]) void change({ [field]: value.trim() });
  };
  const kinds = (Object.keys(PRIVATE_API_LABELS) as PrivateInfo["api"][]).map((kind) => ({
    value: kind,
    label: PRIVATE_API_LABELS[kind],
    checked: kind === model.api,
  }));
  const agents = installed(model.api).map((agent) => ({ value: agent, label: harnessName(agent), checked: agent === inUse }));
  const sizes = [...new Set([...CONTEXT_SIZES, model.contextWindow])]
    .sort((a, b) => a - b)
    .map((size) => ({ value: String(size), label: tokens(size), checked: size === model.contextWindow }));
  return (
    <>
      <Group
        label="Private model"
        note="Run your agent against a model of your own, on this Mac or on your company's server. What you say and what is filed goes to that server and nowhere else."
      >
        <Switch
          label="Use a private model"
          description="The agent below files and answers with it, in place of the agent's own models."
          checked={model.enabled}
          onChange={(on) => void change({ enabled: on }, on ? withAgent(model.api) : undefined)}
        />
        <GroupReveal open={model.enabled}>
          <GroupRow label="Server speaks" description="What your server understands. A server on this Mac that runs mlx-lm speaks OpenAI chat completions.">
            <PickButton label="Server speaks" value={PRIVATE_API_LABELS[model.api]} options={kinds} onChoose={(kind) => void change({ api: kind as PrivateInfo["api"] }, withAgent(kind as PrivateInfo["api"]))} />
          </GroupRow>
          <GroupRow
            label="Agent"
            description={
              agents.length
                ? `${orList(PRIVATE_AGENTS[model.api])} speak${PRIVATE_AGENTS[model.api].length === 1 ? "s" : ""} this kind of server.`
                : `Install ${orList(PRIVATE_AGENTS[model.api])} to use this kind of server.`
            }
          >
            {agents.length > 0 && (
              <PickButton
                label="Private model agent"
                value={inUse && PRIVATE_AGENTS[model.api].includes(inUse) ? harnessName(inUse) : "Choose…"}
                options={agents}
                onChoose={(agent) => attemptChange({ onChange, attempt }, () => api.setLibrary({ harness: agent }))}
              />
            )}
          </GroupRow>
          <GroupRow label="Address" description="Where the server is, such as http://127.0.0.1:8765/v1. A server that isn't on this Mac needs https.">
            <div className="settings-field" onBlur={() => save("baseUrl", address)}>
              <TextField label="Server address" labelHidden value={address} onChange={setAddress} onEnter={() => save("baseUrl", address)} />
            </div>
          </GroupRow>
          <GroupRow label="Model" description="The model's name on that server.">
            <div className="settings-field" onBlur={() => save("model", name)}>
              <TextField label="Private model name" labelHidden value={name} onChange={setName} onEnter={() => save("model", name)} />
            </div>
          </GroupRow>
          <GroupRow label="Context size" description="How much one conversation can hold. Agents need at least 32,768 tokens; 65,536 is safer.">
            <PickButton label="Context size" value={tokens(model.contextWindow)} options={sizes} onChoose={(size) => void change({ contextWindow: Number(size) })} />
          </GroupRow>
          <GroupRow
            label="Key"
            description={
              keySaved
                ? "A key is saved in your Keychain, never in your library. A server only checks it once you give it the key: press Copy."
                : "A server on this Mac needs none. For one that does, generate a key to give it, or paste the one it gave you."
            }
          >
            <Row gap={8}>
              {keySaved ? (
                <>
                  <Button size="small" variant="secondary" onClick={() => void attemptChange({ onChange, attempt }, () => api.copyPrivateKey())}>Copy</Button>
                  <Button size="small" variant="secondary" onClick={() => void attemptChange({ onChange, attempt }, () => api.removePrivateKey())}>Remove</Button>
                </>
              ) : (
                <>
                  <Button size="small" variant="secondary" onClick={() => void attemptChange({ onChange, attempt }, () => api.generatePrivateKey())}>Generate</Button>
                  <Button size="small" variant="secondary" onClick={() => void attemptChange({ onChange, attempt }, () => api.pastePrivateKey())}>Paste</Button>
                </>
              )}
            </Row>
          </GroupRow>
        </GroupReveal>
      </Group>
      {model.enabled && lib.privateProblem && (
        <Notice tone="error" title={lib.privateProblem}>
          Filing stops until this is fixed, and nothing is sent to any other server.
        </Notice>
      )}
    </>
  );
}

/** The Agents pane: each agent with its check, the choice of which one files, its model or a private model to run it against. */
export function Agents(props: PaneProps): ReactNode {
  const { snap, onChange, attempt } = props;
  const lib = snap.library;
  // The person has pressed Check agents: only then are the agents' statuses announced.
  const [asked, setAsked] = useState(false);
  // The agent whose install command was copied, for COPIED_MS.
  const [copied, setCopied] = useState<AgentInstall | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    // Only the free checks, which read a sign-in and never ask the model: a prompt waits for Check.
    void attemptChange(props, () => api.checkAgents(), AGENTS_NOT_CHECKED);
    return () => clearTimeout(timer.current);
  }, []);
  // The shell draws this pane only while a library is open, so this only narrows the type. It stands below every hook.
  if (!lib) return null;
  // The agent that files and answers: the library's, or the one Automatic picks.
  const inUse = lib.harness === "auto" ? snap.selectedHarness : lib.harness;

  const use = (harness: string) => attemptChange(props, () => api.setLibrary({ harness }));
  const installed = snap.harnesses.filter((agent) => agent.available);
  // Busy for what the person asked. The sign-in reads the pane makes as it opens don't hold the button up: a press meanwhile leaves those to finish and asks the others.
  const checking = asked && installed.some((agent) => agent.status?.kind === "checking");
  // Each installed agent, one by one, as a press of it alone was: a check that can't start is told, and the others still run.
  const checkAll = () => {
    setAsked(true);
    for (const agent of installed) void attemptChange(props, () => api.checkAgent(agent.name), agentNotChecked(harnessName(agent.name)));
  };
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
            asked={asked}
            copied={copied === agent.name}
            onUse={() => void use(agent.name)}
            onCopy={copy}
          />
        ))}
        <ChoiceRow
          label="Choose automatically"
          description="Avanzel uses the best agent installed: Claude Code first."
          chosen={lib.harness === "auto"}
          chooseLabel="Use"
          onChoose={() => void use("auto")}
        />
      </Group>
      {installed.length > 0 && (
        <Actions>
          {/* Busy rather than disabled while they check, so it keeps the focus. */}
          <Button size="small" variant="secondary" busy={checking} onClick={checkAll}>Check agents</Button>
        </Actions>
      )}
      <PrivateGroup key={lib.private.enabled ? "private" : "own"} lib={lib} inUse={inUse} harnesses={snap.harnesses} onChange={onChange} attempt={attempt} />
      {inUse && !lib.private.enabled && (
        <ModelGroup
          key={inUse}
          agent={inUse}
          models={lib.models}
          listed={snap.harnesses.find((agent) => agent.name === inUse)?.models ?? []}
          onChange={onChange}
          attempt={attempt}
        />
      )}
    </Stack>
  );
}
