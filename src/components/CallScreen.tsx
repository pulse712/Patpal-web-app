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
import { useEffect, useRef, useState, useCallback, type ReactNode } from "react";
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
  Minimize2,
  Maximize2,
  MessageSquare,
  Send,
  SwitchCamera,
  X,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { getAgoraToken } from "@/lib/agora.functions";
import { awaitCallMediaPrewarm, preloadAgoraSdk, resetCallPrewarm } from "@/lib/agora-prewarm";
import {
  startSession,
  startCallbackSession,
  endSession,
  cancelSession,
  createTopUpIntent,
  declineIncomingCall,
  markSessionConnected,
  getActiveSessionBilling,
} from "@/lib/session.functions";
import { RatingModal } from "@/components/RatingModal";
import { CallTopUpPayment } from "@/components/CallTopUpPayment";
import { startCallRingtone, stopCallRingtone } from "@/lib/call-ringtone";
import { useConversationMessages, sendConversationMessage } from "@/lib/conversation-messages";

type CallKind = "audio" | "video";

/** iOS Safari cannot switch earpiece ↔ speakerphone from a web/PWA call. */
function isIosSafariLike(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

interface CallScreenProps {
  channelName: string;
  kind: CallKind;
  remoteName: string;
  palId: string;
  conversationId?: string;
  callerName?: string;
  role?: "caller" | "callee";
  sessionId?: string;
  /** True when a Pat Pal is calling a client back within an existing conversation — still billed to the client. */
  asCallback?: boolean;
  /**
   * True when the viewer is the paying client for this call. NOT the same as
   * "am I the caller" — a Pat Pal calling a client back is the caller but
   * not the payer. Billing UI (warnings, top-up, remaining-time) must be
   * gated on this, not on caller/callee role.
   */
  isPayingClient: boolean;
  onEnd: () => void;
}

// Agora dynamic import types
type AgoraClient = import("agora-rtc-sdk-ng").IAgoraRTCClient;
type AgoraRemoteUser = import("agora-rtc-sdk-ng").IAgoraRTCRemoteUser;
type ILocalAudio = import("agora-rtc-sdk-ng").ILocalAudioTrack;
type ILocalVideo = import("agora-rtc-sdk-ng").ILocalVideoTrack;
type IRemoteAudio = import("agora-rtc-sdk-ng").IRemoteAudioTrack;
type IRemoteVideo = import("agora-rtc-sdk-ng").IRemoteVideoTrack;
type ICameraVideo = import("agora-rtc-sdk-ng").ICameraVideoTrack;

const GRACE_SECONDS = 30; // extra seconds after balance runs out before forced end
const WARN_SECONDS = 120; // show top-up warning when this many seconds remain
const RING_TIMEOUT_MS = 45_000; // auto-cancel if pal never answers
const REMOTE_RECONNECT_GRACE_MS = 20_000; // grace period after remote drops before ending the call
/** Minimum connected time before prompting for a post-call review. */
const MIN_RATING_SECONDS = 15;
/** Simple call volume presets (Agora remote playback 0–100). */
const VOLUME_NORMAL = 70;
const VOLUME_HIGH = 100;

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

async function createMicrophoneTrack(
  AgoraRTC: AgoraSdk,
  opts?: { skipPrime?: boolean },
): Promise<ILocalAudio | null> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      "This browser does not support microphone access. Try Chrome, Edge, or Safari.",
    );
  }

  if (!opts?.skipPrime) {
    await primeMediaPermission({ audio: true });
  }

  try {
    return await AgoraRTC.createMicrophoneAudioTrack();
  } catch (err) {
    if (!isMediaDeviceError(err)) {
      throw new Error(mediaAccessError(err, "microphone"));
    }
  }

  const mics = await AgoraRTC.getMicrophones();
  for (const mic of mics) {
    if (!mic.deviceId) continue;
    try {
      return await AgoraRTC.createMicrophoneAudioTrack({ microphoneId: mic.deviceId });
    } catch {
      /* try next device */
    }
  }

  return null;
}

async function createCameraTrack(
  AgoraRTC: AgoraSdk,
  opts?: { skipPrime?: boolean },
): Promise<ILocalVideo | null> {
  if (!navigator.mediaDevices?.getUserMedia) return null;

  if (!opts?.skipPrime) {
    await primeMediaPermission({ video: true });
  }

  try {
    return await AgoraRTC.createCameraVideoTrack();
  } catch (err) {
    if (!isMediaDeviceError(err)) return null;
  }

  const cameras = await AgoraRTC.getCameras();
  for (const camera of cameras) {
    if (!camera.deviceId) continue;
    try {
      return await AgoraRTC.createCameraVideoTrack({ cameraId: camera.deviceId });
    } catch {
      /* try next device */
    }
  }

  return null;
}

function isAgoraLeaveAbort(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("WS_ABORT") || msg.includes("LEAVE");
}

async function disposeAgoraClient(client: AgoraClient | null | undefined) {
  if (!client) return;
  try {
    await client.leave();
  } catch (err) {
    if (!isAgoraLeaveAbort(err)) {
      console.warn("[CallScreen] dispose client failed:", err);
    }
  }
}

async function createLocalMediaTracks(
  AgoraRTC: AgoraSdk,
  kind: CallKind,
  opts?: { skipPrime?: boolean },
): Promise<{
  audio: ILocalAudio | null;
  video: ILocalVideo | null;
  videoUnavailable: boolean;
  listenOnly: boolean;
}> {
  if (kind === "audio") {
    const audio = await createMicrophoneTrack(AgoraRTC, opts);
    return { audio, video: null, videoUnavailable: false, listenOnly: !audio };
  }

  const [audio, video] = await Promise.all([
    createMicrophoneTrack(AgoraRTC, opts),
    createCameraTrack(AgoraRTC, opts),
  ]);

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
  asCallback = false,
  isPayingClient,
  onEnd,
}: CallScreenProps) {
  const isCallee = role === "callee";
  // ── Agora state ──────────────────────────────────────────────────────────
  const [status, setStatus] = useState<"connecting" | "connected" | "ended">("connecting");
  const [muted, setMuted] = useState(false);
  const [listenOnly, setListenOnly] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [remoteJoined, setRemoteJoined] = useState(false);
  // Two independent sources of "not fully connected right now" — the remote
  // peer dropping (user-left, transient) vs. our own Agora connection
  // reconnecting — kept separate so one clearing doesn't mask the other
  // still being true (e.g. our own connection blips back to CONNECTED while
  // the remote party genuinely hasn't returned yet).
  const [remoteDropping, setRemoteDropping] = useState(false);
  const [localReconnecting, setLocalReconnecting] = useState(false);
  const reconnecting = remoteDropping || localReconnecting;
  const reconnectingRef = useRef(false);
  const [volumeMode, setVolumeMode] = useState<"normal" | "high">("normal");
  const volumeRef = useRef(VOLUME_NORMAL);
  const remoteAudioTrackRef = useRef<IRemoteAudio | null>(null);
  const remoteVideoTrackRef = useRef<IRemoteVideo | null>(null);

  // ── In-call chat state ───────────────────────────────────────────────────
  const [showChat, setShowChat] = useState(false);
  const showChatRef = useRef(false);
  const { messages: chatMessages, loaded: chatLoaded } = useConversationMessages(conversationId);
  const [chatText, setChatText] = useState("");
  const [chatUnread, setChatUnread] = useState(0);
  const [meId, setMeId] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // ── Front/back camera switch ─────────────────────────────────────────────
  const camerasRef = useRef<MediaDeviceInfo[]>([]);
  const cameraIndexRef = useRef(0);
  const [cameraCount, setCameraCount] = useState(0);
  const [switchingCamera, setSwitchingCamera] = useState(false);

  // ── Minimize / floating pill state ──────────────────────────────────────
  const [minimized, setMinimized] = useState(false);
  const [pillPos, setPillPos] = useState<{ x: number; y: number } | null>(null);
  const dragStateRef = useRef<{
    dragging: boolean;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);

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
  const ratingSessionIdRef = useRef<string | null>(null);
  const hasEndedRef = useRef(false); // guard against double-end
  const wasConnectedRef = useRef(false);
  const hasMarkedConnectedRef = useRef(false);
  const endCallRemotelyRef = useRef<() => void>(() => {});
  const joinGenerationRef = useRef(0);
  const [watchSessionId, setWatchSessionId] = useState<string | null>(sessionId ?? null);
  const joinParamsRef = useRef({
    palId,
    conversationId,
    kind,
    isCallee,
    sessionId,
    asCallback,
  });
  joinParamsRef.current = { palId, conversationId, kind, isCallee, sessionId, asCallback };

  function isJoinStale(generation: number) {
    return generation !== joinGenerationRef.current;
  }

  function offerRatingIfEligible(): boolean {
    if (!wasConnectedRef.current || !sessionIdRef.current) return false;
    if (elapsedRef.current < MIN_RATING_SECONDS) return false;
    ratingSessionIdRef.current = sessionIdRef.current;
    setShowRating(true);
    return true;
  }

  function finishAfterCall() {
    setShowRating(false);
    ratingSessionIdRef.current = null;
    onEnd();
  }

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

        if (isPayingClient && !isUnlimited) {
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
  const remoteDropTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackRetryTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // ── Timers ────────────────────────────────────────────────────────────────
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const graceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─────────────────────────────────────────────────────────────────────────
  // Join Agora + start session
  // ─────────────────────────────────────────────────────────────────────────
  const joinChannel = useCallback(async (generation: number) => {
    const { palId, conversationId, kind, isCallee, sessionId, asCallback } = joinParamsRef.current;
    let sessionCreated = false;
    let client: AgoraClient | null = null;
    try {
      await awaitCallMediaPrewarm();
      const agoraPromise = preloadAgoraSdk();

      async function playRemoteMedia(
        client: AgoraClient,
        user: AgoraRemoteUser,
        mediaType: "audio" | "video",
      ) {
        await client.subscribe(user, mediaType);
        if (mediaType === "audio") {
          const track = user.audioTrack as IRemoteAudio | undefined;
          // Don't early-return here — markRemotePresent() below must still
          // run (it starts billing/elapsed state) even on the rare case
          // where subscribe() resolves before the track reference exists.
          if (track) {
            const isIos = isIosSafariLike();
            const targetVolume = isIos ? VOLUME_HIGH : volumeRef.current;
            volumeRef.current = targetVolume;
            if (isIos) setVolumeMode("high");
            track.setVolume(targetVolume);
            track.play();
            // Retry play/volume after a tick — helps when autoplay was
            // briefly blocked. Tracked so leaveChannel can cancel it if the
            // call ends before this fires.
            const retryTimer = setTimeout(() => {
              playbackRetryTimersRef.current.delete(retryTimer);
              try {
                track.play();
                track.setVolume(volumeRef.current);
              } catch {
                /* ignore */
              }
            }, 250);
            playbackRetryTimersRef.current.add(retryTimer);
          }
          remoteAudioTrackRef.current = track ?? null;
        }
        if (mediaType === "video") {
          const track = user.videoTrack as IRemoteVideo | undefined;
          remoteVideoTrackRef.current = track ?? null;
          if (track && remoteVideoElRef.current) track.play(remoteVideoElRef.current);
        }
        markRemotePresent();
      }

      function markRemotePresent() {
        if (remoteDropTimerRef.current) {
          clearTimeout(remoteDropTimerRef.current);
          remoteDropTimerRef.current = null;
        }
        setRemoteDropping(false);
        setRemoteJoined(true);
        setStatus("connected");
        void ensureSessionConnected();
      }

      async function syncExistingRemoteUsers(activeClient: AgoraClient) {
        if (activeClient.remoteUsers.length === 0) return;
        markRemotePresent();
        for (const user of activeClient.remoteUsers) {
          if (user.hasAudio) await playRemoteMedia(activeClient, user, "audio");
          if (user.hasVideo) await playRemoteMedia(activeClient, user, "video");
        }
      }

      if (isCallee) {
        sessionIdRef.current = sessionId ?? null;
        if (sessionIdRef.current) setWatchSessionId(sessionIdRef.current);
      } else if (asCallback) {
        if (!conversationId) {
          throw new Error("Cannot call back without an existing conversation.");
        }
        const sessionData = await startCallbackSession({
          data: { conversationId, kind },
        });
        sessionIdRef.current = sessionData.sessionId;
        setWatchSessionId(sessionData.sessionId);
        sessionCreated = true;
        setBalanceSec(sessionData.isUnlimited ? Infinity : sessionData.balanceSeconds);
        setIsUnlimited(sessionData.isUnlimited);
      } else {
        const sessionData = await startSession({
          data: { palId, conversationId, kind },
        });
        sessionIdRef.current = sessionData.sessionId;
        setWatchSessionId(sessionData.sessionId);
        sessionCreated = true;
        setBalanceSec(sessionData.isUnlimited ? Infinity : sessionData.balanceSeconds);
        setIsUnlimited(sessionData.isUnlimited);
      }

      const AgoraRTC = await agoraPromise;
      if (isJoinStale(generation)) return;
      AgoraRTC.setLogLevel(import.meta.env.DEV ? 1 : 4);

      if (!sessionIdRef.current) {
        throw new Error("No active call session.");
      }

      const agoraChannel = sessionIdRef.current;
      const mediaOpts = { skipPrime: true as const };

      const [{ token, appId, uid: agoraUid }, localTracks] = await Promise.all([
        getAgoraToken({ data: { channelName: agoraChannel } }),
        createLocalMediaTracks(AgoraRTC, kind, mediaOpts),
      ]);

      if (isJoinStale(generation)) return;
      if (!appId) throw new Error("Agora App ID not configured.");
      if (!token) {
        throw new Error(
          "Agora token missing. Check AGORA_APP_ID and AGORA_APP_CERTIFICATE on the server, then redeploy.",
        );
      }

      const { audio, video, videoUnavailable, listenOnly: noMic } = localTracks;
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

      client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

      client.on("user-published", async (user, mediaType) => {
        if (mediaType !== "audio" && mediaType !== "video") return;
        await playRemoteMedia(client!, user, mediaType);
      });

      client.on("user-joined", () => {
        // Other party may be listen-only (no mic) and never publish audio/video.
        markRemotePresent();
      });

      client.on("user-unpublished", (_u, mt) => {
        // Drop our ref to the now-dead track so a later un-minimize doesn't
        // try to replay a stale/unpublished track into the video element.
        if (mt === "video") {
          setRemoteJoined(false);
          remoteVideoTrackRef.current = null;
        } else if (mt === "audio") {
          remoteAudioTrackRef.current = null;
        }
      });
      client.on("user-left", (_user, reason) => {
        setRemoteJoined(false);
        if (reason === "Quit") {
          // Explicit hangup — end immediately.
          endCallRemotelyRef.current();
          return;
        }
        // Likely a transient network drop (e.g. server timeout) — give the
        // other side a window to reconnect before treating this as a hangup.
        // Drop our track refs too: a hard network-loss disconnect can fire
        // user-left directly without a preceding user-unpublished, so a
        // minimize/un-minimize during the grace window must not replay them.
        remoteVideoTrackRef.current = null;
        remoteAudioTrackRef.current = null;
        setRemoteDropping(true);
        if (remoteDropTimerRef.current) clearTimeout(remoteDropTimerRef.current);
        remoteDropTimerRef.current = setTimeout(() => {
          remoteDropTimerRef.current = null;
          endCallRemotelyRef.current();
        }, REMOTE_RECONNECT_GRACE_MS);
      });
      client.on("connection-state-change", (curState, _revState, reason) => {
        if (curState === "RECONNECTING") {
          setLocalReconnecting(true);
        } else if (curState === "CONNECTED") {
          setLocalReconnecting(false);
        } else if (curState === "DISCONNECTED" && reason && reason !== "LEAVE") {
          // SDK gave up reconnecting on our own connection.
          setLocalReconnecting(false);
          toast.error("Connection lost — call ended.");
          void handleEnd();
        }
      });

      await client.join(appId, agoraChannel, token, agoraUid);
      if (isJoinStale(generation)) {
        await disposeAgoraClient(client);
        return;
      }

      clientRef.current = client;
      setStatus("connected");

      const tracksToPublish = [audio, video].filter(Boolean) as Array<ILocalAudio | ILocalVideo>;
      if (tracksToPublish.length > 0) {
        await client.publish(tracksToPublish);
      }
      if (video) {
        localVideoRef.current = video;
        if (localVideoElRef.current) video.play(localVideoElRef.current);
      }

      await syncExistingRemoteUsers(client);
      resetCallPrewarm();

      if (kind === "video" && video) {
        AgoraRTC.getCameras()
          .then((cams) => {
            if (isJoinStale(generation)) return;
            camerasRef.current = cams;
            setCameraCount(cams.length);
            // Figure out which of the listed cameras we actually opened, so the
            // first flip goes to a genuinely different one instead of index 0.
            const activeId = video.getMediaStreamTrack().getSettings().deviceId;
            const idx = cams.findIndex((c) => c.deviceId === activeId);
            cameraIndexRef.current = idx >= 0 ? idx : 0;
          })
          .catch(() => {});
      }
    } catch (err: unknown) {
      if (client && clientRef.current !== client) {
        await disposeAgoraClient(client);
      }
      if (isJoinStale(generation) || isAgoraLeaveAbort(err)) return;
      console.error("[CallScreen] Join failed:", err);
      // A connection-state-change DISCONNECTED event can fire (and call
      // handleEnd) while this join() promise is still in flight — if that
      // already ran, don't repeat cleanup/leaveChannel/onEnd here too.
      if (hasEndedRef.current) return;
      hasEndedRef.current = true;
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
  }, []);

  function startElapsedTimer() {
    if (elapsedTimerRef.current) return; // already running
    elapsedTimerRef.current = setInterval(() => {
      // Don't advance duration/billing while we're in the reconnect grace
      // window — no media is actually flowing, so the caller shouldn't be
      // charged (and call time shouldn't tick) for a silent dropout.
      if (reconnectingRef.current) return;
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
    if (!billingActive || isUnlimited || balanceSec === null || !isPayingClient) return;

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
        // Don't burn down the depleted-balance grace period while we're
        // separately waiting out a connection reconnect — the user should
        // get the full grace window once they're actually back on the call.
        if (reconnectingRef.current) return;
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
  }, [elapsed, balanceSec, isUnlimited, graceRemaining, isPayingClient, billingActive]); // eslint-disable-line

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
    if (remoteDropTimerRef.current) {
      clearTimeout(remoteDropTimerRef.current);
      remoteDropTimerRef.current = null;
    }
    for (const t of playbackRetryTimersRef.current) clearTimeout(t);
    playbackRetryTimersRef.current.clear();
    localAudioRef.current?.close();
    localVideoRef.current?.close();
    const client = clientRef.current;
    clientRef.current = null;
    if (client) {
      try {
        await client.leave();
      } catch (err) {
        if (!isAgoraLeaveAbort(err)) {
          console.warn("[CallScreen] leave failed:", err);
        }
      }
    }
    localAudioRef.current = null;
    localVideoRef.current = null;
  }, []);

  async function cleanupSession(billSession: boolean) {
    if (!sessionIdRef.current) return;
    const sid = sessionIdRef.current;
    // Clear synchronously (before the await below) so a second concurrent
    // caller — e.g. the join-failure catch block racing the
    // connection-state-change DISCONNECTED handler's handleEnd() — sees this
    // already claimed instead of double-cancelling the same session.
    sessionIdRef.current = null;
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

    if (wasConnectedRef.current && sessionIdRef.current) {
      await cleanupSession(true);
    }
    await leaveChannel();

    if (offerRatingIfEligible()) return;
    onEnd();
  }, [leaveChannel, onEnd, remoteName, isCallee]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    endCallRemotelyRef.current = () => {
      void handleRemoteEnd();
    };
  }, [handleRemoteEnd]);

  useEffect(() => {
    if (!watchSessionId) return;

    const sessionId = watchSessionId;
    let cancelled = false;

    async function checkSessionEnded() {
      if (cancelled || hasEndedRef.current) return;
      const { data } = await supabase
        .from("sessions")
        .select("status")
        .eq("id", sessionId)
        .maybeSingle();
      if (data?.status === "ended" || data?.status === "cancelled") {
        endCallRemotelyRef.current();
      }
    }

    void checkSessionEnded();
    const poll = window.setInterval(() => void checkSessionEnded(), 1500);

    const channel = supabase
      .channel(`call-session:${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "sessions",
          filter: `id=eq.${sessionId}`,
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
      cancelled = true;
      window.clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [watchSessionId]);

  async function handleEnd() {
    if (hasEndedRef.current) return; // prevent double-end from race conditions
    hasEndedRef.current = true;
    setStatus("ended");

    await cleanupSession(true);
    await leaveChannel();

    if (offerRatingIfEligible()) return;
    onEnd();
  }

  useEffect(() => {
    const generation = ++joinGenerationRef.current;
    void joinChannel(generation);
    return () => {
      joinGenerationRef.current += 1;
      void leaveChannel();
      if (!hasEndedRef.current) {
        hasEndedRef.current = true;
        void cleanupSession(wasConnectedRef.current);
      }
    };
    // Join once on mount; stale joins are aborted via joinGenerationRef + leaveChannel.
  }, [joinChannel, leaveChannel]);

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

  // Caller-side ringback tone while waiting for the other party to answer.
  // Guarded by wasConnectedRef so it doesn't restart mid-call — remoteJoined
  // can flip back to false without a real hangup (e.g. the other side toggles
  // their camera off, or we're in the reconnect grace window).
  useEffect(() => {
    if (isCallee || status !== "connected" || remoteJoined || wasConnectedRef.current) return;
    startCallRingtone();
    return () => stopCallRingtone();
  }, [isCallee, status, remoteJoined]);

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

  function applyVolumeMode(mode: "normal" | "high") {
    const next = mode === "high" ? VOLUME_HIGH : VOLUME_NORMAL;
    setVolumeMode(mode);
    volumeRef.current = next;
    remoteAudioTrackRef.current?.setVolume(next);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Front/back camera switch
  // ─────────────────────────────────────────────────────────────────────────
  async function switchCamera() {
    const cams = camerasRef.current;
    const track = localVideoRef.current as unknown as ICameraVideo | null;
    if (cams.length < 2 || !track || switchingCamera) return;
    setSwitchingCamera(true);
    try {
      const nextIndex = (cameraIndexRef.current + 1) % cams.length;
      await track.setDevice(cams[nextIndex].deviceId);
      // Re-derive from the actual resulting device rather than trusting
      // nextIndex blindly — the initial index guess (at join time) can be
      // wrong if the browser didn't report a deviceId before the stream
      // settled, in which case this keeps future taps correct even if the
      // very first one silently landed back on the same camera.
      const activeId = track.getMediaStreamTrack().getSettings().deviceId;
      const actualIndex = cams.findIndex((c) => c.deviceId === activeId);
      cameraIndexRef.current = actualIndex >= 0 ? actualIndex : nextIndex;
    } catch {
      toast.error("Could not switch camera.");
    } finally {
      setSwitchingCamera(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // In-call chat — same `messages` table/RLS as the regular chat screen, just
  // rendered inline so nobody has to leave the call to read or send a reply.
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    reconnectingRef.current = reconnecting;
  }, [reconnecting]);

  useEffect(() => {
    showChatRef.current = showChat;
    if (showChat) setChatUnread(0);
  }, [showChat]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setMeId(data.session?.user.id ?? null));
  }, []);

  // Track unread arrivals against the shared conversation store by the last-
  // seen message's id (not "any id not seen before", and not a created_at
  // high-water mark — two independently-inserted rows could in principle
  // share a timestamp). The underlying chat screen can still be visible
  // (e.g. the call is minimized) and paginate older history into the FRONT
  // of this same shared list via loadOlderMessages, which must never be
  // mistaken for new arrivals — slicing after the last-seen id's position
  // handles that regardless of timestamp ties. Also gated on meId being
  // resolved, so a message arriving from this same user's other tab/session
  // during the brief getSession() lookup can't be misattributed as unread.
  const lastSeenChatIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!chatLoaded || meId === null) return;
    if (lastSeenChatIdRef.current === null) {
      lastSeenChatIdRef.current = chatMessages.length > 0 ? chatMessages.at(-1)!.id : "";
      return;
    }
    const lastIdx = chatMessages.findIndex((m) => m.id === lastSeenChatIdRef.current);
    const newOnes = lastIdx === -1 ? [] : chatMessages.slice(lastIdx + 1);
    if (chatMessages.length > 0) lastSeenChatIdRef.current = chatMessages.at(-1)!.id;
    if (newOnes.length === 0 || showChatRef.current) return;
    const fromOther = newOnes.filter((m) => m.sender_id !== meId).length;
    if (fromOther > 0) setChatUnread((n) => n + fromOther);
  }, [chatMessages, chatLoaded, meId]);

  useEffect(() => {
    if (!showChat) return;
    chatScrollRef.current?.scrollTo({
      top: chatScrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [chatMessages, showChat]);

  async function sendChatMessage(e: React.FormEvent) {
    e.preventDefault();
    const body = chatText.trim();
    if (!body || !conversationId || !meId) return;
    setChatText("");
    const result = await sendConversationMessage(conversationId, meId, body);
    if (!result.ok) {
      setChatText(body);
      toast.error("Message failed to send.");
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Minimize / floating pill (WhatsApp-style)
  // ─────────────────────────────────────────────────────────────────────────

  // Re-attach video playback to the fresh DOM nodes whenever we return from
  // the minimized pill — audio keeps playing regardless since Agora's audio
  // element isn't tied to a container we render.
  useEffect(() => {
    if (minimized) return;
    if (remoteVideoTrackRef.current && remoteVideoElRef.current) {
      remoteVideoTrackRef.current.play(remoteVideoElRef.current);
    }
    if (localVideoRef.current && localVideoElRef.current) {
      localVideoRef.current.play(localVideoElRef.current);
    }
  }, [minimized]);

  // Surface the full call screen for anything the user must not miss.
  useEffect(() => {
    if (showTopUp || showRating) setMinimized(false);
  }, [showTopUp, showRating]);

  const PILL_WIDTH = 224; // w-56
  const PILL_HEIGHT = 64; // h-16

  function handlePillPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    dragStateRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      originX: rect.left,
      originY: rect.top,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePillPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const state = dragStateRef.current;
    if (!state?.dragging) return;
    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) state.moved = true;
    setPillPos({
      x: Math.min(Math.max(0, state.originX + dx), window.innerWidth - PILL_WIDTH),
      y: Math.min(Math.max(0, state.originY + dy), window.innerHeight - PILL_HEIGHT),
    });
  }

  function handlePillPointerUp() {
    const state = dragStateRef.current;
    dragStateRef.current = null;
    if (state && !state.moved) setMinimized(false);
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
    !isPayingClient || balanceSec === null || isUnlimited
      ? null
      : Math.max(0, (billableCapRef.current ?? balanceSec) - elapsed);
  const remaining = billableRemaining;
  const remainingLow =
    isPayingClient && remaining !== null && isFinite(remaining) && remaining <= WARN_SECONDS;
  const inGrace = graceRemaining !== null;

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  if (minimized) {
    return (
      <div
        onPointerDown={handlePillPointerDown}
        onPointerMove={handlePillPointerMove}
        onPointerUp={handlePillPointerUp}
        onPointerCancel={handlePillPointerUp}
        style={
          pillPos ? { left: pillPos.x, top: pillPos.y, right: "auto", bottom: "auto" } : undefined
        }
        className={cn(
          "fixed z-50 flex h-16 w-56 touch-none select-none items-center gap-3 rounded-2xl border border-white/10 bg-gray-900/95 px-3 text-white shadow-2xl backdrop-blur cursor-grab active:cursor-grabbing",
          !pillPos && "bottom-24 right-4",
        )}
      >
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/20 text-lg font-bold text-primary">
          {remoteName.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{remoteName}</p>
          <p className="text-xs text-gray-400">
            {reconnecting
              ? "Reconnecting…"
              : remoteJoined || wasConnectedRef.current
                ? fmt(elapsed)
                : "Ringing…"}
          </p>
        </div>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setMinimized(false)}
          aria-label="Expand call"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/20"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handleEnd}
          aria-label="End call"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-red-600 hover:bg-red-700"
        >
          <PhoneOff className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gradient-to-br from-indigo-950 via-slate-900 to-black text-white">
      {/* ── Remote video / audio area ──────────────────────────────────── */}
      {kind === "video" ? (
        <div ref={remoteVideoElRef} className="flex-1 bg-gray-900">
          {!remoteJoined && (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <div className="grid h-20 w-20 place-items-center rounded-full bg-primary/20 text-4xl font-bold text-primary">
                {remoteName.slice(0, 1).toUpperCase()}
              </div>
              <p className="text-lg font-semibold">{remoteName}</p>
              <div
                className={cn(
                  "flex items-center gap-2 text-sm",
                  reconnecting ? "text-orange-400" : "text-gray-400",
                )}
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                {status === "connecting"
                  ? "Connecting…"
                  : reconnecting
                    ? "Reconnecting…"
                    : "Waiting for other person…"}
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
          ) : reconnecting ? (
            <div className="flex items-center gap-2 text-sm text-orange-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Reconnecting…
            </div>
          ) : (
            <p className="text-sm text-gray-400">Ringing…</p>
          )}
          {isIosSafariLike() && remoteJoined && (
            <p className="mx-6 mt-2 max-w-xs text-center text-xs leading-relaxed text-amber-200/90">
              iPhone tip: Safari often plays call audio through the earpiece (quiet). Hold the phone
              to your ear, raise volume, or use headphones. Loud speakerphone requires the native
              iOS app.
            </p>
          )}
        </div>
      )}

      {/* iOS Safari can't route call audio to loudspeaker — same limitation
          on video calls as audio, so show the same tip here too. */}
      {kind === "video" && isIosSafariLike() && remoteJoined && (
        <p className="absolute inset-x-6 bottom-32 z-10 mx-auto max-w-xs rounded-lg bg-black/50 px-3 py-2 text-center text-xs leading-relaxed text-amber-200/90">
          iPhone tip: Safari often plays call audio through the earpiece (quiet). Hold the phone to
          your ear, raise volume, or use headphones. Loud speakerphone requires the native iOS app.
        </p>
      )}

      {/* ── Local video PiP ───────────────────────────────────────────── */}
      {kind === "video" && (
        <div
          className={cn(
            "absolute right-4 top-4 h-32 w-24 overflow-hidden rounded-xl border-2 border-white/20 bg-gray-800",
            camOff && "opacity-30",
          )}
        >
          <div ref={localVideoElRef} className="h-full w-full" />
          {cameraCount > 1 && (
            <button
              onClick={switchCamera}
              disabled={switchingCamera}
              aria-label="Switch camera"
              className="absolute bottom-1 right-1 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80 disabled:opacity-50"
            >
              <SwitchCamera className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* ── Balance / duration overlay ────────────────────────────────── */}
      <div className="absolute left-4 top-4 flex flex-col gap-1">
        {kind === "video" && (
          <div className="rounded-full bg-black/50 px-3 py-1 text-xs font-mono">{fmt(elapsed)}</div>
        )}
        {isPayingClient && !isUnlimited && remaining !== null && (
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
      {isPayingClient && showTopUp && (
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

      {/* ── In-call chat panel ───────────────────────────────────────── */}
      {showChat && conversationId && (
        <div className="absolute inset-x-4 bottom-28 z-10 flex h-80 flex-col overflow-hidden rounded-2xl border border-white/10 bg-gray-900 shadow-2xl md:inset-x-auto md:left-auto md:right-4 md:top-20 md:h-auto md:w-96">
          <div className="flex items-center justify-between border-b border-white/10 px-2 py-2">
            <button
              onClick={() => setShowChat(false)}
              aria-label="Back to call"
              className="grid h-8 w-8 place-items-center rounded-full text-white hover:bg-white/10"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold text-white">Chat</span>
            <button
              onClick={() => setShowChat(false)}
              aria-label="Close chat"
              className="grid h-8 w-8 place-items-center rounded-full text-white hover:bg-white/10"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div ref={chatScrollRef} className="flex-1 space-y-2 overflow-y-auto p-3">
            {chatMessages.length === 0 && (
              <p className="mt-6 text-center text-xs text-gray-500">
                Messages sent here also show up in your regular chat.
              </p>
            )}
            {chatMessages.map((m) => {
              const mine = m.sender_id === meId;
              return (
                <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[80%] rounded-2xl px-3 py-1.5 text-sm",
                      mine
                        ? "bg-primary text-white rounded-br-sm"
                        : "bg-white/10 text-white rounded-bl-sm",
                    )}
                  >
                    {m.body}
                  </div>
                </div>
              );
            })}
          </div>
          <form
            onSubmit={sendChatMessage}
            className="flex items-center gap-2 border-t border-white/10 p-2"
          >
            <Input
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              placeholder="Message…"
              className="h-10 flex-1 border-white/20 bg-white/5 text-white placeholder:text-gray-500"
            />
            <Button
              type="submit"
              size="icon"
              className="h-10 w-10 shrink-0 rounded-full"
              disabled={!chatText.trim()}
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      )}

      {/* ── Controls bar — iPhone-style 2×3 grid, End in bottom center ─ */}
      <div className="px-8 pb-14 pt-4">
        <div className="mx-auto grid max-w-sm grid-cols-3 items-start justify-items-center gap-x-6 gap-y-7">
          {/* Top row: speaker · video/add · mute (matches native call UI) */}
          <ControlButton
            label={volumeMode === "high" ? "high" : "speaker"}
            onClick={() => applyVolumeMode(volumeMode === "high" ? "normal" : "high")}
            ariaLabel={
              volumeMode === "high"
                ? "Volume: High (tap for Normal)"
                : "Volume: Normal (tap for High)"
            }
            active={volumeMode === "high"}
          >
            <Volume2 className="h-7 w-7" />
          </ControlButton>

          {kind === "video" ? (
            <ControlButton
              label="video"
              onClick={toggleCam}
              ariaLabel={camOff ? "Turn camera on" : "Turn camera off"}
              danger={camOff}
            >
              {camOff ? <VideoOff className="h-7 w-7" /> : <Video className="h-7 w-7" />}
            </ControlButton>
          ) : isPayingClient ? (
            <ControlButton label="add time" onClick={() => setShowTopUp(true)} ariaLabel="Add time">
              <Plus className="h-7 w-7" />
            </ControlButton>
          ) : (
            <div className="h-[4.75rem] w-16" aria-hidden />
          )}

          <ControlButton
            label="mute"
            onClick={toggleMute}
            disabled={listenOnly}
            ariaLabel={listenOnly ? "No microphone" : muted ? "Unmute" : "Mute"}
            danger={listenOnly || muted}
          >
            {muted ? <MicOff className="h-7 w-7" /> : <Mic className="h-7 w-7" />}
          </ControlButton>

          {/* Bottom row: chat · end · minimize */}
          {conversationId ? (
            <ControlButton
              label="chat"
              onClick={() => setShowChat((v) => !v)}
              ariaLabel="Chat"
              active={showChat}
              badge={chatUnread > 0 ? (chatUnread > 9 ? "9+" : String(chatUnread)) : undefined}
            >
              <MessageSquare className="h-7 w-7" />
            </ControlButton>
          ) : (
            <div className="h-[4.75rem] w-16" aria-hidden />
          )}

          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={handleEnd}
              aria-label="End call"
              className="grid h-16 w-16 place-items-center rounded-full bg-red-600 text-white shadow-lg transition-transform hover:bg-red-700 active:scale-95"
            >
              <PhoneOff className="h-7 w-7" />
            </button>
            <span className="text-[11px] font-medium capitalize tracking-wide text-white/90">
              end
            </span>
          </div>

          <ControlButton
            label="minimize"
            onClick={() => setMinimized(true)}
            ariaLabel="Minimize call"
          >
            <Minimize2 className="h-7 w-7" />
          </ControlButton>
        </div>
      </div>

      {/* ── Post-call rating modal ────────────────────────────────────── */}
      {showRating && ratingSessionIdRef.current && (
        <RatingModal
          sessionId={ratingSessionIdRef.current}
          rateeName={remoteName}
          durationMinutes={Math.max(1, Math.round(elapsedRef.current / 60))}
          onDone={finishAfterCall}
        />
      )}
    </div>
  );
}

function ControlButton({
  label,
  onClick,
  ariaLabel,
  children,
  active,
  danger,
  disabled,
  badge,
}: {
  label: string;
  onClick: () => void;
  ariaLabel: string;
  children: ReactNode;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  badge?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={ariaLabel}
        className={cn(
          "relative grid h-16 w-16 place-items-center rounded-full transition-colors",
          danger
            ? "bg-white text-gray-900"
            : active
              ? "bg-white/90 text-gray-900"
              : "bg-white/15 text-white hover:bg-white/25",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        {children}
        {badge ? (
          <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white">
            {badge}
          </span>
        ) : null}
      </button>
      <span className="text-[11px] font-medium capitalize tracking-wide text-white/90">{label}</span>
    </div>
  );
}
