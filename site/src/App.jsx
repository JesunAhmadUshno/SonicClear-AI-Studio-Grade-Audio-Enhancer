import { useMemo, useState, useEffect, useRef, useId } from 'react';
import P from '../../results/params.json';
import snrRef from '../../results/gate_snr.json';
import pyd from '../../results/pydub_reference.json';
import mp3Url from '../../uploads/processed_EP1.mp3?url';
import {
  cleanSignal, noiseSignal, mix, measure, spectralGate, spectrogramDb, compress, eqResponseDb, readmeCurveDb, levelStats, toInt16, mp3Header, README_EQ, TOL,
} from './dsp.js';

const REPO = 'https://github.com/JesunAhmadUshno/SonicClear-AI-Studio-Grade-Audio-Enhancer';
const blob = (p) => `${REPO}/blob/main/${p}`;
const sgn = (v, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;
const C = P.compress;
const FS = P.synthetic_signal.fs;
const CLEAN = cleanSignal(P.synthetic_signal);
const row = (noise, snr) => snrRef.rows.find((r) => r.noise === noise && r.snr_in_db === snr);
const SNR_LEVELS = [...new Set(snrRef.rows.map((r) => r.snr_in_db))];
const orList = (xs, w) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} ${w} ${xs[xs.length - 1]}` : `${xs[0]}`);
const EQ_DC_DB = eqResponseDb(0, FS, P.eq_lowpass_hz, P.eq_gain_db); // DC gain is 20*log10(1+g), independent of fs
const tone = (hz) => pyd.eq_tone_gain_db_48k.find((t) => t.hz === hz).gain_db;

const SECTIONS = [['top', 'Overview', '◎'], ['chain', 'Chain', '⇢'], ['gate', 'Gate', '▤'], ['compressor', 'Compressor', '◢'], ['eq', 'EQ', '∿'], ['recorded', 'Recorded', '●'], ['receipts', 'Receipts', '✓']];

function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.08 });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
}

function useDark() {
  const q = '(prefers-color-scheme: dark)';
  const [dark, setDark] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q), h = (e) => setDark(e.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, []);
  return dark;
}

function MenuBar() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);
  return (
    <div className="menubar" role="banner">
      <span className="apple" aria-hidden="true">◆</span>
      <a className="app" href="#top">SonicClear</a>
      <a className="m" href={blob('processor.py')}>processor.py</a>
      <a className="m" href={blob('docs/research-review.md')}>Research review</a>
      <a className="m" href={blob('scripts/make_reference.py')}>References</a>
      <span className="spacer" />
      <span className="status"><i /> Checked against scipy + pydub</span>
      <a href={REPO}>GitHub ↗</a>
      <span className="clock">{now.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span>
    </div>
  );
}

function Dock() {
  const [active, setActive] = useState('top');
  useEffect(() => {
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setActive(e.target.id)), { rootMargin: '-45% 0px -50% 0px' });
    SECTIONS.forEach(([id]) => { const el = document.getElementById(id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, []);
  return (
    <nav className="dock" aria-label="Sections">
      {SECTIONS.map(([id, label, icon]) => (
        <a key={id} href={`#${id}`} className={active === id ? 'on' : ''} aria-current={active === id ? 'true' : undefined}>
          <span className="ico" aria-hidden="true">{icon}</span><span className="lbl">{label}</span>
        </a>
      ))}
    </nav>
  );
}

function Range({ label, value, min, max, step, onChange, show }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label} <span>{show}</span></label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
    </div>
  );
}

function Seg({ label, value, options, onChange }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([k, l]) => <button key={k} aria-pressed={value === k} onClick={() => onChange(k)}>{l}</button>)}
    </div>
  );
}

// Spectrogram heatmap on a canvas (too many cells for SVG). Intensity is the theme's primary colour.
function Spectro({ frames, fs, maxHz, top, label, height = 150 }) {
  const ref = useRef(null);
  const dark = useDark();
  useEffect(() => {
    const c = ref.current;
    if (!c || !frames?.length) return;
    const bins = frames[0].length, kMax = Math.min(bins, Math.round((maxHz / (fs / 2)) * (bins - 1)) + 1);
    const hi = top ?? Math.max(...frames.map((f) => Math.max(...f.subarray(0, kMax))));
    const hex = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim().replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const off = document.createElement('canvas');
    off.width = frames.length; off.height = kMax;
    const octx = off.getContext('2d'), img = octx.createImageData(frames.length, kMax);
    frames.forEach((f, x) => {
      for (let k = 0; k < kMax; k++) {
        const a = Math.max(0, Math.min(1, (f[k] - (hi - 72)) / 72)), i = ((kMax - 1 - k) * frames.length + x) * 4;
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = Math.round(255 * a ** 1.6);
      }
    });
    octx.putImageData(img, 0, 0);
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, Math.round(c.clientWidth * dpr)); c.height = Math.round(height * dpr);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(off, 0, 0, c.width, c.height);
  }, [frames, fs, maxHz, top, height, dark]);
  return (
    <div className="spectro">
      <canvas ref={ref} style={{ height }} role="img" aria-label={label} />
      <span className="ax top">{(maxHz / 1000).toFixed(0)} kHz</span><span className="ax bot">0</span>
    </div>
  );
}

// Min/max envelope of a long signal as an SVG area.
function envelope(x, buckets, W, mid, half) {
  const per = x.length / buckets, up = [], dn = [];
  for (let b = 0; b < buckets; b++) {
    let lo = 0, hi = 0;
    for (let i = Math.floor(b * per); i < Math.floor((b + 1) * per); i++) { if (x[i] < lo) lo = x[i]; if (x[i] > hi) hi = x[i]; }
    const px = ((b + 0.5) / buckets) * W;
    up.push(`${px.toFixed(1)},${(mid - Math.min(1, hi) * half).toFixed(1)}`);
    dn.push(`${px.toFixed(1)},${(mid - Math.max(-1, lo) * half).toFixed(1)}`);
  }
  return `M${up.join('L')}L${dn.reverse().join('L')}Z`;
}

export default function App() {
  useReveal();
  return (
    <div className="wrap">
      <MenuBar />
      <div className="glow" aria-hidden="true" />
      <Hero />
      <Chain />
      <Gate />
      <Compressor />
      <Eq />
      <Recorded />
      <Receipts />
      <Dock />
      <footer>
        Code: <a href={REPO} style={{ color: 'inherit' }}>SonicClear</a> by Jesun Ahmad Ushno. Constants are read from <code>results/params.json</code>, which <code>scripts/make_reference.py</code> copies from <code>processor.py</code>.
        The playgrounds run a JavaScript port of the chain in your browser; the build fails unless that port reproduces scipy and pydub to within rounding.
      </footer>
    </div>
  );
}

function Hero() {
  const w0 = row('white', 0), p0 = row('pink', 0);
  return (
    <header className="card hero window" id="top" data-title="SonicClear — README">
      <div className="head">
        <p className="eyebrow">Classical DSP · Flask app · browser port</p>
        <span className="pill warn">● No listening test recorded</span>
      </div>
      <h1>Three classical DSP steps that <em>clean up speech</em>, ported to your browser and measured.</h1>
      <p className="sub">
        SonicClear is a small Flask app. It learns the noise from the first {P.noise_profile_seconds} s of a recording, gates it in the frequency domain,
        compresses anything above {C.threshold} dB at {C.ratio}:1, and adds a low-shelf boost. There is no learned model in it, despite the name.
        The app needs a Python server, so this page runs a line-for-line JavaScript port of <a href={blob('processor.py')}>processor.py</a> instead, on a synthetic test signal where the clean answer is known.
      </p>
      <div className="actions">
        <a className="btn primary" href="#gate">Open the gate playground</a>
        <a className="btn ghost" href={blob('docs/research-review.md')}>Read the research review</a>
        <span className="hint">Rebuild the references with <code>python3 scripts/make_reference.py</code></span>
      </div>
      <div className="tiles">
        <div className="tile"><div className="num">{sgn(w0.snr_gain_db_mean)} dB</div><div className="cap">SNR gain on white noise at {w0.snr_in_db} dB input (±{w0.snr_out_db_sd} dB SD, {snrRef.seeds.length} seeds)</div></div>
        <div className="tile"><div className="num">{sgn(p0.snr_gain_db_mean)} dB</div><div className="cap">SNR gain on pink noise at {p0.snr_in_db} dB input (±{p0.snr_out_db_sd} dB SD)</div></div>
        <div className="tile"><div className="num">{sgn(w0.residual_noise_db_mean)} dB</div><div className="cap">Noise left in the speech-free first {P.noise_profile_seconds} s (white)</div></div>
        <div className="tile"><div className="num">{sgn(tone(README_EQ.aboveHz), 2)} dB</div><div className="cap">EQ gain at {README_EQ.aboveHz / 1000} kHz, measured with pydub. The README says {sgn(README_EQ.gainDb, 0)} dB.</div></div>
      </div>
    </header>
  );
}

function Chain() {
  const steps = [
    ['Load', 'pydub + FFmpeg', ['left channel only', 'if stereo', 'scaled to ±1 float']],
    ['Spectral gate', 'scipy STFT', [`Hann, ${P.nperseg} samples`, `${P.noverlap} overlap`, `noise: mean |Z|,`, `first ${P.noise_profile_seconds} s`, `keep |Z| > ${P.gate_threshold}× noise`, `else scale ×${P.mask_floor}`]],
    ['Compress', 'pydub', [`threshold ${C.threshold} dBFS`, `ratio ${C.ratio}:1`, `attack ${C.attack} ms`, `release ${C.release} ms`, 'RMS, attack window']],
    ['EQ', 'pydub', [`one-pole low-pass`, `at ${P.eq_lowpass_hz} Hz, +${P.eq_gain_db} dB`, 'summed with the', 'dry signal']],
    ['Export', 'MP3', ['mono 16-bit', 'if the gate ran']],
  ];
  const W = 960, bw = 168, gap = (W - steps.length * bw) / (steps.length - 1), H = 220;
  return (
    <section id="chain" className="card window reveal" data-title="processor.py — signal chain">
      <p className="eyebrow">The chain</p>
      <h2>Every constant below is read from the code, not retyped.</h2>
      <p className="sub">
        <code>scripts/make_reference.py</code> imports <code>processor.py</code> and writes its constants to <a href={blob('results/params.json')}>results/params.json</a>; this page imports that file at build time.
        Each step is optional in the app (three checkboxes), and the order is fixed.
      </p>
      <div className="scroll-x" style={{ marginTop: 16 }}>
        <svg className="chart chain" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Signal chain: load, spectral gate, compress, EQ, export, with each step's constants">
          <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="var(--muted)" /></marker></defs>
          {steps.map(([t, lib, lines], i) => {
            const x = i * (bw + gap);
            return (
              <g key={t}>
                <rect x={x} y={8} width={bw} height={H - 16} rx="12" fill="var(--surface-strong)" stroke={i > 0 && i < 4 ? 'var(--primary)' : 'var(--border)'} strokeWidth={i > 0 && i < 4 ? 1.5 : 1} />
                <text x={x + 14} y={34} className="t">{t}</text>
                <text x={x + 14} y={52}>{lib}</text>
                {lines.map((l, k) => <text key={k} x={x + 14} y={82 + k * 21} className="mono-t">{l}</text>)}
                {i < steps.length - 1 && <line x1={x + bw + 4} x2={x + bw + gap - 4} y1={H / 2} y2={H / 2} stroke="var(--muted)" strokeWidth="1.5" markerEnd="url(#arr)" />}
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}

let audioCtx = null, playing = null;
function play(x, fs) {
  audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
  playing?.stop();
  const buf = audioCtx.createBuffer(1, x.length, fs);
  buf.copyToChannel(Float32Array.from(x, (v) => Math.max(-1, Math.min(1, v))), 0);
  const src = audioCtx.createBufferSource();
  src.buffer = buf; src.connect(audioCtx.destination); src.start();
  playing = src;
}

function Gate() {
  const [colour, setColour] = useState('white');
  const [snr, setSnr] = useState(5);
  const [k, setK] = useState(P.gate_threshold);
  const [floor, setFloor] = useState(P.mask_floor);
  const [win, setWin] = useState(P.noise_profile_seconds);
  const [seed, setSeed] = useState(1);
  const r = useMemo(() => {
    const noisy = mix(CLEAN, noiseSignal(CLEAN.length, seed, colour), snr);
    const g = spectralGate(noisy, FS, { nperseg: P.nperseg, threshold: k, floor, profileSeconds: win });
    const y = g.y.subarray(0, CLEAN.length);
    const sIn = spectrogramDb(noisy, P.nperseg), sOut = spectrogramDb(y, P.nperseg);
    const top = Math.max(...sIn.map((f) => Math.max(...f)));
    return { noisy, y, sIn, sOut, top, kept: g.keptFraction, m: measure(CLEAN, noisy, y, FS, win) };
  }, [colour, snr, k, floor, win, seed]);
  const isDefault = k === P.gate_threshold && floor === P.mask_floor && win === P.noise_profile_seconds && SNR_LEVELS.includes(snr);
  const ref = isDefault ? row(colour, snr) : null;
  const speechInProfile = win > P.synthetic_signal.bursts[0][0];
  const W = 960, H = 120;
  return (
    <section id="gate" className="card window reveal" data-title="gate.lab — spectral gating playground · live">
      <div className="head">
        <div>
          <p className="eyebrow">Live · computed in your browser</p>
          <h2>The gate removes steady noise, but only where speech is quiet.</h2>
          <p className="sub">
            A synthetic voiced signal (three harmonic bursts with a gliding pitch, {P.synthetic_signal.fs / 1000} kHz) plus seeded noise. Because the clean signal is known, the SNR is exact.
            Bins above {k.toFixed(2)}× the mean noise magnitude pass untouched; the rest are scaled by {floor.toFixed(2)}. The bursts start at {P.synthetic_signal.bursts[0][0]} s, so a profile window past that learns speech as noise.
          </p>
        </div>
        <Seg label="Noise colour" value={colour} options={[['white', 'White'], ['pink', 'Pink']]} onChange={setColour} />
      </div>
      <div className="controls">
        <Range label="Input SNR" value={snr} min={-5} max={20} step={1} onChange={setSnr} show={`${snr} dB`} />
        <Range label="Threshold multiplier" value={k} min={1} max={4} step={0.1} onChange={setK} show={`${k.toFixed(1)}×`} />
        <Range label="Mask floor" value={floor} min={0} max={0.5} step={0.01} onChange={setFloor} show={floor.toFixed(2)} />
        <Range label="Noise-profile window" value={win} min={0.25} max={2} step={0.05} onChange={setWin} show={`${win.toFixed(2)} s`} />
        <Range label="Noise seed" value={seed} min={1} max={10} step={1} onChange={setSeed} show={seed} />
      </div>
      <div className="tiles" style={{ marginTop: 0 }}>
        <div className="tile"><div className="num">{r.m.snr_in_db.toFixed(1)} dB</div><div className="cap">True SNR in</div></div>
        <div className="tile"><div className="num">{r.m.snr_out_db.toFixed(1)} dB</div><div className="cap">True SNR out ({sgn(r.m.snr_out_db - r.m.snr_in_db)} dB)</div></div>
        <div className="tile"><div className="num">{r.m.residual_noise_db.toFixed(1)} dB</div><div className="cap">Noise left in the speech-free start</div></div>
        <div className="tile"><div className="num">{(r.kept * 100).toFixed(1)}%</div><div className="cap">Time-frequency bins passed at full level</div></div>
      </div>
      <p className="hint" style={{ marginTop: 10 }}>
        {speechInProfile ? <span className="pill bad">Profile window includes speech</span> : null}{' '}
        {ref ? <>At these settings the committed {snrRef.seeds.length}-seed run (<a href={blob('results/gate_snr.json')}>gate_snr.json</a>) averaged {ref.snr_out_db_mean} dB out (SD {ref.snr_out_db_sd}).</> : `Move back to the repo defaults (${P.gate_threshold.toFixed(1)}×, ${P.mask_floor.toFixed(2)}, ${P.noise_profile_seconds.toFixed(2)} s) at ${orList(SNR_LEVELS, 'or')} dB to compare with the committed run.`}
      </p>
      <div className="grid2" style={{ marginTop: 16 }}>
        <div><h3>Before: noisy input</h3><Spectro frames={r.sIn} fs={FS} maxHz={FS / 2} top={r.top} label="Spectrogram of the noisy input" /></div>
        <div><h3>After: gated output</h3><Spectro frames={r.sOut} fs={FS} maxHz={FS / 2} top={r.top} label="Spectrogram of the gated output" /></div>
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Waveforms of the noisy input and the gated output" style={{ marginTop: 16 }}>
        <rect x={0} y={0} width={(win / P.synthetic_signal.duration_s) * W} height={H} fill="var(--warn)" opacity="0.08" />
        <path d={envelope(r.noisy, 480, W, H / 2, H / 2 - 4)} fill="var(--muted)" opacity="0.35" />
        <path d={envelope(r.y, 480, W, H / 2, H / 2 - 4)} fill="var(--primary)" opacity="0.85" />
        <text x={6} y={14}>noise profile window</text>
        <text x={W - 4} y={H - 4} textAnchor="end">{P.synthetic_signal.duration_s} s</text>
      </svg>
      <div className="legend"><span><i style={{ background: 'var(--muted)', opacity: 0.5 }} />noisy input</span><span><i style={{ background: 'var(--primary)' }} />gated output</span><span><i style={{ background: 'var(--warn)', opacity: 0.3 }} />profile window</span></div>
      <div className="actions">
        <button className="btn primary" onClick={() => play(r.noisy, FS)}>▶ Play noisy</button>
        <button className="btn ghost" onClick={() => play(r.y, FS)}>▶ Play gated</button>
        <button className="btn ghost" onClick={() => play(CLEAN, FS)}>▶ Play clean reference</button>
        <span className="hint">Listen for “musical noise”: the hard on/off mask leaves short tonal blips where noise peaks cross the threshold.</span>
      </div>
    </section>
  );
}

function Compressor() {
  const [thr, setThr] = useState(C.threshold);
  const [ratio, setRatio] = useState(C.ratio);
  const [attack, setAttack] = useState(C.attack);
  const [release, setRelease] = useState(C.release);
  const [gainDb, setGainDb] = useState(8);
  const I = pyd.input;
  const res = useMemo(() => {
    const loud = mix(CLEAN.map((v) => v * 10 ** (gainDb / 20)), noiseSignal(CLEAN.length, I.noise_seed, 'white'), I.snr_db);
    const ints = toInt16(loud);
    const { out, atten } = compress(ints, FS, { threshold: thr, ratio, attack, release });
    const toF = (a) => Float64Array.from(a, (v) => v / 32768);
    return { inp: toF(ints), out: toF(out), atten, max: Math.max(...atten), above: atten.filter((a) => a > 0).length / atten.length };
  }, [thr, ratio, attack, release, gainDb, I.noise_seed, I.snr_db]);
  const W = 420, H = 300, pad = 36;
  const cx = (d) => pad + ((d + 60) / 60) * (W - pad - 8), cy = (d) => 8 + (-d / 60) * (H - pad - 8);
  const curve = (t, r) => [-60, t, 0].map((d) => `${cx(d)},${cy(d <= t ? d : t + (d - t) / r)}`).join(' ');
  const TW = 540, TH = 300, buckets = 270;
  const trace = useMemo(() => {
    const per = res.atten.length / buckets, top = Math.max(12, Math.ceil(res.max + 1));
    const pts = Array.from({ length: buckets }, (_, b) => {
      let m = 0;
      for (let i = Math.floor(b * per); i < Math.floor((b + 1) * per); i++) m = Math.max(m, res.atten[i]);
      return `${((b + 0.5) / buckets) * TW},${190 + (m / top) * 100}`;
    });
    return { d: `M0,190L${pts.join('L')}L${TW},190Z`, top };
  }, [res]);
  return (
    <section id="compressor" className="card window reveal" data-title="compressor.app — transfer curve · live">
      <p className="eyebrow">Live · pydub's algorithm, ported</p>
      <h2>Above {thr} dB, every {ratio} dB in becomes 1 dB out.</h2>
      <p className="sub">
        pydub's compressor measures RMS over the last {attack} ms, then ramps its gain reduction toward (1 − 1/ratio) × the excess, faster on attack than on release.
        The port reproduces pydub {pyd.versions.pydub}'s output to within {TOL.int16Steps} sample steps on the reference slice (<a href={blob('results/pydub_reference.json')}>pydub_reference.json</a>). Dashed lines are the repo defaults.
      </p>
      <div className="controls">
        <Range label="Threshold" value={thr} min={-40} max={0} step={1} onChange={setThr} show={`${thr} dBFS`} />
        <Range label="Ratio" value={ratio} min={1} max={20} step={0.5} onChange={setRatio} show={`${ratio}:1`} />
        <Range label="Attack" value={attack} min={1} max={50} step={1} onChange={setAttack} show={`${attack} ms`} />
        <Range label="Release" value={release} min={10} max={500} step={10} onChange={setRelease} show={`${release} ms`} />
        <Range label="Input level boost" value={gainDb} min={0} max={14} step={1} onChange={setGainDb} show={`+${gainDb} dB`} />
      </div>
      <div className="grid2 comp">
        <div>
          <h3>Static transfer curve (steady-state RMS)</h3>
          <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Compressor input versus output level in dB">
            {[-60, -40, -20, 0].map((d) => <g key={d}><line className="axis" x1={cx(d)} x2={cx(d)} y1={8} y2={H - pad} /><line className="axis" x1={pad} x2={W - 8} y1={cy(d)} y2={cy(d)} />
              <text x={cx(d)} y={H - pad + 16} textAnchor="middle">{d}</text><text x={pad - 6} y={cy(d) + 4} textAnchor="end">{d}</text></g>)}
            <line x1={cx(-60)} y1={cy(-60)} x2={cx(0)} y2={cy(0)} stroke="var(--grid)" strokeWidth="1.5" />
            <polyline fill="none" stroke="var(--muted)" strokeDasharray="5 4" strokeWidth="1.5" points={curve(C.threshold, C.ratio)} />
            <polyline fill="none" stroke="var(--primary)" strokeWidth="2.5" points={curve(thr, ratio)} />
            <circle cx={cx(thr)} cy={cy(thr)} r="4.5" fill="var(--primary)" />
            <text x={W - 8} y={H - 4} textAnchor="end">input RMS, dBFS</text>
            <text x={pad + 4} y={20}>output, dBFS</text>
          </svg>
        </div>
        <div>
          <h3>Gain reduction over the test signal</h3>
          <svg className="chart" viewBox={`0 0 ${TW} ${TH}`} role="img" aria-label="Waveform before and after compression, and the gain reduction applied over time">
            <path d={envelope(res.inp, buckets, TW, 90, 84)} fill="var(--muted)" opacity="0.35" />
            <path d={envelope(res.out, buckets, TW, 90, 84)} fill="var(--primary)" opacity="0.85" />
            <line className="axis" x1={0} x2={TW} y1={190} y2={190} />
            <path d={trace.d} fill="var(--bad)" opacity="0.5" />
            <text x={4} y={206}>0 dB</text><text x={4} y={288}>−{trace.top} dB gain reduction</text>
          </svg>
          <div className="legend"><span><i style={{ background: 'var(--muted)', opacity: 0.5 }} />input</span><span><i style={{ background: 'var(--primary)' }} />output</span><span><i style={{ background: 'var(--bad)', opacity: 0.6 }} />gain reduction</span></div>
        </div>
      </div>
      <div className="tiles three">
        <div className="tile"><div className="num">{res.max.toFixed(1)} dB</div><div className="cap">Deepest gain reduction</div></div>
        <div className="tile"><div className="num">{(res.above * 100).toFixed(0)}%</div><div className="cap">Of samples with any gain reduction</div></div>
        <div className="tile"><div className="num">{levelStats(res.inp).crestDb.toFixed(1)} → {levelStats(res.out).crestDb.toFixed(1)}</div><div className="cap">Crest factor in → out, dB (peak over RMS)</div></div>
      </div>
      <p className="hint" style={{ marginTop: 10 }}>pydub applies no make-up gain, so compressed speech comes out quieter, not louder. The README's “quiet speech gets lifted” only holds if something raises the level afterwards; nothing in the chain does.</p>
    </section>
  );
}

function Eq() {
  const [fs, setFs] = useState(48000);
  const [cut, setCut] = useState(P.eq_lowpass_hz);
  const [gain, setGain] = useState(P.eq_gain_db);
  const [pos, setPos] = useState(Math.log10(6000));
  const isDefault = fs === 48000 && cut === P.eq_lowpass_hz && gain === P.eq_gain_db;
  const W = 960, H = 280, pad = { l: 40, r: 12, t: 12, b: 28 }, lo = Math.log10(20), hi = Math.log10(fs / 2);
  const x = (f) => pad.l + ((Math.log10(f) - lo) / (hi - lo)) * (W - pad.l - pad.r);
  const y = (d) => pad.t + (1 - (d + 2) / 14) * (H - pad.t - pad.b);
  const fr = Array.from({ length: 200 }, (_, i) => 10 ** (lo + (i / 199) * (hi - lo)));
  const code = fr.map((f) => `${x(f)},${y(eqResponseDb(f, fs, cut, gain))}`).join(' ');
  const readme = fr.map((f) => `${x(f)},${y(readmeCurveDb(f))}`).join(' ');
  const f = Math.min(10 ** pos, fs / 2), dc = eqResponseDb(0, fs, cut, gain);
  let a = 1, b = fs / 2; // frequency where the boost has fallen to half its DC value, in dB
  for (let i = 0; i < 60; i++) { const m = Math.sqrt(a * b); if (eqResponseDb(m, fs, cut, gain) > dc / 2) a = m; else b = m; }
  return (
    <section id="eq" className="card window reveal" data-title="eq.app — what the EQ really does · live">
      <div className="head">
        <div>
          <p className="eyebrow">Live · analytic response, checked against pydub</p>
          <h2>The “broadcast EQ” is a bass boost of about {dc.toFixed(1)} dB, with no treble lift.</h2>
          <p className="sub">
            The code runs <code>audio.low_pass_filter({P.eq_lowpass_hz}).apply_gain({P.eq_gain_db}).overlay(audio)</code>: a +{P.eq_gain_db} dB copy of a gentle one-pole low-pass, added back to the dry signal.
            At low frequencies the two add up to about {dc.toFixed(1)} dB, and the boost fades slowly through the midrange. The README describes {sgn(README_EQ.gainDb, 0)} dB below {README_EQ.belowHz} Hz and {sgn(README_EQ.gainDb, 0)} dB above {README_EQ.aboveHz / 1000} kHz; the code has no path that boosts treble.
          </p>
        </div>
        <Seg label="Sample rate" value={fs} options={[[16000, '16 kHz'], [44100, '44.1 kHz'], [48000, '48 kHz']]} onChange={setFs} />
      </div>
      <div className="controls">
        <Range label="Low-pass cutoff" value={cut} min={50} max={1000} step={10} onChange={setCut} show={`${cut} Hz`} />
        <Range label="Gain on the low-passed copy" value={gain} min={0} max={12} step={0.5} onChange={setGain} show={`+${gain} dB`} />
        <Range label="Read the curve at" value={pos} min={lo} max={hi} step={0.005} onChange={setPos} show={`${f < 1000 ? f.toFixed(0) + ' Hz' : (f / 1000).toFixed(2) + ' kHz'}`} />
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="EQ magnitude response in the code versus the README's description">
        {[0, 4, 8, 12].map((d) => <g key={d}><line className="axis" x1={pad.l} x2={W - pad.r} y1={y(d)} y2={y(d)} strokeWidth={d === 0 ? 1.5 : 1} /><text x={pad.l - 6} y={y(d) + 4} textAnchor="end">{d === 0 ? '0' : `+${d}`}</text></g>)}
        {[20, 100, 250, 1000, 6000, 10000, 20000].filter((t) => t <= fs / 2).map((t) => <g key={t}><line className="axis" x1={x(t)} x2={x(t)} y1={pad.t} y2={H - pad.b} /><text x={x(t)} y={H - 8} textAnchor="middle">{t < 1000 ? t : `${t / 1000}k`}</text></g>)}
        <polyline fill="none" stroke="var(--warn)" strokeWidth="2" strokeDasharray="6 5" points={readme} />
        <polyline fill="none" stroke="var(--primary)" strokeWidth="2.5" points={code} />
        {isDefault && pyd.eq_tone_gain_db_48k.map((t) => <circle key={t.hz} cx={x(t.hz)} cy={y(t.gain_db)} r="4.5" fill="var(--surface-strong)" stroke="var(--text)" strokeWidth="1.8" />)}
        <line x1={x(f)} x2={x(f)} y1={pad.t} y2={H - pad.b} stroke="var(--text)" strokeOpacity="0.4" />
        <circle cx={x(f)} cy={y(eqResponseDb(f, fs, cut, gain))} r="5" fill="var(--primary)" />
      </svg>
      <div className="legend">
        <span><i style={{ background: 'var(--primary)' }} />code (analytic)</span>
        <span><i style={{ background: 'var(--warn)' }} />README description</span>
        {isDefault && <span><i style={{ background: 'transparent', border: '1.8px solid var(--text)', borderRadius: '50%' }} />pydub, measured on tones</span>}
      </div>
      <div className="tiles">
        <div className="tile"><div className="num">{sgn(eqResponseDb(f, fs, cut, gain), 2)}</div><div className="cap">Code at {f < 1000 ? `${f.toFixed(0)} Hz` : `${(f / 1000).toFixed(2)} kHz`}, dB</div></div>
        <div className="tile"><div className="num">{sgn(readmeCurveDb(f), 0)}</div><div className="cap">README description at the same frequency, dB</div></div>
        <div className="tile"><div className="num">{sgn(dc, 2)}</div><div className="cap">Boost at DC, dB</div></div>
        <div className="tile"><div className="num">{a < 1000 ? `${a.toFixed(0)} Hz` : `${(a / 1000).toFixed(1)} k`}</div><div className="cap">Where the boost falls to half</div></div>
      </div>
    </section>
  );
}

function Recorded() {
  const [s, setS] = useState({ status: 'loading' });
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const bytes = await (await fetch(mp3Url)).arrayBuffer();
        const hdr = mp3Header(new Uint8Array(bytes)), size = bytes.byteLength; // decodeAudioData detaches the buffer
        const ctx = new OfflineAudioContext(1, 1, hdr?.sampleRate || 48000);
        const ab = await ctx.decodeAudioData(bytes);
        const x = ab.getChannelData(0);
        const st = levelStats(x);
        if (live) setS({ status: 'ok', hdr, x, st, dur: ab.duration, fs: ab.sampleRate, bytes: size, frames: spectrogramDb(x, 2048, 720) });
      } catch (e) {
        if (live) setS({ status: 'fail', msg: e?.message || String(e) });
      }
    })();
    return () => { live = false; };
  }, []);
  const W = 960, H = 110;
  return (
    <section id="recorded" className="card window reveal" data-title="uploads/ — recorded output">
      <div className="head">
        <div>
          <p className="eyebrow">Recorded · output of a past run</p>
          <h2>One real output file ships in the repo. Its settings were not recorded.</h2>
          <p className="sub">
            <code>uploads/processed_EP1.mp3</code> is what the app wrote for one upload. Nobody logged which of the three steps were on, so it can’t be scored against its input.
            Your browser decodes it and measures it here; nothing below is typed in.
          </p>
        </div>
        <span className="pill warn">● RECORDED</span>
      </div>
      {s.status === 'loading' && <p className="hint">Decoding the file…</p>}
      {s.status === 'fail' && <p className="hint">This browser could not decode the MP3 ({s.msg}). The file is in the repo at <a href={blob('uploads/processed_EP1.mp3')}>uploads/processed_EP1.mp3</a>.</p>}
      {s.status === 'ok' && (
        <>
          <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Waveform of the recorded output file">
            <line className="axis" x1={0} x2={W} y1={H / 2} y2={H / 2} />
            <path d={envelope(s.x, 600, W, H / 2, H / 2 - 4)} fill="var(--primary)" opacity="0.85" />
          </svg>
          <Spectro frames={s.frames} fs={s.fs} maxHz={Math.min(16000, s.fs / 2)} label="Spectrogram of the recorded output file" height={130} />
          <div className="tiles">
            <div className="tile"><div className="num">{s.dur.toFixed(1)} s</div><div className="cap">Decoded duration</div></div>
            <div className="tile"><div className="num">{s.st.rmsDb.toFixed(1)} dB</div><div className="cap">RMS level, dBFS</div></div>
            <div className="tile"><div className="num">{s.st.peakDb.toFixed(1)} dB</div><div className="cap">Peak level, dBFS</div></div>
            <div className="tile"><div className="num">{s.st.crestDb.toFixed(1)} dB</div><div className="cap">Crest factor (peak over RMS)</div></div>
          </div>
          <p className="hint" style={{ marginTop: 10 }}>
            {s.hdr ? <>Frame header: MPEG Layer III, {s.hdr.kbps} kbps, {s.hdr.sampleRate / 1000} kHz, {s.hdr.channels === 1 ? 'mono' : 'stereo'}. </> : null}
            {(s.bytes / 1024).toFixed(0)} KB. Mono output fits the code path where the gate forces mono 16-bit, but that is a consistent reading, not proof of which steps ran.
          </p>
          <div><audio controls preload="none" src={mp3Url} aria-label="Play the recorded output file" style={{ width: '100%', marginTop: 8, display: 'block' }} /></div>
        </>
      )}
    </section>
  );
}

function Receipts() {
  const measured = [
    ['Gate vs scipy', `The browser port matches processor.spectral_gate sample by sample (max error under ${TOL.gateMaxAbs.toExponential(0)}) on the reference signal.`, 'good', 'Checked'],
    ['Compressor and EQ vs pydub', `The ports match pydub ${pyd.versions.pydub} within ${TOL.int16Steps} int16 steps; the analytic EQ curve matches pydub tone gains within ${TOL.eqDb} dB.`, 'good', 'Checked'],
    ['SNR on a synthetic signal', `True SNR in and out at ${orList(SNR_LEVELS, 'and')} dB, white and pink noise, ${snrRef.seeds.length} seeds. Harmonic bursts, not speech.`, 'warn', 'Synthetic'],
    ['Speech quality (PESQ, STOI, DNSMOS, listening test)', 'Not measured. Needs a fixed set of real noisy/clean speech pairs with settings recorded.', 'bad', 'Missing'],
    ['Baselines', 'Not compared against noisereduce, RNNoise or DeepFilterNet.', 'bad', 'Missing'],
    ['Recorded file', 'One output, no matching settings, unknown speaker and consent record.', 'warn', 'Unscored'],
  ];
  const issues = [
    ['README vs code', `The EQ has no treble boost and its bass gain is about ${sgn(EQ_DC_DB, 0)} dB, not ${sgn(README_EQ.gainDb, 0)}. The gate threshold (${P.gate_threshold.toFixed(1)}× mean noise) was undocumented. README is now corrected.`],
    ['Silent-start assumption', `The noise profile is the first ${P.noise_profile_seconds} s, assumed speech-free. Nothing checks that; the playground shows what happens when it isn’t.`],
    ['Musical noise', 'A hard binary mask with a fixed floor and no smoothing over time or frequency. A soft (Wiener-style) gain would be the usual fix.'],
    ['Channels and clipping', 'Stereo input keeps the left channel only when the gate or EQ is on. The gate output is now clipped to ±1 before the int16 cast, so peaks over full scale saturate instead of wrapping.'],
    ['Upload handling', 'The client filename now goes through secure_filename, so uploads stay in uploads/. Still runs with debug=True and has no size limit: fine on localhost, unsafe on a server.'],
    ['Packaging', 'No pinned versions, and the README cites an MIT LICENSE file that does not exist.'],
  ];
  const docs = [
    ['docs/research-review.md', 'Research review', 'Graded rubric and open gaps'],
    ['processor.py', 'processor.py', 'The DSP chain'],
    ['scripts/make_reference.py', 'make_reference.py', 'References and SNR run'],
    ['tests/test_processor.py', 'Tests', 'unittest, numpy + scipy only'],
    ['results/gate_snr.json', 'gate_snr.json', 'The SNR table'],
    ['site/src/dsp.check.mjs', 'dsp.check.mjs', 'Build-time known-answer check'],
  ];
  return (
    <section id="receipts" className="card window reveal" data-title="README.md — receipts and gaps">
      <p className="eyebrow">Receipts, limitations, threats</p>
      <h2>What is measured, what is not, and what would break in production.</h2>
      <div className="grid2" style={{ marginTop: 16 }}>
        {measured.map(([t, d, tone, label]) => (
          <div className="tile" key={t}>
            <div className="head" style={{ marginBottom: 6 }}><h3>{t}</h3><span className={`pill ${tone}`}>{label}</span></div>
            <p className="hint" style={{ margin: 0, fontSize: 13 }}>{d}</p>
          </div>
        ))}
      </div>
      <h3 style={{ marginTop: 24 }}>Measured SNR (committed run, mean ± SD over {snrRef.seeds.length} seeds)</h3>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Noise</th><th>SNR in</th><th>SNR out</th><th>Gain</th><th>Noise left in silence</th></tr></thead>
          <tbody>
            {snrRef.rows.map((r) => (
              <tr key={r.noise + r.snr_in_db}><td>{r.noise}</td><td>{r.snr_in_db} dB</td><td>{r.snr_out_db_mean} ± {r.snr_out_db_sd} dB</td><td className="ok">{sgn(r.snr_gain_db_mean, 2)} dB</td><td>{r.residual_noise_db_mean} ± {r.residual_noise_db_sd} dB</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 style={{ marginTop: 24 }}>Engineering issues found in review (left for the owner to decide)</h3>
      <ul className="issues">
        {issues.map(([t, d]) => <li key={t}><b>{t}.</b> {d}</li>)}
      </ul>
      <p className="hint">Roadmap: SonicClear is the clean-up front end planned for voice-agent-lab (clean speech in, then transcription and agent steps).</p>
      <div className="docs" style={{ marginTop: 16 }}>
        {docs.map(([p, t, d]) => <a key={p} href={blob(p)}><b>{t}</b><small>{d}</small></a>)}
      </div>
    </section>
  );
}
