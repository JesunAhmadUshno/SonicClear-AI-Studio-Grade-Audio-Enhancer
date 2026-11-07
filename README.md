# SonicClear AI: Studio-Grade Audio Enhancer

![Python Version](https://img.shields.io/badge/python-3.12-blue.svg)
![Framework](https://img.shields.io/badge/flask-3.0-green.svg)
![License](https://img.shields.io/badge/license-MIT-purple.svg)
![Status](https://img.shields.io/badge/status-stable-success.svg)

Live dashboard: https://jesunahmadushno.github.io/SonicClear-AI-Studio-Grade-Audio-Enhancer/
(the DSP chain ported to the browser, with live controls, measured SNR and the checks below).

SonicClear cleans and masters spoken audio. Upload a recording. The app
removes noise, evens out the volume, and applies a speech EQ curve. You
download a cleaner file.

## Start here

1. Clone this repo and install the requirements (Python 3.8 or newer,
   FFmpeg on your PATH):

   ```bash
   git clone https://github.com/JesunAhmadUshno/SonicClear-AI-Studio-Grade-Audio-Enhancer.git
   cd SonicClear-AI-Studio-Grade-Audio-Enhancer
   pip install -r requirements.txt
   ```

2. Run the app:

   ```bash
   python app.py
   ```

3. Open the local page. Upload a speech file. Download the cleaned
   result.

## What it does

Three steps run in order, in `processor.py`:

1. **Spectral gating (noise reduction).** The app takes the mean STFT
   magnitude of the first 1 second as the noise profile, so that second
   must be speech-free (nothing checks this). A time-frequency bin
   passes if it is louder than 2.0x the noise profile; every other bin
   is scaled by 0.1 (a hard mask, no smoothing).
2. **Dynamic compression.** pydub, threshold -20 dBFS, ratio 4:1,
   attack 5 ms, release 50 ms. Loud peaks get tamed. There is no
   make-up gain, so quiet speech is not lifted.
3. **Low-shelf EQ.** The code adds a +4 dB copy of a one-pole 250 Hz
   low-pass back onto the dry signal. That is about +8.3 dB at the
   lowest frequencies, fading to roughly +0.3 dB by 6 kHz (measured with
   pydub, `results/pydub_reference.json`). There is no treble boost,
   although earlier versions of this README described +4 dB below
   250 Hz and +4 dB above 6 kHz.

The interface draws the waveform with WaveSurfer.js, so you see the
audio while you work on it.

## Before and after samples

Sample slots. No audio samples ship in this repo yet, and none are
linked here until real ones are recorded from this app.

- SLOT `samples/before-sample.wav`: one noisy speech clip, 10 to 20
  seconds, recorded in a real room.
- SLOT `samples/after-sample.wav`: the same clip after one pass
  through SonicClear, with the settings recorded next to it.

## Quality, in numbers

| Item | Value |
| :--- | :--- |
| Noise profile window | First 1 second of the audio |
| Compression | Threshold -20 dB, ratio 4:1 |
| Gate threshold, mask floor | 2.0x mean noise magnitude, 0.1 |
| EQ curve | One-pole 250 Hz low-pass at +4 dB summed with dry: about +8.3 dB at DC, no treble boost |
| Synthetic-signal SNR gain | See `results/gate_snr.json`: true SNR before/after the gate on a seeded harmonic test signal, white and pink noise, 10 seeds |
| Speech quality score | TBD-NO-RECORD: no PESQ, STOI, DNSMOS or listening-test run is recorded in this repo |

The settings above come from the code (`results/params.json` is
generated from `processor.py`). The SNR numbers are on a synthetic
signal where the clean answer is known; they are not a speech-quality
score. That needs real noisy/clean speech pairs and a scored run, which
has not been done. See `docs/research-review.md` for the full list of
gaps.

## Tests and references

```bash
python3 -m unittest discover -s tests     # needs requirements.txt (Flask, pydub; no FFmpeg)
                                          # tests/test_processor.py alone needs numpy + scipy only
python3 scripts/make_reference.py         # regenerates results/*.json
                                          # (pip install pydub==0.25.1 for the compressor/EQ reference)
cd site && npm ci && npm run build        # the build re-checks the browser port against results/
```

## Technology stack

| Component | Tech | Role |
| :--- | :--- | :--- |
| Web framework | Flask | Routes and file handling (`app.py`) |
| DSP core | NumPy, SciPy | STFT, spectral gating, EQ (`processor.py`) |
| Audio I/O | Pydub (FFmpeg) | Format conversion |
| Frontend | HTML, CSS, JavaScript | One page, glass design |
| Visualization | WaveSurfer.js | Waveform display |

Requirements, from `requirements.txt`: Flask, pydub, numpy, scipy,
werkzeug.

## Project structure

```
SonicClear-AI-Studio-Grade-Audio-Enhancer/
├── app.py            # Flask server and routes
├── processor.py      # The DSP chain: gating, compression, EQ
├── requirements.txt  # Python dependencies
├── templates/        # The one page
├── static/           # Styles and client script
├── uploads/          # Runtime storage for files in process
├── scripts/          # make_reference.py: known-answer references, SNR run
├── results/          # Generated JSON the dashboard reads
├── tests/            # unittest suite: DSP, process_audio, upload handler
└── site/             # The live dashboard (Vite + React)
```

## This repo and the roadmap

SonicClear is the Learn base for voice-agent-lab (roadmap project 18).
The cleanup chain here is the front end of that project: clean speech
in, then transcription and agent steps on top.

## License

The badge says MIT, but no LICENSE file is in the repo yet, so no
licence has actually been granted. Adding one is the owner's call.

Built by Jesun Ahmad Ushno.
