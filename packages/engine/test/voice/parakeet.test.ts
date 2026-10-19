import { describe, expect, it } from "vitest";
import { AvanzelError } from "../../src/types.ts";
import { decodeTokens, greedyTdt, parseVocab } from "../../src/voice/parakeet.ts";

describe("decodeTokens", () => {
  // Expected strings were produced by onnx-asr's own `re.sub(r"\A\s|\s\B|(\s)\b", …)` in Python.
  const cases: [string[], string][] = [
    [[" I", " want", " to", " la", "unch", " my", " pod", "cast", "."], "I want to launch my podcast."],
    [[" Hello", " ,", " world", " !"], "Hello, world!"],
    [[" Иде", "я", ":", " сделать", " сад", "."], "Идея: сделать сад."],
    [[" Встре", "ча", " в", " 10", " утра", "."], "Встреча в 10 утра."],
    [[" at", " 3", " p", ".", "m", ".,", " and", " book"], "at 3 p.m., and book"],
    [[" 12", "%", " growth"], "12% growth"],
    [[" don", "'", "t", " stop"], "don't stop"],
    [[" snake", "_", "case", " _", "x"], "snake_case _x"],
    [[" x", " ²", " y", " ½", " Ⅻ"], "x ² y ½ Ⅻ"],
    [[" a", " ́", "b"], "áb"],
    [[" end", " "], "end"],
    [["  double", "  space"], " double space"],
    [[" «", "Привет", "»", " —", " сказал", " он"], "«Привет»— сказал он"],
    [[" 中", "文", " 字"], "中文 字"],
    [[], ""],
  ];

  it.each(cases)("decodes %j like onnx-asr", (pieces, expected) => {
    expect(decodeTokens(pieces)).toBe(expected);
  });
});

describe("parseVocab", () => {
  it("maps ids to tokens with ▁ as a space and finds <blk>", () => {
    const vocab = parseVocab("<unk> 0\n▁the 1\n▁при 2\ns 3\n<blk> 4\n");
    expect(vocab.tokens).toEqual(["<unk>", " the", " при", "s", "<blk>"]);
    expect(vocab.blank).toBe(4);
  });

  it("accepts CRLF line endings and ids out of order", () => {
    const vocab = parseVocab("<blk> 2\r\n▁a 0\r\nb 1\r\n");
    expect(vocab.tokens).toEqual([" a", "b", "<blk>"]);
    expect(vocab.blank).toBe(2);
  });

  it("rejects a vocabulary without <blk>", () => {
    expect(() => parseVocab("a 0\nb 1\n")).toThrow(AvanzelError);
  });
});

describe("greedyTdt", () => {
  const vocabSize = 4;
  const blank = 3;

  /** Logits that pick `token` and duration index `duration` (durations 0..4). */
  function logits(token: number, duration: number): Float32Array {
    const out = new Float32Array(vocabSize + 5);
    out[token] = 1;
    out[vocabSize + duration] = 1;
    return out;
  }

  function scripted(steps: [token: number, duration: number][]) {
    const calls: { t: number; prev: number; state: number }[] = [];
    let call = 0;
    const joint = async (t: number, prev: number, state: number) => {
      calls.push({ t, prev, state });
      const [token, duration] = steps[call] ?? [blank, 1];
      call += 1;
      return { logits: logits(token, duration), state: 100 + call };
    };
    return { calls, joint };
  }

  it("emits tokens, advances by the predicted duration and keeps state on blanks", async () => {
    const { calls, joint } = scripted([
      [0, 0], // t=0: token 0, stay on the frame
      [blank, 0], // t=0: blank, move on by one frame
      [1, 2], // t=1: token 1, skip two frames
      [2, 0], // t=3: token 2, stay
      [blank, 1], // t=3: blank -> done
    ]);
    const tokens = await greedyTdt(4, 0, joint, { vocabSize, blank, maxTokensPerStep: 10 });
    expect(tokens).toEqual([0, 1, 2]);
    expect(calls).toEqual([
      { t: 0, prev: blank, state: 0 },
      { t: 0, prev: 0, state: 101 },
      { t: 1, prev: 0, state: 101 },
      { t: 3, prev: 1, state: 103 },
      { t: 3, prev: 2, state: 104 },
    ]);
  });

  it("moves on after maxTokensPerStep tokens on one frame", async () => {
    const { calls, joint } = scripted(Array.from({ length: 6 }, () => [1, 0] as [number, number]));
    const tokens = await greedyTdt(2, 0, joint, { vocabSize, blank, maxTokensPerStep: 3 });
    expect(tokens).toEqual([1, 1, 1, 1, 1, 1]);
    expect(calls.map((c) => c.t)).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it("lets a blank skip several frames when its duration says so", async () => {
    const { calls, joint } = scripted([[blank, 3], [0, 1]]);
    expect(await greedyTdt(4, 0, joint, { vocabSize, blank, maxTokensPerStep: 10 })).toEqual([0]);
    expect(calls.map((c) => c.t)).toEqual([0, 3]);
  });

  it("takes the first index on ties, like numpy argmax", async () => {
    const joint = async () => ({ logits: new Float32Array(vocabSize + 5), state: 0 });
    // All-zero logits: token 0 (not blank) with duration 0, until maxTokensPerStep moves the frame on.
    expect(await greedyTdt(1, 0, joint, { vocabSize, blank, maxTokensPerStep: 2 })).toEqual([0, 0]);
  });

  it("returns nothing for zero frames", async () => {
    const { calls, joint } = scripted([]);
    expect(await greedyTdt(0, 0, joint, { vocabSize, blank, maxTokensPerStep: 10 })).toEqual([]);
    expect(calls).toEqual([]);
  });
});
