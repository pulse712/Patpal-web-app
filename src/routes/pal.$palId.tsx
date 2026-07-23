import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  ArrowLeft,
  BadgeCheck,
  Calendar,
  Clock,
  Crown,
  Globe,
  MessageCircle,
  Phone,
  ShieldCheck,
  Star,
  Video,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsOnline } from "@/lib/presence";
import { fetchPublicProfile } from "@/lib/public-profiles";
import { CallScreen } from "@/components/CallScreen";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
type Day = (typeof DAYS)[number];
type DaySchedule = { enabled: boolean; start: string; end: string };
type Schedule = Record<Day, DaySchedule>;

const DEFAULT_SCHEDULE: Schedule = DAYS.reduce((acc, d) => {
  acc[d] = { enabled: d !== "Sat" && d !== "Sun", start: "09:00", end: "17:00" };
  return acc;
}, {} as Schedule);

export const Route = createFileRoute("/pal/$palId")({
  head: () => ({
    meta: [{ title: "Pat Pal — Pat My Back" }, { name: "robots", content: "noindex" }],
  }),
  component: PalProfile,
});

type Pal = {
  user_id: string;
  headline: string | null;
  price_cents_per_minute: number;
  availability: "available" | "busy" | "offline" | null;
  rating_avg: number | null;
  rating_count: number | null;
  category_slugs: string[] | null;
  tier: "trusted" | "premium" | "expert" | string | null;
  is_team: boolean | null;
  profiles: { full_name: string | null; avatar_url: string | null; bio: string | null } | null;
};

const TIER_LABEL: Record<string, string> = {
  trusted: "Trusted Supporter",
  premium: "Premium Expert",
  expert: "Expert",
};

const CATEGORY_LABEL: Record<string, string> = {
  mentorship: "Mentorship",
  training: "Training",
  motivation: "Motivation",
  accountability: "Accountability",
  "business-coaching": "Business Coaching",
  "friendly-chat": "Friendly Chat",
  "emotional-support": "Emotional Support",
  consulting: "Consulting",
  "career-advice": "Career Advice",
  encouragement: "Encouragement",
  "spiritual-encouragement": "Spiritual Encouragement",
  "music-lessons": "Music Lessons",
};

function labelForSlug(slug: string) {
  return (
    CATEGORY_LABEL[slug] ??
    slug
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

function PalProfile() {
  const { palId } = Route.useParams();
  const palPresenceOnline = useIsOnline(palId);
  const navigate = useNavigate();
  const [pal, setPal] = useState<Pal | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState<"chat" | "audio" | "video" | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [schedule, setSchedule] = useState<Schedule>(DEFAULT_SCHEDULE);
  const [activeCall, setActiveCall] = useState<"audio" | "video" | null>(null);
  const [callConversationId, setCallConversationId] = useState("");
  const [callerName, setCallerName] = useState("Someone");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`pal-schedule:${palId}`);
      if (raw) setSchedule({ ...DEFAULT_SCHEDULE, ...JSON.parse(raw) });
    } catch {
      /* ignore */
    }
  }, [palId]);

  function updateDay(day: Day, patch: Partial<DaySchedule>) {
    setSchedule((s) => ({ ...s, [day]: { ...s[day], ...patch } }));
  }

  function saveSchedule() {
    localStorage.setItem(`pal-schedule:${palId}`, JSON.stringify(schedule));
    setScheduleOpen(false);
    toast.success("Availability saved");
  }

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("pat_pals")
        .select(
          "user_id, headline, price_cents_per_minute, availability, rating_avg, rating_count, category_slugs, tier, is_team",
        )
        .eq("user_id", palId)
        .maybeSingle();
      let profile: {
        full_name: string | null;
        avatar_url: string | null;
        bio: string | null;
      } | null = null;
      if (data) {
        profile = (await fetchPublicProfile(palId)) ?? {
          full_name: null,
          avatar_url: null,
          bio: null,
        };
      }
      setPal(data ? ({ ...(data as object), profiles: profile } as unknown as Pal) : null);
      setLoading(false);
    })();
  }, [palId]);

  async function startChat() {
    setStarting("chat");
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) {
      navigate({ to: "/auth" });
      return;
    }
    const clientId = sess.session.user.id;
    const { data: existing } = await supabase
      .from("conversations")
      .select("id")
      .eq("client_id", clientId)
      .eq("pal_id", palId)
      .maybeSingle();
    let convoId = existing?.id;
    if (!convoId) {
      const { data: created, error } = await supabase
        .from("conversations")
        .insert({ client_id: clientId, pal_id: palId })
        .select("id")
        .single();
      if (error || !created) {
        setStarting(null);
        toast.error(error?.message ?? "Couldn't start chat");
        return;
      }
      convoId = created.id;
    }
    navigate({
      to: "/chat/$conversationId",
      params: { conversationId: convoId },
      search: { call: undefined },
    });
  }

  async function ensureConversation(clientId: string): Promise<string | null> {
    const { data: existing } = await supabase
      .from("conversations")
      .select("id")
      .eq("client_id", clientId)
      .eq("pal_id", palId)
      .maybeSingle();
    if (existing?.id) return existing.id;

    const { data: created, error } = await supabase
      .from("conversations")
      .insert({ client_id: clientId, pal_id: palId })
      .select("id")
      .single();
    if (error || !created) {
      toast.error(error?.message ?? "Couldn't start call");
      return null;
    }
    return created.id;
  }

  async function startCall(kind: "audio" | "video") {
    setStarting(kind);
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) {
      setStarting(null);
      navigate({ to: "/auth" });
      return;
    }
    const convoId = await ensureConversation(sess.session.user.id);
    setStarting(null);
    if (!convoId) return;

    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", sess.session.user.id)
      .maybeSingle();
    setCallerName(prof?.full_name ?? "Someone");
    setCallConversationId(convoId);
    setActiveCall(kind);
  }

  if (loading) {
    return (
      <AppShell>
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      </AppShell>
    );
  }

  if (!pal) {
    return (
      <AppShell>
        <div className="p-6">
          <p className="text-sm text-muted-foreground">Pal not found.</p>
          <Link to="/browse" className="mt-3 inline-block text-primary">
            Back to Browse
          </Link>
        </div>
      </AppShell>
    );
  }

  const name = pal.profiles?.full_name ?? "Pat Pal";
  const isOnline = palPresenceOnline;
  const ratingAvg = Number(pal.rating_avg ?? 0);
  const ratingCount = pal.rating_count ?? 0;

  return (
    <>
      {/* Full-screen call overlay */}
      {activeCall && callConversationId && (
        <CallScreen
          channelName={callConversationId}
          kind={activeCall}
          remoteName={name}
          palId={palId}
          conversationId={callConversationId}
          callerName={callerName}
          onEnd={() => {
            setActiveCall(null);
            setCallConversationId("");
          }}
        />
      )}

      <AppShell>
        {/* Header */}
        <header className="flex items-center gap-3 border-b border-border px-4 py-3">
          <button
            onClick={() => history.back()}
            aria-label="Back"
            className="grid h-9 w-9 place-items-center rounded-full bg-muted"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-bold">Profile</h1>
        </header>

        {/* Avatar + identity */}
        <section className="flex flex-col items-center px-5 pt-6 text-center">
          <div className="relative">
            {pal.profiles?.avatar_url ? (
              <img
                src={pal.profiles.avatar_url}
                alt={name}
                className="h-24 w-24 rounded-full object-cover"
              />
            ) : (
              <div className="grid h-24 w-24 place-items-center rounded-full bg-primary-soft text-3xl font-bold text-primary">
                {name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <span
              className={cn(
                "absolute bottom-1 right-1 h-4 w-4 rounded-full border-2 border-background",
                isOnline
                  ? "bg-success"
                  : pal.availability === "busy"
                    ? "bg-accent"
                    : "bg-muted-foreground/50",
              )}
            />
          </div>
          <div className="mt-3 flex items-center gap-1.5">
            <h2 className="text-xl font-extrabold tracking-tight">{name}</h2>
            <BadgeCheck className="h-5 w-5 text-primary" />
          </div>
          <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-semibold text-accent">
            <Crown className="h-3 w-3" /> {TIER_LABEL[pal.tier ?? ""] ?? "Supporter"}
          </span>
          <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Star className="h-3.5 w-3.5 fill-accent text-accent" />
              <span className="font-semibold text-foreground">{ratingAvg.toFixed(1)}</span> (
              {ratingCount})
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" /> {ratingCount} sessions
            </span>
          </div>
        </section>

        {/* Rate + action buttons */}
        <section className="px-5 pt-5">
          <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-2xl font-extrabold text-primary">
                  {pal.price_cents_per_minute === 0
                    ? "Free"
                    : `$${(pal.price_cents_per_minute / 100).toFixed(2)}`}
                  {pal.price_cents_per_minute > 0 && (
                    <span className="text-xs font-medium text-muted-foreground">/min</span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">Usually responds in 2 min</p>
              </div>
              {pal.price_cents_per_minute === 0 && (
                <span className="rounded-full bg-primary-soft px-2.5 py-1 text-[11px] font-semibold text-primary">
                  Free Trial
                </span>
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button
                onClick={() => startCall("audio")}
                disabled={starting !== null}
                className="h-11 rounded-xl font-semibold"
              >
                <Phone className="h-4 w-4" /> Audio Call
              </Button>
              <Button
                onClick={() => startCall("video")}
                variant="outline"
                disabled={starting !== null}
                className="h-11 rounded-xl font-semibold"
              >
                <Video className="h-4 w-4" /> Video
              </Button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button
                onClick={startChat}
                disabled={starting !== null}
                variant="secondary"
                className="h-11 rounded-xl font-semibold"
              >
                <MessageCircle className="h-4 w-4" /> Chat
              </Button>
              <Button
                onClick={() => setScheduleOpen(true)}
                variant="outline"
                className="h-11 rounded-xl font-semibold"
              >
                <Calendar className="h-4 w-4" /> Schedule
              </Button>
            </div>
          </div>
        </section>

        {/* About */}
        <section className="px-5 pt-6">
          <h3 className="text-sm font-bold">About</h3>
          <p className="mt-1.5 whitespace-pre-line text-sm text-muted-foreground">
            {pal.profiles?.bio ?? pal.headline ?? "This Pal hasn't added a bio yet."}
          </p>
        </section>

        {/* Specialties */}
        {pal.category_slugs && pal.category_slugs.length > 0 && (
          <section className="px-5 pt-5">
            <h3 className="text-sm font-bold">Specialties</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {pal.category_slugs.map((s) => (
                <span
                  key={s}
                  className="rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary"
                >
                  {labelForSlug(s)}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Languages */}
        <section className="px-5 pt-5">
          <h3 className="flex items-center gap-1.5 text-sm font-bold">
            <Globe className="h-4 w-4" /> Languages
          </h3>
          <p className="mt-1.5 text-sm text-muted-foreground">English</p>
        </section>

        {/* Credentials */}
        <section className="px-5 pt-5">
          <h3 className="flex items-center gap-1.5 text-sm font-bold">
            <ShieldCheck className="h-4 w-4" /> Credentials
          </h3>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {pal.headline ?? "Verified Pat Pal"}
          </p>
        </section>

        {/* Reviews */}
        <section className="px-5 pt-5 pb-8">
          <h3 className="text-sm font-bold">Reviews ({ratingCount})</h3>
          {ratingCount === 0 ? (
            <p className="mt-1.5 text-sm text-muted-foreground">No reviews yet</p>
          ) : (
            <p className="mt-1.5 text-sm text-muted-foreground">
              {ratingAvg.toFixed(1)} average from {ratingCount} sessions.
            </p>
          )}
        </section>

        {/* Schedule dialog */}
        <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Set availability</DialogTitle>
              <DialogDescription>
                Choose the days and hours you're available for sessions.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2.5 py-1">
              {DAYS.map((day) => {
                const d = schedule[day];
                return (
                  <div
                    key={day}
                    className="flex items-center gap-3 rounded-lg border border-border p-2.5"
                  >
                    <Switch
                      checked={d.enabled}
                      onCheckedChange={(v) => updateDay(day, { enabled: v })}
                      aria-label={`Toggle ${day}`}
                    />
                    <span className="w-10 text-sm font-semibold">{day}</span>
                    <div className="ml-auto flex items-center gap-1.5">
                      <Input
                        type="time"
                        value={d.start}
                        disabled={!d.enabled}
                        onChange={(e) => updateDay(day, { start: e.target.value })}
                        className="h-9 w-[110px]"
                      />
                      <span className="text-xs text-muted-foreground">to</span>
                      <Input
                        type="time"
                        value={d.end}
                        disabled={!d.enabled}
                        onChange={(e) => updateDay(day, { end: e.target.value })}
                        className="h-9 w-[110px]"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setScheduleOpen(false)}>
                Cancel
              </Button>
              <Button onClick={saveSchedule}>Save availability</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </AppShell>
    </>
  );
}
