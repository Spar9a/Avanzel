# Third-party files

## nemo128.onnx

The NeMo 128-bin log-mel feature preprocessor from **onnx-asr 0.12.0** by Ilya Stupakov
(<https://github.com/istupakov/onnx-asr>), copied unchanged from the package's
`onnx_asr/preprocessors/data/nemo128.onnx` (138,824 bytes, sha256
`5b4a84c52eeaa615dc46d781cc7e4598f9b432184831d57493c48adcd01371a9`).

Avanzel's Parakeet transcriber (`src/voice/parakeet.ts`) runs it to compute the same features as
Avanzel v0.1. The `nemo128.onnx` in the Parakeet model repos on Hugging Face is an older export and
is not used.

## resample_{8,11,22,24,32,44,48}_16.onnx

The band-limited resamplers to 16 kHz from **onnx-asr 0.12.0**, for audio at 8, 11.025, 22.05, 24,
32, 44.1 and 48 kHz, copied unchanged from the package's `onnx_asr/preprocessors/data/`:

| file | bytes | sha256 |
|---|---|---|
| `resample_8_16.onnx` | 3,727 | `5aaaef8508880c639ccc4bcd2662a894c9015ddfff22b6c352ee33e03b8c2414` |
| `resample_11_16.onnx` | 10,040 | `f2e90792f65753b0b79ec73829f21352b230a8fa06f3c115dce3feba2ec3d46c` |
| `resample_22_16.onnx` | 8,776 | `09e29ba5d6c21fc2df326b6103db824d6e50f5ba392f9816650d97899d48817b` |
| `resample_24_16.onnx` | 4,029 | `6e924a97e41ef3ceac2e0f80a8d834ade1049d1fa8b2a8e5c31f925031f475b9` |
| `resample_32_16.onnx` | 3,705 | `aa0624578edd8730d5dbc9eeff573f477f32dfd2c8b4f70242cf4ee4f03c6a40` |
| `resample_44_16.onnx` | 8,200 | `edce58a900588cf95b0e853511fbfc32ad88264a2f32e0787b3d29d75987f0eb` |
| `resample_48_16.onnx` | 3,758 | `25791c6e65504d7be9717dd814937d2e757b7b49a1ef51da32cfb1fa6627264d` |

`src/voice/resample.ts` runs them so audio at those rates reaches 16 kHz exactly as it does in
onnx-asr, and so in Avanzel v0.1. Audio at any other rate goes through ffmpeg.

## onnx-asr's license

onnx-asr is distributed under the MIT License:

```text
MIT License

Copyright (c) 2025 Ilya Stupakov

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
