import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useSession } from "@/lib/session";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Trash2,
  Users,
  DollarSign,
  PhoneCall,
  TrendingUp,
  BarChart2,
  Loader2,
  Star,
  Search,
  ImagePlus,
} from "lucide-react";
import { getAnalytics } from "@/lib/analytics.functions";
import {
  listAdminUsers,
  setUserActive,
  setUserRole,
  confirmUserEmail,
  listTrialCodes,
  createTrialCode,
  setTrialCodeActive,
  deleteTrialCode,
  listPromoBanners,
  createPromoBanner,
  setPromoBannerVisible,
  deletePromoBanner,
  setPatPalApproved,
  setPatPalPrice,
  getAppPricingSettings,
  saveAppPricingSettings,
  setUserApprovalStatus,
  deleteUserAccount,
} from "@/lib/admin.functions";
import { requireAdminBeforeLoad } from "@/lib/admin-guard";
import { fetchPublicProfiles } from "@/lib/public-profiles";
import { uploadPromoBannerImage } from "@/lib/banner-upload";
import { readFileAsDataUrl } from "@/lib/image-crop";
import { BannerImageCropDialog } from "@/components/BannerImageCropDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AdminSessionsChart } from "@/components/AdminSessionsChart";
import { isMissingColumnError } from "@/lib/postgrest-utils";
import { parseDollarToCents } from "@/lib/money-input";
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

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: requireAdminBeforeLoad,
  validateSearch: (search: Record<string, unknown>): { tab?: "pals" } => ({
    tab: search.tab === "pals" ? "pals" : undefined,
  }),
  component: AdminPanel,
});

type Pal = {
  user_id: string;
  headline: string | null;
  availability: string;
  price_cents_per_minute: number;
  tier: string;
  full_name: string | null;
  is_approved?: boolean;
  approval_status?: string;
};
type Code = {
  id: string;
  code: string;
  label: string | null;
  is_active: boolean;
  unlimited: boolean;
  expires_at: string | null;
  starts_at?: string | null;
  grant_seconds?: number | null;
};
type Banner = {
  id: string;
  title: string;
  body: string | null;
  image_url: string | null;
  is_visible: boolean;
  sort_order: number;
  starts_at?: string | null;
  ends_at?: string | null;
};
type PricingPackage = {
  id: string;
  label: string;
  seconds: number;
  amount: number;
};

type Analytics = Awaited<ReturnType<typeof getAnalytics>>;
type AdminUser = Awaited<ReturnType<typeof listAdminUsers>>["users"][number];
type AppRole = "client" | "pat_pal" | "admin" | "super_admin";

const ROLE_LABELS: Record<AppRole, string> = {
  client: "Client",
  pat_pal: "Pat Pal",
  admin: "Admin",
  super_admin: "Super Admin",
};

function palListingState(p: Pal): "pending" | "listed" | "disabled" {
  if (p.is_approved) return "listed";
  if (p.approval_status === "approved") return "disabled";
  return "pending";
}

function AdminPanel() {
  const { isSuperAdmin = false } = Route.useRouteContext();
  const { tab } = Route.useSearch();
  const { user, loading } = useSession();
  const [pals, setPals] = useState<Pal[]>([]);
  const [codes, setCodes] = useState<Code[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [userRoleFilter, setUserRoleFilter] = useState<AppRole | "all">("all");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [userPage, setUserPage] = useState(1);
  const [userTotal, setUserTotal] = useState(0);
  const [userHasMore, setUserHasMore] = useState(false);
  const [roleBusy, setRoleBusy] = useState<string | null>(null);
  const [emailConfirmBusy, setEmailConfirmBusy] = useState<string | null>(null);
  const [approvalBusy, setApprovalBusy] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [newCode, setNewCode] = useState({
    label: "",
    code: "",
    unlimited: false,
    startsAt: "",
    expiresAt: "",
    grantMinutes: "60",
  });
  const [newBanner, setNewBanner] = useState({
    title: "",
    body: "",
    image_url: "",
    startsAt: "",
    endsAt: "",
  });
  const [bannerImageUploading, setBannerImageUploading] = useState(false);
  const [cropDialogOpen, setCropDialogOpen] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const [lastCropSource, setLastCropSource] = useState<string | null>(null);
  const [pricingDefaultDraft, setPricingDefaultDraft] = useState("1.00");
  const [pricingPackages, setPricingPackages] = useState<PricingPackage[]>([]);
  const [packageDrafts, setPackageDrafts] = useState<
    Record<string, { minutes: string; amount: string }>
  >({});
  const [pricingLoading, setPricingLoading] = useState(false);
  const [pricingBusy, setPricingBusy] = useState(false);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (loading || !user) return;
    void refresh();
  }, [user, loading]);

  async function refresh() {
    const [p, c, b] = await Promise.all([
      supabase
        .from("pat_pals")
        .select("user_id, headline, availability, price_cents_per_minute, tier, is_approved")
        .order("created_at", { ascending: false }),
      listTrialCodes(),
      listPromoBanners(),
    ]);
    let palRows = p.data ?? [];
    if (p.error && isMissingColumnError(p.error)) {
      const fallback = await supabase
        .from("pat_pals")
        .select("user_id, headline, availability, price_cents_per_minute, tier")
        .order("created_at", { ascending: false });
      palRows = (fallback.data ?? []).map((row) => ({ ...row, is_approved: true }));
    }
    const nameMap = await fetchPublicProfiles(palRows.map((r) => r.user_id));
    const ids = palRows.map((r) => r.user_id);
    let statusMap = new Map<string, string>();
    if (ids.length > 0) {
      const { data: statusRows } = await supabase
        .from("profiles")
        .select("id, approval_status")
        .in("id", ids);
      statusMap = new Map((statusRows ?? []).map((row) => [row.id, row.approval_status]));
    }
    const nextPals = palRows.map((r) => ({
      ...r,
      full_name: nameMap.get(r.user_id)?.full_name ?? null,
      approval_status: statusMap.get(r.user_id),
    })) as Pal[];
    setPals(nextPals);
    setPriceDrafts((prev) => {
      const next = { ...prev };
      for (const pal of nextPals) {
        if (next[pal.user_id] === undefined) {
          next[pal.user_id] = (pal.price_cents_per_minute / 100).toFixed(2);
        }
      }
      return next;
    });
    setCodes(c.codes as Code[]);
    setBanners(b.banners as Banner[]);
  }

  async function loadUsers(page = 1) {
    setUsersLoading(true);
    try {
      const result = await listAdminUsers({
        data: {
          search: userSearch.trim() || undefined,
          role: userRoleFilter,
          pendingOnly: pendingOnly || undefined,
          page,
          perPage: 50,
        },
      });
      setAdminUsers(result.users);
      setUserTotal(result.total);
      setUserPage(result.page);
      setUserHasMore(result.hasMore);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setUsersLoading(false);
    }
  }

  async function toggleUserActive(userId: string, isActive: boolean) {
    try {
      await setUserActive({ data: { userId, isActive } });
      toast.success(isActive ? "User activated" : "User deactivated");
      await loadUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function reviewSignup(userId: string, status: "approved" | "rejected") {
    setApprovalBusy(userId);
    try {
      await setUserApprovalStatus({ data: { userId, status } });
      toast.success(status === "approved" ? "Signup approved" : "Signup request cancelled");
      await loadUsers(userPage);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setApprovalBusy(null);
    }
  }

  async function confirmDeleteUser() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await deleteUserAccount({ data: { userId: deleteTarget.id } });
      toast.success("Account deleted — that email can be used to sign up again");
      setDeleteTarget(null);
      await Promise.all([loadUsers(userPage), refresh()]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleteBusy(false);
    }
  }

  async function assignUserRole(userId: string, role: AppRole) {
    setRoleBusy(userId);
    try {
      await setUserRole({ data: { userId, role } });
      toast.success(`Role updated to ${ROLE_LABELS[role]}`);
      await loadUsers();
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Role update failed");
    } finally {
      setRoleBusy(null);
    }
  }

  async function confirmEmail(userId: string) {
    setEmailConfirmBusy(userId);
    try {
      await confirmUserEmail({ data: { userId } });
      toast.success("Email confirmed — user can sign in now");
      await loadUsers(userPage);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to confirm email");
    } finally {
      setEmailConfirmBusy(null);
    }
  }

  async function loadAnalytics() {
    setAnalyticsLoading(true);
    try {
      const data = await getAnalytics();
      setAnalytics(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load analytics");
    } finally {
      setAnalyticsLoading(false);
    }
  }

  async function setApproved(userId: string, isApproved: boolean) {
    try {
      await setPatPalApproved({ data: { userId, isApproved } });
      toast.success(
        isApproved
          ? "Pat Pal approved — they can sign in and appear in Browse"
          : "Pat Pal disabled and unlisted",
      );
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function createCode() {
    const label = newCode.label.trim();
    if (!label) return toast.error("Label is required");
    const grantMinutes = Number(newCode.grantMinutes);
    if (!newCode.unlimited && (!Number.isFinite(grantMinutes) || grantMinutes < 1)) {
      return toast.error("Grant minutes must be at least 1");
    }
    try {
      const result = await createTrialCode({
        data: {
          label,
          code: newCode.code.trim() || undefined,
          unlimited: newCode.unlimited,
          startsAt: newCode.startsAt || undefined,
          expiresAt: newCode.expiresAt || undefined,
          grantMinutes: newCode.unlimited ? null : grantMinutes,
        },
      });
      setNewCode({
        label: "",
        code: "",
        unlimited: false,
        startsAt: "",
        expiresAt: "",
        grantMinutes: "60",
      });
      toast.success(`Created — Label: ${label} · Code: ${result.code}`);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create code");
    }
  }

  async function revokeCode(id: string) {
    try {
      await setTrialCodeActive({ data: { id, isActive: false } });
      toast.success("Code revoked — removed from user wallets");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not revoke code");
    }
  }

  async function reactivateCode(id: string) {
    try {
      await setTrialCodeActive({ data: { id, isActive: true } });
      toast.success("Code reactivated");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reactivate code");
    }
  }

  async function deleteCode(id: string) {
    if (
      !window.confirm("Delete this code permanently? Any users who redeemed it will lose access.")
    ) {
      return;
    }
    try {
      await deleteTrialCode({ data: { id } });
      toast.success("Code deleted");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  }

  async function openBannerCropper(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file.");
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setLastCropSource(dataUrl);
      setCropImageSrc(dataUrl);
      setCropDialogOpen(true);
    } catch {
      toast.error("Could not read image file.");
    }
  }

  function openBannerRecrop() {
    if (!newBanner.image_url && !lastCropSource) return;
    setCropImageSrc(lastCropSource ?? newBanner.image_url);
    setCropDialogOpen(true);
  }

  async function uploadCroppedBanner(blob: Blob) {
    setBannerImageUploading(true);
    try {
      const url = await uploadPromoBannerImage(blob);
      setNewBanner((prev) => ({ ...prev, image_url: url }));
      toast.success("Banner image saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not upload image");
      throw err;
    } finally {
      setBannerImageUploading(false);
    }
  }

  async function createBanner() {
    if (!newBanner.title) return toast.error("Title required");
    try {
      await createPromoBanner({
        data: {
          title: newBanner.title,
          body: newBanner.body || undefined,
          image_url: newBanner.image_url || undefined,
          sort_order: banners.length,
          startsAt: newBanner.startsAt || undefined,
          endsAt: newBanner.endsAt || undefined,
        },
      });
      setNewBanner({ title: "", body: "", image_url: "", startsAt: "", endsAt: "" });
      setLastCropSource(null);
      toast.success("Banner created");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create banner");
    }
  }

  async function savePalPrice(userId: string) {
    const raw = priceDrafts[userId]?.trim() ?? "";
    const dollars = parseFloat(raw);
    if (!Number.isFinite(dollars) || dollars < 0) {
      return toast.error("Enter a valid price");
    }
    const priceCentsPerMinute = Math.round(dollars * 100);
    try {
      await setPatPalPrice({ data: { userId, priceCentsPerMinute } });
      setPriceDrafts((prev) => ({
        ...prev,
        [userId]: (priceCentsPerMinute / 100).toFixed(2),
      }));
      toast.success("Price updated");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update price");
    }
  }

  async function loadPricing() {
    setPricingLoading(true);
    try {
      const data = await getAppPricingSettings();
      setPricingDefaultDraft((data.defaultPriceCents / 100).toFixed(2));
      setPricingPackages(data.packages);
      setPackageDrafts(
        Object.fromEntries(
          data.packages.map((pkg) => [
            pkg.id,
            {
              minutes: String(Math.round(pkg.seconds / 60)),
              amount: (pkg.amount / 100).toFixed(2),
            },
          ]),
        ),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load pricing");
    } finally {
      setPricingLoading(false);
    }
  }

  async function savePricing() {
    if (pricingPackages.length === 0) {
      return toast.error("Add at least one package");
    }
    const defaultCents = parseDollarToCents(pricingDefaultDraft);
    if (defaultCents == null) {
      return toast.error("Enter a valid default price");
    }
    const packages: PricingPackage[] = [];
    for (const pkg of pricingPackages) {
      if (!pkg.label.trim()) return toast.error("Each package needs a label");
      const draft = packageDrafts[pkg.id] ?? {
        minutes: String(Math.round(pkg.seconds / 60)),
        amount: (pkg.amount / 100).toFixed(2),
      };
      const minutes = Number(draft.minutes);
      if (!Number.isFinite(minutes) || minutes < 1) {
        return toast.error("Package minutes must be at least 1");
      }
      const amountCents = parseDollarToCents(draft.amount);
      if (amountCents == null) {
        return toast.error("Package amount cannot be negative");
      }
      packages.push({
        ...pkg,
        label: pkg.label.trim(),
        seconds: Math.round(minutes) * 60,
        amount: amountCents,
      });
    }
    setPricingBusy(true);
    try {
      await saveAppPricingSettings({
        data: {
          defaultPriceCents: defaultCents,
          packages: packages.map((pkg) => ({
            id: pkg.id,
            label: pkg.label.trim(),
            seconds: pkg.seconds,
            amount: pkg.amount,
          })),
        },
      });
      setPricingPackages(packages);
      toast.success("Pricing saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save pricing");
    } finally {
      setPricingBusy(false);
    }
  }

  async function toggleBanner(id: string, is_visible: boolean) {
    try {
      await setPromoBannerVisible({ data: { id, isVisible: is_visible } });
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function deleteBanner(id: string) {
    try {
      await deletePromoBanner({ data: { id } });
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  }

  if (loading) {
    return (
      <AppShell>
        <div className="p-6 text-sm text-muted-foreground">Loading...</div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-4 p-4 pb-24">
        <header className="rounded-2xl bg-gradient-to-br from-primary to-accent p-5 text-primary-foreground shadow-lg">
          <p className="text-xs uppercase tracking-wide opacity-80">Admin</p>
          <h1 className="text-2xl font-bold">Control panel</h1>
        </header>

        <Tabs
          defaultValue={tab === "pals" ? "pals" : "analytics"}
          onValueChange={(value) => {
            if (value === "pricing") void loadPricing();
          }}
        >
          <TabsList className="grid h-auto w-full grid-cols-6 gap-1">
            <TabsTrigger value="analytics" className="text-xs sm:text-sm">
              Stats
            </TabsTrigger>
            <TabsTrigger value="users" className="text-xs sm:text-sm">
              Users
            </TabsTrigger>
            <TabsTrigger value="pals" className="text-xs sm:text-sm">
              Pals
            </TabsTrigger>
            <TabsTrigger value="codes" className="text-xs sm:text-sm">
              Codes
            </TabsTrigger>
            <TabsTrigger value="pricing" className="text-xs sm:text-sm">
              Pricing
            </TabsTrigger>
            <TabsTrigger value="banners" className="text-xs sm:text-sm">
              Banners
            </TabsTrigger>
          </TabsList>

          {/* ── Analytics tab ──────────────────────────────────────── */}
          <TabsContent value="analytics" className="space-y-4 mt-4">
            {!analytics && !analyticsLoading && (
              <div className="flex flex-col items-center gap-3 py-10">
                <BarChart2 className="h-10 w-10 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">Load the latest stats</p>
                <Button onClick={loadAnalytics} className="font-semibold">
                  Load analytics
                </Button>
              </div>
            )}
            {analyticsLoading && (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            )}
            {analytics && !analyticsLoading && (
              <>
                {/* Stat cards */}
                <div className="grid grid-cols-2 gap-3">
                  <StatCard
                    icon={<Users className="h-5 w-5" />}
                    label="Total users"
                    value={analytics.totalUsers}
                    sub={`+${analytics.newUsers7d} this week`}
                  />
                  <StatCard
                    icon={<PhoneCall className="h-5 w-5" />}
                    label="Total sessions"
                    value={analytics.totalSessions}
                    sub={`${analytics.sessions7d} this week`}
                  />
                  <StatCard
                    icon={<DollarSign className="h-5 w-5" />}
                    label="Total revenue"
                    value={`$${analytics.totalRevDollars}`}
                    sub={`$${analytics.rev7dDollars} this week`}
                  />
                  <StatCard
                    icon={<TrendingUp className="h-5 w-5" />}
                    label="Active Pals"
                    value={analytics.activePals}
                    sub={`of ${analytics.totalPals} total`}
                  />
                </div>

                <AdminSessionsChart data={analytics.sessionsByDay} />

                {/* Top Pals */}
                {analytics.topPals.length > 0 && (
                  <Card className="p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                      Top Pat Pals (30 days)
                    </p>
                    <div className="space-y-2">
                      {analytics.topPals.map((p, i) => (
                        <div key={p.id} className="flex items-center gap-3">
                          <span className="text-xs font-bold text-muted-foreground w-4">
                            {i + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate">{p.name}</p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Star className="h-3 w-3 text-amber-400 fill-amber-400" />
                            <span className="text-sm font-bold">{p.count}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}

                {/* Recent sessions */}
                <Card className="p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    Recent sessions
                  </p>
                  <div className="space-y-2">
                    {analytics.recentSessions.length === 0 && (
                      <p className="text-sm text-muted-foreground">No sessions yet.</p>
                    )}
                    {analytics.recentSessions.map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center gap-2 text-sm border-b border-border pb-2 last:border-0"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="truncate font-medium">
                            {s.clientName} → {s.palName}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {s.kind} · {s.minutes}m · ${s.costDollars}
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground shrink-0">
                          {new Date(s.date).toLocaleDateString()}
                        </p>
                      </div>
                    ))}
                  </div>
                </Card>

                <Button variant="outline" onClick={loadAnalytics} className="w-full">
                  Refresh
                </Button>
              </>
            )}
          </TabsContent>

          {/* ── Users tab ───────────────────────────────────────────── */}
          <TabsContent value="users" className="mt-4 space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search name or email…"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  className="h-10 pl-9"
                />
              </div>
              <Select
                value={userRoleFilter}
                onValueChange={(v) => setUserRoleFilter(v as AppRole | "all")}
              >
                <SelectTrigger className="h-10 w-[130px]">
                  <SelectValue placeholder="Role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  <SelectItem value="client">Client</SelectItem>
                  <SelectItem value="pat_pal">Pat Pal</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  {isSuperAdmin && <SelectItem value="super_admin">Super Admin</SelectItem>}
                </SelectContent>
              </Select>
            </div>

            <Button
              type="button"
              variant={pendingOnly ? "default" : "outline"}
              size="sm"
              className="w-full"
              onClick={() => setPendingOnly((v) => !v)}
            >
              {pendingOnly ? "Showing pending approvals only" : "Show pending approvals only"}
            </Button>

            <Button onClick={() => loadUsers(1)} disabled={usersLoading} className="w-full">
              {usersLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </>
              ) : (
                "Load users"
              )}
            </Button>

            {adminUsers.length === 0 && !usersLoading && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Click "Load users" to view accounts.
              </p>
            )}

            {adminUsers.length > 0 && (
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
                <span className="text-muted-foreground">
                  Showing {(userPage - 1) * 50 + 1}-{Math.min(userPage * 50, userTotal)} of{" "}
                  {userTotal}
                </span>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => loadUsers(userPage - 1)}
                    disabled={userPage === 1 || usersLoading}
                  >
                    ← Prev
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => loadUsers(userPage + 1)}
                    disabled={!userHasMore || usersLoading}
                  >
                    Next →
                  </Button>
                </div>
              </div>
            )}

            {adminUsers.map((u) => (
              <Card key={u.id} className="space-y-3 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{u.fullName || "Unnamed"}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {u.email || "No email"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Badge variant="secondary" className="text-[10px]">
                        {ROLE_LABELS[u.role]}
                      </Badge>
                      {!u.emailConfirmed && (
                        <Badge variant="outline" className="text-[10px] text-amber-700">
                          Email unverified
                        </Badge>
                      )}
                      {!u.isActive && (
                        <Badge variant="destructive" className="text-[10px]">
                          Inactive
                        </Badge>
                      )}
                      {u.role === "pat_pal" && u.approvalStatus === "pending" && (
                        <Badge variant="secondary" className="text-[10px] text-amber-700">
                          Pending approval
                        </Badge>
                      )}
                      {u.approvalStatus === "rejected" && (
                        <Badge variant="destructive" className="text-[10px]">
                          Cancelled
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Label htmlFor={`active-${u.id}`} className="text-[10px] text-muted-foreground">
                      Active
                    </Label>
                    <Switch
                      id={`active-${u.id}`}
                      checked={u.isActive}
                      disabled={u.id === user?.id}
                      onCheckedChange={(v) => toggleUserActive(u.id, v)}
                    />
                  </div>
                </div>

                {u.role === "pat_pal" && u.approvalStatus !== "approved" && (
                  <div className="flex flex-wrap gap-2 border-t border-border pt-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={approvalBusy === u.id}
                      onClick={() => reviewSignup(u.id, "approved")}
                    >
                      {approvalBusy === u.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Approve"
                      )}
                    </Button>
                    {u.approvalStatus !== "rejected" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={approvalBusy === u.id}
                        onClick={() => reviewSignup(u.id, "rejected")}
                      >
                        Cancel request
                      </Button>
                    )}
                  </div>
                )}

                <div className="space-y-2 border-t border-border pt-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Role
                  </p>
                  <Select
                    value={u.role}
                    disabled={
                      roleBusy === u.id ||
                      (u.id === user?.id && (u.role === "admin" || u.role === "super_admin"))
                    }
                    onValueChange={(value) => assignUserRole(u.id, value as AppRole)}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="client">{ROLE_LABELS.client}</SelectItem>
                      <SelectItem value="pat_pal">{ROLE_LABELS.pat_pal}</SelectItem>
                      <SelectItem value="admin">{ROLE_LABELS.admin}</SelectItem>
                      {isSuperAdmin && (
                        <SelectItem value="super_admin">{ROLE_LABELS.super_admin}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>

                {!u.emailConfirmed && (
                  <div className="border-t border-border pt-2">
                    <p className="mb-2 text-[10px] text-muted-foreground">
                      User cannot sign in until email is verified. Use this if Supabase mail is
                      rate-limited.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="w-full"
                      disabled={emailConfirmBusy === u.id}
                      onClick={() => confirmEmail(u.id)}
                    >
                      {emailConfirmBusy === u.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Confirm email (allow sign-in)"
                      )}
                    </Button>
                  </div>
                )}

                {u.id !== user?.id && (
                  <div className="border-t border-border pt-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="w-full text-destructive hover:text-destructive"
                      onClick={() =>
                        setDeleteTarget({
                          id: u.id,
                          label: u.fullName || u.email || "this account",
                        })
                      }
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete account
                    </Button>
                  </div>
                )}
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="pals" className="space-y-2">
            {pals.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">No Pat Pals yet.</p>
            )}
            {pals.map((p) => {
              const state = palListingState(p);
              const badgeLabel =
                state === "listed" ? "Listed" : state === "disabled" ? "Disabled" : "Pending";
              return (
                <Card
                  key={p.user_id}
                  className={
                    state === "disabled"
                      ? "space-y-2 border-dashed p-3 opacity-70"
                      : "space-y-2 p-3"
                  }
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{p.full_name || "Unnamed"}</p>
                        <Badge variant={state === "listed" ? "default" : "secondary"}>
                          {badgeLabel}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{p.headline || "No headline"}</p>
                      <p className="mt-1 text-xs">
                        ${(p.price_cents_per_minute / 100).toFixed(2)}/min · {p.tier}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {state === "pending" && (
                      <Button size="sm" onClick={() => setApproved(p.user_id, true)}>
                        Approve
                      </Button>
                    )}
                    {state === "listed" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setApproved(p.user_id, false)}
                      >
                        Disable
                      </Button>
                    )}
                    {state === "listed" && p.approval_status && p.approval_status !== "approved" && (
                      <Button size="sm" onClick={() => setApproved(p.user_id, true)}>
                        Unlock sign-in
                      </Button>
                    )}
                    {state === "disabled" && (
                      <Button size="sm" onClick={() => setApproved(p.user_id, true)}>
                        Enable
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      onClick={() =>
                        setDeleteTarget({
                          id: p.user_id,
                          label: p.full_name || "this Pat Pal",
                        })
                      }
                    >
                      <Trash2 className="mr-1 h-4 w-4" />
                      Delete
                    </Button>
                  </div>
                  <div className="flex items-end gap-2 border-t border-border pt-2">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Label htmlFor={`price-${p.user_id}`}>Price ($/min)</Label>
                      <Input
                        id={`price-${p.user_id}`}
                        type="text"
                        inputMode="decimal"
                        value={
                          priceDrafts[p.user_id] ?? (p.price_cents_per_minute / 100).toFixed(2)
                        }
                        onChange={(e) =>
                          setPriceDrafts((prev) => ({
                            ...prev,
                            [p.user_id]: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <Button size="sm" onClick={() => savePalPrice(p.user_id)}>
                      Save
                    </Button>
                  </div>
                </Card>
              );
            })}
          </TabsContent>

          <TabsContent value="codes" className="space-y-3">
            <Card className="space-y-2 p-3">
              <h3 className="font-semibold">New trial code</h3>
              <p className="text-xs text-muted-foreground">
                Revoke removes access from users who redeemed a code. Delete removes the code
                entirely.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="code-label">Label</Label>
                <Input
                  id="code-label"
                  placeholder="e.g. Summer promo"
                  value={newCode.label}
                  onChange={(e) => setNewCode({ ...newCode, label: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="code-value">Custom redeem code</Label>
                <Input
                  id="code-value"
                  placeholder="Leave blank to auto-generate"
                  value={newCode.code}
                  onChange={(e) => setNewCode({ ...newCode, code: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="code-starts">Start date</Label>
                  <Input
                    id="code-starts"
                    type="date"
                    value={newCode.startsAt}
                    onChange={(e) => setNewCode({ ...newCode, startsAt: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="code-expires">End date</Label>
                  <Input
                    id="code-expires"
                    type="date"
                    value={newCode.expiresAt}
                    onChange={(e) => setNewCode({ ...newCode, expiresAt: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="code-grant">Grant minutes</Label>
                <Input
                  id="code-grant"
                  type="number"
                  min="1"
                  disabled={newCode.unlimited}
                  value={newCode.grantMinutes}
                  onChange={(e) => setNewCode({ ...newCode, grantMinutes: e.target.value })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="unlimited">Unlimited access</Label>
                <Switch
                  id="unlimited"
                  checked={newCode.unlimited}
                  onCheckedChange={(v) => setNewCode({ ...newCode, unlimited: v })}
                />
              </div>
              <Button onClick={createCode} className="w-full">
                Create code
              </Button>
            </Card>
            {codes.length === 0 ? (
              <Card className="p-6 text-center text-sm text-muted-foreground">No codes yet</Card>
            ) : (
              codes.map((c) => (
                <Card key={c.id} className="p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Label
                        </p>
                        <p className="font-medium">{c.label || "—"}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Redeem code
                        </p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2">
                          <p className="font-mono text-sm font-semibold tracking-wide">{c.code}</p>
                          <Badge variant={c.is_active ? "default" : "secondary"}>
                            {c.is_active ? "Active" : "Revoked"}
                          </Badge>
                          {c.unlimited && <Badge variant="outline">Unlimited</Badge>}
                        </div>
                      </div>
                      <div className="space-y-0.5 text-xs text-muted-foreground">
                        {c.starts_at && <p>Starts {new Date(c.starts_at).toLocaleDateString()}</p>}
                        {c.expires_at && (
                          <p>Expires {new Date(c.expires_at).toLocaleDateString()}</p>
                        )}
                        {!c.unlimited && c.grant_seconds != null && (
                          <p>Grant {Math.round(c.grant_seconds / 60)} min</p>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {c.is_active ? (
                        <Button size="sm" variant="outline" onClick={() => revokeCode(c.id)}>
                          Revoke
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => reactivateCode(c.id)}>
                          Reactivate
                        </Button>
                      )}
                      <Button size="sm" variant="destructive" onClick={() => deleteCode(c.id)}>
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </Button>
                    </div>
                  </div>
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="banners" className="space-y-3">
            <Card className="space-y-3 p-3">
              <h3 className="font-semibold">New banner</h3>
              <Input
                placeholder="Title"
                value={newBanner.title}
                onChange={(e) => setNewBanner({ ...newBanner, title: e.target.value })}
              />
              <div className="space-y-1.5">
                <Label htmlFor="banner-body">Body</Label>
                <Textarea
                  id="banner-body"
                  placeholder="Banner message"
                  value={newBanner.body}
                  onChange={(e) => setNewBanner({ ...newBanner, body: e.target.value })}
                  maxLength={1000}
                  rows={4}
                />
                <p className="text-right text-xs text-muted-foreground">
                  {newBanner.body.length}/1000
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="banner-image">Banner image</Label>
                {newBanner.image_url ? (
                  <div className="overflow-hidden rounded-xl border border-border">
                    <div className="aspect-[12/5] w-full overflow-hidden">
                      <img
                        src={newBanner.image_url}
                        alt="Banner preview"
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="flex flex-wrap gap-2 p-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={bannerImageUploading}
                        onClick={openBannerRecrop}
                      >
                        Edit crop
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={bannerImageUploading}
                        onClick={() => document.getElementById("banner-image")?.click()}
                      >
                        Change
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={bannerImageUploading}
                        onClick={() => {
                          setNewBanner({ ...newBanner, image_url: "" });
                          setLastCropSource(null);
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                ) : (
                  <label
                    htmlFor="banner-image"
                    className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center hover:bg-muted/40"
                  >
                    {bannerImageUploading ? (
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    ) : (
                      <ImagePlus className="h-8 w-8 text-muted-foreground" />
                    )}
                    <span className="text-sm font-medium">
                      {bannerImageUploading ? "Uploading…" : "Upload picture"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      PNG, JPG, or WebP up to 5 MB
                    </span>
                  </label>
                )}
                <input
                  id="banner-image"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="sr-only"
                  disabled={bannerImageUploading}
                  onChange={(e) => {
                    void openBannerCropper(e.target.files?.[0] ?? null);
                    e.target.value = "";
                  }}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="banner-starts">Start date</Label>
                  <Input
                    id="banner-starts"
                    type="date"
                    value={newBanner.startsAt}
                    onChange={(e) => setNewBanner({ ...newBanner, startsAt: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="banner-ends">End date</Label>
                  <Input
                    id="banner-ends"
                    type="date"
                    value={newBanner.endsAt}
                    onChange={(e) => setNewBanner({ ...newBanner, endsAt: e.target.value })}
                  />
                </div>
              </div>
              <Button onClick={createBanner} className="w-full" disabled={bannerImageUploading}>
                Create banner
              </Button>
            </Card>
            {banners.map((b) => (
              <Card key={b.id} className="flex items-center justify-between gap-3 p-3">
                <div className="flex min-w-0 items-center gap-3">
                  {b.image_url ? (
                    <img
                      src={b.image_url}
                      alt=""
                      className="h-14 w-20 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="grid h-14 w-20 shrink-0 place-items-center rounded-lg bg-muted text-xs text-muted-foreground">
                      No image
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-semibold">{b.title}</p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{b.body || "—"}</p>
                    {(b.starts_at || b.ends_at) && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {b.starts_at
                          ? `From ${new Date(b.starts_at).toLocaleDateString()}`
                          : "No start"}
                        {" · "}
                        {b.ends_at ? `Until ${new Date(b.ends_at).toLocaleDateString()}` : "No end"}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Switch checked={b.is_visible} onCheckedChange={(v) => toggleBanner(b.id, v)} />
                  <Button size="icon" variant="ghost" onClick={() => deleteBanner(b.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="pricing" className="mt-4 space-y-3">
            <Card className="space-y-3 p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">App pricing</h3>
                <Button size="sm" variant="outline" onClick={loadPricing} disabled={pricingLoading}>
                  {pricingLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                    </>
                  ) : (
                    "Load"
                  )}
                </Button>
              </div>
              {pricingLoading && pricingPackages.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="default-price">Default price ($/min)</Label>
                    <Input
                      id="default-price"
                      type="text"
                      inputMode="decimal"
                      placeholder="1.00"
                      value={pricingDefaultDraft}
                      onChange={(e) => setPricingDefaultDraft(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Credit packages
                    </p>
                    {pricingPackages.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        Click Load to fetch current packages.
                      </p>
                    )}
                    {pricingPackages.map((pkg, idx) => (
                      <Card key={pkg.id} className="space-y-2 p-3">
                        <div className="space-y-1.5">
                          <Label htmlFor={`pkg-label-${pkg.id}`}>Label</Label>
                          <Input
                            id={`pkg-label-${pkg.id}`}
                            value={pkg.label}
                            onChange={(e) => {
                              const label = e.target.value;
                              setPricingPackages((prev) =>
                                prev.map((row, i) => (i === idx ? { ...row, label } : row)),
                              );
                            }}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1.5">
                            <Label htmlFor={`pkg-min-${pkg.id}`}>Minutes</Label>
                            <Input
                              id={`pkg-min-${pkg.id}`}
                              type="text"
                              inputMode="numeric"
                              value={
                                packageDrafts[pkg.id]?.minutes ??
                                String(Math.round(pkg.seconds / 60))
                              }
                              onChange={(e) => {
                                const minutes = e.target.value;
                                setPackageDrafts((prev) => ({
                                  ...prev,
                                  [pkg.id]: {
                                    minutes,
                                    amount:
                                      prev[pkg.id]?.amount ?? (pkg.amount / 100).toFixed(2),
                                  },
                                }));
                              }}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`pkg-amt-${pkg.id}`}>Amount ($)</Label>
                            <Input
                              id={`pkg-amt-${pkg.id}`}
                              type="text"
                              inputMode="decimal"
                              value={
                                packageDrafts[pkg.id]?.amount ?? (pkg.amount / 100).toFixed(2)
                              }
                              onChange={(e) => {
                                const amount = e.target.value;
                                setPackageDrafts((prev) => ({
                                  ...prev,
                                  [pkg.id]: {
                                    minutes:
                                      prev[pkg.id]?.minutes ??
                                      String(Math.round(pkg.seconds / 60)),
                                    amount,
                                  },
                                }));
                              }}
                            />
                          </div>
                        </div>
                        <p className="text-[10px] text-muted-foreground">ID: {pkg.id}</p>
                      </Card>
                    ))}
                  </div>
                  <Button
                    onClick={savePricing}
                    className="w-full"
                    disabled={pricingBusy || pricingPackages.length === 0}
                  >
                    {pricingBusy ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                      </>
                    ) : (
                      "Save pricing"
                    )}
                  </Button>
                </>
              )}
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <BannerImageCropDialog
        open={cropDialogOpen}
        imageSrc={cropImageSrc}
        onOpenChange={setCropDialogOpen}
        onConfirm={uploadCroppedBanner}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Are you sure you want to delete {deleteTarget?.label || "this account"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the account, profile, wallet, sessions, and messages tied to
              it. Their email will be free to sign up again as a brand new account. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteBusy}
              onClick={(e) => {
                e.preventDefault();
                void confirmDeleteUser();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <Card className="p-4 space-y-1">
      <div className="flex items-center gap-2 text-primary">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <p className="text-2xl font-extrabold tracking-tight">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
}
