type AgoraSdk = typeof import("agora-rtc-sdk-ng").default;
type CallKind = "audio" | "video";

let agoraSdkPromise: Promise<AgoraSdk> | null = null;
let mediaPrimePromise: Promise<void> | null = null;

async function primeMediaPermission(constraints: MediaStreamConstraints): Promise<boolean> {
  if (!navigator.mediaDevices?.getUserMedia) return false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch {
    return false;
  }
}

/** Start loading the Agora SDK before CallScreen mounts. */
export function preloadAgoraSdk(): Promise<AgoraSdk> {
  if (!agoraSdkPromise) {
    agoraSdkPromise = import("agora-rtc-sdk-ng").then((mod) => mod.default);
  }
  return agoraSdkPromise;
}

/** Prompt for mic/camera while the incoming-call overlay is visible. */
export function preloadCallMedia(kind: CallKind): Promise<void> {
  mediaPrimePromise = primeMediaPermission(
    kind === "video" ? { audio: true, video: true } : { audio: true },
  ).then(() => undefined);
  return mediaPrimePromise;
}

/** Await in-flight media prewarm, if any. */
export async function awaitCallMediaPrewarm(): Promise<void> {
  if (mediaPrimePromise) {
    await mediaPrimePromise.catch(() => undefined);
  }
}

export function resetCallPrewarm() {
  mediaPrimePromise = null;
}
