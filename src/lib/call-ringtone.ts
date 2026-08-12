/** Softer call ringtone (file if present, else pleasant Web Audio tones). */

let audioEl: HTMLAudioElement | null = null;
let audioCtx: AudioContext | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;

const RINGTONE_SRC = "/sounds/ringtone.mp3";

function playSoftPair() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const freqs = [523.25, 659.25]; // C5 / E5 — soft chime pair, not a siren
  for (const [i, frequency] of freqs.entries()) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now + i * 0.08);
    osc.stop(now + 0.4 + i * 0.08);
  }
}

export function startCallRingtone() {
  stopCallRingtone();

  try {
    audioEl = new Audio(RINGTONE_SRC);
    audioEl.loop = true;
    audioEl.volume = 0.55;
    const playPromise = audioEl.play();
    if (playPromise) {
      void playPromise.catch(() => {
        // Missing file or autoplay block — fall back to Web Audio
        audioEl = null;
        startWebAudioRingtone();
      });
    }
  } catch {
    startWebAudioRingtone();
  }
}

function startWebAudioRingtone() {
  try {
    audioCtx = new AudioContext();
    void audioCtx.resume();
    playSoftPair();
    intervalId = setInterval(playSoftPair, 1600);
  } catch {
    /* audio blocked until user gesture — overlay still shows */
  }
}

export function stopCallRingtone() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (audioEl) {
    audioEl.pause();
    audioEl.src = "";
    audioEl = null;
  }
  if (audioCtx) {
    void audioCtx.close();
    audioCtx = null;
  }
}
