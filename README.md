# SonicClear AI: Studio-Grade Audio Enhancer

![Python Version](https://img.shields.io/badge/python-3.12-blue.svg)
![Framework](https://img.shields.io/badge/flask-3.0-green.svg)
![License](https://img.shields.io/badge/license-MIT-purple.svg)
![Status](https://img.shields.io/badge/status-stable-success.svg)

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

1. **Spectral gating (noise reduction).** The app profiles the noise
   from the first 1 second of audio. It then runs an FFT and subtracts
   the noise frequencies with a dynamic mask (0.1 factor on non-vocal
   signal). The voice stays; the room tone drops.
2. **Dynamic compression.** Threshold -20 dB, ratio 4:1. Quiet speech
   gets lifted. Loud peaks get tamed.
3. **Broadcast EQ.** A speech curve: +4 dB below 250 Hz for warmth,
   +4 dB above 6 kHz for clarity.

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
| EQ curve | +4 dB below 250 Hz, +4 dB above 6 kHz |
| Files in repo | 10 (one Flask app, one DSP module, one page) |
| Measured quality score | TBD-NO-RECORD: no SNR, PESQ, or listening-test run is recorded in this repo |

The settings above come from the code and the project record. A
measured quality score needs a fixed test clip and a scored run. That
run has not been recorded yet, so this table claims none.

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
└── uploads/          # Runtime storage for files in process
```

## This repo and the roadmap

SonicClear is the Learn base for voice-agent-lab (roadmap project 18).
The cleanup chain here is the front end of that project: clean speech
in, then transcription and agent steps on top.

## License

Distributed under the MIT License. See LICENSE for more information.

Built by Jesun Ahmad Ushno.
