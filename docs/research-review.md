# Research and engineering review

Reviewed 7 November 2026 against a PhD-level rubric for an engineering artifact. SonicClear is a
product app (a Flask front end over a classical DSP chain), so the rubric weighs engineering rigor
alongside research method. Grades: A strong, B adequate, C weak pass, D missing or wrong.

**Overall: C+ (was C).** A clear, working prototype with a sensible three-stage chain. This pass
added the first tests, a known-answer reference for every stage, a synthetic-signal SNR measurement
with seed variance, and corrected documentation. It still has no speech-quality evaluation and no
baselines, so it cannot claim it makes speech better, only that it removes stationary noise on a
synthetic signal.

## Rubric

| Criterion | Grade | Evidence and what changed |
| :--- | :---: | :--- |
| Question | C | Implicit: "can a simple spectral gate + compressor + EQ clean up spoken audio?" Never stated or bounded (which noise types, which SNRs, which use case). |
| Hypotheses | D | None. A testable one would be: "at 0 to 10 dB input SNR on stationary noise, the chain raises PESQ by at least X over the unprocessed input and is within Y of noisereduce." |
| Method | B- | The chain is standard and now documented exactly: STFT gate (Hann, 1024, 50% overlap, threshold 2.0x mean noise magnitude over the first 1 s, floor 0.1), pydub compressor (-20 dBFS, 4:1, 5/50 ms), one-pole 250 Hz low-pass at +4 dB summed with the dry signal. Constants now live in one place in `processor.py`. |
| Baselines | D | No comparison with the unprocessed input under a quality metric, nor with noisereduce, RNNoise or DeepFilterNet. |
| Statistics and uncertainty | C | New: `results/gate_snr.json` reports true SNR in/out at 0, 5, 10 dB for white and pink noise, mean and SD over 10 noise seeds. Variation is over noise draws only, on one synthetic clean signal; no confidence intervals over signals or speakers. |
| Reproducibility | B | New: `scripts/make_reference.py` regenerates every number from seeded inputs (numpy 2.4.5, scipy 1.17.1, pydub 0.25.1 recorded in the JSON). The site build fails unless its JavaScript port reproduces those files. Gaps: `requirements.txt` is unpinned; the full file pipeline needs FFmpeg and was not run here. |
| Threats to validity | C | Now listed on the dashboard and below. The main one: the SNR test signal is harmonic bursts, not speech, and the noise is stationary. |
| Related work | D | None cited. Should place the gate against spectral subtraction (Boll 1979), Wiener filtering and decision-directed estimation (Ephraim and Malah 1984), and modern learned denoisers (RNNoise, DeepFilterNet). |
| Limitations | B- | Now explicit in the README and dashboard: no speech-quality score, no baselines, speech-free first second assumed, hard mask causes musical noise. |
| Engineering rigor | C | New: unittest suite (4 tests), CI workflow, `.gitignore`, behaviour-preserving refactor so the DSP imports without pydub. Open issues below. |

## Findings fixed in this pass (cheap)

1. **README contradicted the code.** It promised "+4 dB above 6 kHz"; the code has no treble path.
   The EQ line `low_pass_filter(250).apply_gain(4).overlay(audio)` adds a +4 dB low-passed copy to the
   dry signal, which is about +8.25 dB at DC (analytic) and +0.25 dB at 6 kHz (pydub, measured on
   tones at 48 kHz). README corrected; the dashboard plots both curves.
2. **Undocumented gate threshold** (2.0x mean noise magnitude). Now in the README and `results/params.json`.
3. **"Quiet speech gets lifted"** was wrong: pydub's compressor only attenuates and the chain has no
   make-up gain. README corrected.
4. **No tests, no CI, no reference values.** Added `tests/test_processor.py`, `.github/workflows/tests.yml`,
   `scripts/make_reference.py` and `results/*.json`.
5. **No measurement at all.** Added the synthetic-signal SNR table (labelled as synthetic, not PESQ).
6. **Missing LICENSE** while the README claimed MIT. Now stated plainly in the README; adding a
   licence is an owner decision.
7. **No `.gitignore`.** Added. The already committed `__pycache__/processor.cpython-312.pyc` was left
   in place; removing tracked files needs owner sign-off.

## Findings left for the owner (they change app behaviour)

- **int16 wrap-around:** fixed, the gate output is clipped to [-1, 1] before the int16 cast, so samples
  beyond full scale saturate instead of wrapping to the opposite sign (tests/test_process_audio.py).
- **Path traversal on upload:** fixed, the client filename now goes through `werkzeug.utils.secure_filename`
  (tests/test_app.py). Still open: `MAX_CONTENT_LENGTH`, and `debug=False` outside localhost.
- **Stereo collapse:** fixed, the gate now runs on each channel and keeps the channel count
  (tests/test_process_audio.py). Output is still 16-bit. Non-16-bit input is rescaled by its own dtype but written as int16.
- **Musical noise:** hard binary mask, fixed floor, no smoothing across time or frequency.
- **Naming:** the repo name says "AI", but nothing is learned. The dashboard says so.
- **Recorded sample provenance:** `uploads/EP1.mp4` and `uploads/processed_EP1.mp3` have no recorded
  settings, speaker or consent note.

## Remaining gaps and the exact compute or data each needs

| Gap | What closes it | Cost |
| :--- | :--- | :--- |
| Speech-quality evaluation | A fixed public set of paired clean/noisy speech, e.g. the VoiceBank-DEMAND test set (824 utterances). Score input vs output with PESQ (`pesq` package) and STOI (`pystoi`), report mean and bootstrap 95% CI. | CPU only; FFmpeg not required if the gate is called on WAV arrays directly. Minutes on one core. |
| Baselines | Same set through `noisereduce` (stationary mode), RNNoise and DeepFilterNet 3. | CPU minutes for the first two; DeepFilterNet also runs on CPU (no GPU required for 824 short files). |
| Per-stage ablation | Score gate only, gate + compressor, full chain. Needs pydub + FFmpeg installed to run `process_audio` end to end. | CPU minutes. |
| Perceptual check | A small MUSHRA-style listening test (10 to 15 listeners, 10 clips), or DNSMOS P.835 as an automatic proxy. | Listener time; DNSMOS is a free ONNX model, CPU minutes. |
| Musical-noise fix | Soft mask (Wiener gain or decision-directed estimate) with time smoothing, evaluated with the set above. | Code change plus the same CPU evaluation. |
| Noise-profile robustness | Test files where speech starts in the first second, and non-stationary noise (babble, traffic) from DEMAND. | Same data, CPU minutes. |
| Pinned environment | Pin `requirements.txt` (Flask, pydub, numpy, scipy, werkzeug) and document the FFmpeg version. | None. |

## Threats to validity of the numbers on the dashboard

- The SNR test signal is synthetic harmonic bursts at 16 kHz, not speech; real speech has unvoiced
  consonants that sit near the noise floor and will be gated harder.
- Noise is stationary and Gaussian (white, or pink by Paul Kellet's filter). Real rooms are not.
- SD is over 10 noise seeds on one clean signal, so it captures noise-draw variance only.
- SNR rewards removing noise and is blind to distortion the ear dislikes (musical noise), which is why
  PESQ/STOI or a listening test is still required before any quality claim.
- The recorded MP3 is analysed for level only; with no matching settings or clean reference it
  cannot be scored.
