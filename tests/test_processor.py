"""Tests for the spectral gate in processor.py. Needs numpy and scipy only (no pydub, no FFmpeg).

    python3 -m unittest discover -s tests
"""
import json
import os
import sys
import unittest

sys.dont_write_bytecode = True
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [ROOT, os.path.join(ROOT, 'scripts')]
import processor  # noqa: E402
import make_reference as ref  # noqa: E402


class SpectralGateTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.clean = ref.clean_signal()
        cls.noisy, _ = ref.mix(cls.clean, ref.noise_signal(len(cls.clean), 7, 'white'), 5.0)
        cls.gated = processor.spectral_gate(np.array(cls.noisy), ref.FS)

    def test_output_covers_input(self):
        # scipy pads to whole frames, so the output may be longer but never shorter
        self.assertGreaterEqual(len(self.gated), len(self.noisy))

    def test_gate_reduces_noise_and_raises_snr(self):
        m = ref.measure(self.clean, self.noisy, self.gated)
        self.assertLess(m['residual_noise_db'], -6)
        self.assertGreater(m['snr_out_db'], m['snr_in_db'] + 4)

    def test_silence_in_silence_out(self):
        out = processor.spectral_gate(np.zeros(ref.FS * 2), ref.FS)
        self.assertEqual(float(np.max(np.abs(out))), 0.0)

    def test_matches_committed_reference(self):
        # results/gate_reference.json is what the dashboard's JavaScript port is checked against
        with open(os.path.join(ROOT, 'results', 'gate_reference.json')) as f:
            want = json.load(f)
        self.assertEqual(len(self.gated), want['output_length'])
        got = self.gated[:: want['stride']]
        self.assertLess(float(np.max(np.abs(got - np.array(want['output_sampled'])))), 1e-8)


if __name__ == '__main__':
    unittest.main()
