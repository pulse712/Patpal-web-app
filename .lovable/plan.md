## Pat My Back — build plan

This is a large marketplace app (auth, wallet, real-time chat, audio/video calls, payments, admin, PWA). I'll ship it in phases so each one is reviewable and works end-to-end. Before I start, a few important stack notes and one decision I need from you.

### Stack adjustments (please confirm)

Your brief specifies Firebase + Agora + Stripe + Vercel. This Lovable project ships on a different stack that gives you the same capabilities with less setup:

- **Auth + database + realtime + storage** → Lovable Cloud (Postgres + Row-Level Security + realtime) instead of Firebase. Same features (email/password auth, phone OTP, realtime chat, per-user data isolation via RLS), fully managed, no external account needed. The account can be transferred to you.
- **Payments** → Lovable's built-in Stripe integration (`enable_stripe_payments`). No API key handling, Stripe still the processor, standard fees. If you insist on bring-your-own Stripe account with your own secret key, we can do that instead — say the word.
- **Audio/video calls** → Agora requires an Agora account + App ID + a token-signing server. I'll wire the client SDK and a server function that mints Agora tokens; you'll add your Agora App ID + App Certificate as secrets when ready. Until then, call buttons will show a "connect Agora" notice.
- **Hosting** → Lovable's Publish (one click, custom domain supported). Not Vercel. Source code is yours and exportable to GitHub at any time.
- **Framework** → React + TypeScript + Tailwind (as requested), on TanStack Start.
- **"Demo mode with localStorage when Firebase creds missing"** → not applicable, Lovable Cloud is always provisioned. Removing this requirement.

If any of these are dealbreakers, tell me now and I'll adjust.

### Decision I need from you

**Where should video/audio calling live in v1?**
1. **Stub it now, wire Agora in phase 3** once you've created an Agora account and shared App ID / App Certificate. (Recommended — unblocks everything else.)
2. **Skip calls entirely for v1**, ship text chat + wallet + admin, add calls later.
3. **You already have Agora credentials** — share them via the secure secret form and I'll wire it in phase 1.

### Phase 1 — Foundation (this turn if you approve)

- Design system in `src/styles.css`: teal `#0EA5A0` primary, teal→orange gradient token, Inter font, shadcn variants for hero button, tier badges, pill chips
- PWA manifest + icons (installable, no offline SW — per Lovable PWA defaults)
- Route scaffolding with head metadata: `/`, `/auth/login`, `/auth/register`, `/auth/forgot`, `/auth/verify`, `/chats`, `/chats/$conversationId`, `/browse`, `/wallet`, `/profile`, `/pal` (Pat Pal dashboard), `/admin`
- Bottom nav shell (5 tabs, Lucide icons, teal active)
- Enable Lovable Cloud
- Schema + RLS: `profiles` (with `role` via separate `user_roles` table + `app_role` enum + `has_role` SECURITY DEFINER — never role on profile), `pat_pals` (bio, tier, price_per_minute, availability, categories), `categories` (seeded with your 12 emoji categories), `conversations`, `messages`, `wallets` (balance_seconds), `sessions` (client, pal, start, end, duration, credit_used, remaining), `credit_transactions`, `trial_codes`, `promo_banners`
- Auth pages (email/password + phone) wired to Lovable Cloud with `onAuthStateChange` + `getUser` guard, `_authenticated` layout route

### Phase 2 — Client experience

- Home dashboard: header pill (live minutes remaining), teal→orange hero banner, "Talk to the Team" (admin/team Pat Pals), category grid, "Online now", "Top rated" (all reading from Firestore-equivalent Postgres via TanStack Query)
- Browse page with category + tier + price filters, Pat Pal profile pages
- Chat: realtime messages, teal client bubbles, message input, header with call icons
- Wallet: credit packs (15m / 30m / 1h / custom ≥ $20), Stripe Checkout, balance display, transaction history
- Trial-code redemption (unlimited-minutes flag on wallet)

### Phase 3 — Calls, sessions, live billing

- Agora audio + video modals (full-screen, mute, camera toggle, red end-call, local PiP)
- Session lifecycle: server function starts session (checks balance or trial code), 1-second-tick countdown driven by server timestamp, 2-minute warning modal with $5/$10/custom top-up, mid-call top-up without dropping, server function ends session and records `sessions` row + debits wallet
- Pat Pal cannot initiate: enforced by RLS (only clients can insert into `sessions`/`conversations`)

### Phase 4 — Pat Pal + admin + super admin

- Pat Pal dashboard: availability toggle (Available / Busy / Offline), active conversations, earnings summary (aggregated from `sessions`)
- Admin panel: user list with role filter, activate/deactivate, payment records, promo banner editor (text + visibility, read by home page), trial-code CRUD (code, expiry, active flag, unlimited)
- Super Admin role (full access via `has_role(uid, 'super_admin')`)

### Phase 5 — Polish + launch

- SEO metadata per route, sitemap.xml, robots.txt, og:image
- Loading/empty/error states, toasts, form validation with Zod
- Manual QA pass on mobile viewport
- Security scan + fixes

### Technical details

- **Roles**: separate `user_roles` table + `app_role` enum + `has_role()` SECURITY DEFINER function; RLS everywhere; grants on every public table
- **Server functions** for balance checks, session start/end, Agora token mint, admin actions — protected with `requireSupabaseAuth` + role check
- **Realtime** via Supabase Postgres changes (messages, availability, session ticks)
- **Stripe webhooks** at `src/routes/api/public/stripe-webhook.ts` with signature verification, credits `wallets.balance_seconds`
- **Env/secrets**: Stripe secret + Agora App Certificate stored via Lovable secrets (never in frontend); Agora App ID is publishable, safe in code
- **PWA**: manifest-only (installable, no service worker) per Lovable PWA defaults, unless you specifically ask for offline
- **60-day support / source ownership / accounts under your business** — those are contract terms, noted; source is already yours via GitHub export

Reply "go" (plus your answer to the calling question) and I'll start on Phase 1.