/** Simple repeating ringtone for incoming audio/video calls. */

let audioCtx: AudioContext | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;

function playTone(frequency: number, durationMs: number) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.value = frequency;
  gain.gain.value = 0.08;
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + durationMs / 1000);
}

export function startCallRingtone() {
  stopCallRingtone();

  try {
    audioCtx = new AudioContext();
    void audioCtx.resume();

    let high = true;
    playTone(high ? 880 : 660, 400);
    intervalId = setInterval(() => {
      high = !high;
      playTone(high ? 880 : 660, 400);
    }, 500);
  } catch {
    /* audio blocked until user gesture — overlay still shows */
  }
}

export function stopCallRingtone() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (audioCtx) {
    void audioCtx.close();
    audioCtx = null;
  }
}
