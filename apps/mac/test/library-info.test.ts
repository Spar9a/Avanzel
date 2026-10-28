import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Vault } from "@avanzel/engine";
import { describe, expect, it } from "vitest";
import { answeredFrom, captureMeta, captureWords, filedPages, filedToday, findPage, obsidianUrl, pageAt, pageInfo, recentFromLog } from "../src/main/library-info.ts";

function library() {
  const root = mkdtempSync(path.join(tmpdir(), "avz-lib-"));
  const write = (rel: string, text: string) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  };
  write("goals/launch-podcast.md", "---\ntitle: Launch the indie game dev podcast\nshelf: goals\n---\n# Launch the indie game dev podcast\n");
  write("ideas/balcony-garden.md", "# Маленький сад на балконе\n\nТекст.\n");
  write("people/mark.md", "No heading here.\n");
  write("raw/2026/10/2026-10-20-140312.md", "---\nid: x\n---\n\nwords\n");
  write("log.md", [
    "# Log",
    "- 2026-10-20 00:55 | file | [[2026-10-20-005550-i-want]] → [[launch-podcast]], [[mark]]",
    "- 2026-10-20 00:56 | review | [[2026-10-20]]",
    "- 2026-10-20 00:57 | file | [[2026-10-20-005619]] → [[balcony-garden]]",
    "",
  ].join("\n"));
  return root;
}

describe("library info", () => {
  it("titles a page from its frontmatter, then its heading, then its file name", () => {
    const root = library();
    expect(pageInfo(root, "goals/launch-podcast.md")).toEqual({ title: "Launch the indie game dev podcast", shelf: "goals", path: "goals/launch-podcast.md" });
    expect(pageInfo(root, "ideas/balcony-garden.md").title).toBe("Маленький сад на балконе");
    expect(pageInfo(root, "people/mark.md").title).toBe("mark");
  });

  it("lists recently filed pages, newest first, from the log", () => {
    expect(recentFromLog(library()).map((p) => p.path)).toEqual(["ideas/balcony-garden.md", "goals/launch-podcast.md", "people/mark.md"]);
  });

  describe("how many thoughts were filed today", () => {
    /** A library whose log.md holds `lines` under its heading, and nothing else: no page the lines name is there. */
    function logged(...lines: string[]): string {
      const root = mkdtempSync(path.join(tmpdir(), "avz-log-"));
      writeFileSync(path.join(root, "log.md"), ["# Log", ...lines, ""].join("\n"));
      return root;
    }
    const noon = new Date(2026, 9, 20, 12, 0); // Tue 20 Oct 2026, local

    it("counts the file lines of the library's log that are dated today, and no page is looked up for them", () => {
      expect(filedToday(library(), noon)).toBe(2);
      // The pages these lines name aren't in the library, and the count doesn't ask.
      expect(filedToday(logged("- 2026-10-20 09:00 | file | [[a]] → [[nowhere]]", "- 2026-10-20 09:05 | file | [[b]] → [[nowhere-either]], [[nor-this]]"), noon)).toBe(2);
    });

    it("ignores the review and ask lines, and a line that is not a log line", () => {
      const root = logged(
        "- 2026-10-20 09:00 | file | [[a]] → [[x]]",
        "- 2026-10-20 18:00 | review | [[2026-10-20]]",
        "- 2026-10-20 18:05 | ask | what did I file today → [[x]]",
        "- 2026-10-20 18:06 | ask | does the log say | file | in a question → [[x]]", // the words of an Ask, not a filing
        "2026-10-20 19:00 | file | [[b]] → [[x]]", // no dash: not a line the log wrote
        "A note about 2026-10-20 | file | [[c]]",
      );
      expect(filedToday(root, noon)).toBe(1);
    });

    it("counts by the library's own local days: yesterday's and tomorrow's lines are not today's", () => {
      const root = logged(
        "- 2026-10-19 23:59 | file | [[a]] → [[x]]",
        "- 2026-10-20 00:00 | file | [[b]] → [[x]]",
        "- 2026-10-20 23:59 | file | [[c]] → [[x]]",
        "- 2026-10-21 00:00 | file | [[d]] → [[x]]",
      );
      expect(filedToday(root, noon)).toBe(2);
      expect(filedToday(root, new Date(2026, 9, 20, 0, 0))).toBe(2); // the first minute of the day
      expect(filedToday(root, new Date(2026, 9, 20, 23, 59))).toBe(2); // the last
      expect(filedToday(root, new Date(2026, 9, 19, 23, 59))).toBe(1);
      expect(filedToday(root, new Date(2026, 9, 21, 0, 0))).toBe(1);
      expect(filedToday(root, new Date(2026, 9, 22, 12, 0))).toBe(0);
    });

    it("reads the month and day as the log writes them, with a leading zero", () => {
      const root = logged("- 2026-01-05 08:00 | file | [[a]] → [[x]]", "- 2026-10-05 08:00 | file | [[b]] → [[x]]");
      expect(filedToday(root, new Date(2026, 0, 5, 12, 0))).toBe(1);
      expect(filedToday(root, new Date(2026, 9, 5, 12, 0))).toBe(1);
    });

    it("is 0 for a log with no lines, and for a library without a log, a folder where the log should be, or no library", () => {
      expect(filedToday(logged(), noon)).toBe(0);
      const without = mkdtempSync(path.join(tmpdir(), "avz-nolog-"));
      expect(filedToday(without, noon)).toBe(0);
      mkdirSync(path.join(without, "log.md"));
      expect(filedToday(without, noon)).toBe(0);
      expect(filedToday(path.join(without, "no-such-library"), noon)).toBe(0);
    });

    it("counts through a long log", () => {
      const many = Array.from({ length: 5_000 }, (_, i) => `- 2026-10-${i < 4_990 ? "19" : "20"} 10:${String(i % 60).padStart(2, "0")} | file | [[c${i}]] → [[x]]`);
      expect(filedToday(logged(...many), noon)).toBe(10);
    });
  });

  it("finds a page by its wikilink name, shelves before sources", () => {
    const root = library();
    expect(findPage(root, "mark")).toBe("people/mark.md");
    expect(findPage(root, "2026-10-20-140312")).toBe("raw/2026/10/2026-10-20-140312.md");
    expect(findPage(root, "nope")).toBeNull();
  });

  it("answeredFrom reads an answer's lines and the pages its links name, and leaves out a name with no page", () => {
    const answered = answeredFrom(library(), "See [[launch-podcast|the podcast]] and [[nowhere]].\n\n## Next\n**Call Mark**");
    expect(answered.paragraphs).toEqual(["See the podcast and nowhere.", "Next", "Call Mark"]);
    expect(answered.sources).toEqual([{ title: "Launch the indie game dev podcast", shelf: "goals", path: "goals/launch-podcast.md" }]);
  });

  it("answeredFrom without a library keeps the lines and names no page", () => {
    expect(answeredFrom(null, "See [[x]].")).toEqual({ paragraphs: ["See x."], sources: [] });
  });

  it("answeredFrom leaves out a name whose search can't read the library, so the answer still shows", () => {
    const notAFolder = path.join(library(), "log.md"); // a library path that is a file: reading it as a folder throws
    expect(answeredFrom(notAFolder, "See [[mark]].")).toEqual({ paragraphs: ["See mark."], sources: [] });
  });

  it("turns an agent run's changes into the pages it filed, new pages first", () => {
    const root = library();
    const pages = filedPages(root, { created: ["people/mark.md", "index.md"], modified: ["goals/launch-podcast.md", "log.md", "reviews/2026-10-20.md"] });
    expect(pages.map((p) => p.path)).toEqual(["people/mark.md", "goals/launch-podcast.md"]);
  });

  it("marks each page it filed new or updated, by the run's own changes", () => {
    const root = library();
    const pages = filedPages(root, { created: ["people/mark.md", "ideas/balcony-garden.md"], modified: ["goals/launch-podcast.md"] });
    expect(pages).toEqual([
      { title: "mark", shelf: "people", path: "people/mark.md", created: true },
      { title: "Маленький сад на балконе", shelf: "ideas", path: "ideas/balcony-garden.md", created: true },
      { title: "Launch the indie game dev podcast", shelf: "goals", path: "goals/launch-podcast.md", created: false },
    ]);
  });

  it("marks a page written both ways as new, and lists it once", () => {
    const pages = filedPages(library(), { created: ["people/mark.md"], modified: ["people/mark.md", "goals/launch-podcast.md"] });
    expect(pages.map((p) => [p.path, p.created])).toEqual([["people/mark.md", true], ["goals/launch-podcast.md", false]]);
  });

  it("marks no page where a page is only looked up: the menu's, Ask's and a step's leave it unset", () => {
    const root = library();
    expect(pageInfo(root, "goals/launch-podcast.md")).not.toHaveProperty("created");
    expect(recentFromLog(root).some((page) => "created" in page)).toBe(false);
    expect(answeredFrom(root, "See [[mark]].").sources.some((page) => "created" in page)).toBe(false);
  });

  it("opens pages in Obsidian only when Obsidian knows the library as a vault", () => {
    const root = library();
    expect(obsidianUrl(root, "goals/launch-podcast.md")).toBeNull();
    mkdirSync(path.join(root, ".obsidian"));
    expect(obsidianUrl(root, "goals/launch-podcast.md")).toBe(`obsidian://open?path=${encodeURIComponent(path.join(root, "goals/launch-podcast.md"))}`);
    expect(obsidianUrl(root, "")).toBe(`obsidian://open?path=${encodeURIComponent(root)}`);
  });

  it("reads what a re-filed capture must keep: source, audio, transcriber and creation time", () => {
    const root = library();
    const file = path.join(root, "capture.md");
    writeFileSync(file, "---\nid: 2026-10-20-040829-a-hygienic-tool\ntype: capture\nsource: voice\ncreated: 2026-10-20T04:08:29+04:00\naudio: raw/audio/2026/10/2026-10-20-040829.wav\ntranscriber: onnx-asr:nemo-parakeet-tdt-0.6b-v3\n---\n\nwords\n");
    const meta = captureMeta(file);
    expect(meta.source).toBe("voice");
    expect(meta.audio).toBe("raw/audio/2026/10/2026-10-20-040829.wav");
    expect(meta.transcriber).toBe("onnx-asr:nemo-parakeet-tdt-0.6b-v3");
    expect(meta.created?.toISOString()).toBe(new Date("2026-10-20T04:08:29+04:00").toISOString());
    writeFileSync(file, "just text\n");
    expect(captureMeta(file)).toEqual({ source: "text" });
  });

  // A receipt reprinted for a filing in the background has no words of its own (`FilingJob.text` is ""): they are read from the capture
  // the engine archived, which is the capture as `Vault.newCapture` wrote it. Its embeds (`![[x.wav]]`) come after the words, for each
  // attachment and for the recording, and are not the person's.
  it("captureWords: a capture's words after its frontmatter, without the embeds after them, and nothing from a file that isn't there", () => {
    const root = library();
    const file = path.join(root, "capture.md");
    writeFileSync(file, "---\nid: x\ntype: capture\nsource: text\n---\n\nPlant tulips in October\n");
    expect(captureWords(file)).toBe("Plant tulips in October");
    // A voice capture as newCapture writes it: the recording is in its frontmatter, and embedded after its words (B2).
    const voice = new Vault(root).newCapture("Plant tulips in October", {
      source: "voice",
      audio: path.join(root, "raw", "audio", "2026", "10", "x.wav"),
      transcriber: "onnx-asr:nemo-parakeet-tdt-0.6b-v3",
    });
    const written = readFileSync(voice.path, "utf8");
    expect(written).toContain("audio: raw/audio/2026/10/x.wav");
    expect(written).toContain("![[x.wav]]");
    expect(captureWords(voice.path)).toBe("Plant tulips in October");
    // Line breaks in the words stay, as Words keeps them; the blank line before the embed and the one after it go with the trim.
    const long = new Vault(root).newCapture("First thought\n\nSecond thought,\nin two lines", {
      source: "voice",
      audio: path.join(root, "raw", "audio", "2026", "10", "y.wav"),
      attachments: [path.join(root, "raw", "attachments", "2026", "10", "shot.png")],
    });
    expect(captureWords(long.path)).toBe("First thought\n\nSecond thought,\nin two lines");
    // The cost of reading the words from the file: a line of the person's own that is exactly an embed is dropped, and a line that
    // only has one in it stays.
    writeFileSync(file, "---\nid: x\n---\n\nSee ![[x.wav]] for it\n![[mine.png]]\n  ![[also mine.png]]  \nAfter\n");
    expect(captureWords(file)).toBe("See ![[x.wav]] for it\nAfter");
    // A capture with no frontmatter is all words, and one with nothing is none; a file that isn't there has no words.
    writeFileSync(file, "just text\n");
    expect(captureWords(file)).toBe("just text");
    writeFileSync(file, "---\nid: x\n---\n\n![[x.wav]]\n");
    expect(captureWords(file)).toBe("");
    expect(captureWords(path.join(root, "not-there.md"))).toBe("");
    expect(captureWords("")).toBe("");
  });
});

// An agent with a shell could make a page a link to a file of its own, a script say: a link opens as what it points at, by that
// file's own type, so one click would run it. A page Avanzel opens or reads is a plain file in the library, reached through no link.
describe("a page Avanzel opens or reads", () => {
  /** A file outside every library, holding `text`. */
  function outside(name: string, text: string): string {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "avz-outside-")), name);
    writeFileSync(file, text);
    return file;
  }

  it("is a page when it is a plain file in the library", () => {
    const root = library();
    expect(pageAt(root, "goals/launch-podcast.md")).toBe("page");
    expect(pageAt(root, "ideas/balcony-garden.md")).toBe("page");
  });

  it("is a link when the page is one, wherever it points: out of the library, or at another page in it", () => {
    const root = library();
    symlinkSync(outside("run-me.command", "#!/bin/sh\n"), path.join(root, "ideas", "linked.md"));
    symlinkSync("balcony-garden.md", path.join(root, "ideas", "same.md"));
    expect(pageAt(root, "ideas/linked.md")).toBe("link");
    expect(pageAt(root, "ideas/same.md")).toBe("link");
  });

  it("is a link when a folder on its way is one", () => {
    const root = library();
    const elsewhere = path.dirname(outside("page.md", "# Elsewhere\n"));
    symlinkSync(elsewhere, path.join(root, "topics"));
    expect(pageAt(root, "topics/page.md")).toBe("link");
  });

  it("is none when nothing is there, when a folder is, or when the path leads out of the library", () => {
    const root = library();
    expect(pageAt(root, "ideas/gone.md")).toBe("none");
    mkdirSync(path.join(root, "ideas", "folder.md"));
    expect(pageAt(root, "ideas/folder.md")).toBe("none");
    const away = outside("away.md", "# Away\n");
    expect(pageAt(root, path.relative(root, away))).toBe("none");
  });

  it("finds the library's own pages through a link to the library itself, as /tmp is /private/tmp on a Mac", () => {
    const root = library();
    const via = path.join(mkdtempSync(path.join(tmpdir(), "avz-via-")), "library");
    symlinkSync(root, via);
    expect(pageAt(via, "goals/launch-podcast.md")).toBe("page");
  });

  it("titles a page that is a link by its file name, and never reads what the link points at", () => {
    const root = library();
    symlinkSync(outside("private.md", "---\ntitle: Something private\n---\n# Something private\n"), path.join(root, "ideas", "linked.md"));
    expect(pageInfo(root, "ideas/linked.md")).toEqual({ title: "linked", shelf: "ideas", path: "ideas/linked.md" });
    expect(filedPages(root, { created: ["ideas/linked.md"], modified: [] })).toEqual([{ title: "linked", shelf: "ideas", path: "ideas/linked.md", created: true }]);
  });
});
