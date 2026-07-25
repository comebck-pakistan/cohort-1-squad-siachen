# Week 5 — QA, Integration & Frontend Delivery
### Squad Siachen · Comebck Pakistan Cohort 1 · July 2026

---

## Theme: Quality Assurance

Week 5's focus was QA — validating that the system we've been building actually works end to end, hardening the backend architecture, and delivering a production-ready frontend. The week produced two major merged contributions and one integration PR in progress.

---

## What Shipped This Week

### ✅ Backend — Vara Ali
**PR: `vara/backend-whatsapp-api-integration` → merged to `main`**

Two commits, one architectural upgrade:

**Commit 1 — Database migrations (11 + 12)**
- Migration 11: partial unique index on `conversations(business_id, customer_id) WHERE status = 'active'` — prevents duplicate active conversations from race conditions when a customer sends messages in rapid succession
- Migration 12: new `conversation_state` table replacing raw message storage. Bot now reads and writes structured slots per conversation:
  ```
  current_intent · service_interest · preferred_date · preferred_time
  customer_name · customer_phone · last_customer_msg · last_agent_msg
  ```
- Added `resolved_at` and `resolution_reason` columns to `conversations`
- FABS Salon fully seeded: 1 business, 7 hours rows, 10 staff, 87 services, 113 staff skills — agent can be tested against real data immediately
- `docs/SUPABASE_CHANGELOG.md` added — running log of every schema change for squad-wide visibility

**Commit 2 — Backend architectural upgrade**
- Extracted `lib/message-handler.ts` — transport-agnostic message handler. Both Meta Cloud API and whatsapp-web.js now call a single shared `handleIncomingMessage()` function. Transport layer only handles getting messages in and out; all business logic lives in one place
- Added `whatsapp-web.js` transport as an alternative to Meta Cloud API — salon owners connect via QR scan instead of waiting for Meta Business API approval
- QR onboarding server: `GET /onboarding/:businessId` serves an auto-refreshing HTML page; salon owner scans with phone, session persists on disk
- Session manager: owns one Chromium instance per active salon, restores sessions after restart, isolates failures per salon
- Structured logging via `pino` — replaces all `console.log` calls with JSON logs in production, colorized in development, filterable by module
- Graceful shutdown: SIGTERM/SIGINT tears down Chromium sessions cleanly within 25s timeout
- WebSocket polyfill for Node.js < 22 compatibility

**QA signal:** Vara shared screenshots of the WhatsApp agent responding to live test messages via both Cloud API and whatsapp-web.js transport. Both paths confirmed working.

---

### ✅ Frontend — Marriyam Andeel
**PR: `marriyam/recepta-frontend` — open for review**

Delivered a complete, production-ready frontend for the Recepta platform built with TanStack Start + TypeScript + Tailwind CSS + shadcn/ui.

**What's built and running:**

| Portal | Route | Status |
|---|---|---|
| Landing / index | `/` | ✅ Live |
| Salon owner login | `/login` | ✅ Live |
| Salon owner onboarding | `/onboarding` | ✅ Live |
| Superadmin login | `/superadmin/login` | ✅ Live |
| Superadmin dashboard | `/superadmin` | ✅ Live with mock data |
| Superadmin — Salons | `/superadmin/salons` | ✅ Live with mock data |
| Superadmin — Subscriptions | `/superadmin/subscriptions` | ✅ Live with mock data |
| Superadmin — Settings | `/superadmin/settings` | ✅ Live with mock data |
| Salon owner portal | `/salon-portal` | ✅ Live with mock data |
| Salon owner — Inbox | `/salon-portal/inbox` | ✅ Live with mock data |
| Salon owner — Escalations | `/salon-portal/escalations` | ✅ Live with mock data |
| Salon owner — AI Rules | `/salon-portal/ai-rules` | ✅ Live with mock data |
| Salon owner — Business | `/salon-portal/business` | ✅ Live with mock data |

**Key features delivered:**
- Dual portal architecture — superadmin (us) and salon owner (client) with separate auth flows
- Mock auth system: `admin@recepta.pk` / `admin123` for superadmin demo access
- `api.ts` uses `withMock()` pattern — calls real backend when available, falls back to deterministic mock data when backend is unreachable. Zero code changes needed when backend routes go live
- QR modal polls `/onboarding/:businessId/status` every 2.5s — already connected to Vara's backend endpoint
- Escalations screen with HIGH/MEDIUM/LOW severity — directly implements the medical/skin guardrail from FABS interview findings
- Agent online/offline toggle per salon
- Revenue bar chart (PKR), payment logs table, audit event stream
- PKR currency formatting throughout
- Full TypeScript types in `src/types/index.ts`

**Integration status:** Frontend is running locally. Mock data is live. Backend integration begins Week 6 — the `withMock()` pattern means real data replaces mocks automatically as backend routes come online, with no frontend code changes required.

---

## Updated Repository Structure

```
cohort-1-squad-siachen/
│
├── backend/
│   ├── .env                              (local only — gitignored)
│   ├── .env.example
│   ├── package.json                      (add "cors" dependency — Week 6)
│   ├── src/
│   │   ├── index.ts                      (mount adminRouter + cors — Week 6)
│   │   ├── config.ts
│   │   ├── lib/
│   │   │   ├── db.ts
│   │   │   ├── llm.ts
│   │   │   ├── logger.ts
│   │   │   ├── message-handler.ts        ← NEW this week (transport-agnostic core)
│   │   │   ├── supabase.ts
│   │   │   ├── whatsapp.ts
│   │   │   └── admin-service.ts          ← PLANNED Week 6
│   │   ├── routes/
│   │   │   ├── demo.ts
│   │   │   ├── webhook.ts                ← refactored this week
│   │   │   └── admin.ts                  ← PLANNED Week 6
│   │   └── whatsapp-web/                 ← NEW this week
│   │       ├── client.ts
│   │       ├── session-manager.ts
│   │       ├── qr-server.ts
│   │       └── clear-locks.ts
│   └── public/demo.html
│
├── frontend/                             ← NEW this week
│   ├── .env                              (local — VITE_API_URL=http://localhost:3000)
│   ├── .env.example
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── lib/
│       │   ├── api.ts                    (withMock pattern — backend-ready)
│       │   ├── auth.tsx                  (mock auth — swap for real /api/auth Week 6)
│       │   ├── utils.ts
│       │   └── error-capture.ts
│       ├── routes/
│       │   ├── __root.tsx
│       │   ├── index.tsx
│       │   ├── login.tsx
│       │   ├── onboarding.tsx
│       │   ├── superadmin.tsx
│       │   ├── superadmin.index.tsx
│       │   ├── superadmin.login.tsx
│       │   ├── superadmin.salons.tsx
│       │   ├── superadmin.subscriptions.tsx
│       │   ├── superadmin.settings.tsx
│       │   ├── salon-portal.tsx
│       │   ├── salon-portal.index.tsx
│       │   ├── salon-portal.inbox.tsx
│       │   ├── salon-portal.escalations.tsx
│       │   ├── salon-portal.ai-rules.tsx
│       │   └── salon-portal.business.tsx
│       ├── components/
│       │   ├── dashboard/
│       │   │   ├── OverviewTab.tsx
│       │   │   ├── SalonsTab.tsx
│       │   │   ├── SubsTab.tsx
│       │   │   ├── SettingsTab.tsx
│       │   │   └── StatusBadge.tsx
│       │   ├── tenant/
│       │   │   ├── TenantShell.tsx
│       │   │   ├── TenantOverview.tsx
│       │   │   ├── TenantInbox.tsx
│       │   │   ├── TenantEscalations.tsx
│       │   │   ├── TenantAIRules.tsx
│       │   │   └── TenantBusiness.tsx
│       │   ├── modals/
│       │   │   ├── AddSalonModal.tsx
│       │   │   └── QRModal.tsx
│       │   ├── layout/
│       │   │   ├── Header.tsx
│       │   │   └── Sidebar.tsx
│       │   └── ui/                       (shadcn/ui — 30+ components)
│       └── types/
│           └── index.ts
│
├── database/
│   ├── schema/
│   │   ├── 11_conversation_unique_active.sql   ← NEW this week
│   │   └── 12_conversation_state.sql           ← NEW this week
│   └── seed/
│       └── fabs_salon.sql                      ← NEW this week
│
└── docs/
    ├── WHATSAPP_INTEGRATION.md           (Marriyam — Week 2)
    ├── SUPABASE_CHANGELOG.md             (Vara — Week 5)
    └── WEEK5_PROGRESS.md                 ← this file
```

---

## QA Checklist — Week 5

| Item | Owner | Status |
|---|---|---|
| WhatsApp agent responds via Cloud API transport | Vara | ✅ Verified |
| WhatsApp agent responds via whatsapp-web.js transport | Vara | ✅ Verified |
| QR pairing flow works end to end | Vara | ✅ Verified |
| conversation_state migrations applied and verified | Vara | ✅ Applied 2026-07-22 |
| FABS Salon seed data live in Supabase | Vara | ✅ Confirmed |
| Frontend builds without TypeScript errors | Marriyam | ✅ Confirmed |
| Superadmin login and navigation working | Marriyam | ✅ Confirmed |
| Salon owner portal loads with mock data | Marriyam | ✅ Confirmed |
| Escalations screen renders with correct severity badges | Marriyam | ✅ Confirmed |
| QRModal polls `/onboarding/:id/status` correctly | Marriyam | 🔄 Pending backend integration |
| Backend CORS configured for frontend origin | Pending | ⏳ Week 6 |
| `/api/salons` route live | Pending | ⏳ Week 6 |
| `/api/kpis` route live | Pending | ⏳ Week 6 |
| `/api/audit` route live | Pending | ⏳ Week 6 |
| Mock data replaced with real Supabase data | Pending | ⏳ Week 6 |

---

## Week 6 Plan

**Priority 1 — Backend admin routes (unblocks frontend real data)**
- Add `cors` middleware to backend
- Create `src/lib/admin-service.ts` — Supabase queries for KPIs, audit, salons
- Create `src/routes/admin.ts` — mount `/api/salons`, `/api/kpis`, `/api/audit`, `/api/settings/*`
- Mount admin router in `src/index.ts`

**Priority 2 — Frontend integration**
- Set `VITE_API_URL` to backend URL
- Verify each `withMock()` call switches to real data as routes come online
- Replace mock auth in `auth.tsx` with real `POST /api/auth/login`

**Priority 3 — Tenant portal backend**
- `/tenant/:businessId/conversations`
- `/tenant/:businessId/escalations`

**Priority 4 — Real user testing**
- FABS Salon owner on the salon portal with real conversation data
- Collect 3 quotes for Demo Day

---

## Validation Bar Update

| Checkpoint | Target | Status |
|---|---|---|
| Week 2 — 5 user interviews | ≥ 5 | ✅ Done (Marriyam — 3 freelancer, Vara — FABS salon) |
| Week 4 — 10 sign-ups / design partners | ≥ 10 | ⚠️ In progress |
| Week 8 — Real users on MVP | ≥ 25 | 🎯 Target |
| Week 8 — User quotes | ≥ 3 | 🎯 Target |
| Week 8 — Willingness to pay signal | ≥ 1 | 🎯 Target (FABS: Rs 20,000/mo WTP confirmed) |

---

*Squad Siachen · Comebck Pakistan Cohort 1 · Week 5 Report*

