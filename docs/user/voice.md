# Voice

| Model (`[voice] model = …`) | Languages | Notes |
|---|---|---|
| `nemo-parakeet-tdt-0.6b-v3` | 25 European languages, incl. English, Russian, Ukrainian | default, int8 ≈ 670 MB |
| `nemo-parakeet-tdt-0.6b-v2` | English | |
| `onnx-community/whisper-large-v3-turbo` | ~100 languages | |
| `whisper-base` | many | small and fast |
| `gigaam-v3-rnnt` | Russian | |

Long recordings are split with the Silero VAD. Prefer another engine (whisper.cpp, mlx-whisper)?
Use the command backend:

```toml
[voice]
backend = "command"
command = ["whisper-cli", "-m", "/path/to/ggml-large-v3-turbo.bin", "-nt", "-f", "{audio}"]
```
