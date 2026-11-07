// Known-answer self-check, run by `npm run build`: the JavaScript port in dsp.js must reproduce
// results/*.json, which scripts/make_reference.py produced by running processor.py (scipy) and pydub.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanSignal, noiseSignal, mix, measure, spectralGate, compress, eqApply, eqResponseDb, toInt16, mp3Header, TOL } from './dsp.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../results/${f}`, import.meta.url)));
const P = load('params.json'), G = load('gate_reference.json'), S = load('gate_snr.json'), D = load('pydub_reference.json');
const gateOpts = { nperseg: P.nperseg, threshold: P.gate_threshold, floor: P.mask_floor, profileSeconds: P.noise_profile_seconds };
const fs = P.synthetic_signal.fs;
const clean = cleanSignal(P.synthetic_signal);

// 1. Spectral gate vs scipy, sample by sample (float64 both sides; FFT round-off only)
const noisy = mix(clean, noiseSignal(clean.length, G.seed, G.noise), G.snr_db);
const { y } = spectralGate(noisy, fs, gateOpts);
assert.equal(y.length, G.output_length, 'istft length');
let maxErr = 0;
G.output_sampled.forEach((v, i) => { maxErr = Math.max(maxErr, Math.abs(y[i * G.stride] - v)); });
assert.ok(maxErr < TOL.gateMaxAbs, `gate max abs error ${maxErr}`);
const m = measure(clean, noisy, y, fs, P.noise_profile_seconds);
for (const k of ['snr_in_db', 'snr_out_db', 'residual_noise_db']) assert.ok(Math.abs(m[k] - G.metrics[k]) < 1e-6, `${k} ${m[k]} vs ${G.metrics[k]}`);

// 2. The SNR table: rerun every cell (2 colours x 3 SNRs x 10 seeds) and compare the means
for (const row of S.rows) {
  let out = 0, res = 0;
  for (const seed of S.seeds) {
    const x = mix(clean, noiseSignal(clean.length, seed, row.noise), row.snr_in_db);
    const r = measure(clean, x, spectralGate(x, fs, gateOpts).y, fs, P.noise_profile_seconds);
    out += r.snr_out_db / S.seeds.length; res += r.residual_noise_db / S.seeds.length;
  }
  assert.ok(Math.abs(out - row.snr_out_db_mean) < 2e-3, `${row.noise} ${row.snr_in_db} dB: snr out ${out} vs ${row.snr_out_db_mean}`);
  assert.ok(Math.abs(res - row.residual_noise_db_mean) < 2e-3, `${row.noise} residual ${res} vs ${row.residual_noise_db_mean}`);
}

// 3. Compressor and EQ vs pydub on the same int16 slice (truncation can differ by one step)
const I = D.input;
const loud = mix(clean.map((v) => v * I.clean_gain), noiseSignal(clean.length, I.noise_seed, 'white'), I.snr_db);
const ints = toInt16(loud.subarray(I.start, I.end));
const { out: comp, atten } = compress(ints, I.fs, P.compress);
const eq = eqApply(ints, I.fs, P.eq_lowpass_hz, P.eq_gain_db);
const worst = (got, want) => want.reduce((w, v, i) => Math.max(w, Math.abs(got[i * D.stride] - v)), 0);
assert.ok(worst(comp, D.compress_out_sampled) <= TOL.int16Steps, `compressor max diff ${worst(comp, D.compress_out_sampled)}`);
assert.ok(worst(eq, D.eq_out_sampled) <= TOL.int16Steps, `eq max diff ${worst(eq, D.eq_out_sampled)}`);
assert.ok(Math.max(...atten) > 1, 'the compressor reference slice must actually compress');

// 4. Analytic EQ response vs pydub's measured tone gains at 48 kHz
for (const { hz, gain_db } of D.eq_tone_gain_db_48k) {
  const a = eqResponseDb(hz, 48000, P.eq_lowpass_hz, P.eq_gain_db);
  assert.ok(Math.abs(a - gain_db) < TOL.eqDb, `eq at ${hz} Hz: analytic ${a} vs pydub ${gain_db}`);
}

// 5. The recorded file's own frame header (what `file uploads/processed_EP1.mp3` also reports)
const hdr = mp3Header(readFileSync(new URL('../../uploads/processed_EP1.mp3', import.meta.url)));
assert.deepEqual([hdr.sampleRate, hdr.kbps, hdr.channels], [48000, 64, 1], `mp3 header ${JSON.stringify(hdr)}`);

console.log('dsp ok', { gateMaxErr: maxErr, snrOut: +m.snr_out_db.toFixed(3), maxAttenDb: +Math.max(...atten).toFixed(2), eqDcDb: +eqResponseDb(0, 48000, 250, 4).toFixed(2) });
