// Step 2, Here's what I found: the library's place, and the installed agents with what reading their sign-in found.
// Setup chooses the best one, and Use {agent} picks another. Zel waits on the stage.
import { Button, Group, GroupRow, Icon, Stack, Text, Zel } from "@avanzel/ui";
import type { LibraryFolder } from "../../../shared/ipc.ts";
import { agentLine } from "../copy.ts";
import { Frame, type StepProps } from "../frame.tsx";

/** What is at the library's place, as the row under it says. */
const LIBRARY_LINE: Record<LibraryFolder, string> = {
  missing: "A new library: Markdown files with git history.",
  empty: "A new library: Markdown files with git history.",
  "has-files": "This folder has files already. I'll add the shelves, an AGENTS.md for your agent, and git history that keeps them.",
  library: "This folder is already an Avanzel library.",
};

/** The agents whose harness keeps them inside the library folder (harness.ts: Claude Code's file tools, OpenCode's opencode.json). */
const CONFINED = new Set(["claude", "opencode"]);

export function Found({ snap, go }: StepProps) {
  return (
    <Frame
      model={snap.model}
      stage={
        <div className="found">
          <Zel mood="idle" size="large" />
        </div>
      }
      actions={<Button variant="quiet" onClick={() => go("hello")}>Back</Button>}
    >
      {/* 12 between the sections, as on Hello: with two agents the step fits without scrolling. */}
      <Stack gap={12}>
        <Text variant="heading">Here's what I found.</Text>
        <Group label="Your library">
          <GroupRow label={snap.libraryLabel} description={LIBRARY_LINE[snap.folder]} />
        </Group>
        {snap.agents.length > 0 && (
          <Group
            label="Who should do the filing?"
            note="Checking Claude Code or Codex reads their sign-in. Other agents are asked one short question when you pick them."
          >
            {snap.agents.map((agent) => (
              <GroupRow key={agent.name} label={agent.label} description={agentLine(agent.status)}>
                {agent.name === "claude" && <Text variant="caption" tone="accent">Best results</Text>}
                {agent.name === snap.agent ? (
                  <Icon name="check" label="Chosen" />
                ) : (
                  <Button size="small" onClick={() => void window.avanzel.setup.chooseAgent(agent.name)}>{`Use ${agent.label}`}</Button>
                )}
              </GroupRow>
            ))}
          </Group>
        )}
        {snap.agent !== null && CONFINED.has(snap.agent) && (
          <Text variant="footnote" tone="secondary">Your agent works only inside the library folder: no shell, no web.</Text>
        )}
      </Stack>
    </Frame>
  );
}
