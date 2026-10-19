# Third-party files

## nemo128.onnx

The NeMo 128-bin log-mel feature preprocessor from **onnx-asr 0.12.0** by Ilya Stupakov
(<https://github.com/istupakov/onnx-asr>), copied unchanged from the package's
`onnx_asr/preprocessors/data/nemo128.onnx` (138,824 bytes, sha256
`5b4a84c52eeaa615dc46d781cc7e4598f9b432184831d57493c48adcd01371a9`).

Avanzel's Parakeet transcriber (`src/voice/parakeet.ts`) runs it to compute the same features as
Avanzel v0.1. The `nemo128.onnx` in the Parakeet model repos on Hugging Face is an older export and
is not used.

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
