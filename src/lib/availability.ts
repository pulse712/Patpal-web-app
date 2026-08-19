import { supabase } from "@/integrations/supabase/client";
import { clearPushSubscriptionForThisBrowser } from "@/lib/push-client";

const ACCEPTING_PREF_KEY = "patpal-accepting-calls";

/** Pat Pal is accepting calls (toggle on dashboard). Not the same as in-app presence. */
export function isAcceptingCalls(availability: string | null | undefined): boolean {
  return availability === "available" || availability === "busy";
}

export function availabilityLabel(availability: string | null | undefined): string {
  return isAcceptingCalls(availability) ? "Available" : "Away";
}

export function setAcceptingCallsPreference(on: boolean) {
  try {
    if (on) localStorage.removeItem(ACCEPTING_PREF_KEY);
    else localStorage.setItem(ACCEPTING_PREF_KEY, "0");
  } catch {
    // private mode
  }
}

function wantsToAcceptCalls() {
  try {
    return localStorage.getItem(ACCEPTING_PREF_KEY) !== "0";
  } catch {
    return true;
  }
}

/** Logged-in Pals show as available unless they turned Accepting calls off. */
export async function syncPalAvailabilityForSession(userId: string | null) {
  if (!userId || !wantsToAcceptCalls()) return;
  await supabase
    .from("pat_pals")
    .update({ availability: "available" })
    .eq("user_id", userId)
    .eq("availability", "offline");
}

export async function markPalOffline(userId: string) {
  setAcceptingCallsPreference(true);
  await supabase.from("pat_pals").update({ availability: "offline" }).eq("user_id", userId);
}

/** Mark the Pal offline (if they have a listing) before dropping the session. */
export async function signOutUser() {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (userId) {
    try {
      await markPalOffline(userId);
    } catch {
      // still sign out
    }
    try {
      await clearPushSubscriptionForThisBrowser();
    } catch {
      // still sign out
    }
  }
  await supabase.auth.signOut();
}
