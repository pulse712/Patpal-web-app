export type SessionKind = "audio" | "video" | "chat";
export type SessionStatus = "active" | "ended" | "cancelled";

export type CallLogSession = {
  id: string;
  conversation_id: string | null;
  client_id: string;
  pal_id: string;
  initiated_by: string;
  kind: SessionKind;
  status: SessionStatus;
  started_at: string;
  connected_at: string | null;
  ended_at: string | null;
  seconds_used: number;
  end_reason: string | null;
};

export type CallDirection = "incoming" | "outgoing";
export type CallOutcome = "answered" | "missed" | "declined" | "cancelled" | "in_progress";

export function getOtherParticipantId(session: CallLogSession, viewerId: string): string {
  return session.client_id === viewerId ? session.pal_id : session.client_id;
}

export function getCallDirection(session: CallLogSession, viewerId: string): CallDirection {
  return session.initiated_by === viewerId ? "outgoing" : "incoming";
}

export function getCallOutcome(session: CallLogSession, viewerId: string): CallOutcome {
  if (session.status === "active") return "in_progress";
  if (session.connected_at) return "answered";

  // end_reason is only set going forward (see the 2026-08-19 migration) —
  // older rows fall back to the direction-based guess below. "Declined"
  // applies from both sides: the callee explicitly rejected it either way.
  if (session.end_reason === "declined") return "declined";

  const incoming = getCallDirection(session, viewerId) === "incoming";
  return incoming ? "missed" : "cancelled";
}

export function getCallDurationSeconds(session: CallLogSession): number {
  if (session.seconds_used > 0) return session.seconds_used;
  if (!session.connected_at || !session.ended_at) return 0;
  const start = new Date(session.connected_at).getTime();
  const end = new Date(session.ended_at).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  return Math.floor((end - start) / 1000);
}

export function outcomeLabel(outcome: CallOutcome): string {
  switch (outcome) {
    case "answered":
      return "Answered";
    case "missed":
      return "Missed";
    case "declined":
      return "Declined";
    case "cancelled":
      return "Cancelled";
    case "in_progress":
      return "In progress";
  }
}

export function kindLabel(kind: SessionKind): string {
  switch (kind) {
    case "audio":
      return "Voice";
    case "video":
      return "Video";
    case "chat":
      return "Chat";
  }
}
