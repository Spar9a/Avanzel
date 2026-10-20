"""Writes resample-44100.f32 and resample-48000.f32: a test signal resampled to 16 kHz by onnx-asr 0.12.0 itself.

The signal is 0.5 s of 0.5·sin(2π·440·t) + 0.25·sin(2π·5000·t) as float32; each file holds the resampled samples
as little-endian float32. resample.test.ts builds the same signal and expects resampleTo16k to match them.
Run from the repo root (the v0.1 virtualenv has onnx-asr 0.12.0):

    uv run python -I packages/engine/test/voice/fixtures/make-resample-fixtures.py
"""

from pathlib import Path

import numpy as np
import onnxruntime as rt
from onnx_asr.preprocessors.resampler import Resampler

# The session options of Avanzel's engine (src/voice/onnx.ts).
options = rt.SessionOptions()
options.intra_op_num_threads = 4
options.log_severity_level = 3
resampler = Resampler(16_000, {"sess_options": options, "providers": ["CPUExecutionProvider"]})

for rate in (44_100, 48_000):
    t = np.arange(rate // 2) / rate
    signal = (0.5 * np.sin(2 * np.pi * 440 * t) + 0.25 * np.sin(2 * np.pi * 5000 * t)).astype(np.float32)
    resampled, lens = resampler(signal[None, :], np.array([signal.size], dtype=np.int64), rate)
    resampled[0, : lens[0]].astype("<f4").tofile(Path(__file__).with_name(f"resample-{rate}.f32"))
