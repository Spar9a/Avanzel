// The gallery: every component in light and dark, drawn from the real code. It is the reference agents
// compare their windows with, and the page the screenshot tests photograph (e2e/gallery.spec.ts).
// A new component isn't finished until it has a section here (test/catalog.test.ts checks).
// main.tsx mounts it in a browser; static.tsx renders it to plain HTML for a preview.
import { useState, type CSSProperties, type ReactNode } from "react";
import {
  ActionTile, Actions, Badge, Bubble, Button, CapsuleAppear, CapsuleBar, CapsuleMenu, CapsuleNotice, Card, ChoiceRow, Group, GroupRow, GroupReveal, Hud, Icon, ICON_NAMES, Kbd, Letter, Link, Notice,
  PermissionPrimer, Progress, Receipt, Row, Segmented, SHELVES, SHELF_NAMES, ShelfDrawer, ShelfGlyph, ShelfMark, ShelfTag, Spacer, Spinner,
  Aura, Confirm, Disclosure, Dust, Expiring, FileChip, FileLink, FilePreview, Items, UndoBar, ListField, MarkUp, More, RecordingStage, ScreenArea, Select, SpokenField, Stack, Stage, Stamp, Switch, TabPanel, Tabs, Text, TextArea, TextField, Wave, Zel, PageRow, type ZelMood,
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

/** A picture to mark in the gallery: an empty one, the size of the part it stands for, so the window's own ground shows through. */
const BLANK_PICTURE = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='600' height='220'/>";
const LEVELS = [0.1, 0.25, 0.5, 0.35, 0.7, 0.9, 0.6, 0.4, 0.75, 0.5, 0.3, 0.55, 0.8, 0.45, 0.2, 0.1];
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
      <TextField label="Library" value={library} onChange={setLibrary} description="Notes are Markdown files in a git repository." />
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
              <Button variant="danger">Delete note</Button>
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
            <Card
              look="panel"
              label="Thought"
              status="Filing with Claude Code"
              progress={0.4}
              onClose={() => {}}
              footer={<Text variant="footnote" tone="secondary">10 s of about 18</Text>}
              actions={<><Button>Edit</Button><Button icon="stop">Stop</Button></>}
            >
              Ask Dana about the launch checklist before Friday, and book the room.
            </Card>
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

      <Specimen id="capsule" title="The capsule" use="Dark glass in light and dark mode, because it floats over any desktop. The live line shows what is really happening." code={'<CapsuleBar mood="listening" levels={levels} time="0:07">…and book the room</CapsuleBar>'}>
        {() => (
          <Stack gap={12}>
            <CapsuleAppear>
              <CapsuleBar mood="listening" levels={LEVELS} time="0:07">Ask Dana about the launch checklist before Friday</CapsuleBar>
            </CapsuleAppear>
            <div className="g-screen">
              <ScreenArea rect={{ x: 40, y: 24, width: 260, height: 110 }} recording={false} hint="Drag over the part of the screen to record. Esc gives up." />
            </div>
            <div className="g-screen">
              <ScreenArea rect={{ x: 40, y: 24, width: 260, height: 110 }} recording time="0:12" hint="" />
            </div>
            <div className="g-screen">
              <MarkUp rect={{ x: 40, y: 24, width: 300, height: 110 }} picture={BLANK_PICTURE} onDone={() => {}} onCancel={() => {}} />
            </div>
            <CapsuleMenu
              open
              title="Add to this recording"
              onClose={() => {}}
              items={[
                { label: "Attach a file…", icon: "attach", onSelect: () => {} },
                { label: "Screenshot of the screen", icon: "display", onSelect: () => {} },
                { label: "Screenshot of an area", icon: "screen", onSelect: () => {} },
                { label: "Record a video of an area", icon: "play", onSelect: () => {}, busy: true },
              ]}
            >
              <Items items={[{ text: "report.pdf · 10:42" }, { text: "Screenshot", busy: true }]} onRemove={() => {}} />
            </CapsuleMenu>
            <CapsuleBar mood="listening" levels={LEVELS} time="0:05" onDropFiles={() => {}}>Ask Dana about the launch checklist</CapsuleBar>
            <CapsuleBar mood="listening" steady levels={LEVELS} time="0:13" actions={<Button size="small">Stop</Button>}>Taking notes on the call</CapsuleBar>
            <CapsuleBar mood="thinking" time="0:04"><Text tone="secondary" as="span" truncate>Reading Ideas/Launch checklist.md</Text></CapsuleBar>
            <CapsuleBar mood="filed" actions={<><Button size="small">Undo</Button><Button size="small" variant="primary">Open</Button></>}>Filed on 2 notes</CapsuleBar>
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

      <Specimen id="group-reveal" title="Rows a switch shows" use="A switch's own settings, under it while it is on: they open out and fade in, and fold away when it is off." code={'<Switch label="Start a thought by voice" checked={on} … />\n<GroupReveal open={on}>\n  <GroupRow label="Trigger word">…</GroupRow>\n</GroupReveal>'}>
        {() => (
          <Group label="Voice trigger">
            <Switch label="Start a thought by voice" checked onChange={() => {}} />
            <GroupReveal open>
              <GroupRow label="Trigger word"><Kbd>Avanzel</Kbd></GroupRow>
              <GroupRow label="Stop word"><Kbd>Avanzel stop</Kbd></GroupRow>
            </GroupReveal>
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
              <Text variant="footnote" tone="secondary">Notes used:</Text>
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
            <Text variant="callout" tone="secondary" align="center">Answers come from your library only, with links to the notes they use.</Text>
          </Stack>
        )}
      </Specimen>

      <Specimen id="panel" title="The menu bar panel" use="Tabs move between the panel's places, with a quieter row for the parts of one. Action tiles start something new. A page row folds open in place to show more." code={'<Tabs label="Sections" controls="panel" options={…} value={tab} onChange={setTab} />\n<TabPanel id="panel" value={tab} pages={[{ value: "capture", content: … }, …]} />\n<Aura><ActionTile icon="mic" label="Record a thought" … /></Aura>\n<PageRow title="Fix the light in graphics" shelf="problems" status="open" date="6 Nov" expanded={open} onToggle={…} actions={…} />'}>
        {() => <PanelSpecimen />}
      </Specimen>
    </main>
  );
}

type PanelTab = "capture" | "library" | "settings";
type PanelPart = "all" | "ideas" | "problems";

function PanelSpecimen() {
  const [tab, setTab] = useState<PanelTab>("library");
  const [part, setPart] = useState<PanelPart>("all");
  const [open, setOpen] = useState<string | null>("onboarding");
  // The bin's demonstration: the row turns to dust, and comes back a moment later to be deleted again.
  const [dusting, setDusting] = useState(false);
  const [dusted, setDusted] = useState(false);
  const [sort, setSort] = useState<"changed" | "title">("changed");
  const [skip, setSkip] = useState(["com.lastpass.LastPass", "com.dashlane.Dashlane"]);
  return (
    <Stack gap={12}>
      <Card
        label="Thought"
        status="Filing with Claude Code"
        progress={0.3}
        onClose={() => {}}
        footer={<Text variant="footnote" tone="secondary">4 s of about 15 · Transcribed on this Mac in 0.3 s</Text>}
        actions={<><Button>Edit</Button><Button icon="stop">Stop</Button></>}
      >
        <Text variant="words-small">The other side of this call wasn't heard.</Text>
      </Card>
      <Card
        label="Thought"
        stamp={{ word: "noted", date: "6 Nov 2026" }}
        onClose={() => {}}
        footer={<Text variant="footnote">Nothing new to file. Claude Code noted it in the log.</Text>}
        actions={<Button>Undo</Button>}
      >
        <Text variant="words-small">Uh cancel. Let's say it like this.</Text>
      </Card>
      <Row gap={6} justify="end">
        <Select label="Filter" icon="settings" buttonLabel="Filter" options={[{ value: "all", label: "All notes" }, { value: "ideas", label: "Ideas", section: "Shelves" }]} value="all" onChange={() => {}} />
        <Select
          label="Filter"
          icon="settings"
          options={[{ value: "all", label: "All notes" }, { value: "problems", label: "Problems", shelf: "problems", section: "Shelves" }]}
          value="problems"
          onChange={() => {}}
          clearable
          clearLabel="Clear the filter"
          onClear={() => {}}
        />
        <Select label="Sort by" options={[{ value: "changed", label: "Newest change" }, { value: "title", label: "Title" }]} value={sort} onChange={setSort} />
      </Row>
      <ListField label="Apps to skip" items={skip} onChange={setSkip} placeholder="com.apple.Passwords" />
      <Row gap={6} wrap>
        <FileChip name="2026-11-07-131109.mov" kind="video" onOpen={() => {}} onRemove={() => {}} />
        <FileChip name="Screenshot.png" kind="image" onOpen={() => {}} onRemove={() => {}} />
        <FileChip name="brief.pdf" kind="file" onOpen={() => {}} />
      </Row>
      <Row gap={6} justify="center">
        <UndoBar message="Note deleted" seconds={5} paused onUndo={() => {}} onDone={() => {}} />
        <Dust removing={false}>
          <Card look="panel" label="Thought" status="Waiting to file" headAction={<Button size="small" variant="danger" icon="trash" label="Delete this thought" />}>
            Book the room for Friday
          </Card>
        </Dust>
        <Expiring seconds={5}>
          <Card look="panel" label="Thought" footer={<Text variant="footnote">No note was made. Claude Code noted it in the log.</Text>}>
            Testing the microphone
          </Card>
        </Expiring>
      </Row>
      <Stack gap={8}>
        <SpokenField label="Trigger word" value="Avanzel" onChange={() => {}} listening={false} levels={[]} onListen={() => {}} listenLabel="Say the trigger word" />
        <SpokenField label="Trigger word" value="" onChange={() => {}} listening levels={LEVELS} onListen={() => {}} listenLabel="Say the trigger word" />
      </Stack>
      <Row gap={6} justify="end">
        <Button size="small" variant="danger" icon="trash" label="Delete this note" />
        <Confirm open question="Move this note to the Trash?" confirmLabel="Delete" onConfirm={() => {}} onCancel={() => {}}>
          <Button size="small" variant="danger" icon="trash" label="Delete this note" expanded />
        </Confirm>
      </Row>
      <Text variant="callout">
        Watch <FileLink name="2026-11-07-131109.mov" kind="video" onOpen={() => {}} onRemove={() => {}}>the screen recording</FileLink> before
        Friday.
      </Text>
      <Items
        items={[
          {
            text: "2026-11-07-172904.png",
            content: (
              <>
                <FileLink name="2026-11-07-172904.png" kind="image" onOpen={() => {}} onRemove={() => {}}>2026-11-07-172904.png</FileLink>
                <FilePreview name="2026-11-07-172904.png" kind="video" picture={BLANK_PICTURE} onOpen={() => {}} />
              </>
            ),
          },
          {
            text: "2026-11-07-173133.png",
            content: (
              <>
                <FileLink name="2026-11-07-173133.png" kind="image" onOpen={() => {}}>2026-11-07-173133.png</FileLink>
                <FilePreview name="2026-11-07-173133.png" kind="image" picture={undefined} onOpen={() => {}} />
              </>
            ),
          },
        ]}
      />
      <Disclosure label="Log" count={2}>
        <Items items={[{ text: "2026-11-07 — Noted by voice.", when: "2026-11-07", content: "Noted by voice." }, { text: "2026-11-07 — Added a screen recording.", when: "2026-11-07", content: "Added a screen recording." }]} />
      </Disclosure>
      <Row gap={8} wrap>
        <ListField label="Apps to skip" items={skip} onChange={setSkip} placeholder="com.apple.Passwords" collapsed={{ one: "app", many: "apps" }} />
        <ListField label="Sites to skip" items={[]} onChange={() => {}} placeholder="bank.example.com" collapsed={{ one: "site", many: "sites" }} />
      </Row>
      <Row gap={8} wrap>
        <Button size="small" variant="primary" icon="screen" shortcut="⌥⇧S">Capture the whole screen</Button>
        <Button size="small" shortcut="⌥⇧R">Pick a part</Button>
        <Select
          label="Add a file, a screenshot or a video, 3 added"
          trigger={{ icon: "attach", size: "xlarge", count: 3 }}
          options={[{ value: "file", label: "Attach a file…", icon: "attach" }, { value: "shot", label: "Screenshot of the screen", icon: "display" }]}
          value={null}
          onChange={() => {}}
        />
      </Row>
      <Notice
        tone="info"
        title="Next steps"
        actions={<Button size="small" variant="primary" icon="mic">Continue by voice</Button>}
      >
        <Items items={[{ text: "Ask Dana which project the lighting fix is for" }, { text: "Book the room for Friday", done: true }]} onRemove={() => {}} />
      </Notice>
      <RecordingStage
        active
        line="Recording a thought"
        time="0:12"
        levels={LEVELS}
        controls={
          <Row gap={8}>
            <Button size="xlarge" icon="attach" count={2} label="Add a file, a screenshot or a video, 2 added" />
            <Button size="xlarge" icon="close" label="Cancel the recording" />
            <Button size="xlarge" icon="pause" label="Pause" />
            <Button size="xlarge" variant="primary" icon="stop" badge="spark" label="Stop, and your agent files it now" />
          </Row>
        }
      >
        <Text variant="callout" tone="secondary">The ways to start something new.</Text>
      </RecordingStage>
      <Tabs
        label="Sections"
        controls="g-panel-tab"
        options={[{ value: "capture", label: "Capture" }, { value: "library", label: "Library", count: 12, countLabel: "12 notes" }, { value: "settings", label: "Settings" }]}
        value={tab}
        onChange={setTab}
      />
      <Tabs
        level="secondary"
        label="Shelves"
        options={[{ value: "all", label: "All" }, { value: "ideas", label: "Ideas", shelf: "ideas", count: 1, countLabel: "1 note" }, { value: "problems", label: "Problems", shelf: "problems", count: 1, countLabel: "1 note" }]}
        value={part}
        onChange={setPart}
        controls="g-panel-shelves"
      />
      <CapsuleBar mood="listening" levels={LEVELS} time="0:11">
        {null}
      </CapsuleBar>
      <Row gap={6} justify="end">
        <Segmented
          label="When your agent files this recording"
          options={[{ value: "now", label: "Now", icon: "spark" }, { value: "evening", label: "21:00", icon: "moon" }]}
          value="now"
          onChange={() => {}}
        />
        <Button size="small" icon="close" label="Cancel the recording" />
        <Button size="small" icon="pause" label="Pause" />
        <Button size="small" variant="primary" icon="stop" badge="spark" label="Stop, and your agent files it now" />
        <Button size="small" variant="primary" icon="stop" badge="moon" label="Stop, and file it at the evening review at 21:00" />
      </Row>
      <Aura>
        <Stack gap={8}>
          <ActionTile tone="primary" icon="mic" label="Record a thought" hint="Speak, and your agent files it." shortcut="⌥Space" onClick={() => {}} />
          <ActionTile
            icon="screen"
            label="Capture the screen"
            hint="With a comment on what is on it."
            open
            choices={
              <>
                <Button size="small" variant="primary" icon="screen">Capture the whole screen</Button>
                <Button size="small">Pick a part</Button>
              </>
            }
            onClick={() => {}}
          />
        </Stack>
      </Aura>
      <TabPanel
        id="g-panel-tab"
        value={tab}
        pages={[
          { value: "capture", content: <Text variant="callout" tone="secondary">The ways to start something new.</Text> },
          {
            value: "library",
            content: (
              <Stack gap={8}>
                <PageRow
                  title="Fix the light in graphics"
                  shelf="problems"
                  status="open"
                  tags={["work", "graphics"]}
                  date="6 Nov"
                  summary="A short voice note about a work task: fix the lighting in the graphics."
                  expanded={open === "light"}
                  onToggle={() => setOpen(open === "light" ? null : "light")}
                  actions={<><Button size="small" icon="open">.md</Button><Button size="small" icon="open">Obsidian</Button></>}
                  lead={<Row gap={8} wrap><Text variant="footnote" tone="secondary">Add more</Text><Button size="small" variant="primary" icon="mic">Record</Button><More><Button size="small" icon="pen">Screenshot with marks</Button><Button size="small" icon="attach">Attach a file…</Button></More></Row>}
                  onDropFiles={() => {}}
                />
                {!dusted && (
                  <PageRow
                    title="Ask Dana about the launch"
                    shelf="people"
                    date="4 Nov"
                    expanded={false}
                    onToggle={() => {}}
                    removing={dusting}
                    onRemoved={() => {
                      setDusted(true);
                      setDusting(false);
                      setTimeout(() => setDusted(false), 1200);
                    }}
                    actions={<Button size="small" variant="quiet" icon="trash" label="Delete this note" onClick={() => setDusting(true)} />}
                  />
                )}
                <PageRow
                  title="An easier first run"
                  shelf="ideas"
                  tags={["product"]}
                  date="5 Nov"
                  summary="Show the shortcut on the first card, so people learn it by using it."
                  expanded={open === "onboarding"}
                  onToggle={() => setOpen(open === "onboarding" ? null : "onboarding")}
                  actions={<><Button size="small" icon="open">.md</Button><Button size="small" icon="open">Obsidian</Button></>}
                >
                  <Stack gap={4}>
                    <Text variant="footnote" tone="secondary">Next steps</Text>
                    <Text variant="callout">Try it with three people this week.</Text>
                  </Stack>
                </PageRow>
              </Stack>
            ),
          },
          { value: "settings", content: <Text variant="callout" tone="secondary">Settings, pane by pane.</Text> },
        ]}
      />
    </Stack>
  );
}

