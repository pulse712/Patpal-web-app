# Pat My Back — Project status

Last updated: **2026-08-15**

Live: `patmyback.com` / `www.patmyback.com`  
Repos: `pulse712/Patpal-web-app` (`origin`), `thebenhurk/pat-my-back` (`benhur`)  
Branch: `main`

---

## Payment / phases (current)

| Item | Amount | Status |
|------|--------|--------|
| Phase 1 — PWA (Milestones 1 + 2) | $1,000 | Built. First $500 released; second $500 was outstanding as of late July. |
| Phase 2 / Milestone 3 — native iOS & Android, stores, demos, promotions | $500 from first earnings (client later asked to bundle with extras as $1,000) | **Not started** |
| Aug 12 admin/control extras (approval, codes, banners, pricing, sounds) | Quoted ~$1,400–$1,650; then $600; then **$300/month** with bug fixes until paid off | **Mostly coded** (see below) |
| Support | 60-day free bugs after launch, then monthly | Client: lost school job; 6-month “make money or shut down” |

There was **no Phase 3** in the original plan. Client called Milestone 3 “Phase 3.”

---

## What’s live in the product (Phase 1)

Auth (email + phone collected; login is email/password), roles, Pal profiles, browse, chat, Agora audio/video, wallet/Stripe, call timer + mid-call top-up, trial codes, admin panel, PWA, banners, ratings, profile photos, push plumbing.

---

## Work history — 12–14 Aug 2026

### 12 Aug — admin ops batch (`672e192`)

Unique Pal names, Super Admin email on Pal signup, Pal pending/unlisted (`is_approved`), per-Pal price, trial codes (custom code, dates, minutes), banner schedule, admin pricing tab, home categories-in-use, Browse Any-price + real ranges, softer ringtone + message chime (fallback tones until 15 Aug).

### 13 Aug — account statuses + login gate

Client’s 5 statuses:

1. Pending — review up to 24 hours  
2. Approved — normal login  
3. Deactivated — signed out; contact **thebenhurk@gmail.com**  
4. Deleted — “account does not exist, please sign up”  
5. Never signed up / bad password — same as deleted  

Fixes: pending/banned could enter the app; approval not enforced everywhere; approved users blocked by flaky client gate + missing `account.functions` chunk 404 (`df7412f`). Server-side `checkMyAccountAccess`.

### 14 Aug — client punch-list (this round)

Client: live alert unclear; no phone push; pricing input broken; Disable doesn’t unlist/look disabled; no delete; no notice on Pal signup; approved Pal still “being reviewed”; don’t approve customers.

**Coded (latest commits `97080b2` … `7a22191`):**

- Customers auto-approved; only Pat Pals stay pending  
- Pals **Approve** sets `pat_pals.is_approved` **and** `profiles.approval_status` (unlocks login). **Unlock sign-in** if already listed  
- Disable = unlist + **Disabled** badge; no Unlist button  
- Delete with “Are you sure you want to delete…?”  
- Pricing fields are typed as text (can clear / type cents)  
- Sticky **live alert** for pending Pals: on signup, on admin login if unseen, gone after **Review**  
- Email to admin + super_admin on new Pal (needs Resend)  
- iPhone: Add to Home Screen copy for notifications  

**Vercel** failed on `c3cf755` (JSX in `.ts`); fixed `df80588` (rename to `.tsx`). Later commits `b7b1579` and `7a22191` are on `origin/main`.

### 15 Aug — client sounds

Client sent Dings 1–4 and a Pat My Back ringtone. Wired:

- `public/sounds/message-chime.mp3` ← Ding 4 (highest note)
- `public/sounds/ringtone.mp3` ← Pat My Back - Righton.mp3

Until this is committed and deployed, production 404s both files and keeps the Web Audio fallback. Skipped *Simple Strings Serenade.wav* (~25MB track).

---

## Client punch-list vs code

| Ask | Code | Live caveat |
|-----|------|-------------|
| What is live alert? | Sticky banner + Review → Pals tab | In `7a22191` on `origin/main` |
| No admin notice on Pal signup | Banner + email | Email needs a real `RESEND_API_KEY` on Vercel |
| Approved Pal can’t sign in / listed but locked | Approve unlocks login | Prod: 19 listed Pals, all `approval_status=approved` |
| Don’t approve customers | Yes | Prod: 0 pending profiles; Aug 14 customer is approved |
| Disable still on Browse | Disable unlists; **Disabled** badge | In `7a22191` |
| Delete + confirm | Yes | In `7a22191` |
| Pricing wonky | Yes | In `7a22191` |
| Phone call/message push | Web push only; iOS PWA instructions | Confirm VAPID keys on **Vercel** (not just local `.env`); not native apps |
| Custom ringtone / ding | Files in `public/sounds/` | Live after this commit deploys; URLs were 404 on 15 Aug while untracked |

---

## Must do next (blocks “it works for the client”)

1. **Sounds** are in `public/sounds/` in this snapshot. After push, confirm `https://www.patmyback.com/sounds/ringtone.mp3` and `message-chime.mp3` return 200 (they were 404 on 15 Aug while untracked).
2. **SQL** `20260814120000_client_auto_approve_patpal_login.sql`: production *data* already matches the backfill (no pending profiles; listed Pals can log in). Confirm the **signup trigger** in Supabase SQL Editor if a brand-new customer is stuck pending — we could not read `handle_new_user` via the API.
3. **Vercel Production env** (CLI was logged out here, so dashboard check is still required; then **Redeploy** if keys change):
   - Push: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VITE_VAPID_PUBLIC_KEY` (public pair must match)
   - Optional: `VAPID_EMAIL`
   - Email: `RESEND_API_KEY` (optional `RESEND_FROM`; default `noreply@mail.patmyback.com`). Local `.env` still has the example placeholder, so Pal-signup email is likely unset unless Vercel has a real key.
4. Confirm Vercel dashboard is green after `df80588` (the `c3cf755` JSX-in-`.ts` failure). Live site is serving; sounds were 404 only because they were untracked.
5. Smoke test after the sound deploy: incoming call plays the Pat My Back ringtone; new chat plays Ding 4. Also: customer login with no approval; Approve Pal → they sign in; Disable → gone from Browse; phone Enable notifications (iPhone: Home Screen first).

**Checked 15 Aug (not typecheck-only):** `ratings.rater_id` / `ratee_id` exist in production (bidirectional migration is applied; table currently has 0 rows). The legacy ratings insert path is dead on prod.

Older setup still worth verifying: Stripe webhook `https://patmyback.com/api/stripe/webhook`, Agora two-device call, custom SMTP, domain DNS.

---

## Not started / out of this month’s web work

- Native iOS/Android, store submission, demo videos, promotions (Milestone 3)  
- True native push (needs those apps)  
- Phone OTP login (number is collected only)  
- Dedicated “default banner” after a scheduled banner ends  

---

## Key files (Aug work)

- Gate: `src/lib/account-access.ts`, `src/lib/account.functions.ts`, `src/routes/auth.tsx`, `src/routes/_authenticated/route.tsx`, `src/routes/account-status.tsx`  
- Admin Pals/pricing/delete: `src/routes/_authenticated/admin.tsx`, `src/lib/admin.functions.ts`  
- Alert: `src/hooks/use-signup-notifications.tsx`, `src/components/NotificationProvider.tsx`  
- SQL: `supabase/migrations/20260814120000_client_auto_approve_patpal_login.sql`  
- Sounds: `public/sounds/ringtone.mp3`, `public/sounds/message-chime.mp3`  
- Two flags: `profiles.approval_status` = **login**; `pat_pals.is_approved` = **Browse listing**. Approve must set both.

---

## Account states (product)

| Status | Login | Browse (Pal) |
|--------|-------|----------------|
| Customer (new) | Yes after email verify | n/a |
| Pal pending | No | Hidden |
| Pal listed (Approve/Enable) | Yes | Yes |
| Pal Disabled | Yes | No |
| User Inactive (Users tab) | No | No |
| Deleted | No (“does not exist”) | No |

**Active/Inactive** (Users) = whole account. **Enable/Disable** (Pals) = listing only.

---

## Original Phase 1 checklist (still useful)

1. Signed-out `patmyback.com` → `/auth`  
2. Customer signup + confirmation email  
3. Pal: approve, categories, photo, rate  
4. Stripe pack + receipt  
5. Chat + audio + video, two devices  
6. Countdown, 2-min warning, in-call top-up  
7. Session record, rating, summary email  
8. Admin: users, codes, banners, analytics, **Pals Approve/Disable/Delete**, **Pricing**
