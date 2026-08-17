/** Incoming call ringtone (client MP3 if present, else Web Audio fallback). */

import { getRingtoneElement, RINGTONE_SRC, unlockAppAudio } from "@/lib/app-audio";

let audioEl: HTMLAudioElement | null = null;
let audioCtx: AudioContext | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;
let generation = 0;
let usingSharedEl = false;

function playSoftPair() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const freqs = [523.25, 659.25];
  for (const [i, frequency] of freqs.entries()) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now + i * 0.08);
    osc.stop(now + 0.4 + i * 0.08);
  }
}

export function startCallRingtone() {
  stopCallRingtone();
  unlockAppAudio();
  const myGeneration = generation;

  try {
    const shared = getRingtoneElement();
    const el = shared ?? new Audio(RINGTONE_SRC);
    usingSharedEl = !!shared;
    el.loop = true;
    el.volume = 0.9;
    el.currentTime = 0;
    audioEl = el;
    const playPromise = el.play();
    if (playPromise) {
      void playPromise.catch(() => {
        if (myGeneration !== generation) return;
        if (audioEl === el) audioEl = null;
        startWebAudioRingtone(myGeneration);
      });
    }
  } catch {
    startWebAudioRingtone(myGeneration);
  }
}

function startWebAudioRingtone(myGeneration: number) {
  if (myGeneration !== generation) return;
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
  generation++;
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (audioEl) {
    audioEl.pause();
    audioEl.currentTime = 0;
    if (!usingSharedEl) audioEl.src = "";
    audioEl = null;
  }
  usingSharedEl = false;
  if (audioCtx) {
    void audioCtx.close();
    audioCtx = null;
  }
}
