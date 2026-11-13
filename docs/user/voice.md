# Voice

Settings → Voice → Choose a model sets the library's speech model. Each runs on the Mac (int8, ONNX Runtime); one that
isn't on the Mac yet downloads first, while the model in use goes on hearing.

| Model (`[voice] model = …`) | Name | Languages | Size |
|---|---|---|---|
| `nemo-parakeet-tdt-0.6b-v3` | NVIDIA Parakeet TDT 0.6B v3 (default) | 25 European languages, incl. English, Russian, Ukrainian | 670 MB |
| `moondream-parakeet-ultra-0.6b` | Moondream Parakeet Ultra 0.6B, a post-training of v3 | the same 25 | 670 MB |
| `nemo-parakeet-tdt-0.6b-v2` | NVIDIA Parakeet TDT 0.6B v2 | English only: never writes another alphabet | 661 MB |

All three are CC-BY-4.0. Parakeet v2 and v3 are [NVIDIA's](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3);
Parakeet Ultra is [Moondream's](https://huggingface.co/moondream/parakeet-ultra), in the ONNX export of
[Masterx/parakeet-tdt-0.6b-ultra-onnx](https://huggingface.co/Masterx/parakeet-tdt-0.6b-ultra-onnx). Every file is
pinned to a commit and checked against its SHA-256.

Recordings longer than 25 s are cut at pauses with the Silero VAD, and heard in pieces of up to 25 s. Prefer another engine (whisper.cpp, mlx-whisper)?
Use the command backend:

```toml
[voice]
backend = "command"
command = ["whisper-cli", "-m", "/path/to/ggml-large-v3-turbo.bin", "-nt", "-f", "{audio}"]
```
