import numpy as np
import scipy.signal
import scipy.io.wavfile
import os

# The chain's constants, in one place. scripts/make_reference.py copies them into
# results/params.json, which the live dashboard reads, so the site cannot drift from the code.
NOISE_PROFILE_SECONDS = 1.0   # noise is learned from the first second (assumed to be speech-free)
NPERSEG = 1024                # STFT frame length; scipy defaults: Hann window, 50% overlap
GATE_THRESHOLD = 2.0          # a bin passes if its magnitude exceeds this multiple of the mean noise magnitude
MASK_FLOOR = 0.1              # bins below the threshold are scaled by this, not removed
COMPRESS = dict(threshold=-20.0, ratio=4.0, attack=5.0, release=50.0)  # pydub compress_dynamic_range
EQ_LOWPASS_HZ = 250           # pydub one-pole low_pass_filter cutoff
EQ_GAIN_DB = 4                # gain on the low-passed copy, which is then summed with the dry signal


def spectral_gate(data_float, sample_rate):
    """Spectral gating on a mono float signal. Returns the gated signal (scipy istft length)."""
    noise_sample_len = min(len(data_float), int(sample_rate * NOISE_PROFILE_SECONDS))
    noise_profile = data_float[:noise_sample_len]

    f, t, Zxx = scipy.signal.stft(data_float, fs=sample_rate, nperseg=NPERSEG)
    _, _, Zxx_noise = scipy.signal.stft(noise_profile, fs=sample_rate, nperseg=NPERSEG)
    noise_spectrum = np.mean(np.abs(Zxx_noise), axis=1, keepdims=True)

    threshold = GATE_THRESHOLD * noise_spectrum
    mask = np.where(np.abs(Zxx) > threshold, 1.0, MASK_FLOOR)
    _, denoised_data = scipy.signal.istft(Zxx * mask, fs=sample_rate)
    return denoised_data


def process_audio(input_path, output_path, options):
    # pydub (and FFmpeg) are only needed for file I/O, so the DSP above stays importable without them.
    from pydub import AudioSegment

    # 1. Load Audio
    audio = AudioSegment.from_file(input_path)
    sample_rate = audio.frame_rate
    
    # Check options
    do_denoise = options.get('denoise') == 'true'
    do_compress = options.get('compress') == 'true'
    do_eq = options.get('eq') == 'true'

    # Convert to numpy for processing if needed
    if do_denoise or do_eq:
        samples = np.array(audio.get_array_of_samples())
        if audio.channels == 2:
            samples = samples.reshape((-1, 2))
            data = samples[:, 0] # Left channel for analysis
        else:
            data = samples
        
        # Normalize
        data_float = data.astype(np.float32) / np.iinfo(samples.dtype).max

    # --- PROCESS: NOISE REDUCTION ---
    if do_denoise:
        denoised_data = spectral_gate(data_float, sample_rate)
        
        # Reconstruct AudioSegment
        # The ISTFT can overshoot full scale on loud material: clip so it saturates instead of wrapping
        denoised_data_int = (np.clip(denoised_data, -1.0, 1.0) * np.iinfo(np.int16).max).astype(np.int16)
        audio = AudioSegment(
            denoised_data_int.tobytes(), 
            frame_rate=sample_rate,
            sample_width=2, 
            channels=1
        )

    # --- PROCESS: COMPRESSION ---
    if do_compress:
        audio = audio.compress_dynamic_range(**COMPRESS)

    # --- PROCESS: EQ (Simple Gain) ---
    if do_eq:
        # Pydub simple filter simulation
        # Sums a +4 dB low-passed copy with the dry signal: about +8.3 dB at DC, falling
        # toward 0 dB at high frequencies. There is no treble boost (see docs/research-review.md).
        audio = audio.low_pass_filter(EQ_LOWPASS_HZ).apply_gain(EQ_GAIN_DB).overlay(audio)
        # Note: A real parametric EQ is complex in pure Python; this is a simplified "Loudness" effect.

    # Export
    audio.export(output_path, format="mp3")
    return output_path