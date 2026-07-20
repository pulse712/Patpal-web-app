import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Bell,
  BellOff,
  ChevronRight,
  LogOut,
  Moon,
  Settings,
  Shield,
  Sun,
  Trash2,
  User,
  Video,
} from "lucide-react";
import { useTheme } from "@/hooks/use-theme";
import { deleteMyAccount } from "@/lib/account.functions";
import { usePushNotifications } from "@/hooks/use-push-notifications";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({ meta: [{ title: "Profile — Pat My Back" }, { name: "robots", content: "noindex" }] }),
  component: Profile,
});

type NotifPrefs = { push: boolean; email: boolean; marketing: boolean };
const defaultNotifs: NotifPrefs = { push: true, email: true, marketing: false };

function loadNotifs(): NotifPrefs {
  if (typeof window === "undefined") return defaultNotifs;
  try {
    const v = window.localStorage.getItem("notif-prefs");
    return v ? { ...defaultNotifs, ...JSON.parse(v) } : defaultNotifs;
  } catch {
    return defaultNotifs;
  }
}

function Profile() {
  const navigate = useNavigate();
  const { theme, toggle: toggleTheme } = useTheme();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);

  // Modals
  const [pwOpen, setPwOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Password change
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [changingPw, setChangingPw] = useState(false);

  // Notification prefs (client-side pref)
  const [notifs, setNotifs] = useState<NotifPrefs>(defaultNotifs);
  const push = usePushNotifications();

  // Delete
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const deleteAccountFn = useServerFn(deleteMyAccount);

  useEffect(() => {
    setNotifs(loadNotifs());
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) return;
      setEmail(sess.session.user.email ?? "");
      const uid = sess.session.user.id;
      const [{ data: p }, { data: c }] = await Promise.all([
        supabase.from("profiles").select("full_name, bio").eq("id", uid).maybeSingle(),
        supabase.from("profile_contacts").select("phone").eq("user_id", uid).maybeSingle(),
      ]);
      if (p) {
        setFullName(p.full_name ?? "");
        setBio(p.bio ?? "");
      }
      if (c) setPhone(c.phone ?? "");
    })();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) return;
    const uid = sess.session.user.id;
    const [{ error }, { error: err2 }] = await Promise.all([
      supabase.from("profiles").update({ full_name: fullName, bio }).eq("id", uid),
      supabase.from("profile_contacts").upsert({ user_id: uid, phone }, { onConflict: "user_id" }),
    ]);
    setSaving(false);
    const e1 = error || err2;
    if (e1) toast.error(e1.message);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Profile saved");
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  async function changePassword() {
    if (newPw.length < 6) return toast.error("Password must be at least 6 characters");
    if (newPw !== newPw2) return toast.error("Passwords do not match");
    setChangingPw(true);
    const { error } = await supabase.auth.updateUser({ password: newPw });
    setChangingPw(false);
    if (error) return toast.error(error.message);
    toast.success("Password updated");
    setNewPw("");
    setNewPw2("");
    setPwOpen(false);
  }

  function updateNotif(key: keyof NotifPrefs, value: boolean) {
    const next = { ...notifs, [key]: value };
    setNotifs(next);
    window.localStorage.setItem("notif-prefs", JSON.stringify(next));
  }

  async function confirmDelete() {
    if (deleteConfirm !== "DELETE") return toast.error("Type DELETE to confirm");
    setDeleting(true);
    try {
      await deleteAccountFn();
      await supabase.auth.signOut();
      toast.success("Account deleted");
      navigate({ to: "/auth", replace: true });
    } catch (e) {
      setDeleting(false);
      toast.error(e instanceof Error ? e.message : "Failed to delete account");
    }
  }

  return (
    <AppShell>
      <header className="bg-hero-gradient px-5 pt-10 pb-8 text-white">
        <div className="flex items-center gap-4">
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-white/25 backdrop-blur">
            <User className="h-8 w-8" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-extrabold tracking-tight">{fullName || "Your profile"}</h1>
            <p className="truncate text-sm opacity-90">{email}</p>
          </div>
        </div>
      </header>

      <form onSubmit={save} className="space-y-4 px-5 pt-6">
        <div className="space-y-1.5">
          <Label htmlFor="p-name">Full name</Label>
          <Input id="p-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-phone">Phone</Label>
          <Input id="p-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-bio">Bio</Label>
          <Input id="p-bio" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Tell your Pals a bit about you" />
        </div>
        <Button type="submit" disabled={saving} className="h-11 w-full font-semibold">Save changes</Button>
      </form>

      {/* Preferences list */}
      <div className="px-5 pt-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Preferences</h2>
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          <button
            type="button"
            onClick={toggleTheme}
            className="flex w-full items-center gap-3 p-3.5 text-left hover:bg-muted/50"
          >
            {theme === "dark" ? <Moon className="h-5 w-5 text-primary" /> : <Sun className="h-5 w-5 text-primary" />}
            <div className="flex-1">
              <div className="text-sm font-semibold">Appearance</div>
              <div className="text-xs text-muted-foreground">{theme === "dark" ? "Dark mode" : "Light mode"} — tap to switch</div>
            </div>
            <Switch checked={theme === "dark"} onCheckedChange={toggleTheme} onClick={(e) => e.stopPropagation()} />
          </button>

          <RowButton icon={<Shield className="h-5 w-5 text-primary" />} title="Privacy & security" subtitle="Change password" onClick={() => setPwOpen(true)} />
          <RowButton icon={<Bell className="h-5 w-5 text-primary" />} title="Notifications" subtitle="Push, email, marketing" onClick={() => setNotifOpen(true)} />
          <Link to="/chats" className="flex w-full items-center gap-3 p-3.5 text-left hover:bg-muted/50">
            <Video className="h-5 w-5 text-primary" />
            <div className="flex-1">
              <div className="text-sm font-semibold">My sessions</div>
              <div className="text-xs text-muted-foreground">Your chats & calls</div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
          <RowButton icon={<Settings className="h-5 w-5 text-primary" />} title="Settings & privacy" subtitle="Account preferences" onClick={() => setSettingsOpen(true)} />
        </div>
      </div>

      {/* Account actions */}
      <div className="space-y-2.5 px-5 pt-6 pb-10">
        <button onClick={signOut} className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card p-3.5 text-sm font-semibold text-foreground hover:bg-muted/50">
          <LogOut className="h-4 w-4" /> Log out
        </button>
        <button
          onClick={() => setDeleteOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-destructive/30 bg-card p-3.5 text-sm font-semibold text-destructive hover:bg-destructive/5"
        >
          <Trash2 className="h-4 w-4" /> Delete account
        </button>
      </div>

      {/* Password dialog */}
      <Dialog open={pwOpen} onOpenChange={setPwOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>Choose a new password for your account.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-pw">New password</Label>
              <Input id="new-pw" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-pw2">Confirm password</Label>
              <Input id="new-pw2" type="password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwOpen(false)}>Cancel</Button>
            <Button onClick={changePassword} disabled={changingPw}>Update password</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Notifications dialog */}
      <Dialog open={notifOpen} onOpenChange={setNotifOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Notifications</DialogTitle>
            <DialogDescription>Choose what you want to hear about.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Real push subscription row */}
            <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-3.5">
              <div className="mt-0.5">
                {push.subscribed
                  ? <Bell className="h-5 w-5 text-primary" />
                  : <BellOff className="h-5 w-5 text-muted-foreground" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">Push notifications</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {push.permission === "denied"
                    ? "Blocked in browser settings — allow in site permissions to enable."
                    : push.permission === "unsupported"
                      ? "Not supported in this browser."
                      : push.subscribed
                        ? "You'll get alerts for messages and calls."
                        : "Get alerts for new messages and incoming calls."}
                </div>
              </div>
              <Switch
                checked={push.subscribed}
                disabled={push.loading || push.permission === "denied" || push.permission === "unsupported"}
                onCheckedChange={(v) => v ? push.enable() : push.disable()}
              />
            </div>

            <NotifRow label="Email notifications" desc="Session summaries and receipts" checked={notifs.email} onChange={(v) => updateNotif("email", v)} />
            <NotifRow label="Marketing" desc="Occasional product updates" checked={notifs.marketing} onChange={(v) => updateNotif("marketing", v)} />
          </div>
          <DialogFooter>
            <Button onClick={() => setNotifOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settings & privacy dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Settings & privacy</DialogTitle>
            <DialogDescription>Manage how your account behaves.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">Your data is protected by row-level security. You can export or delete your data at any time by contacting support or using the Delete account option.</p>
            <div className="rounded-lg border border-border p-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Account email</div>
              <div className="mt-1 break-all">{email}</div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setSettingsOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete account confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes your account and profile. Wallet balance, sessions, and messages tied to your account will be removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="del-confirm">Type <span className="font-mono font-semibold">DELETE</span> to confirm</Label>
            <Input id="del-confirm" value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              disabled={deleting || deleteConfirm !== "DELETE"}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

function RowButton({ icon, title, subtitle, onClick }: { icon: React.ReactNode; title: string; subtitle: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 p-3.5 text-left hover:bg-muted/50">
      {icon}
      <div className="flex-1">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-muted-foreground">{subtitle}</div>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </button>
  );
}

function NotifRow({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1">
        <div className="text-sm font-semibold">{label}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
