import { createContext, useContext, useEffect, type ReactNode } from "react";
import { CallScreen } from "@/components/CallScreen";
import { IncomingCallOverlay } from "@/components/IncomingCallOverlay";
import { useIncomingCalls } from "@/hooks/use-incoming-calls";
import { preloadAgoraSdk } from "@/lib/agora-prewarm";
import { startCallRingtone, stopCallRingtone } from "@/lib/call-ringtone";

type IncomingCallContextValue = ReturnType<typeof useIncomingCalls>;

const IncomingCallContext = createContext<IncomingCallContextValue | null>(null);

export function IncomingCallProvider({
  userId,
  children,
}: {
  userId: string | null;
  children: ReactNode;
}) {
  const value = useIncomingCalls(userId);

  useEffect(() => {
    if (!value.incoming) {
      stopCallRingtone();
      return;
    }
    // Only preload the Agora JS bundle here — that's invisible to the user.
    // Mic/camera permission (which surfaces a native browser dialog) is
    // requested from acceptIncoming() instead, once the callee has actually
    // chosen to answer, not the moment the phone starts ringing.
    void preloadAgoraSdk();
    startCallRingtone();

    return () => {
      stopCallRingtone();
    };
  }, [value.incoming]);

  return (
    <IncomingCallContext.Provider value={value}>
      {children}
      {value.incoming && (
        <IncomingCallOverlay
          call={value.incoming}
          onAccept={value.acceptIncoming}
          onDecline={value.declineIncoming}
        />
      )}
      {value.activeCall && (
        <CallScreen
          role="callee"
          sessionId={value.activeCall.sessionId}
          channelName={value.activeCall.channelName}
          kind={value.activeCall.kind}
          remoteName={value.activeCall.callerName}
          palId={value.activeCall.palId}
          conversationId={value.activeCall.conversationId ?? undefined}
          isPayingClient={value.activeCall.clientId === userId}
          onEnd={value.endActiveCall}
        />
      )}
    </IncomingCallContext.Provider>
  );
}

export function useIncomingCallContext() {
  return useContext(IncomingCallContext);
}
