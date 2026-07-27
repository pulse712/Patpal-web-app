/**
 * CallScreen — full-screen call overlay with Agora RTC + session billing.
 *
 * Features:
 *  - Audio / video call via Agora
 *  - Starts a session record on server, debits wallet on end
 *  - Live countdown of remaining balance
 *  - 2-minute warning popup with quick top-up ($5 / $10 / $15 / custom)
 *  - Mid-call Stripe top-up (no page redirect, stays in call)
 *  - Grace period: 30 s after balance hits 0 before forced end
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  Loader2,
  Volume2,
  AlertTriangle,
  Plus,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { getAgoraToken } from "@/lib/agora.functions";
import {
  startSession,
  endSession,
  cancelSession,
  createTopUpIntent,
  declineIncomingCall,
  markSessionConnected,
  getActiveSessionBilling,
} from "@/lib/session.functions";
import { notifyIncomingCall } from "@/lib/notify.functions";
import { RatingModal } from "@/components/RatingModal";
import { CallTopUpPayment } from "@/components/CallTopUpPayment";

type CallKind = "audio" | "video";

interface CallScreenProps {
  channelName: string;
  kind: CallKind;
  remoteName: string;
  palId: string;
  conversationId?: string;
  callerName?: string;
  role?: "caller" | "callee";
  sessionId?: string;
  onEnd: () => void;
}

// Agora dynamic import types
type AgoraClient = import("agora-rtc-sdk-ng").IAgoraRTCClient;
type ILocalAudio = import("agora-rtc-sdk-ng").ILocalAudioTrack;
type ILocalVideo = import("agora-rtc-sdk-ng").ILocalVideoTrack;
type IRemoteAudio = import("agora-rtc-sdk-ng").IRemoteAudioTrack;
type IRemoteVideo = import("agora-rtc-sdk-ng").IRemoteVideoTrack;

const GRACE_SECONDS = 30; // extra seconds after balance runs out before forced end
const WARN_SECONDS = 120; // show top-up warning when this many seconds remain
const RING_TIMEOUT_MS = 45_000; // auto-cancel if pal never answers

const TOP_UP_PRESETS = [
  { label: "$5", cents: 500 },
  { label: "$10", cents: 1000 },
  { label: "$15", cents: 1500 },
];

type AgoraSdk = typeof import("agora-rtc-sdk-ng").default;

function mediaAccessError(err: unknown, device: "microphone" | "camera"): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("PERMISSION_DENIED") || message.includes("NotAllowedError")) {
    return device === "camera"
      ? "Camera access denied. Allow camera permission in your browser and try again."
      : "Microphone access denied. Allow microphone permission in your browser and try again.";
  }
  if (message.includes("DEVICE_NOT_FOUND") || message.includes("NotFoundError")) {
    return device === "camera"
      ? "No camera found on this device."
      : "No microphone found. Connect a mic and allow browser access.";
  }
  return `Could not access ${device}. Check browser permissions and connected devices.`;
}

function isMediaDeviceError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes("DEVICE_NOT_FOUND") ||
    message.includes("NotFoundError") ||
    message.includes("PERMISSION_DENIED") ||
    message.includes("NotAllowedError")
  );
}

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

async function createMicrophoneTrack(AgoraRTC: AgoraSdk): Promise<ILocalAudio | null> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser does not support microphone access. Try Chrome, Edge, or Safari.");
  }

  await primeMediaPermission({ audio: true });

  const mics = await AgoraRTC.getMicrophones();
  for (const mic of mics) {
    if (!mic.deviceId) continue;
    try {
      return await AgoraRTC.createMicrophoneAudioTrack({ microphoneId: mic.deviceId });
    } catch {
      /* try next device */
    }
  }

  try {
    return await AgoraRTC.createMicrophoneAudioTrack();
  } catch (err) {
    if (isMediaDeviceError(err)) return null;
    throw new Error(mediaAccessError(err, "microphone"));
  }
}

async function createCameraTrack(AgoraRTC: AgoraSdk): Promise<ILocalVideo | null> {
  if (!navigator.mediaDevices?.getUserMedia) return null;

  await primeMediaPermission({ video: true });

  const cameras = await AgoraRTC.getCameras();
  for (const camera of cameras) {
    if (!camera.deviceId) continue;
    try {
      return await AgoraRTC.createCameraVideoTrack({ cameraId: camera.deviceId });
    } catch {
      /* try next device */
    }
  }

  try {
    return await AgoraRTC.createCameraVideoTrack();
  } catch (err) {
    if (isMediaDeviceError(err)) return null;
    throw new Error(mediaAccessError(err, "camera"));
  }
}

async function createLocalMediaTracks(
  AgoraRTC: AgoraSdk,
  kind: CallKind,
): Promise<{
  audio: ILocalAudio | null;
  video: ILocalVideo | null;
  videoUnavailable: boolean;
  listenOnly: boolean;
}> {
  const audio = await createMicrophoneTrack(AgoraRTC);

  if (kind === "audio") {
    return { audio, video: null, videoUnavailable: false, listenOnly: !audio };
  }

  const video = await createCameraTrack(AgoraRTC);
  return {
    audio,
    video,
    videoUnavailable: !video,
    listenOnly: !audio,
  };
}

export function CallScreen({
  channelName,
  kind,
  remoteName,
  palId,
  conversationId,
  callerName,
  role = "caller",
  sessionId,
  onEnd,
}: CallScreenProps) {
  const isCallee = role === "callee";
  // ── Agora state ──────────────────────────────────────────────────────────
  const [status, setStatus] = useState<"connecting" | "connected" | "ended">("connecting");
  const [muted, setMuted] = useState(false);
  const [listenOnly, setListenOnly] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [remoteJoined, setRemoteJoined] = useState(false);

  // ── Billing state ────────────────────────────────────────────────────────
  const [balanceSec, setBalanceSec] = useState<number | null>(null); // null = loading
  const [isUnlimited, setIsUnlimited] = useState(false);
  const [elapsed, setElapsed] = useState(0); // seconds since connected
  const elapsedRef = useRef(0); // always-current value for handleEnd
  const [graceRemaining, setGraceRemaining] = useState<number | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  // ── Top-up modal state ───────────────────────────────────────────────────
  const [showTopUp, setShowTopUp] = useState(false);
  const [topUpCents, setTopUpCents] = useState<number | null>(null);
  const [customInput, setCustomInput] = useState("");
  const [topUpBusy, setTopUpBusy] = useState(false);
  const [topUpDone, setTopUpDone] = useState(false);
  const [topUpClientSecret, setTopUpClientSecret] = useState<string | null>(null);
  const [topUpPurchasedSeconds, setTopUpPurchasedSeconds] = useState(0);
  const warnFiredRef = useRef(false);
  const [billingActive, setBillingActive] = useState(false);
  const billableCapRef = useRef<number | null>(null);

  // ── Rating state ─────────────────────────────────────────────────────────
  const [showRating, setShowRating] = useState(false);
  const palIdForRating = useRef(palId);
  const hasEndedRef = useRef(false); // guard against double-end
  const wasConnectedRef = useRef(false);
  const hasMarkedConnectedRef = useRef(false);
  const endCallRemotelyRef = useRef<() => void>(() => {});
  const [watchSessionId, setWatchSessionId] = useState<string | null>(sessionId ?? null);

  async function ensureSessionConnected() {
    if (hasMarkedConnectedRef.current || !sessionIdRef.current) return;

    const sid = sessionIdRef.current;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await markSessionConnected({ data: { sessionId: sid } });
        hasMarkedConnectedRef.current = true;
        wasConnectedRef.current = true;
        setBillingActive(true);
        setElapsed(0);
        elapsedRef.current = 0;

        if (!isCallee && !isUnlimited) {
          const billing = await getActiveSessionBilling({ data: { sessionId: sid } });
          billableCapRef.current = billing.billableSecondsRemaining;
          setBalanceSec(billing.balanceSeconds);
        }

        startElapsedTimer();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }

    toast.error("Could not confirm call connection. Ending call.");
    void handleEnd();
  }

  // ── Agora refs ────────────────────────────────────────────────────────────
  const clientRef = useRef<AgoraClient | null>(null);
  const localAudioRef = useRef<ILocalAudio | null>(null);
  const localVideoRef = useRef<ILocalVideo | null>(null);
  const localVideoElRef = useRef<HTMLDivElement>(null);
  const remoteVideoElRef = useRef<HTMLDivElement>(null);

  // ── Timers ────────────────────────────────────────────────────────────────
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const graceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─────────────────────────────────────────────────────────────────────────
  // Join Agora + start session
  // ─────────────────────────────────────────────────────────────────────────
  const joinChannel = useCallback(async () => {
    let sessionCreated = false;
    try {
      const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;
      AgoraRTC.setLogLevel(import.meta.env.DEV ? 1 : 4);

      if (isCallee) {
        sessionIdRef.current = sessionId ?? null;
        if (sessionIdRef.current) setWatchSessionId(sessionIdRef.current);
      } else {
        const sessionData = await startSession({
          data: { palId, conversationId, kind },
        });
        sessionIdRef.current = sessionData.sessionId;
        setWatchSessionId(sessionData.sessionId);
        sessionCreated = true;
        setBalanceSec(sessionData.isUnlimited ? Infinity : sessionData.balanceSeconds);
        setIsUnlimited(sessionData.isUnlimited);

        notifyIncomingCall({
          data: {
            recipientId: palId,
            kind,
            conversationId,
            sessionId: sessionData.sessionId,
          },
        }).catch(() => {
          /* best-effort push */
        });
      }

      if (!sessionIdRef.current) {
        throw new Error("No active call session.");
      }

      const agoraChannel = sessionIdRef.current;
      const { token, appId, uid: agoraUid } = await getAgoraToken({ data: { channelName: agoraChannel } });
      if (!appId) throw new Error("Agora App ID not configured.");

      const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
      clientRef.current = client;

      client.on("user-published", async (user, mediaType) => {
        await client.subscribe(user, mediaType);
        if (mediaType === "audio") (user.audioTrack as IRemoteAudio)?.play();
        if (mediaType === "video" && remoteVideoElRef.current)
          (user.videoTrack as IRemoteVideo)?.play(remoteVideoElRef.current);
        setRemoteJoined(true);
        setStatus("connected");
        void ensureSessionConnected();
      });

      client.on("user-unpublished", (_u, mt) => {
        if (mt === "video") setRemoteJoined(false);
      });
      client.on("user-left", () => {
        setRemoteJoined(false);
        endCallRemotelyRef.current();
      });

      await client.join(appId, agoraChannel, token ?? null, agoraUid);

      const { audio, video, videoUnavailable, listenOnly: noMic } =
        await createLocalMediaTracks(AgoraRTC, kind);
      localAudioRef.current = audio;
      if (noMic) {
        setListenOnly(true);
        setMuted(true);
        toast.warning("No microphone detected — you can listen but not speak.");
      }
      if (videoUnavailable) {
        setCamOff(true);
        if (kind === "video") {
          toast.warning("Camera not available — joined as audio only.");
        }
      }

      const tracksToPublish = [audio, video].filter(Boolean) as Array<ILocalAudio | ILocalVideo>;
      if (tracksToPublish.length > 0) {
        await client.publish(tracksToPublish);
      }
      if (video) {
        localVideoRef.current = video;
        if (localVideoElRef.current) video.play(localVideoElRef.current);
      }

      setStatus("connected");
      if (client.remoteUsers.length > 0) {
        void ensureSessionConnected();
      }
    } catch (err: unknown) {
      console.error("[CallScreen] Join failed:", err);
      if (sessionCreated && sessionIdRef.current) {
        try {
          await cancelSession({ data: { sessionId: sessionIdRef.current } });
        } catch (cleanupErr) {
          console.error("[CallScreen] Session cleanup failed:", cleanupErr);
        }
        sessionIdRef.current = null;
      } else if (isCallee && sessionIdRef.current) {
        try {
          await declineIncomingCall({ data: { sessionId: sessionIdRef.current } });
        } catch (cleanupErr) {
          console.error("[CallScreen] Session cleanup failed:", cleanupErr);
        }
        sessionIdRef.current = null;
      }
      const message =
        err instanceof Error
          ? err.message
          : isMediaDeviceError(err)
            ? "Could not access microphone or camera."
            : "Could not start call";
      toast.error(message);
      await leaveChannel();
      onEnd();
    }
  }, [channelName, kind, palId, conversationId, remoteName, isCallee, sessionId]); // eslint-disable-line

  function startElapsedTimer() {
    if (elapsedTimerRef.current) return; // already running
    elapsedTimerRef.current = setInterval(() => {
      setElapsed((e) => {
        const next = e + 1;
        elapsedRef.current = next;
        return next;
      });
    }, 1000);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Watch balance & elapsed to trigger warning / grace / forced end
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!billingActive || isUnlimited || balanceSec === null || isCallee) return;

    const cap = billableCapRef.current ?? balanceSec;
    const remaining = cap - elapsed;

    // 2-minute warning
    if (!warnFiredRef.current && remaining <= WARN_SECONDS && remaining > 0) {
      warnFiredRef.current = true;
      setShowTopUp(true);
    }

    // Balance depleted — start grace countdown (only if not already running)
    if (remaining <= 0 && graceRemaining === null && !graceTimerRef.current) {
      setGraceRemaining(GRACE_SECONDS);
      graceTimerRef.current = setInterval(() => {
        setGraceRemaining((g) => {
          if (g === null || g <= 1) {
            if (graceTimerRef.current) {
              clearInterval(graceTimerRef.current);
              graceTimerRef.current = null;
            }
            handleEnd(); // forced end after grace
            return 0;
          }
          return g - 1;
        });
      }, 1000);
    }
  }, [elapsed, balanceSec, isUnlimited, graceRemaining, isCallee, billingActive]); // eslint-disable-line

  async function waitForTopUpApplied(purchasedSeconds: number) {
    const sid = sessionIdRef.current;
    if (!sid) return;

    const baseline = billableCapRef.current ?? 0;
    for (let i = 0; i < 20; i++) {
      const billing = await getActiveSessionBilling({ data: { sessionId: sid } });
      if (billing.isUnlimited) {
        setIsUnlimited(true);
        setBalanceSec(Infinity);
        billableCapRef.current = Infinity;
        setElapsed(0);
        elapsedRef.current = 0;
        return;
      }
      if (
        billing.billableSecondsRemaining >= baseline + purchasedSeconds - 2 ||
        billing.balanceSeconds >= (balanceSec ?? 0) + purchasedSeconds - 2
      ) {
        billableCapRef.current = billing.billableSecondsRemaining;
        setBalanceSec(billing.balanceSeconds);
        setElapsed(0);
        elapsedRef.current = 0;
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    toast.warning("Payment received — balance may take a moment to update.");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Leave Agora + end session
  // ─────────────────────────────────────────────────────────────────────────
  const leaveChannel = useCallback(async () => {
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    if (graceTimerRef.current) clearInterval(graceTimerRef.current);
    localAudioRef.current?.close();
    localVideoRef.current?.close();
    try {
      await clientRef.current?.leave();
    } catch {
      /* ignore */
    }
    clientRef.current = null;
    localAudioRef.current = null;
    localVideoRef.current = null;
  }, []);

  async function cleanupSession(billSession: boolean) {
    if (!sessionIdRef.current) return;
    const sid = sessionIdRef.current;
    try {
      if (isCallee) {
        if (billSession && wasConnectedRef.current) {
          await endSession({ data: { sessionId: sid } });
        } else {
          await declineIncomingCall({ data: { sessionId: sid } });
        }
      } else if (billSession && wasConnectedRef.current) {
        await endSession({ data: { sessionId: sid } });
      } else {
        await cancelSession({ data: { sessionId: sid } });
      }
    } catch (err) {
      console.error("[CallScreen] session cleanup failed:", err);
    }
  }

  const handleRemoteEnd = useCallback(async () => {
    if (hasEndedRef.current) return;
    hasEndedRef.current = true;
    setStatus("ended");
    toast.info(`${remoteName} ended the call.`);
    if (wasConnectedRef.current) {
      await cleanupSession(true);
    }
    await leaveChannel();
    onEnd();
  }, [leaveChannel, onEnd, remoteName, isCallee]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    endCallRemotelyRef.current = () => {
      void handleRemoteEnd();
    };
  }, [handleRemoteEnd]);

  useEffect(() => {
    if (!watchSessionId) return;

    const channel = supabase
      .channel(`call-session:${watchSessionId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "sessions",
          filter: `id=eq.${watchSessionId}`,
        },
        (payload) => {
          const row = payload.new as { status?: string };
          if (row.status === "ended" || row.status === "cancelled") {
            endCallRemotelyRef.current();
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [watchSessionId]);

  async function handleEnd() {
    if (hasEndedRef.current) return; // prevent double-end from race conditions
    hasEndedRef.current = true;
    setStatus("ended");

    await cleanupSession(true);
    await leaveChannel();

    if (!isCallee && elapsed >= 30 && sessionIdRef.current) {
      setShowRating(true);
    } else {
      onEnd();
    }
  }

  useEffect(() => {
    joinChannel();
    return () => {
      if (!hasEndedRef.current) {
        hasEndedRef.current = true;
        void cleanupSession(wasConnectedRef.current);
      }
      void leaveChannel();
    };
  }, []); // eslint-disable-line

  // Caller-side ring timeout — free the active-session slot if pal never answers
  useEffect(() => {
    if (isCallee || status !== "connected" || remoteJoined || wasConnectedRef.current) return;

    const timer = window.setTimeout(() => {
      if (wasConnectedRef.current || remoteJoined) return;
      toast.info("No answer — call ended.");
      void handleEnd();
    }, RING_TIMEOUT_MS);

    return () => window.clearTimeout(timer);
  }, [isCallee, status, remoteJoined]); // eslint-disable-line

  // ─────────────────────────────────────────────────────────────────────────
  // Mid-call top-up via Stripe PaymentIntent + Payment Element
  // Shows a minimal card input UI overlay if no saved card exists.
  // ─────────────────────────────────────────────────────────────────────────
  async function startTopUp(cents: number) {
    setTopUpBusy(true);
    try {
      const { clientSecret, seconds } = await createTopUpIntent({
        data: {
          cents,
          sessionId: sessionIdRef.current ?? undefined,
        },
      });
      setTopUpPurchasedSeconds(seconds);
      setTopUpClientSecret(clientSecret);
    } catch (err: unknown) {
      console.error("[CallScreen] Top-up setup failed:", err);
      toast.error(err instanceof Error ? err.message : "Could not start payment");
    } finally {
      setTopUpBusy(false);
    }
  }

  async function onTopUpPaymentSuccess() {
    setTopUpClientSecret(null);
    setTopUpBusy(true);
    try {
      await waitForTopUpApplied(topUpPurchasedSeconds);
      warnFiredRef.current = false;
      if (graceTimerRef.current) {
        clearInterval(graceTimerRef.current);
        graceTimerRef.current = null;
        setGraceRemaining(null);
      }
      setTopUpDone(true);
      toast.success(`${Math.round(topUpPurchasedSeconds / 60)} min added to your balance!`, {
        icon: <CheckCircle2 className="h-4 w-4 text-green-500" />,
      });
      setTimeout(() => {
        setShowTopUp(false);
        setTopUpDone(false);
        setTopUpCents(null);
        setCustomInput("");
      }, 2000);
    } finally {
      setTopUpBusy(false);
    }
  }

  function cancelTopUpPayment() {
    setTopUpClientSecret(null);
  }

  async function confirmTopUp(cents: number) {
    await startTopUp(cents);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Mute / camera
  // ─────────────────────────────────────────────────────────────────────────
  async function toggleMute() {
    if (!localAudioRef.current) return;
    const next = !muted;
    await localAudioRef.current.setMuted(next);
    setMuted(next);
  }

  async function toggleCam() {
    if (!localVideoRef.current) return;
    const next = !camOff;
    await localVideoRef.current.setMuted(next);
    setCamOff(next);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────
  function fmt(s: number) {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60)
      .toString()
      .padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  }

  const billableRemaining =
    isCallee || balanceSec === null || isUnlimited
      ? null
      : Math.max(0, (billableCapRef.current ?? balanceSec) - elapsed);
  const remaining = billableRemaining;
  const remainingLow =
    !isCallee && remaining !== null && isFinite(remaining) && remaining <= WARN_SECONDS;
  const inGrace = graceRemaining !== null;

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-950 text-white">
      {/* ── Remote video / audio area ──────────────────────────────────── */}
      {kind === "video" ? (
        <div ref={remoteVideoElRef} className="flex-1 bg-gray-900">
          {!remoteJoined && (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <div className="grid h-20 w-20 place-items-center rounded-full bg-primary/20 text-4xl font-bold text-primary">
                {remoteName.slice(0, 1).toUpperCase()}
              </div>
              <p className="text-lg font-semibold">{remoteName}</p>
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                {status === "connecting" ? "Connecting…" : "Waiting for other person…"}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <div className="grid h-24 w-24 place-items-center rounded-full bg-primary/20 text-4xl font-bold text-primary">
            {remoteName.slice(0, 1).toUpperCase()}
          </div>
          <p className="text-xl font-bold">{remoteName}</p>
          {status === "connecting" ? (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Connecting…
            </div>
          ) : remoteJoined ? (
            <div className="flex items-center gap-2 text-sm text-green-400">
              <Volume2 className="h-4 w-4" /> On call · {fmt(elapsed)}
            </div>
          ) : (
            <p className="text-sm text-gray-400">Ringing…</p>
          )}
        </div>
      )}

      {/* ── Local video PiP ───────────────────────────────────────────── */}
      {kind === "video" && (
        <div
          ref={localVideoElRef}
          className={cn(
            "absolute right-4 top-4 h-32 w-24 overflow-hidden rounded-xl border-2 border-white/20 bg-gray-800",
            camOff && "opacity-30",
          )}
        />
      )}

      {/* ── Balance / duration overlay ────────────────────────────────── */}
      <div className="absolute left-4 top-4 flex flex-col gap-1">
        {kind === "video" && (
          <div className="rounded-full bg-black/50 px-3 py-1 text-xs font-mono">{fmt(elapsed)}</div>
        )}
        {!isCallee && !isUnlimited && remaining !== null && (
          <div
            className={cn(
              "rounded-full px-3 py-1 text-xs font-mono font-semibold",
              inGrace
                ? "bg-red-600/90 animate-pulse"
                : remainingLow
                  ? "bg-orange-500/80"
                  : "bg-black/50",
            )}
          >
            {inGrace ? `Ending in ${graceRemaining}s` : `${fmt(Math.max(0, remaining))} left`}
          </div>
        )}
      </div>

      {/* ── 2-minute warning / top-up modal ──────────────────────────── */}
      {!isCallee && showTopUp && (
        <div className="absolute inset-x-4 top-20 z-10 rounded-2xl bg-gray-900 border border-white/10 p-5 shadow-2xl">
          {topUpDone ? (
            <div className="flex flex-col items-center gap-2 py-2 text-green-400">
              <CheckCircle2 className="h-8 w-8" />
              <p className="font-semibold">Time added!</p>
            </div>
          ) : (
            <>
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 shrink-0 text-orange-400 mt-0.5" />
                <div>
                  <p className="font-semibold text-white leading-tight">
                    {inGrace ? "Balance depleted" : "Running low on time"}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {inGrace
                      ? "Add time to keep the call going."
                      : `About ${Math.ceil((remaining ?? 0) / 60)} min remaining. Add more?`}
                  </p>
                </div>
              </div>

              {/* Preset buttons + payment */}
              {topUpClientSecret ? (
                <CallTopUpPayment
                  clientSecret={topUpClientSecret}
                  amountLabel={
                    topUpCents
                      ? `$${(topUpCents / 100).toFixed(topUpCents % 100 === 0 ? 0 : 2)}`
                      : "selected amount"
                  }
                  onSuccess={onTopUpPaymentSuccess}
                  onCancel={cancelTopUpPayment}
                />
              ) : (
                <>
                  <div className="mt-4 flex gap-2">
                    {TOP_UP_PRESETS.map((p) => (
                      <button
                        key={p.cents}
                        onClick={() => setTopUpCents(p.cents)}
                        disabled={topUpBusy}
                        className={cn(
                          "flex-1 rounded-xl border py-2.5 text-sm font-semibold transition-colors",
                          topUpCents === p.cents
                            ? "border-primary bg-primary text-white"
                            : "border-white/20 text-white hover:border-primary/60",
                        )}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  {/* Custom amount */}
                  <div className="mt-3 flex gap-2">
                    <div className="relative flex-1">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                        $
                      </span>
                      <Input
                        type="number"
                        min="5"
                        step="1"
                        placeholder="Custom"
                        value={customInput}
                        onChange={(e) => {
                          setCustomInput(e.target.value);
                          const v = parseFloat(e.target.value);
                          if (!isNaN(v) && v >= 5) setTopUpCents(Math.round(v * 100));
                        }}
                        className="h-10 pl-7 bg-white/5 border-white/20 text-white placeholder:text-gray-500"
                      />
                    </div>
                    <Button
                      onClick={() => topUpCents && confirmTopUp(topUpCents)}
                      disabled={!topUpCents || topUpBusy}
                      className="h-10 px-5 font-semibold"
                    >
                      {topUpBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Plus className="h-4 w-4" /> Add
                        </>
                      )}
                    </Button>
                  </div>

                  <button
                    onClick={() => setShowTopUp(false)}
                    className="mt-3 w-full text-center text-xs text-gray-500 hover:text-gray-300"
                  >
                    Dismiss
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Controls bar ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-center gap-5 pb-12 pt-6">
        {/* Mute */}
        <button
          onClick={toggleMute}
          disabled={listenOnly}
          aria-label={listenOnly ? "No microphone" : muted ? "Unmute" : "Mute"}
          className={cn(
            "grid h-14 w-14 place-items-center rounded-full transition-colors",
            listenOnly || muted
              ? "bg-red-500/20 text-red-400"
              : "bg-white/10 text-white hover:bg-white/20",
            listenOnly && "cursor-not-allowed opacity-60",
          )}
        >
          {muted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
        </button>

        {/* End call */}
        <button
          onClick={handleEnd}
          aria-label="End call"
          className="grid h-16 w-16 place-items-center rounded-full bg-red-600 text-white shadow-lg hover:bg-red-700 active:scale-95 transition-transform"
        >
          <PhoneOff className="h-7 w-7" />
        </button>

        {/* Camera or top-up shortcut */}
        {kind === "video" ? (
          <button
            onClick={toggleCam}
            aria-label={camOff ? "Turn camera on" : "Turn camera off"}
            className={cn(
              "grid h-14 w-14 place-items-center rounded-full transition-colors",
              camOff ? "bg-red-500/20 text-red-400" : "bg-white/10 text-white hover:bg-white/20",
            )}
          >
            {camOff ? <VideoOff className="h-6 w-6" /> : <Video className="h-6 w-6" />}
          </button>
        ) : !isCallee ? (
          <button
            onClick={() => setShowTopUp(true)}
            aria-label="Add time"
            className="grid h-14 w-14 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
          >
            <Plus className="h-6 w-6" />
          </button>
        ) : (
          <div className="h-14 w-14" />
        )}
      </div>

      {/* ── Post-call rating modal ────────────────────────────────────── */}
      {showRating && sessionIdRef.current && (
        <RatingModal
          sessionId={sessionIdRef.current}
          palId={palIdForRating.current}
          palName={remoteName}
          durationMinutes={Math.max(1, Math.round(elapsed / 60))}
          onDone={onEnd}
        />
      )}
    </div>
  );
}
