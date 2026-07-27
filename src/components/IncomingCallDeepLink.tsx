import { useEffect } from "react";
import { useIncomingCallContext } from "@/components/IncomingCallProvider";

/** Opens incoming-call UI when user lands from a push notification link. */
export function IncomingCallDeepLink() {
  const ctx = useIncomingCallContext();

  useEffect(() => {
    if (!ctx) return;

    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("incomingSession");
    if (!sessionId) return;

    void ctx.checkSessionCall(sessionId);

    params.delete("incomingSession");
    const path = window.location.pathname;
    const query = params.toString();
    window.history.replaceState({}, "", query ? `${path}?${query}` : path);
  }, [ctx]);

  return null;
}
