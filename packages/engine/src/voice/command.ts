// Any local speech-to-text CLI (whisper.cpp, mlx-whisper, …) as a transcriber: `{audio}` in its argv
// becomes the path of a 16 kHz mono PCM16 WAV, and its stdout is the text.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { AvanzelError, type Transcriber, type Transcript } from "../types.ts";
import { resampleTo16k } from "./resample.ts";
import { loadAudio, readWav, runCommand, SAMPLE_RATE, writeWav } from "./wav.ts";

export class CommandTranscriber implements Transcriber {
  readonly engine: string;
  readonly #argv: readonly string[];

  constructor(argv: readonly string[]) {
    if (argv.length === 0) {
      throw new AvanzelError(
        'voice.backend = "command" needs voice.command, e.g. ["whisper-cli", "-m", "<model>", "-nt", "-f", "{audio}"].',
      );
    }
    this.#argv = [...argv];
    this.engine = `command:${basename(argv[0]!)}`;
  }

  async transcribe(audio: string | Float32Array, sampleRate = SAMPLE_RATE): Promise<Transcript> {
    const dir = mkdtempSync(join(tmpdir(), "avanzel-audio-"));
    try {
      const { path, seconds } = await pcm16Wav(audio, sampleRate, dir);
      // A replacer function: given a string, `replaceAll` would read `$&`, `$$` or `$'` in the path as patterns.
      const [command, ...args] = this.#argv.map((part) => part.replaceAll("{audio}", () => path)) as [string, ...string[]];
      let result: Awaited<ReturnType<typeof runCommand>>;
      try {
        result = await runCommand(command, args);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new AvanzelError(`Speech-to-text command \`${command}\` is not on your PATH.`);
        }
        throw error;
      }
      if (result.code !== 0) throw new AvanzelError(`\`${command}\` failed: ${(result.stderr || result.stdout).trim().slice(-400)}`);
      return { text: result.stdout.split(/\s+/).filter(Boolean).join(" "), engine: this.engine, seconds };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /** Nothing to free: each transcription starts the command anew. */
  async release(): Promise<void> {}
}

/** `audio` as a 16 kHz mono PCM16 WAV: the file itself when it already is one, else a converted copy in `dir`. */
async function pcm16Wav(audio: string | Float32Array, sampleRate: number, dir: string): Promise<{ path: string; seconds: number }> {
  let samples: Float32Array;
  let seconds: number;
  if (typeof audio === "string") {
    const wav = readPcmWav(audio);
    if (wav && wav.sampleRate === SAMPLE_RATE && wav.channels === 1 && wav.bitsPerSample === 16) {
      return { path: audio, seconds: wav.samples.length / SAMPLE_RATE };
    }
    ({ samples, seconds } = await loadAudio(audio));
  } else {
    samples = await resampleTo16k(audio, sampleRate);
    seconds = audio.length / sampleRate;
  }
  const path = join(dir, "audio.wav");
  writeWav(path, samples);
  return { path, seconds };
}

function readPcmWav(path: string) {
  try {
    return readWav(path);
  } catch {
    return null;
  }
}
