// Browser port of SonicClear's DSP chain (processor.py) and of the synthetic test signal in
// scripts/make_reference.py. src/dsp.check.mjs asserts it reproduces results/*.json.

// ---- deterministic synthetic signal (bit-identical generator to the Python copy) ----
export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function cleanSignal({ fs, duration_s, bursts, n_harmonics, peak }) {
  const n = Math.round(fs * duration_s);
  const x = new Float64Array(n);
  for (const [start, end, f0a, f0b] of bursts) {
    const i0 = Math.round(start * fs), len = Math.round(end * fs) - i0;
    let phase = 0;
    for (let i = 0; i < len; i++) {
      const u = i / len, f0 = f0a + (f0b - f0a) * u;
      phase += (2 * Math.PI * f0) / fs;
      const env = 0.5 - 0.5 * Math.cos(2 * Math.PI * u);
      let s = 0;
      for (let k = 1; k <= n_harmonics; k++) if (k * f0 < fs / 2) s += (Math.sin(k * phase) / k) * (1 + 2 * Math.exp(-(((k * f0 - 700) / 300) ** 2)));
      x[i0 + i] = env * s;
    }
  }
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  for (let i = 0; i < n; i++) x[i] = (x[i] * peak) / m;
  return x;
}

export function noiseSignal(n, seed, colour) {
  const rand = mulberry32(seed), out = new Float64Array(n);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const u1 = 1 - rand(), u2 = rand();
    let w = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    if (colour === 'pink') { // Paul Kellet's economy pink filter
      b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
      w = b0 + b1 + b2 + w * 0.1848;
    }
    out[i] = w;
  }
  return out;
}

export function mix(clean, noise, snrDb) {
  let ps = 0, pn = 0;
  for (let i = 0; i < clean.length; i++) { ps += clean[i] ** 2; pn += noise[i] ** 2; }
  const g = Math.sqrt(ps / (pn * 10 ** (snrDb / 10)));
  const noisy = new Float64Array(clean.length);
  for (let i = 0; i < clean.length; i++) noisy[i] = clean[i] + g * noise[i];
  return noisy;
}

export function measure(clean, noisy, gated, fs, profileSeconds) {
  const k = Math.floor(fs * profileSeconds);
  let s = 0, ein = 0, eout = 0, rin = 0, rout = 0;
  for (let i = 0; i < clean.length; i++) {
    s += clean[i] ** 2; ein += (noisy[i] - clean[i]) ** 2; eout += (gated[i] - clean[i]) ** 2;
    if (i < k) { rin += noisy[i] ** 2; rout += gated[i] ** 2; }
  }
  return { snr_in_db: 10 * Math.log10(s / ein), snr_out_db: 10 * Math.log10(s / eout), residual_noise_db: 10 * Math.log10(rout / rin) };
}

// ---- FFT (radix 2, in place) ----
function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

const hann = (N) => Float64Array.from({ length: N }, (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N)); // scipy 'hann', periodic

// scipy.signal.stft defaults: Hann, noverlap N/2, boundary='zeros', padded=True, scaling='spectrum'.
// Returns frames of N/2+1 complex bins as { re: Float64Array[], im: Float64Array[] }.
export function stft(x, N) {
  const hop = N / 2, w = hann(N), wsum = N / 2;
  const L0 = x.length + N, nadd = ((-(L0 - N) % hop) + hop) % hop;
  const padded = new Float64Array(L0 + nadd);
  padded.set(x, N / 2);
  const nseg = (padded.length - hop) / hop, re = [], im = [];
  for (let s = 0; s < nseg; s++) {
    const fr = new Float64Array(N), fi = new Float64Array(N);
    for (let n = 0; n < N; n++) fr[n] = padded[s * hop + n] * w[n];
    fft(fr, fi, false);
    re.push(fr.slice(0, N / 2 + 1).map((v) => v / wsum)); im.push(fi.slice(0, N / 2 + 1).map((v) => v / wsum));
  }
  return { re, im, N };
}

// scipy.signal.istft defaults, matching the stft above. Output length (nseg - 1) * N/2.
export function istft({ re, im, N }) {
  const hop = N / 2, w = hann(N), wsum = N / 2, nseg = re.length;
  const out = new Float64Array(N + (nseg - 1) * hop), norm = new Float64Array(out.length);
  for (let s = 0; s < nseg; s++) {
    const fr = new Float64Array(N), fi = new Float64Array(N);
    for (let k = 0; k <= N / 2; k++) { fr[k] = re[s][k]; fi[k] = im[s][k]; }
    fi[0] = 0; fi[N / 2] = 0; // irfft ignores the imaginary part of DC and Nyquist
    for (let k = 1; k < N / 2; k++) { fr[N - k] = fr[k]; fi[N - k] = -fi[k]; }
    fft(fr, fi, true);
    for (let n = 0; n < N; n++) { out[s * hop + n] += (fr[n] / N) * wsum * w[n]; norm[s * hop + n] += w[n] * w[n]; }
  }
  const y = out.subarray(N / 2, out.length - N / 2), nn = norm.subarray(N / 2, out.length - N / 2);
  return y.map((v, i) => v / (nn[i] > 1e-10 ? nn[i] : 1));
}

// processor.spectral_gate: mean noise magnitude from the first `profileSeconds`, binary mask with a floor.
export function spectralGate(x, fs, { nperseg, threshold, floor, profileSeconds }) {
  const Z = stft(x, nperseg);
  const noiseLen = Math.min(x.length, Math.floor(fs * profileSeconds));
  const Zn = stft(x.subarray(0, noiseLen), nperseg);
  const bins = nperseg / 2 + 1, noise = new Float64Array(bins);
  for (let s = 0; s < Zn.re.length; s++) for (let k = 0; k < bins; k++) noise[k] += Math.hypot(Zn.re[s][k], Zn.im[s][k]) / Zn.re.length;
  let kept = 0;
  for (let s = 0; s < Z.re.length; s++) for (let k = 0; k < bins; k++) {
    if (Math.hypot(Z.re[s][k], Z.im[s][k]) > threshold * noise[k]) { kept++; continue; }
    Z.re[s][k] *= floor; Z.im[s][k] *= floor;
  }
  return { y: istft(Z), noise, keptFraction: kept / (Z.re.length * bins) };
}

// Magnitude spectrogram in dB, for display only: Hann frames at 50% overlap, thinned to at most maxFrames.
export function spectrogramDb(x, N, maxFrames = 640) {
  const w = hann(N), hop = N / 2, total = Math.max(1, Math.floor((x.length - N) / hop) + 1);
  const step = Math.max(1, Math.ceil(total / maxFrames)), out = [];
  for (let s = 0; s < total; s += step) {
    const fr = new Float64Array(N), fi = new Float64Array(N);
    for (let n = 0; n < N && s * hop + n < x.length; n++) fr[n] = x[s * hop + n] * w[n];
    fft(fr, fi, false);
    out.push(Float32Array.from({ length: N / 2 + 1 }, (_, k) => 20 * Math.log10(Math.hypot(fr[k], fi[k]) / (N / 2) + 1e-9)));
  }
  return out;
}

// First MPEG audio Layer III frame header after any ID3v2 tag: what the file says about itself.
export function mp3Header(b) {
  let i = 0;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) i = 10 + (((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f));
  for (; i < b.length - 4; i++) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) continue;
    const ver = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3, br = (b[i + 2] >> 4) & 15, sr = (b[i + 2] >> 2) & 3, mode = (b[i + 3] >> 6) & 3;
    if (ver === 1 || layer !== 1 || br === 0 || br === 15 || sr === 3) continue; // Layer III only
    const sampleRate = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }[ver][sr];
    const kbps = (ver === 3 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])[br];
    return { sampleRate, kbps, channels: mode === 3 ? 1 : 2, offset: i };
  }
  return null;
}

// ---- pydub compress_dynamic_range on int16 samples (effects.py, pydub 0.25.1) ----
// Returns the output samples and the attenuation (dB) applied at each sample.
export function compress(ints, fs, { threshold, ratio, attack, release }) {
  const n = ints.length, out = new Int16Array(n), atten = new Float32Array(n);
  const threshRms = 32768 * 10 ** (threshold / 20);
  const attackFrames = (attack * fs) / 1000, releaseFrames = (release * fs) / 1000, look = Math.trunc(attackFrames);
  const sq = new Float64Array(n + 1); // prefix sums of squares: the rms of the previous `look` samples in O(1)
  for (let i = 0; i < n; i++) sq[i + 1] = sq[i] + ints[i] * ints[i];
  let a = 0;
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - look), cnt = i - lo;
    const rms = cnt ? Math.trunc(Math.sqrt((sq[i] - sq[lo]) / cnt)) : 0; // audioop.rms truncates to an int
    const over = rms === 0 ? 0 : Math.max(20 * Math.log10(rms / threshRms), 0);
    const maxA = (1 - 1 / ratio) * over;
    if (rms > threshRms && a <= maxA) a = Math.min(a + maxA / attackFrames, maxA);
    else a = Math.max(a - maxA / releaseFrames, 0);
    atten[i] = a;
    out[i] = a !== 0 ? clip16(Math.floor(ints[i] * 10 ** (-a / 20))) : ints[i];
  }
  return { out, atten };
}

const clip16 = (v) => Math.max(-32768, Math.min(32767, v));

// ---- the EQ line: audio.low_pass_filter(250).apply_gain(4).overlay(audio) ----
export function eqApply(ints, fs, cutoff, gainDb) {
  const RC = 1 / (cutoff * 2 * Math.PI), dt = 1 / fs, alpha = dt / (RC + dt), g = 10 ** (gainDb / 20);
  const out = new Int16Array(ints.length);
  let last = ints[0];
  for (let i = 0; i < ints.length; i++) {
    if (i > 0) last += alpha * (ints[i] - last);
    const lp = i === 0 ? ints[0] : Math.trunc(last);
    out[i] = clip16(clip16(Math.floor(lp * g)) + ints[i]);
  }
  return out;
}

// Analytic magnitude (dB) of 1 + g * H(z), with H the one-pole low-pass y[n] = y[n-1] + a(x[n] - y[n-1]).
export function eqResponseDb(f, fs, cutoff, gainDb) {
  const RC = 1 / (cutoff * 2 * Math.PI), dt = 1 / fs, a = dt / (RC + dt), g = 10 ** (gainDb / 20);
  const w = (2 * Math.PI * f) / fs;
  const dr = 1 - (1 - a) * Math.cos(w), di = (1 - a) * Math.sin(w); // denominator 1 - (1-a) e^{-jw}
  const d2 = dr * dr + di * di;
  const hr = (a * dr) / d2, hi = (-a * di) / d2;
  return 20 * Math.log10(Math.hypot(1 + g * hr, g * hi));
}

// The README's described curve: +4 dB below 250 Hz and +4 dB above 6 kHz (a plain step, for comparison only).
export const README_EQ = { gainDb: 4, belowHz: 250, aboveHz: 6000 };
export const readmeCurveDb = (f) => (f < README_EQ.belowHz || f > README_EQ.aboveHz ? README_EQ.gainDb : 0);

// Pass tolerances for the known-answer check (dsp.check.mjs); the page quotes these same values.
export const TOL = { gateMaxAbs: 1e-8, int16Steps: 2, eqDb: 0.1 };

// ---- recorded-file statistics ----
export function levelStats(x) {
  let s = 0, peak = 0;
  for (const v of x) { s += v * v; peak = Math.max(peak, Math.abs(v)); }
  const rms = Math.sqrt(s / x.length);
  return { rmsDb: 20 * Math.log10(rms), peakDb: 20 * Math.log10(peak), crestDb: 20 * Math.log10(peak / rms) };
}

export const toInt16 = (x) => Int16Array.from(x, (v) => Math.trunc(Math.max(-1, Math.min(1, v)) * 32767));
