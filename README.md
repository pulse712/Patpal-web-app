# Pat My Back

**Talk to someone who has your back.** A peer-support marketplace where clients connect with vetted Pat Pals via chat, audio, and video — billed by the minute.

## Overview

Pat My Back is a full-stack web app that matches people seeking encouragement or guidance with service providers ("Pat Pals"). Clients purchase wallet credits, start conversations or calls, and pay per minute in real time. Pat Pals manage availability, respond to sessions, and track earnings.

### User roles

| Role            | Description                                                                   |
| --------------- | ----------------------------------------------------------------------------- |
| **client**      | Default role. Browse Pat Pals, buy credits, chat/call, rate sessions.         |
| **pat_pal**     | Service provider. Set availability, price, and headline; receive chats/calls. |
| **admin**       | Manage users, trial codes, promo banners, and analytics.                      |
| **super_admin** | Full platform access.                                                         |

Only **clients** can initiate conversations and paid sessions.

### Support categories

Mentorship, training, motivation, accountability, business coaching, friendly chat, emotional support, consulting, career advice, encouragement, spiritual encouragement, and music lessons.

## Tech stack

| Layer           | Technology                                                           |
| --------------- | -------------------------------------------------------------------- |
| Framework       | [TanStack Start](https://tanstack.com/start) (React 19 + TypeScript) |
| Routing         | TanStack Router (file-based)                                         |
| UI              | Tailwind CSS 4 + [shadcn/ui](https://ui.shadcn.com) (Radix)          |
| Database & auth | [Supabase](https://supabase.com) (Postgres, RLS, realtime)           |
| Payments        | [Stripe](https://stripe.com) (Checkout + webhooks)                   |
| Calls           | [Agora](https://www.agora.io) (audio/video SDK + token minting)      |
| Email           | [Resend](https://resend.com)                                         |
| Push            | Web Push (VAPID)                                                     |

## Features

- Email/password authentication (Supabase Auth)
- Real-time messaging
- Audio and video calls (Agora)
- Per-minute session billing with live countdown and mid-call top-ups
- Stripe credit packs and wallet balance (seconds-based)
- Trial code redemption (including unlimited minutes)
- Post-session ratings
- Push notifications
- Pat Pal dashboard (availability, earnings, stats)
- Admin panel (users, promos, trial codes, analytics)
- PWA (installable via web manifest)

## Project structure

```
patpal/
├── src/
│   ├── routes/           # File-based routes (TanStack Start)
│   ├── components/       # UI components (AppShell, CallScreen, etc.)
│   ├── lib/              # Server functions, session logic, integrations
│   └── integrations/     # Supabase client & types
├── supabase/
│   ├── MASTER_MIGRATION.sql   # Full database schema + RLS
│   └── migrations/            # Incremental migrations
├── public/               # Static assets, PWA manifest
└── .env.example          # Required environment variables
```

## Getting started

### Prerequisites

- Node.js 20+ (or [Bun](https://bun.sh))
- A [Supabase](https://supabase.com) project
- [Stripe](https://stripe.com) account (for payments)
- [Agora](https://www.agora.io) account (for audio/video calls)
- [Resend](https://resend.com) API key (for transactional email)
- VAPID keys (for web push notifications)

### Installation

```bash
cd patpal
npm install
# or: bun install
```

### Environment variables

Copy the example file and fill in your credentials:

```bash
cp .env.example .env
```

| Variable                            | Description                                   |
| ----------------------------------- | --------------------------------------------- |
| `SUPABASE_*` / `VITE_SUPABASE_*`    | Supabase project URL and keys                 |
| `STRIPE_SECRET_KEY`                 | Stripe secret key (server)                    |
| `STRIPE_WEBHOOK_SECRET`             | Stripe webhook signing secret                 |
| `VITE_STRIPE_PUBLISHABLE_KEY`       | Stripe publishable key (client)               |
| `APP_URL`                           | Public app URL (e.g. `http://localhost:5173`) |
| `AGORA_APP_ID`                      | Agora application ID                          |
| `AGORA_APP_CERTIFICATE`             | Agora certificate for token signing           |
| `VAPID_*` / `VITE_VAPID_PUBLIC_KEY` | Web push VAPID keys                           |
| `RESEND_API_KEY`                    | Resend email API key                          |

### Database setup

Run the master migration in the Supabase SQL Editor on a fresh project:

```bash
# File: supabase/MASTER_MIGRATION.sql
```

This creates tables, enums, RLS policies, seed categories, and auth triggers. Apply any additional files in `supabase/migrations/` if needed.

### Development

```bash
npm run dev
```

Open the URL shown in the terminal (typically `http://localhost:5173`).

### Build & preview

```bash
npm run build
npm run preview
```

### Lint & format

```bash
npm run lint
npm run format
```

### Tests

```bash
npm test          # run once
npm run test:watch  # watch mode
```

Unit tests cover billing math, trial code rules, admin guardrails, and auth redirects.

## Routes

| Path                    | Description                     |
| ----------------------- | ------------------------------- |
| `/`                     | Home dashboard                  |
| `/auth`                 | Login & registration            |
| `/browse`               | Browse Pat Pals                 |
| `/pal/$palId`           | Pat Pal profile                 |
| `/chats`                | Conversation list               |
| `/chat/$conversationId` | Chat thread (with call buttons) |
| `/wallet`               | Credits & Stripe checkout       |
| `/profile`              | User profile                    |
| `/pal-dashboard`        | Pat Pal provider dashboard      |
| `/admin`                | Admin panel                     |
| `/reset-password`       | Password reset                  |

API routes:

- `/api/stripe/checkout` — Create Stripe Checkout session
- `/api/stripe/webhook` — Stripe webhook handler

## Stripe webhooks

Point your Stripe webhook to:

```
https://yourdomain.com/api/stripe/webhook
```

Listen for checkout completion events to credit user wallets.

## Deployment

The project was scaffolded with [Lovable](https://lovable.dev) and can be published from there, or deployed to any Node-compatible host that supports TanStack Start / Nitro builds.

Set all environment variables in your hosting provider before deploying.

## License

Private — all rights reserved.
