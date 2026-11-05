// The gallery: every component in light and dark, drawn from the real code. It is the reference agents
// compare their windows with, and the page the screenshot tests photograph (e2e/gallery.spec.ts).
// A new component isn't finished until it has a section here (test/catalog.test.ts checks).
// main.tsx mounts it in a browser; static.tsx renders it to plain HTML for a preview.
import { useState, type CSSProperties, type ReactNode } from "react";
import {
  Actions, Badge, Bubble, Button, CapsuleBar, CapsuleNotice, Card, ChoiceRow, Group, GroupRow, Hud, Icon, ICON_NAMES, Kbd, Letter, Link, Notice,
  PermissionPrimer, Progress, Receipt, Row, Segmented, SHELVES, SHELF_NAMES, ShelfDrawer, ShelfGlyph, ShelfMark, ShelfTag, Spacer, Spinner,
  Stack, Stage, Stamp, Switch, Text, TextArea, TextField, Wave, Zel, type ZelMood,
} from "../src/index.ts";
import "./gallery.css";

type Appearance = "light" | "dark";

function Specimen({ id, title, use, code, children }: { id: string; title: string; use: string; code?: string; children: (appearance: Appearance) => ReactNode }) {
  return (
    <section className="g-section" id={id}>
      <div className="g-head">
        <Text variant="heading">{title}</Text>
        <Text variant="callout" tone="secondary">{use}</Text>
      </div>
      <div className="g-pair" data-gallery={id}>
        {(["light", "dark"] as const).map((appearance) => (
          <div key={appearance} className="g-panel" data-appearance={appearance}>{children(appearance)}</div>
        ))}
      </div>
      {code && <pre className="g-code"><code>{code}</code></pre>}
    </section>
  );
}

const Label = ({ children }: { children: string }) => <span className="g-label">{children}</span>;

const COLOURS: [string, string[]][] = [
  ["Ink", ["--av-ink", "--av-ink-secondary", "--av-ink-accent", "--av-ink-danger", "--av-ink-ok"]],
  ["Surfaces", ["--av-surface-window", "--av-surface-stage", "--av-surface-paper", "--av-surface-fill", "--av-accent-fill", "--av-accent-wash"]],
  ["Paper", ["--av-paper-ink", "--av-paper-ink-secondary", "--av-paper-rule-red", "--av-paper-rule-blue"]],
  ["Shelves", SHELVES.map((s) => `--av-shelf-${s}`)],
];

const LEVELS = [0.1, 0.25, 0.5, 0.35, 0.7, 0.9, 0.6, 0.4, 0.75, 0.5, 0.3, 0.55, 0.8, 0.45, 0.2, 0.1];
/** A stand-in for an app's icon, as the helper gives one: a plain rounded square. */
const APP_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 26 26'%3E%3Crect width='26' height='26' rx='6' fill='gray'/%3E%3C/svg%3E";
const LONG_WORDS =
  "Okay, so tell me why the hint moves when the words arrive. First read the design document, then check how the listening scene builds its card, and after that run the end to end tests for the dictation feature on a quiet desktop.";
const MOODS: [ZelMood, string, string][] = [
  ["idle", "Idle", "Ready in the menu bar."],
  ["listening", "Listening", "The microphone is on."],
  ["thinking", "Thinking", "The agent reads and writes."],
  ["filed", "Filed", "Saved, and undoable."],
  ["needs-you", "Needs you", "One thing is stuck."],
  ["asleep", "Asleep", "Today's letter is written."],
];

function Controls() {
  const [login, setLogin] = useState(true);
  const [desk, setDesk] = useState(false);
  const [mode, setMode] = useState<"auto" | "screen" | "type">("auto");
  const [library, setLibrary] = useState("~/Avanzel");
  const [thought, setThought] = useState("");
  const [draft, setDraft] = useState("Ask Dana about the launch checklist before Friday.");
  return (
    <Stack gap={16}>
      <Stack gap={10}>
        <Switch label="Open Avanzel at login" description="Avanzel waits in the menu bar." checked={login} onChange={setLogin} />
        <Switch label="Keep Zel on my desktop" checked={desk} onChange={setDesk} />
        <Switch label="Evening letter" checked={false} onChange={() => {}} disabled />
      </Stack>
      <Segmented label="Capture mode" value={mode} onChange={setMode} options={[{ value: "auto", label: "Auto" }, { value: "screen", label: "Screen" }, { value: "type", label: "Type" }]} />
      <TextField label="Library" value={library} onChange={setLibrary} description="Pages are Markdown files in a git repository." />
      <TextField label="Type a thought" labelHidden size="large" variant="bare" icon="waveform" placeholder="Type a thought…" value={thought} onChange={setThought} />
      <TextField label="Search the library" labelHidden icon="search" value="launch checklist" onChange={() => {}} action={<Button size="small" variant="quiet">Clear</Button>} />
      <TextArea label="Edit before filing" value={draft} onChange={setDraft} rows={2} />
      <Text variant="footnote" tone="secondary">Press <Kbd>⌥Space</Kbd> to talk.</Text>
      <Row gap={6}>
        <Kbd size="key">⌥</Kbd>
        <Kbd size="key" pressed>Space</Kbd>
      </Row>
    </Stack>
  );
}

export function Gallery() {
  return (
    <main className="g-page">
      <header className="g-intro">
        <Zel mood="filed" size="large" />
        <Stack gap={6}>
          <Text variant="title">Avanzel UI</Text>
          <Text variant="callout" tone="secondary">Every window is made of these parts. Windows only arrange them; this package is the only place that paints. Each part is shown in light and in dark.</Text>
        </Stack>
      </header>

      <Specimen id="colour" title="Colour" use="Roles, not paint. Inside a card or the capsule, the inks change by themselves." code={'color: var(--av-ink-secondary);   /* only inside @avanzel/ui */'}>
        {() => (
          <Stack gap={12}>
            {COLOURS.map(([group, names]) => (
              <Stack key={group} gap={6}>
                <Label>{group}</Label>
                <div className="g-swatches">
                  {names.map((name) => (
                    <span key={name} className="g-swatch"><i style={{ "--_swatch": `var(${name})` } as CSSProperties} />{name.replace("--av-", "")}</span>
                  ))}
                </div>
              </Stack>
            ))}
          </Stack>
        )}
      </Specimen>

      <Specimen id="type" title="Type" use="Pick a role by its job. Zel speaks in Nunito, your words are in Newsreader, and everything else is the system font." code={'<Text variant="words">Ask Dana about the checklist.</Text>'}>
        {() => (
          <Stack gap={10}>
            <Text variant="title">Your library is a month old</Text>
            <Text variant="heading">Your week</Text>
            <Text variant="voice">I'm not sure this belongs in Ideas.</Text>
            <Text variant="headline">Filed by Claude Code</Text>
            <Text variant="callout">Press ⌥Space and say what's on your mind.</Text>
            <Text>Transcribed on this Mac in 0.8 seconds.</Text>
            <Text variant="footnote" tone="secondary">Your note is safe in the inbox.</Text>
            <Text variant="caption" tone="secondary">Thought, 14:02</Text>
            <Text variant="words">Ask Dana about the launch checklist before Friday.</Text>
            <Text variant="words">Нагадай мені про зустріч з Оленою в п’ятницю.</Text>
            <Text variant="code">claude auth status</Text>
          </Stack>
        )}
      </Specimen>

      <Specimen id="buttons" title="Buttons" use="One primary action per moment, last in its row. Labels start with a verb and keep the same name through the flow." code={'<Actions>\n  <Button variant="quiet">Not now</Button>\n  <Button variant="primary">File it</Button>\n</Actions>'}>
        {() => (
          <Stack gap={12}>
            <Row gap={8} wrap>
              <Button variant="primary">File it</Button>
              <Button>Undo</Button>
              <Button variant="quiet">Not now</Button>
              <Button variant="danger">Delete page</Button>
            </Row>
            <Row gap={8} wrap align="center">
              <Button size="small">Open</Button>
              <Button>Open</Button>
              <Button size="large" variant="primary">Set me up</Button>
            </Row>
            <Row gap={8} wrap>
              <Button icon="undo">Undo</Button>
              <Button icon="open" label="Open in Obsidian" />
              <Button variant="primary" busy>Filing</Button>
              <Button disabled>Undo</Button>
            </Row>
            <Text variant="footnote" tone="secondary" as="div">Inside text, an action is a link: <Button variant="link">Show the last receipt</Button></Text>
            <Actions>
              <Button variant="quiet">Not now</Button>
              <Button variant="primary">File it</Button>
            </Actions>
          </Stack>
        )}
      </Specimen>

      <Specimen id="controls" title="Controls" use="Settings apply at once. Every field has a label, even when it is hidden." code={'<Switch label="Open Avanzel at login" checked={on} onChange={setOn} />'}>
        {() => <Controls />}
      </Specimen>

      <Specimen id="feedback" title="Progress and notices" use="Every problem says what happened, what is safe, and offers one fix. Long waits get a size and a way out." code={'<Notice tone="error" title="Claude Code has hit its usage limit." actions={…}>…</Notice>'}>
        {() => (
          <Stack gap={12}>
            <Row gap={10}><Spinner /><Text variant="footnote" tone="secondary" as="span">Filing with Claude Code…</Text></Row>
            <Stack gap={6}>
              <Progress label="Downloading the speech model" value={0.62} />
              <Row><Text variant="footnote" tone="secondary" as="span">Speech model</Text><Spacer /><Text variant="footnote" tone="secondary" as="span" numeric>412 of 670 MB</Text></Row>
            </Stack>
            <Progress label="Reading your library" width="short" />
            <Notice tone="error" title="Claude Code has hit its usage limit." actions={<Actions align="start"><Button size="small">Wait until 15:00</Button><Button size="small" variant="primary">File it with Codex now</Button></Actions>}>
              It resets at 15:00. Your note is safe in the inbox.
            </Notice>
            <Notice tone="success" title="Filed in Ideas: Launch checklist." />
            <Notice title="Avanzel needs an AI agent to do the filing.">Claude Code works best.</Notice>
          </Stack>
        )}
      </Specimen>

      <Specimen id="zel" title="Zel" use="Six moods, four sizes. Zel looks at the work, never at you, and moves only while it is listening or thinking." code={'<Zel mood="thinking" size="tiny" />'}>
        {() => (
          <Stack gap={16}>
            <div className="g-grid">
              {MOODS.map(([mood, name, says]) => (
                <div key={mood} className="g-mood">
                  <Zel mood={mood} />
                  <Text variant="voice">{name}</Text>
                  <Text variant="caption" tone="secondary">{says}</Text>
                </div>
              ))}
            </div>
            <Row gap={16} align="end">
              <Zel mood="idle" size="tiny" />
              <Zel mood="idle" size="small" />
              <Zel mood="idle" size="medium" />
              <Zel mood="idle" size="large" />
            </Row>
          </Stack>
        )}
      </Specimen>

      <Specimen id="paper" title="Cards, stamps and shelves" use="Your words live on index cards. The stamp is the receipt. A shelf always shows its colour, its glyph and its name." code={'<Card label="Thought" meta="14:02" stamp={{ word: "filed", date: "20 Oct 2026", animate: true }}>…</Card>'}>
        {() => (
          <Stack gap={16}>
            <Card label="Thought" meta="14:02" stamp={{ word: "filed", date: "20 Oct 2026" }} footer={<Row gap={6} wrap><ShelfTag shelf="people" /><ShelfTag shelf="goals" /></Row>}>
              Ask Dana about the launch checklist before Friday, and book the room.
            </Card>
            <Card label="Question" meta="Due today" size="regular">
              What did Roediger and Karpicke find about testing against restudying?
            </Card>
            <Card label="Thought" placeholder="Say anything…" />
            <Stage>
              <Row gap={12} wrap justify="center">
                <Stamp word="filed" date="20 Oct 2026" />
                <Stamp word="noted" size="small" />
                <Stamp word="remembered" size="small" />
                <Stamp word="letter" size="xs" date="20 Oct 2026" />
              </Row>
            </Stage>
            <div className="g-tabs">
              {SHELVES.map((shelf, i) => <ShelfTag key={shelf} shelf={shelf} variant="tab" count={i === 1 ? 1 : undefined} />)}
            </div>
          </Stack>
        )}
      </Specimen>

      <Specimen id="capsule" title="The capsule" use="Dark glass in light and dark mode, because it floats over any desktop. One panel: the words above a row." code={'<CapsuleBar mood="listening" levels={levels} centred words="…and book the room" />'}>
        {() => (
          <Stack gap={12}>
            <CapsuleBar mood="listening" levels={LEVELS} time="0:01" centred hint={<><Kbd>⌥Space</Kbd> to finish, <Kbd>Esc</Kbd> to cancel</>} />
            <CapsuleBar mood="listening" levels={LEVELS} time="0:07" centred words="Ask Dana about the launch checklist before Friday" />
            <CapsuleBar mood="listening" levels={LEVELS} time="0:31" centred app={{ icon: APP_ICON, label: "Dictating into Slack" }} words={LONG_WORDS} />
            <CapsuleBar mood="thinking" centred app={{ icon: APP_ICON, label: "Dictating into Slack" }} words={LONG_WORDS}>Transcribing on this Mac…</CapsuleBar>
            <CapsuleBar mood="listening" levels={LEVELS} time="0:12">Taking notes on the call</CapsuleBar>
            <CapsuleBar mood="thinking" time="0:04"><Text tone="secondary" as="span" truncate>Reading Ideas/Launch checklist.md</Text></CapsuleBar>
            <CapsuleBar mood="filed" actions={<><Button size="small">Undo</Button><Button size="small" variant="primary">Open</Button></>}>Filed on 2 pages</CapsuleBar>
            <CapsuleBar mood="needs-you" actions={<Button size="small" variant="primary">Answer</Button>}>Claude Code has a question</CapsuleBar>
            <Hud>
              <Stack gap={10}>
                <Row gap={8}><Text variant="headline" as="span">Filed by Claude Code</Text><Spacer /><Text variant="footnote" tone="secondary" as="span">in 6 s</Text></Row>
                <Receipt pages={[{ title: "Launch checklist", shelf: "goals" }, { title: "Dana", shelf: "people" }]} />
                <Actions><Button size="small">Undo</Button><Button size="small" variant="primary">Open</Button></Actions>
              </Stack>
            </Hud>
            <CapsuleNotice title="Claude Code isn't signed in on this Mac." actions={<Actions align="start"><Button size="small">Use another agent</Button><Button size="small" variant="primary">Open Terminal</Button></Actions>}>
              Run <Text variant="code" as="code">claude</Text> once in Terminal and sign in, and your note will be filed straight away.
            </CapsuleNotice>
            <Row gap={10}><Text variant="caption" tone="secondary" as="span">Voice levels</Text><Wave levels={LEVELS} /></Row>
          </Stack>
        )}
      </Specimen>

      <Specimen id="speech" title="Zel speaks" use="Only Zel speaks in bubbles, and only when asked or when something needs you. Before a macOS permission prompt there is one button: Continue." code={'<Bubble title="This agent wants to run a command." actions={…}>…</Bubble>'}>
        {() => (
          <Stack gap={16} align="center">
            <Bubble title="Claude Code wants to run a command." actions={<Actions><Button size="small" variant="quiet">Don't allow</Button><Button size="small" variant="primary">Allow once</Button></Actions>}>
              <Text variant="code">npm test</Text>
            </Bubble>
            <PermissionPrimer kind="microphone" onContinue={() => {}} />
          </Stack>
        )}
      </Specimen>

      <Specimen id="settings" title="Settings" use="Grouped rows, as in System Settings. On/off settings are switches; anything else is a row with its control on the right." code={'<Group label="Capture">\n  <Switch label="Open Avanzel at login" … />\n  <GroupRow label="Shortcut"><Kbd>⌥Space</Kbd></GroupRow>\n</Group>'}>
        {() => (
          <Group label="Capture" note="Avanzel keeps the audio only until it becomes text.">
            <Switch label="Open Avanzel at login" checked onChange={() => {}} />
            <GroupRow label="Shortcut"><Kbd>⌥Space</Kbd><Button size="small">Change</Button></GroupRow>
            <GroupRow label="Agent" description="Claude Code is signed in."><Button size="small" variant="quiet">Choose</Button></GroupRow>
          </Group>
        )}
      </Specimen>

      <Specimen id="letter" title="The evening letter" use="The ending of the day: what you filed, in Zel's words, signed and stamped." code={'<Letter date="Tuesday, 20 October" stampDate="20 Oct 2026">…</Letter>'}>
        {() => (
          <Letter date="Tuesday, 20 October" stampDate="20 Oct 2026">
            <p>You filed six thoughts today. I put two on the launch and one on a worry you hadn't written down before.</p>
            <h3>Worth a look tomorrow</h3>
            <ul>
              <li>Dana's checklist is due on Friday.</li>
              <li>The release build still waits for the speech model.</li>
            </ul>
          </Letter>
        )}
      </Specimen>

      <Specimen id="icons" title="Icons and glyphs" use="Draw new icons here on the 16 px grid, never as an <svg> in a window. Shelf glyphs always sit next to the shelf's name." code={'<Icon name="undo" />   <ShelfGlyph shelf="ideas" />'}>
        {() => (
          <Stack gap={12}>
            <div className="g-icons">
              {ICON_NAMES.map((name) => <span key={name} className="g-icon"><Icon name={name} /><span>{name}</span></span>)}
            </div>
            <div className="g-icons">
              {SHELVES.map((shelf) => <span key={shelf} className="g-icon"><ShelfGlyph shelf={shelf} /><span>{SHELF_NAMES[shelf]}</span></span>)}
            </div>
            <Row gap={10}>
              {SHELVES.map((shelf) => <ShelfMark key={shelf} shelf={shelf} />)}
              <Spacer />
              <Link href="https://github.com/">Contributing</Link>
            </Row>
          </Stack>
        )}
      </Specimen>

      <Specimen id="parts" title="Page buttons, badges and totals" use="A page button opens a page of the library and may wrap. A badge says one thing about its row. A shelf tab can carry its total." code={'<Button variant="page" wrap>Plant tulips in October</Button>\n<Badge>Best results</Badge>\n<ShelfTag shelf="ideas" variant="tab" total count={12} />'}>
        {() => (
          <Stack gap={16}>
            <Stack gap={6}>
              <Text variant="footnote" tone="secondary">Pages used:</Text>
              <Row gap={6} wrap align="center"><ShelfTag shelf="topics" /><Button variant="page">Plant tulips in October</Button></Row>
              <Row gap={6} wrap align="start"><ShelfTag shelf="ideas" /><Button variant="page" wrap>Move the trading system from Voxfor to new hosting before the end of the month</Button></Row>
            </Stack>
            <Button size="small" wrap>Ask about the voice capture tests and the other things to try this week</Button>
            <Row gap={8} wrap align="center">
              <Text variant="footnote" tone="secondary" as="span">Claude Code</Text>
              <Badge>Best results</Badge>
              <Badge tone="neutral">Signed in</Badge>
            </Row>
            <ShelfDrawer total align="start" counts={{ goals: 3, ideas: 12, problems: 0, memories: 5, people: 8, topics: 1 }} />
            <ShelfDrawer counts={{ ideas: 1 }} />
            <Group label="Who should do the filing?">
              <ChoiceRow label="Claude Code" description="Signed in." badge="Best results" chosen chooseLabel="Use Claude Code" onChoose={() => {}} />
              <ChoiceRow label="Codex" description="Signed in." chosen={false} chooseLabel="Use Codex" onChoose={() => {}}>
                <Button size="small" variant="secondary">Check</Button>
              </ChoiceRow>
              <ChoiceRow label="OpenCode" description="Not installed." chosen={false} unavailable chooseLabel="Use OpenCode" onChoose={() => {}} />
            </Group>
            <Text variant="callout" tone="secondary" align="center">Answers come from your library only, with links to the pages they use.</Text>
          </Stack>
        )}
      </Specimen>
    </main>
  );
}

