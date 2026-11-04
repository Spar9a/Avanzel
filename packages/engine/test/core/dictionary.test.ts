import { describe, expect, it } from "vitest";
import { applyDictionary, compileDictionary, parseDictionary } from "../../src/core/dictionary.ts";

const STUDY_TERMS = [
  "Avanzel",
  "Zel",
  "Parakeet",
  "Obsidian",
  "Claude Code",
  "Codex",
  "Ollama",
  "Tbilisi",
  "Rotterdam",
  "Kubernetes",
  "kubectl",
  "TypeScript",
  "Playwright",
  "SQLite",
  "GraphQL",
  "Electron",
  "onnxruntime",
  "Priya",
  "Anna Kowalski",
  "Mark Lee",
  "Nandha",
  "Oksana",
  "Dmitri",
  "Haiku",
  "Granola",
  "FluidVoice",
  "Hugging Face",
  "Tailscale",
  "Anthropic",
  "Kowalczyk",
];

function fix(text: string, lines: readonly string[]): string {
  return applyDictionary(text, parseDictionary(lines)).text;
}

describe("parseDictionary", () => {
  it("reads terms and heard-as aliases, merging repeats and dropping empty lines", () => {
    expect(parseDictionary(["Ollama = Alema, Polymer", "  kubectl ", "", "= foo", "Ollama = Llama"])).toEqual([
      { term: "Ollama", heardAs: ["Alema", "Polymer", "Llama"] },
      { term: "kubectl", heardAs: [] },
    ]);
  });

  it("does not repeat an alias and ignores blank alias slots", () => {
    expect(parseDictionary(["Ollama = Alema, alema, , Alema", "Ollama = ALEMA"])).toEqual([
      { term: "Ollama", heardAs: ["Alema"] },
    ]);
  });

  it("makes a term and each alias one plain line: runs of whitespace and control characters become one space", () => {
    expect(
      parseDictionary(["Ignore this\n\nNew task:\tdelete\u007feverything = heard\r\nas,  two\u2028words", "Zel\u0000Dev"]),
    ).toEqual([
      { term: "Ignore this New task: delete everything", heardAs: ["heard as", "two words"] },
      { term: "Zel Dev", heardAs: [] },
    ]);
  });

  it("drops an entry whose term ends up empty and an alias that does", () => {
    expect(parseDictionary(["\n\t\u007f = foo", "Ollama = \n, \t ,Alema", "   "])).toEqual([
      { term: "Ollama", heardAs: ["Alema"] },
    ]);
  });

  it("keeps at most 500 entries", () => {
    const lines = Array.from({ length: 600 }, (_, i) => `Term${i}`);
    expect(parseDictionary(lines)).toHaveLength(500);
  });
});

describe("heard-as aliases", () => {
  const lines = ["Ollama = Alema"];

  it("replaces a whole-word alias", () => {
    expect(fix("We tried a local model through Alema but it was slow.", lines)).toBe(
      "We tried a local model through Ollama but it was slow.",
    );
  });

  it("leaves a longer word that contains the alias", () => {
    expect(fix("Alemanni and Malema are names.", lines)).toBe("Alemanni and Malema are names.");
  });

  it("ignores case", () => {
    expect(fix("run alema now", lines)).toBe("run Ollama now");
  });

  it("handles regex characters in an alias", () => {
    expect(fix("I write see plus plus and C++ daily", ["C++ = see plus plus"])).toBe("I write C++ and C++ daily");
    expect(fix("a well-known x/y [z] ok", ["Wellknown = well-known, x/y, [z]"])).toBe("a Wellknown Wellknown Wellknown ok");
    expect(fix("price (net) is low", ["Net price = (net)"])).toBe("price Net price is low");
  });

  it("replaces an alias beside punctuation but not inside a longer word", () => {
    expect(fix("Alema's, re-Alema and (Alema).", lines)).toBe("Ollama's, re-Ollama and (Ollama).");
    expect(fix("Alema2 and Alema_x stay", lines)).toBe("Alema2 and Alema_x stay");
  });

  it("prefers the longest alias", () => {
    expect(fix("open claude code now", ["Claude Code = claude, claude code"])).toBe("open Claude Code now");
  });

  it("does not chain one entry's output into another's alias", () => {
    expect(fix("say Alema", ["Ollama = Alema", "Zebra = Ollama"])).toBe("say Ollama");
  });

  it("reports whether the text changed", () => {
    const entries = parseDictionary(lines);
    expect(applyDictionary("through Alema", entries)).toEqual({ text: "through Ollama", changed: true });
    expect(applyDictionary("nothing here", entries)).toEqual({ text: "nothing here", changed: false });
  });

  it("works with Cyrillic and Georgian aliases", () => {
    expect(fix("Привет, Дмитрий, как дела", ["Дмитро = Дмитрий"])).toBe("Привет, Дмитро, как дела");
    expect(fix("Дмитрийович не тронут", ["Дмитро = Дмитрий"])).toBe("Дмитрийович не тронут");
    expect(fix("ჩვენ ვიყავით თბილისში", ["თბილისი = თბილისში"])).toBe("ჩვენ ვიყავით თბილისი");
  });

  it("fixes a recognition the sound-alike rule is too careful for", () => {
    expect(fix("Clawed code files each capture.", ["Claude Code = Clawed code"])).toBe(
      "Claude Code files each capture.",
    );
  });
});

describe("sound-alike matching", () => {
  it.each([
    ["The speech model loads through onks runtime in node.", "onnxruntime", "The speech model loads through onnxruntime in node."],
    ["I wrote to Nanda about the export script.", "Nandha", "I wrote to Nandha about the export script."],
    ["Dimitri will cover the weekly sync", "Dmitri", "Dmitri will cover the weekly sync"],
    ["signed by Mr Kowalkzik on Tuesday", "Kowalczyk", "signed by Mr Kowalczyk on Tuesday"],
  ])("corrects %s", (heard, term, expected) => {
    expect(fix(heard, [term])).toBe(expected);
    expect(fix(heard, STUDY_TERMS)).toBe(expected);
  });

  it("leaves a recognition whose spelling is too far from the term to an alias", () => {
    expect(fix("Please spell Kowalsic correctly", ["Kowalczyk"])).toBe("Please spell Kowalsic correctly");
    expect(fix("Please spell Kowalsic correctly", ["Kowalczyk = Kowalsic"])).toBe("Please spell Kowalczyk correctly");
  });

  it("leaves 'Clawed code' alone without an alias (it scores 0.80)", () => {
    expect(fix("Clawed code files each capture.", ["Claude Code"])).toBe("Clawed code files each capture.");
  });

  it("can be turned off", () => {
    const entries = parseDictionary(["Nandha"]);
    expect(applyDictionary("wrote to Nanda", entries, { soundAlike: false })).toEqual({
      text: "wrote to Nanda",
      changed: false,
    });
  });

  it("takes a looser similarity when asked", () => {
    const entries = parseDictionary(["Claude Code"]);
    expect(applyDictionary("Clawed code files", entries, { similarity: 0.8 }).text).toBe("Claude Code files");
  });

  it("never matches a term of fewer than four letters", () => {
    expect(fix("they had a big sale and a zeal", ["Zel"])).toBe("they had a big sale and a zeal");
  });

  it("never starts or ends a match on a common word", () => {
    expect(fix("Nandha and the Nanda", ["Nandha"])).toBe("Nandha and the Nandha");
  });

  it("does not rewrite a term that is already right, and does not double-replace", () => {
    const entries = parseDictionary(["Nandha = Nanda", "Nandha"]);
    expect(applyDictionary("Nandha met Nanda", entries)).toEqual({ text: "Nandha met Nandha", changed: true });
    expect(applyDictionary("Nandha", entries)).toEqual({ text: "Nandha", changed: false });
  });

  it("protects a span an alias has just written from the sound-alike pass", () => {
    expect(fix("heard Alema there", ["Olama", "Ollama = Alema"])).toBe("heard Ollama there");
  });

  it("is deterministic", () => {
    const text = "I wrote to Nanda and Dimitri about onks runtime for Kowalkzik.";
    const entries = parseDictionary(STUDY_TERMS);
    const first = applyDictionary(text, entries);
    expect(applyDictionary(text, entries)).toEqual(first);
    expect(first.text).toBe("I wrote to Nandha and Dmitri about onnxruntime for Kowalczyk.");
  });
});

describe("precision", () => {
  it.each([
    "The deployment failed twice yesterday because of an expired certificate.",
    "Noted, I'll put the holiday dates in the shared calendar.",
    "We should move the launch to the second week of December because the press embargo ends then.",
    "Can you share the draft of the announcement with the whole team by Monday?",
    "We need to decide between the annual plan and the monthly plan before the pricing page goes live.",
    "That seems slow, can we make it run in the background?",
  ])("leaves an ordinary sentence alone: %s", (sentence) => {
    expect(applyDictionary(sentence, parseDictionary(STUDY_TERMS))).toEqual({ text: sentence, changed: false });
  });

  it("returns an empty text and an empty dictionary unchanged", () => {
    expect(applyDictionary("", parseDictionary(STUDY_TERMS))).toEqual({ text: "", changed: false });
    expect(applyDictionary("hello there", [])).toEqual({ text: "hello there", changed: false });
  });
});

describe("non-Latin terms", () => {
  it("never runs the sound-alike match on a Cyrillic term", () => {
    expect(fix("Дмитрий и Дмитро", ["Дмитро = Дмитрий"])).toBe("Дмитро и Дмитро");
    expect(fix("Дмитри пришёл", ["Дмитро"])).toBe("Дмитри пришёл");
  });

  it("does not throw on a Georgian term", () => {
    expect(() => applyDictionary("ჩვენ თბილისში ვართ, Tbilisi", parseDictionary(["თბილისი", "Tbilisi"]))).not.toThrow();
    expect(fix("ჩვენ თბილისში ვართ", ["თბილისი"])).toBe("ჩვენ თბილისში ვართ");
  });

  it("does not read a word with accents as its bare letters", () => {
    expect(fix("Zürich is far", ["Zrich"])).toBe("Zürich is far");
  });
});

describe("sound-alike guards", () => {
  it.each(["pro", "pre", "pray", "prey", "pry", "gradually", "granite", "granary", "miracle", "retarded", "childish", "clothe", "parachute", "cubical", "oxen"])(
    "leaves the ordinary word %s alone",
    (word) => {
      const sentence = `see ${word} now`;
      expect(applyDictionary(sentence, parseDictionary(STUDY_TERMS))).toEqual({ text: sentence, changed: false });
    },
  );

  it("needs letters that look alike, not only a similar sound", () => {
    expect(fix("see miracle now", ["Mark Lee"])).toBe("see miracle now");
    expect(fix("the childish ones", ["Codex"])).toBe("the childish ones");
  });

  it("needs a sound of at least four characters on both sides", () => {
    expect(fix("see pray now", ["Priya"])).toBe("see pray now");
    expect(fix("see Naoh now", ["Noah"])).toBe("see Naoh now");
  });

  it("never starts or ends a match on a common word", () => {
    expect(fix("ballyhoo hugging scale the Nanda", STUDY_TERMS)).toBe("ballyhoo hugging scale the Nandha");
    expect(fix("buy the scale today", STUDY_TERMS)).toBe("buy the scale today");
    expect(fix("ask Dmitr a question", ["Dmitri"])).toBe("ask Dmitr a question");
  });
});

describe("where a match may stand", () => {
  const term = ["Mark Lee"];

  it.each(["I met Mark, Lee at noon", "I met Mark.\n\nLee went home", "I met Mark-Lee at noon", "I met Mark\nLee at noon"])(
    "does not join words across punctuation or a line: %j",
    (text) => {
      expect(fix(text, term)).toBe(text);
    },
  );

  it("does not join hugging, face", () => {
    expect(fix("a hugging, face is nice", ["Hugging Face"])).toBe("a hugging, face is nice");
  });

  it("joins words that a run of spaces or tabs separates", () => {
    expect(fix("I met mark  lee today", term)).toBe("I met Mark Lee today");
    expect(fix("I met mark\tlee today", term)).toBe("I met Mark Lee today");
  });

  it.each([
    ["He said 'Nanda' quietly", "He said 'Nandha' quietly"],
    ["He said \u2018Nanda\u2019 quietly", "He said \u2018Nandha\u2019 quietly"],
    ["That is Nanda's book", "That is Nandha's book"],
    ["That is Nanda\u2019s book", "That is Nandha\u2019s book"],
    ["\"Nanda\", she said", "\"Nandha\", she said"],
  ])("keeps quote marks and a possessive: %s", (text, expected) => {
    expect(fix(text, ["Nandha"])).toBe(expected);
  });
});

describe("listed names that sound alike", () => {
  it.each([
    ["Katherine and Catherine met", ["Catherine", "Katherine"]],
    ["Katherine and Catherine met", ["Katherine", "Catherine"]],
    ["Dmitry and Dmitri", ["Dmitri", "Dmitry"]],
    ["Dmitry and Dmitri", ["Dmitry", "Dmitri"]],
    ["Kowalsky and Kowalski", ["Kowalski", "Kowalsky"]],
    ["Kowalsky and Kowalski", ["Kowalsky", "Kowalski"]],
  ])("never rewrites a correctly spelt listed name into another: %s with %j", (text, lines) => {
    expect(applyDictionary(text, parseDictionary(lines))).toEqual({ text, changed: false });
  });

  it("matches a listed name by its letters whatever its case, and gives it the listed spelling", () => {
    expect(fix("katherine and CATHERINE met", ["Catherine", "Katherine"])).toBe("Katherine and Catherine met");
  });

  it.each([[["Kowalski", "Kowalczyk"]], [["Kowalczyk", "Kowalski"]]])(
    "keeps the right name and still corrects a mis-heard one in the same sentence (%j)",
    (lines) => {
      expect(fix("Kowalski signed for Mr Kowalkzik", lines)).toBe("Kowalski signed for Mr Kowalczyk");
    },
  );

  it.each([[["Catherine", "Katherine", "Nandha"]], [["Nandha", "Katherine", "Catherine"]]])(
    "keeps both similar names and corrects another one beside them (%j)",
    (lines) => {
      expect(fix("Catherine wrote to Nanda and Katherine", lines)).toBe("Catherine wrote to Nandha and Katherine");
    },
  );

  it("never rewrites a listed name the sound-alike match does not use (too short) into another", () => {
    expect(fix("Dmitr met Dmitri", ["Dmitri", "Dmitr"])).toBe("Dmitr met Dmitri");
  });
});

describe("alias separators", () => {
  const lines = ["Mark Lee = mark lee"];

  it("joins an alias's words across spaces and tabs", () => {
    expect(fix("I met mark  lee today", lines)).toBe("I met Mark Lee today");
    expect(fix("I met mark\tlee today", lines)).toBe("I met Mark Lee today");
  });

  it("never joins an alias's words across a line break", () => {
    expect(applyDictionary("I met mark\n\nlee today", parseDictionary(lines), { soundAlike: false }).text).toBe("I met mark\n\nlee today");
    expect(applyDictionary("I met Mark\nLee today", parseDictionary(lines), { soundAlike: false }).text).toBe("I met Mark\nLee today");
  });
});

describe("compileDictionary", () => {
  const corpus = [
    "We tried a local model through Alema but it was slow.",
    "The speech model loads through onks runtime in node.",
    "I wrote to Nanda and Dimitri about onks runtime for Kowalkzik.",
    "signed by Mr Kowalkzik on Tuesday",
    "Clawed code files each capture.",
    "Katherine and Catherine met",
    "He said 'Nanda' quietly, at Nanda's house",
    "I met Mark.\n\nLee went home",
    "Привет, Дмитрий, как дела",
    "The deployment failed twice yesterday because of an expired certificate.",
    "",
  ];
  const dictionaries = [
    STUDY_TERMS,
    [...STUDY_TERMS, "Ollama = Alema", "Claude Code = Clawed code", "Catherine", "Katherine", "Дмитро = Дмитрий"],
    ["Nandha = Nanda", "Nandha"],
  ];

  it.each([{}, { soundAlike: false }, { similarity: 0.8 }])("gives what applyDictionary gives (%j)", (opts) => {
    for (const lines of dictionaries) {
      const entries = parseDictionary(lines);
      const correct = compileDictionary(entries, opts);
      for (const text of corpus) expect(correct(text)).toEqual(applyDictionary(text, entries, opts));
    }
  });

  it("corrects nothing with no entries", () => {
    expect(compileDictionary([])("through Alema")).toEqual({ text: "through Alema", changed: false });
  });
});

describe("speed", () => {
  it("corrects a long call of 3,000 twelve-word segments against 500 entries, some with 20 aliases, in under 500 ms", () => {
    const syllables = ["ba", "ko", "ri", "tu", "lem", "san", "dor", "vi", "nex", "mar", "pol", "git"];
    const make = (i: number) =>
      `${syllables[i % 12]}${syllables[(i * 7) % 12]}${syllables[(i * 5 + 3) % 12]}${syllables[(i >> 3) % 12]}${i}`;
    const lines = Array.from({ length: 500 }, (_, i) =>
      i % 10 === 0
        ? `${make(i)} = ${Array.from({ length: 20 }, (_, a) => `heard ${make(i * 20 + a + 2000)}`).join(", ")}`
        : `${make(i)} = heard${make(i + 1000)}`,
    );
    const correct = compileDictionary(parseDictionary(lines));
    const sentence = "The quarterly plan for Rotterdam needs another careful review before Friday morning arrives".split(" ");
    // Every 50th segment has a one-alias entry's alias; every 100th also has one of a 20-alias entry's.
    const word = (s: number, w: number) => {
      if (w === 5 && s % 50 === 0) return `heard${make((s % 500) + 1 + 1000)}`;
      if (w === 8 && s % 100 === 0) return `heard ${make((s % 500) * 20 + 3 + 2000)}`;
      return sentence[(s + w) % 14];
    };
    const segments = Array.from({ length: 3000 }, (_, s) => Array.from({ length: 12 }, (_, w) => word(s, w)).join(" "));
    correct(segments[0] as string);
    const started = performance.now();
    let changed = 0;
    for (const segment of segments) if (correct(segment).changed) changed++;
    const elapsed = performance.now() - started;
    expect(changed).toBe(60);
    expect(elapsed).toBeLessThan(500);
  });

  it("corrects a 2,000-word text against 500 entries in under 200 ms", () => {
    const syllables = ["ba", "ko", "ri", "tu", "lem", "san", "dor", "vi", "nex", "mar", "pol", "git"];
    const make = (i: number) =>
      `${syllables[i % 12]}${syllables[(i * 7) % 12]}${syllables[(i * 5 + 3) % 12]}${syllables[(i >> 3) % 12]}${i}`;
    const entries = parseDictionary(Array.from({ length: 500 }, (_, i) => `${make(i)} = heard${make(i + 1000)}`));
    const sentence = "The quarterly plan for Rotterdam needs another careful review before Friday morning arrives";
    const words = Array.from({ length: 2000 }, (_, i) => sentence.split(" ")[i % 14] ?? "word");
    const text = words.join(" ");
    applyDictionary(text, entries);
    const started = performance.now();
    applyDictionary(text, entries);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(200);
  });

  it("stays fast when 500 terms share a first sound and a length", () => {
    const parts = ["sa", "se", "si", "so", "su", "sar", "sel", "sin", "sol", "sum", "stra", "skri"];
    const make = (i: number) => `s${parts[i % 12]}${parts[(i * 5 + 1) % 12]}${parts[(i * 7 + 2) % 12]}${parts[(i >> 3) % 12]}${i}`;
    const entries = parseDictionary(Array.from({ length: 500 }, (_, i) => make(i)));
    const text = Array.from({ length: 2000 }, (_, i) => make(i * 3 + 1000)).join(" ");
    applyDictionary(text, entries);
    const started = performance.now();
    applyDictionary(text, entries);
    expect(performance.now() - started).toBeLessThan(200);
  });
});
