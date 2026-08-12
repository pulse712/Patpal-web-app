/** Short message notification chime for in-app alerts. */

let lastPlayedAt = 0;

const CHIME_SRC = "/sounds/message-chime.mp3";

export function playMessageChime() {
  const now = Date.now();
  if (now - lastPlayedAt < 800) return;
  lastPlayedAt = now;

  try {
    const audio = new Audio(CHIME_SRC);
    audio.volume = 0.45;
    void audio.play().catch(() => playWebAudioChime());
  } catch {
    playWebAudioChime();
  }
}

function playWebAudioChime() {
  try {
    const ctx = new AudioContext();
    void ctx.resume();
    const now = ctx.currentTime;
    const freqs = [784, 1046.5]; // G5 / C6
    for (const [i, frequency] of freqs.entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.07, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.07);
      osc.stop(now + 0.25 + i * 0.07);
    }
    setTimeout(() => void ctx.close(), 500);
  } catch {
    /* ignore */
  }
}
