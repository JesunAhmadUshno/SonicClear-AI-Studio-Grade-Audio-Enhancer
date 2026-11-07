"""Known-answer references and a synthetic-signal SNR measurement for SonicClear's DSP chain.

    python3 scripts/make_reference.py            # needs numpy + scipy (gate, params, SNR)
    pip install pydub==0.25.1                     # optional: adds the compressor and EQ references
                                                  # (raw int16 segments only, so no FFmpeg is needed)

Writes results/params.json, results/gate_reference.json, results/gate_snr.json and, when pydub
is importable, results/pydub_reference.json. The live dashboard (site/) reads these files, and
site/src/dsp.check.mjs asserts that its JavaScript port reproduces them.

The test signal is synthetic and deterministic: a mulberry32 generator (bit-identical to the
JavaScript copy in site/src/dsp.js) drives Gaussian noise, and the "speech" is three harmonic
bursts with a gliding pitch. Because the clean signal is known, SNR is exact. It is not speech,
so these numbers say how the gate treats stationary noise, not how it sounds on a voice.
"""
import json
import math
import os
import sys

sys.dont_write_bytecode = True
import numpy as np
import scipy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import processor  # noqa: E402

M32 = 0xFFFFFFFF
FS = 16000
DURATION = 4.0
BURSTS = [(1.1, 1.7, 120.0, 150.0), (1.9, 2.6, 140.0, 110.0), (2.9, 3.7, 115.0, 135.0)]  # start s, end s, f0 start, f0 end
N_HARMONICS = 24
PEAK = 0.3


def mulberry32(seed):
    a = seed & M32

    def rand():
        nonlocal a
        a = (a + 0x6D2B79F5) & M32
        t = ((a ^ (a >> 15)) * (1 | a)) & M32
        t = ((t + (((t ^ (t >> 7)) * (61 | t)) & M32)) & M32) ^ t
        return ((t ^ (t >> 14)) & M32) / 4294967296

    return rand


def clean_signal(fs=FS, duration=DURATION):
    n = int(round(fs * duration))
    x = [0.0] * n
    for start, end, f0a, f0b in BURSTS:
        i0, i1 = int(round(start * fs)), int(round(end * fs))
        length = i1 - i0
        phase = 0.0
        for i in range(length):
            u = i / length
            f0 = f0a + (f0b - f0a) * u
            phase += 2 * math.pi * f0 / fs
            env = 0.5 - 0.5 * math.cos(2 * math.pi * u)
            s = 0.0
            for k in range(1, N_HARMONICS + 1):
                if k * f0 < fs / 2:
                    # 1/k roll-off with a broad bump near 700 Hz, a crude first formant
                    s += math.sin(k * phase) / k * (1 + 2 * math.exp(-((k * f0 - 700) / 300) ** 2))
            x[i0 + i] = env * s
    peak = max(abs(v) for v in x)
    return [v * PEAK / peak for v in x]


def noise_signal(n, seed, colour):
    rand = mulberry32(seed)
    out = [0.0] * n
    b0 = b1 = b2 = 0.0
    for i in range(n):
        u1 = 1 - rand()
        u2 = rand()
        w = math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2)
        if colour == 'pink':  # Paul Kellet's economy pink filter
            b0 = 0.99765 * b0 + w * 0.0990460
            b1 = 0.96300 * b1 + w * 0.2965164
            b2 = 0.57000 * b2 + w * 1.0526913
            w = b0 + b1 + b2 + w * 0.1848
        out[i] = w
    return out


def mix(clean, noise, snr_db):
    ps = sum(v * v for v in clean)
    pn = sum(v * v for v in noise)
    g = math.sqrt(ps / (pn * 10 ** (snr_db / 10)))
    return [c + g * v for c, v in zip(clean, noise)], [g * v for v in noise]


def measure(clean, noisy, gated, fs=FS):
    c, x, y = np.array(clean), np.array(noisy), np.array(gated)[: len(clean)]
    k = int(fs * processor.NOISE_PROFILE_SECONDS)
    snr = lambda ref, est: 10 * math.log10(np.sum(ref ** 2) / np.sum((est - ref) ** 2))
    return {
        'snr_in_db': snr(c, x),
        'snr_out_db': snr(c, y),
        # level of what is left in the speech-free first second, relative to the noise that was there
        'residual_noise_db': 10 * math.log10(np.mean(y[:k] ** 2) / np.mean(x[:k] ** 2)),
    }


def write(name, obj):
    path = os.path.join(ROOT, 'results', name)
    with open(path, 'w') as f:
        json.dump(obj, f, indent=1)
        f.write('\n')
    print('wrote', os.path.relpath(path, ROOT))


def main():
    os.makedirs(os.path.join(ROOT, 'results'), exist_ok=True)
    signal = {'fs': FS, 'duration_s': DURATION, 'bursts': BURSTS, 'n_harmonics': N_HARMONICS, 'peak': PEAK}
    write('params.json', {
        'source': 'processor.py module constants',
        'noise_profile_seconds': processor.NOISE_PROFILE_SECONDS,
        'nperseg': processor.NPERSEG,
        'noverlap': processor.NPERSEG // 2,
        'gate_threshold': processor.GATE_THRESHOLD,
        'mask_floor': processor.MASK_FLOOR,
        'compress': processor.COMPRESS,
        'eq_lowpass_hz': processor.EQ_LOWPASS_HZ,
        'eq_gain_db': processor.EQ_GAIN_DB,
        'synthetic_signal': signal,
    })

    clean = clean_signal()
    versions = {'numpy': np.__version__, 'scipy': scipy.__version__}

    # 1. Gate reference: one fixed case, sampled output so the JSON stays small
    seed, snr_db, colour, stride = 7, 5.0, 'white', 61
    noisy, _ = mix(clean, noise_signal(len(clean), seed, colour), snr_db)
    gated = processor.spectral_gate(np.array(noisy, dtype=np.float64), FS)
    write('gate_reference.json', {
        'what': 'processor.spectral_gate on the seeded synthetic signal (float64 input)',
        'versions': versions, 'signal': signal, 'seed': seed, 'snr_db': snr_db, 'noise': colour,
        'output_length': int(len(gated)), 'stride': stride,
        'output_sampled': [round(float(v), 10) for v in gated[::stride]],
        'metrics': measure(clean, noisy, gated),
    })

    # 2. SNR before/after across input SNRs, both noise colours, 10 seeds each
    seeds = list(range(1, 11))
    rows = []
    for colour in ('white', 'pink'):
        for snr_db in (0.0, 5.0, 10.0):
            per = []
            for s in seeds:
                noisy, _ = mix(clean, noise_signal(len(clean), s, colour), snr_db)
                per.append(measure(clean, noisy, processor.spectral_gate(np.array(noisy), FS)))
            out = np.array([p['snr_out_db'] for p in per])
            res = np.array([p['residual_noise_db'] for p in per])
            rows.append({
                'noise': colour, 'snr_in_db': snr_db,
                'snr_out_db_mean': round(float(out.mean()), 3), 'snr_out_db_sd': round(float(out.std(ddof=1)), 3),
                'snr_gain_db_mean': round(float(out.mean() - snr_db), 3),
                'residual_noise_db_mean': round(float(res.mean()), 3), 'residual_noise_db_sd': round(float(res.std(ddof=1)), 3),
            })
    write('gate_snr.json', {
        'what': 'True SNR before and after processor.spectral_gate on a synthetic harmonic signal; not speech, not PESQ/STOI',
        'versions': versions, 'signal': signal, 'seeds': seeds, 'rows': rows,
    })

    # 3. pydub references for the compressor and the EQ (optional)
    try:
        from pydub import AudioSegment
        import pydub
    except ImportError:
        print('pydub not installed: skipped results/pydub_reference.json')
        return
    import array
    seg_from = lambda ints, fs=FS: AudioSegment(array.array('h', ints).tobytes(), frame_rate=fs, sample_width=2, channels=1)
    # loud slice of the noisy signal so the compressor engages: 2.5x clean + white noise at 20 dB SNR, 1.0 s to 1.6 s
    loud, _ = mix([2.5 * v for v in clean], noise_signal(len(clean), 3, 'white'), 20.0)
    ints = [int(max(-1.0, min(1.0, v)) * 32767) for v in loud[16000:25600]]
    comp = seg_from(ints).compress_dynamic_range(**processor.COMPRESS).get_array_of_samples()
    eq = seg_from(ints)
    eq = eq.low_pass_filter(processor.EQ_LOWPASS_HZ).apply_gain(processor.EQ_GAIN_DB).overlay(eq).get_array_of_samples()
    # measured EQ gain on pure tones at 48 kHz (the recorded file's rate), 1 s each, skipping the first 0.1 s
    tones = []
    for f in (50, 100, 250, 500, 1000, 3000, 6000, 10000):
        fs = 48000
        tone = [int(8000 * math.sin(2 * math.pi * f * i / fs)) for i in range(fs)]
        seg = seg_from(tone, fs)
        out = seg.low_pass_filter(processor.EQ_LOWPASS_HZ).apply_gain(processor.EQ_GAIN_DB).overlay(seg).get_array_of_samples()
        a, b = np.array(tone[fs // 10:], float), np.array(out[fs // 10:], float)
        tones.append({'hz': f, 'gain_db': round(10 * math.log10(np.mean(b ** 2) / np.mean(a ** 2)), 3)})
    stride = 7
    write('pydub_reference.json', {
        'what': 'pydub compress_dynamic_range and the EQ line from processor.py on a seeded int16 slice',
        'versions': {'pydub': pydub.__version__ if hasattr(pydub, '__version__') else '0.25.1', 'python': sys.version.split()[0]},
        'input': {'clean_gain': 2.5, 'noise_seed': 3, 'snr_db': 20.0, 'start': 16000, 'end': 25600, 'fs': FS},
        'stride': stride,
        'compress_out_sampled': list(comp[::stride]),
        'eq_out_sampled': list(eq[::stride]),
        'eq_tone_gain_db_48k': tones,
    })


if __name__ == '__main__':
    main()
