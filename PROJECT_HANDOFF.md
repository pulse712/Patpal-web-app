# Pat My Back — Project Handoff

Last updated: 2026-07-30

## Phase 1 agreement

Phase 1 was agreed at **$1,000 USD**, split into two $500 milestones:

### Milestone 1

- Registration and login with email and phone collection
- Customer, Pat Pal, Admin, and Super Admin roles
- Pat Pal profiles and availability
- Customer discovery of available Pat Pals
- Real-time text chat
- Agora audio and video calls
- Mobile-responsive installable PWA

### Milestone 2

- Prepaid credit wallet: 15-minute, 30-minute, 1-hour, and custom purchases
- Live call countdown
- Two-minute low-balance warning and in-call top-up
- Trial-code redemption, including friends-and-family access
- Session records and reporting
- Payment receipts and session-summary email implementation
- Full admin panel
- Deployment setup on the client's accounts

## Implementation status

The Phase 1 application features are implemented. This includes:

- Supabase authentication, role handling, profiles, Pat Pal listings, availability, and multi-category specialties
- Customer browsing, public Pat Pal profiles, post-session ratings, and reviewer names
- Realtime chat and Agora-based audio/video calls
- Wallet billing, time-based session charging, countdowns, low-balance warnings, and top-ups
- Stripe Checkout and webhook implementation
- Trial codes, session history, analytics, and admin management
- Promo banners, profile photo upload/cropping, push/in-app notifications, and PWA support
- Supabase migrations for bidirectional ratings, banner images, and profile avatars
- Root domain behavior: signed-out visitors are sent to `/auth`; signed-in users go to `/home`

The repository was clean before this handoff file was added.

## Production setup still to verify

These are account configuration and live validation tasks, not unimplemented product features:

1. **Vercel domain**
   - `patmyback.com` and `www.patmyback.com` should show valid configuration.
   - The root domain needs Vercel's current A record.
   - `www` needs Vercel's CNAME record.

2. **Supabase Auth email**
   - Custom SMTP must be enabled.
   - The Supabase Site URL and redirect URLs must use the production domain.
   - Test one fresh signup after DNS propagates.

3. **Resend**
   - Confirm `mail.patmyback.com` is verified.
   - Use `noreply@mail.patmyback.com` as the sender for Supabase SMTP.
   - Add `RESEND_API_KEY` to Vercel for transactional payment/session emails.
   - The application transactional sender should match the verified Resend subdomain before production testing.

4. **Stripe**
   - Add production/test Stripe keys to Vercel.
   - Configure the webhook endpoint:
     `https://patmyback.com/api/stripe/webhook`
   - Complete one purchase to verify wallet crediting and payment receipts.

5. **Agora**
   - Add the Agora App ID and certificate to Vercel.
   - Test audio and video calls with two different accounts/devices.

6. **Supabase migrations**
   - Verify all later migrations have been run, including:
     - `20260727260000_promo_banner_image.sql`
     - `20260727270000_bidirectional_ratings.sql`
     - `20260727280000_profile_avatars.sql`

## Important DNS notes

- IONOS originally had `A www -> 216.150.1.1`; this conflicted with the Vercel CNAME.
- The client removed the conflicting `www` A record.
- Safari allowed the Vercel CNAME save after another browser/incognito did not.
- Do not delete mail, MX, DKIM, SPF, or Resend DNS records.
- Resend records shown for `mail.patmyback.com` included DKIM, SPF, and a feedback MX record; these are expected.

## Client communication timeline

- Client configured/updated Vercel, Resend, Supabase, and IONOS.
- Client initially could not locate Supabase SMTP settings and did not have administrator access; the project owner/admin must configure it.
- Client created the `mail.patmyback.com` Resend DNS records and an `info@patmyback.com` mailbox.
- Recommended sender: `noreply@mail.patmyback.com`. A mailbox for this address is not required if `mail.patmyback.com` is verified by Resend.
- Client asked for the public domain to start at sign in/create account instead of Browse. This was changed.
- Client released the first $500 milestone.
- A second $500 milestone was created, but the client has not yet released it. The client questioned whether it should wait until the second phase; the agreed plan defines the second milestone as part of completed Phase 1.

## Suggested final acceptance test

1. Open `https://patmyback.com` while signed out; confirm it opens `/auth`.
2. Create a fresh client account and verify the confirmation email arrives.
3. Create/confirm a Pat Pal account; update categories, availability, profile photo, and rate.
4. Buy a credit pack and confirm wallet credit and receipt email.
5. Start a chat, audio call, and video call from separate accounts/devices.
6. Verify countdown, two-minute warning, and top-up during a call.
7. End the call; confirm session record, rating flow, and summary email.
8. Verify the admin panel can manage users, trial codes, promo banners, and analytics.

## Payment context

The agreed Phase 1 scope is the two milestones above ($1,000 total). The implementation work is complete; final DNS, provider credentials, and live testing are client-account-dependent production setup tasks. The second $500 milestone is therefore due under the agreed Phase 1 plan while support continues for final configuration/testing.
