/** Unlock and reuse HTMLAudio so ringtones/chimes can play after the first tap. */

let unlocked = false;
let ringtoneEl: HTMLAudioElement | null = null;
let chimeEl: HTMLAudioElement | null = null;

export const RINGTONE_SRC = "/sounds/ringtone.mp3";
export const CHIME_SRC = "/sounds/message-chime.mp3";

function makeAudio(src: string, loop: boolean) {
  const el = new Audio(src);
  el.preload = "auto";
  el.loop = loop;
  el.setAttribute("playsinline", "true");
  return el;
}

function ensureElements() {
  if (typeof window === "undefined") return;
  if (!ringtoneEl) ringtoneEl = makeAudio(RINGTONE_SRC, true);
  if (!chimeEl) chimeEl = makeAudio(CHIME_SRC, false);
}

export function unlockAppAudio() {
  if (typeof window === "undefined" || unlocked) return;
  ensureElements();
  const prime = (el: HTMLAudioElement | null) => {
    if (!el) return;
    const wasMuted = el.muted;
    const wasVolume = el.volume;
    el.muted = true;
    el.volume = 0;
    void el
      .play()
      .then(() => {
        el.pause();
        el.currentTime = 0;
        el.muted = wasMuted;
        el.volume = wasVolume || 1;
        unlocked = true;
      })
      .catch(() => {
        el.muted = wasMuted;
        el.volume = wasVolume || 1;
      });
  };
  prime(ringtoneEl);
  prime(chimeEl);
}

export function bindAppAudioUnlock() {
  if (typeof window === "undefined") return () => {};
  const once = () => {
    unlockAppAudio();
    window.removeEventListener("pointerdown", once);
    window.removeEventListener("keydown", once);
    window.removeEventListener("touchstart", once);
  };
  window.addEventListener("pointerdown", once);
  window.addEventListener("keydown", once);
  window.addEventListener("touchstart", once, { passive: true });
  return () => {
    window.removeEventListener("pointerdown", once);
    window.removeEventListener("keydown", once);
    window.removeEventListener("touchstart", once);
  };
}

export function getRingtoneElement() {
  ensureElements();
  return ringtoneEl;
}

export function getChimeElement() {
  ensureElements();
  return chimeEl;
}

export function isAppAudioUnlocked() {
  return unlocked;
}
