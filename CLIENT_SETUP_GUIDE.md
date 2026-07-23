# PatPal — Client Setup Guide

This guide is for the **client** (project owner) to finish connecting PatPal to your Supabase project and Vercel deployment. The app code and database schema are ready; you only need to complete the steps below in your own accounts.

**Your live app:** https://pat-my-back-m631.vercel.app  
**Your Supabase project:** `xhgybcyvpasmtlpscdly`  
**Supabase dashboard:** https://supabase.com/dashboard/project/xhgybcyvpasmtlpscdly

---

## 1. Supabase — Auth redirect URLs (required for login)

Without this step, sign-in and sign-up will fail on the live site. Email confirmation links may incorrectly send users to `http://localhost:3000` until Site URL is fixed.

1. Open [Supabase Dashboard](https://supabase.com/dashboard/project/xhgybcyvpasmtlpscdly) → **Authentication** → **URL Configuration**.
2. Set **Site URL** to (replace `localhost:3000` if that is currently set):
   ```
   https://pat-my-back-m631.vercel.app
   ```
3. Under **Redirect URLs**, add these lines (one per line):
   ```
   https://pat-my-back-m631.vercel.app/**
   https://pat-my-back-m631.vercel.app/auth/callback
   http://localhost:5173/**
   http://localhost:5173/auth/callback
   ```
4. Click **Save**.

---

## 2. Vercel — Environment variables (required for server features)

The browser connects to Supabase automatically. The **server** (billing, admin actions, webhooks) needs one secret in Vercel.

1. Open your project on [Vercel](https://vercel.com) → **Settings** → **Environment Variables**.
2. Add these variables for **Production** (and Preview if you use preview deployments):

| Variable name | Where to get the value |
|---------------|------------------------|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → **Project Settings** → **API** → **Secret key** (`sb_secret_...`) |
| `APP_URL` | `https://pat-my-back-m631.vercel.app` |

3. Optional (when you enable payments):

| Variable name | Where to get the value |
|---------------|------------------------|
| `STRIPE_SECRET_KEY` | [Stripe Dashboard](https://dashboard.stripe.com/apikeys) → Secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Webhooks → your endpoint → Signing secret |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Stripe → Publishable key |

4. After saving variables, go to **Deployments** → open the latest deployment → **Redeploy** (so the new env vars take effect).

### Vercel project root directory

If the Git repository root is the parent folder (not the app folder itself), set:

- **Settings** → **General** → **Root Directory** → `patpal`

Then redeploy.

---

## 3. Create your admin account

1. Open https://pat-my-back-m631.vercel.app/auth  
2. **Create account** with your email (e.g. `info@patpal.com`).
3. In Supabase → **SQL Editor**, run (replace the email if different):

```sql
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role
FROM auth.users
WHERE email = 'info@patpal.com'
ON CONFLICT (user_id, role) DO NOTHING
RETURNING user_id, role;
```

4. If a row is returned, admin is set. Sign out and sign in again, then open:
   ```
   https://pat-my-back-m631.vercel.app/admin
   ```

**Verify admin (optional):**

```sql
SELECT u.email, ur.role
FROM auth.users u
JOIN public.user_roles ur ON ur.user_id = u.id
WHERE u.email = 'info@patpal.com';
```

You should see `role = admin`.

---

## 4. Database (already done if migrations succeeded)

If the database was set up correctly, this query in **SQL Editor** should return **8 functions**:

```sql
SELECT proname AS function_name
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN (
    'debit_wallet',
    'credit_wallet',
    'apply_trial_code',
    'end_session_billing',
    'mark_session_connected',
    'cancel_session_before_connect',
    'has_role',
    'handle_new_user'
  )
ORDER BY proname;
```

If any are missing, run these files **in order** in SQL Editor (on a fresh project, run `MASTER_MIGRATION.sql` first):

1. `patpal/supabase/MASTER_MIGRATION.sql` — **once only**, on empty database  
2. Then run `patpal/supabase/POST_MASTER_MIGRATION.sql`  
   — or run individually: `20260723000001` → `20260723100000` → `20260723110000` → `20260723120000` → `20260723130000`

**Do not** run `20260715065810_...sql` — it duplicates the master migration and will error with “type already exists”.

---

## 5. What each URL does (after setup)

| URL | Purpose |
|-----|---------|
| `/` | Redirects to Browse (public) |
| `/browse` | Browse Pat Pals (public) |
| `/auth` | Sign in / Create account |
| `/home` | Home dashboard (signed in) |
| `/admin` | Admin panel (admin role only) |
| `/wallet` | Buy credits (signed in) |

---

## 6. Security reminders

- **Never** share the **service role key** (`sb_secret_...`) in email, chat, or frontend code. It bypasses all database security rules.
- **Never** commit `.env` to Git.
- The **publishable key** (`sb_publishable_...`) is safe in the browser; it is already configured in the app.
- If API keys or passwords were shared in chat, **rotate them** in Supabase and Stripe dashboards.

---

## 7. Troubleshooting

| Problem | What to check |
|---------|----------------|
| Blank page or endless spinner | Redeploy Vercel after latest code push; confirm Root Directory = `patpal` |
| Login fails / “invalid redirect” | Section 1 — Supabase redirect URLs |
| Email link opens `localhost:3000` | Section 1 — change **Site URL** from `localhost:3000` to your Vercel URL |
| Email link has tokens but app does not sign in | Open the link on the live site: replace `localhost:3000` with `pat-my-back-m631.vercel.app` in the address bar, or sign up again after fixing Site URL |
| Admin page access denied | Section 3 — admin SQL after signing up |
| Payments fail | Section 2 — Stripe keys + webhook pointing to your Vercel URL |
| “Missing SUPABASE_SERVICE_ROLE_KEY” | Section 2 — add key in Vercel and redeploy |

---

## 8. Checklist for client

- [ ] Supabase Site URL + Redirect URLs saved (Section 1)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` and `APP_URL` set in Vercel (Section 2)
- [ ] Vercel redeployed after env vars added
- [ ] Signed up at `/auth` with owner email
- [ ] Admin role granted via SQL (Section 3)
- [ ] `/browse` loads on live site
- [ ] Can sign in and open `/admin`
- [ ] (Optional) Stripe keys added when ready for payments

---

**Support:** If a step fails, note the exact error message and which step you were on (Supabase SQL Editor, Vercel build log, or browser console F12 → Console).
