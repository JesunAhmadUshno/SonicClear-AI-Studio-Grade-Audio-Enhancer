"""Tests for process_audio in processor.py. Needs pydub (WAV input only, export is captured, so no FFmpeg).

    python3 -m unittest discover -s tests
"""
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.dont_write_bytecode = True
import numpy as np
import scipy.io.wavfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import processor  # noqa: E402

SR = 44100


def run(samples_int16, options):
    """Write a WAV, run process_audio on it and return the AudioSegment it would export."""
    from pydub import AudioSegment
    captured = {}
    with tempfile.TemporaryDirectory() as d:
        src = os.path.join(d, 'in.wav')
        scipy.io.wavfile.write(src, SR, samples_int16)
        with mock.patch.object(AudioSegment, 'export', lambda seg, *a, **k: captured.setdefault('seg', seg)):
            processor.process_audio(src, os.path.join(d, 'out.mp3'), options)
    return captured['seg']


def to_int16(x):
    return (np.clip(x, -1, 1) * 32767).astype(np.int16)


class ProcessAudioTest(unittest.TestCase):
    def test_loud_denoised_output_saturates_instead_of_wrapping(self):
        r = np.random.default_rng(0)
        t = np.arange(2 * SR) / SR
        x = np.concatenate([0.01 * r.standard_normal(SR), 0.99 * np.sign(np.sin(2 * np.pi * 200 * t))])
        gated = processor.spectral_gate(to_int16(x).astype(np.float32) / 32767, SR)
        self.assertGreater(np.max(np.abs(gated)), 1.0)  # the gate does overshoot full scale here
        out = np.array(run(to_int16(x), {'denoise': 'true'}).get_array_of_samples())
        # a sample the gate made loud must keep its sign, not flip to the opposite extreme
        self.assertFalse(np.any((gated > 0.5) & (out < 0)))
        self.assertFalse(np.any((gated < -0.5) & (out > 0)))


if __name__ == '__main__':
    unittest.main()
