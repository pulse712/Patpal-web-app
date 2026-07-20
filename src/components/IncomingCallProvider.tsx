import { createContext, useContext, type ReactNode } from "react";
import { CallScreen } from "@/components/CallScreen";
import { IncomingCallOverlay } from "@/components/IncomingCallOverlay";
import { useIncomingCalls } from "@/hooks/use-incoming-calls";

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
          palId={userId ?? ""}
          conversationId={value.activeCall.conversationId ?? undefined}
          onEnd={value.endActiveCall}
        />
      )}
    </IncomingCallContext.Provider>
  );
}

export function useIncomingCallContext() {
  return useContext(IncomingCallContext);
}
