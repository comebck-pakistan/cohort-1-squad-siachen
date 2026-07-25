# Halo Backend API — Owner Dashboard Contract

**Base URL:** `http://localhost:3000` (dev) · `https://<your-deployment>.com` (prod)
**All endpoints under `/api/*`**
**Auth:** `Authorization: Bearer <jwt>` for all routes except where noted

---

## TL;DR for the UI builder

Halo uses **Supabase Auth** for signup/login (you call `https://<project>.supabase.co/auth/v1/...` directly with the anon key). Once the user has a JWT, every Halo dashboard endpoint below takes that JWT in `Authorization: Bearer …`.

**Three rules that prevent rework:**
1. **Time format:** all timestamps are ISO 8601 UTC strings (`"2026-07-24T10:00:00.000Z"`). Always render in `Asia/Karachi` (UTC+5) on the UI. Never store display strings.
2. **Money:** integer paisa in DB (the column is `numeric(10,2)` but we treat it as PKR with no decimals for now). Format as `PKR 650` on display.
3. **Durations:** integer minutes. Valid values: 5, 15, 30, 45, 60, 90, 120, 150, 180, 240, 360, 480. No free-form "1 hour 30 mins".

---

## 1. Setup checklist for the frontend

### Get from Vara (env values):
- `SUPABASE_URL` — e.g. `https://abcxyz.supabase.co`
- `SUPABASE_ANON_KEY` — the **anon public** key (not service role)
- `HALO_API_URL` — e.g. `http://localhost:3000`

### Install Supabase JS:
```bash
npm install @supabase/supabase-js
```

### Frontend client init:
```ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
// Use this for signup, login, logout, token refresh
// Don't pass tokens manually — supabase-js auto-attaches them
```

### Signup flow:
1. UI calls `supabase.auth.signUp({ email, password })` — gets back `{ user, session }`
2. UI calls `POST {HALO_API_URL}/api/auth/onboard-business` with body `{ business_name, city?, timezone? }` and the user's JWT — creates the linked `businesses` row
3. UI navigates to dashboard

### Login flow:
1. UI calls `supabase.auth.signInWithPassword({ email, password })` — gets `{ user, session }`
2. session.access_token is auto-stored; supabase-js auto-refreshes before expiry
3. UI calls `GET {HALO_API_URL}/api/auth/me` for fresh business data
4. Navigate to dashboard

---

## 2. Auth endpoints

### `POST /api/auth/onboard-business`
**Auth:** required

Creates the `businesses` row for the currently-authenticated user (called once after signup). Idempotent.

**Request body:**
```json
{
  "business_name": "FABS Beauty Lounge & Salon",
  "city": "Islamabad",
  "timezone": "Asia/Karachi"
}
```

**Success response (201):**
```json
{
  "business": {
    "id": "cbe9f7d3-a260-4129-aafe-a437970f7750",
    "name": "FABS Beauty Lounge & Salon",
    "city": "Islamabad",
    "timezone": "Asia/Karachi"
  },
  "already_existed": false
}
```

If the user already owns a business, returns it with `already_existed: true`.

### `GET /api/auth/me`
**Auth:** required

Returns the current user + their business. Use this on every page load to confirm session.

**Success response (200):**
```json
{
  "user": {
    "id": "f1c1839e-4388-4efb-891b-6a5a99a04ae0",
    "email": "owner@fabs.pk",
    "full_name": "Ayesha Khan",
    "role": "business_owner"
  },
  "business": {
    "id": "cbe9f7d3-a260-4129-aafe-a437970f7750",
    "name": "FABS Beauty Lounge & Salon",
    "city": "Islamabad",
    "timezone": "Asia/Karachi",
    "agent_active": true
  }
}
```

---

## 3. Dashboard endpoints

### `GET /api/business/:businessId/today`
**Auth:** required · **Ownership:** required

Returns today's bookings. "Today" is computed in PKT — bookings from 00:00 to 23:59 Asia/Karachi.

**URL params:** `businessId` (uuid)

**Success response (200):**
```json
{
  "appointments": [
    {
      "id": "8d1c2fa0-...",
      "start_time": "2026-07-24T10:00:00.000Z",
      "end_time": "2026-07-24T10:30:00.000Z",
      "status": "confirmed",
      "source": "whatsapp_bot",
      "customer": {
        "id": "8a7f3c2e-...",
        "phone": "923001234567",
        "name": "Sara"
      },
      "service": {
        "id": "3b2a1c9d-...",
        "name": "Hair cut (trim only)",
        "price": 650,
        "duration_minutes": 30
      },
      "staff": {
        "id": "9d8c7b6a-...",
        "name": "Ayesha Malik"
      }
    }
  ]
}
```

---

### `GET /api/business/:businessId/bookings?date=YYYY-MM-DD`
**Auth:** required · **Ownership:** required

**Query params:**
- `date` (required): ISO date `2026-07-24`. Day bounds are computed in PKT.

**Success response (200):** same shape as `/today` but filtered to that date.

---

### `PATCH /api/appointments/:appointmentId`
**Auth:** required · **Ownership:** automatic

Reschedule or change status.

**Request body** (all fields optional):
```json
{
  "status": "completed",
  "start_time": "2026-07-24T11:00:00.000Z",
  "end_time": "2026-07-24T11:30:00.000Z"
}
```

**Valid status values:** `"pending"`, `"confirmed"`, `"completed"`, `"cancelled"`

**Success response (200):**
```json
{
  "appointment": {
    "id": "...",
    "start_time": "...",
    "end_time": "...",
    "status": "completed",
    "customer": { ... },
    "service": { ... },
    "staff": { ... }
  }
}
```

**Errors:**
- `409 Conflict` — staff member already has overlapping appointment (`no_overlapping_staff_appointments` EXCLUSION constraint)
- `403 Forbidden` — appointment belongs to a different business
- `404 Not Found` — appointment doesn't exist

---

### `POST /api/business/:businessId/staff`
**Auth:** required · **Ownership:** required

Add a new staff member, optionally with initial skills.

**Request body:**
```json
{
  "name": "Rabia Yousaf",
  "phone": "923009876543",
  "skill_service_ids": [
    "3b2a1c9d-...",
    "4c3b2a1d-..."
  ]
}
```

`skill_service_ids` is optional. If empty, the staff has no skills yet and the owner can assign them via the next endpoint.

**Success response (201):**
```json
{
  "staff": {
    "id": "9d8c7b6a-...",
    "name": "Rabia Yousaf",
    "phone": "923009876543",
    "is_active": true,
    "created_at": "2026-07-23T19:25:00.000Z"
  }
}
```

---

### `PATCH /api/staff/:staffId/skills`
**Auth:** required · **Ownership:** automatic

Replace this staff's skill set with the provided list. Pass an empty array to clear all skills.

**Request body:**
```json
{
  "service_ids": [
    "3b2a1c9d-...",
    "4c3b2a1d-...",
    "5d4c3b2e-..."
  ]
}
```

**Success response (200):**
```json
{
  "staff_id": "9d8c7b6a-...",
  "service_ids": ["3b2a1c9d-...", "4c3b2a1d-...", "5d4c3b2e-..."]
}
```

---

### `POST /api/business/:businessId/services`
**Auth:** required · **Ownership:** required

Add a new service to the salon's menu.

**Request body:**
```json
{
  "name": "Express blow-dry",
  "duration_minutes": 20,
  "staff_required": 1,
  "price": 500
}
```

`price` is in PKR. `staff_required` is 1 for most services, 2 for bridal packages where two stylists work in parallel. Default `staff_required` is 1 if omitted.

**Success response (201):**
```json
{
  "service": {
    "id": "...",
    "name": "Express blow-dry",
    "duration_minutes": 20,
    "staff_required": 1,
    "price": 500,
    "is_active": true
  }
}
```

---

### `GET /api/business/:businessId/conversations`
**Auth:** required · **Ownership:** required

**Query params:**
- `limit` (optional, default 50, max 200)

Returns recent conversations with last message preview. Use this for the inbox view.

**Success response (200):**
```json
{
  "conversations": [
    {
      "id": "8f8b12d4-...",
      "status": "active",
      "last_message_at": "2026-07-23T19:25:00.000Z",
      "created_at": "2026-07-22T14:00:00.000Z",
      "customer": {
        "id": "...",
        "phone": "923001234567",
        "name": "Sara"
      },
      "state": {
        "current_intent": "book",
        "last_customer_msg": "Mujhe kal 3pm haircut chahiye",
        "last_agent_msg": "✅ Your appointment is confirmed!",
        "outcome": null
      }
    }
  ]
}
```

`state` can be an array if the relationship is rendered weirdly by Supabase. If you see `state: [{...}]`, use `state[0]` instead.

---

## 4. Helper endpoints (for dropdowns / pickers)

### `GET /api/business/:businessId/services`
**Auth:** required · **Ownership:** required

Returns all services. Sort by name.

**Success response (200):**
```json
{
  "services": [
    { "id": "...", "name": "Hair cut (trim only)", "duration_minutes": 30, "staff_required": 1, "price": 650, "is_active": true }
  ]
}
```

### `GET /api/business/:businessId/staff`
**Auth:** required · **Ownership:** required

Returns all staff with their assigned `service_ids`.

**Success response (200):**
```json
{
  "staff": [
    {
      "id": "...",
      "name": "Ayesha Malik",
      "phone": null,
      "is_active": true,
      "created_at": "...",
      "service_ids": ["...", "...", "..."]
    }
  ]
}
```

---

## 5. Error format

All errors are JSON:
```json
{ "error": "human-readable message" }
```

HTTP codes used:
| Code | Meaning |
|---|---|
| 200 | OK |
| 201 | Created |
| 400 | Bad request (missing field, wrong format) |
| 401 | No token / bad token |
| 403 | Authenticated but doesn't own this business |
| 404 | Resource not found |
| 409 | Conflict (overlapping booking) |
| 500 | Server error |

---

## 6. Example fetch calls

```ts
const token = (await supabase.auth.getSession()).data.session?.access_token;

const res = await fetch(`${HALO_API_URL}/api/business/${businessId}/today`, {
  headers: { Authorization: `Bearer ${token}` }
});
const data = await res.json(); // { appointments: [...] }

// Add staff with skills
await fetch(`${HALO_API_URL}/api/business/${businessId}/staff`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'New Stylist',
    skill_service_ids: ['svc-uuid-1', 'svc-uuid-2']
  })
});

// Reschedule an appointment
await fetch(`${HALO_API_URL}/api/appointments/${appointmentId}`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    start_time: '2026-07-24T11:00:00.000Z',
    end_time: '2026-07-24T11:30:00.000Z'
  })
});
```

---

## 7. Postman collection

Import `backend/docs/Halo_API.postman_collection.json` (sibling file) into Postman to get pre-built requests with example auth and bodies. Variables to set:

- `baseUrl`: e.g. `http://localhost:3000`
- `token`: paste JWT from frontend login
- `businessId`: paste from `GET /api/auth/me` after login

---

## 8. Quick smoke test (no UI needed)

Test the booking round-trip via the demo endpoint (no auth, JSON shapes match):

```bash
curl -X POST http://localhost:3000/demo/chat \
  -H "Content-Type: application/json" \
  -d '{
    "business_id": "<uuid>",
    "customer_phone": "923001234567",
    "customer_name": "Test User",
    "message": "Mujhe kal 3pm haircut chahiye"
  }'
```

Test dashboard endpoints with the token:

```bash
TOKEN="paste-jwt-here"
BUSINESS_ID="paste-from-/api/auth/me"

curl http://localhost:3000/api/business/$BUSINESS_ID/today \
  -H "Authorization: Bearer $TOKEN"
```

---

## 9. Frontend scope checklist (what to build in order)

1. **Login / signup screens** (calls Supabase anon client)
2. **Today's bookings view** (calls `/today`)
3. **Booking detail / cancel** (calls `PATCH /api/appointments/:id`)
4. **Staff management** (calls `/business/:id/staff` GET + POST, `PATCH /api/staff/:id/skills`)
5. **Services management** (calls `/business/:id/services` GET + POST)
6. **Conversations inbox** (calls `/business/:id/conversations`)
7. **Date-range booking calendar** (calls `/business/:id/bookings?date=…`)

---

## 10. Superadmin endpoints (`/api/*` — under `Recepta /superadmin`)

All require `Authorization: Bearer <jwt>` AND `profiles.role === 'superadmin'`.
Backend rejects non-superadmin tokens with 403.

### Field-name adapters (DB → frontend)

The frontend uses `billing_status` and `monthlyMessages` / `concurrentAgents` / `pricePKR` — we rename at the API boundary so the React Query layer doesn't have to:

| Frontend | DB | Notes |
|---|---|---|
| `Business.billing_status` | `businesses.billing_state` | renamed |
| `TierLimits.monthlyMessages` | `tier_limits.max_messages_mo` | renamed |
| `TierLimits.concurrentAgents` | `tier_limits.max_staff_members` | semantic mapping |
| `TierLimits.pricePKR` | `subscriptions.monthly_price` (max per active sub of that tier) | derived |

### Salons CRUD

**`GET /api/salons`** — list all businesses (sorted newest first)

Response (200) — array of:
```json
{
  "id": "uuid",
  "name": "FABS Beauty Lounge & Salon",
  "tier": "basic" | "pro" | "business",
  "phone_number_id": "1043221109888" | null,
  "whatsapp_number": "923001234567" | null,
  "billing_status": "active" | "grace_period" | "suspended",
  "city": "Islamabad" | null,
  "agent_active": true | false,
  "created_at": "2026-07-25T18:43:01.000Z",
  "messages_month": 12480,    // count of customer messages in last 30 days
  "mrr_pkr": 24000            // sum of active subscriptions' monthly_price
}
```

**`POST /api/salons`** — create a new business
```json
{
  "name": "Glow Studio Karachi",
  "tier": "business",                 // default 'basic' if omitted
  "phoneNumberId": "1043221109888",   // optional
  "systemAccessToken": "EAAd...",     // optional (backend stores; not exposed)
  "whatsappNumber": "923001234567",
  "city": "Karachi"                   // optional
}
```
Returns (201): same shape as GET item.

**`PATCH /api/salons/:id`** — partial update of name / tier / phone / whatsapp / city / billing_state / agent_active

**`DELETE /api/salons/:id`** — soft-delete (sets `agent_active=false` + `billing_state='suspended'`)
Returns `{ "id": "...", "suspended": true }`

**`PATCH /api/salons/:id/agent`** — kill switch for AI receptionist
```json
{ "active": true }
```
Hard rule: suspended tenants cannot be re-enabled — they must go through billing reactivation first.

### Platform analytics

**`GET /api/kpis`** — top-level counters
```json
{
  "messagesDelivered": 128420,
  "revenuePKR": 312000,
  "pendingCases": 7,
  "activeSalons": 4
}
```

**`GET /api/revenue`** — 6-month revenue time series
```json
[
  { "month": "Feb", "revenue": 184000 },
  { "month": "Mar", "revenue": 212000 },
  ...
]
```

**`GET /api/payments?limit=50`** — last N subscription start/cancel events
```json
[
  {
    "id": "sub-uuid-start",
    "business_name": "Glow Studio Karachi",
    "amount_pkr": 24000,
    "status": "paid" | "failed",
    "method": "Card",
    "created_at": "2026-07-22T09:12:00Z"
  }
]
```

**`GET /api/audit?limit=50`** — mixed feed of escalation_events + recent bookings
```json
[
  {
    "id": "uuid",
    "business_id": "uuid",
    "business_name": "FABS Beauty Lounge & Salon",
    "kind": "booking" | "system",
    "summary": "Booking confirmed — Haircut for Sara",
    "created_at": "2026-07-25T..."
  }
]
```

### Settings

**`GET /api/settings/tiers`** — list of tier configs
```json
[
  { "tier": "basic", "monthlyMessages": 2000, "concurrentAgents": 1, "pricePKR": 4000 },
  { "tier": "pro", "monthlyMessages": 10000, "concurrentAgents": 3, "pricePKR": 12000 },
  { "tier": "business", "monthlyMessages": 50000, "concurrentAgents": 10, "pricePKR": 24000 }
]
```

**`PATCH /api/settings/tiers`** — update tier limits
```json
[
  { "tier": "pro", "monthlyMessages": 12000, "concurrentAgents": 5, "pricePKR": 15000 },
  ...
]
```

**`GET /api/settings/safety`** — global edge_case_rules split by rule_type
```json
{
  "hard": ["Never diagnose skin conditions...", "Never book outside hours..."],
  "soft": ["Prefer replies under 40 words...", ...]
}
```

**`PATCH /api/settings/safety`** — replace global safety rules
```json
{ "hard": [...], "soft": [...] }
```
Warning: this REPLACES all global rules (deletes then re-inserts). Per-tenant rules are unaffected.

### Onboarding status

**`GET /onboarding/:businessId/status`** — current QR / WhatsApp session state
```json
{
  "businessId": "uuid",
  "status": "qr_ready" | "ready" | "initializing" | "not_found",
  "hasQR": true | false
}
```
MVP: derived from `agent_active`. Once session-manager state is plumbed in, this will reflect live QR readiness.

### Seed: creating a superadmin user

```sql
-- 1. Create user in Supabase Dashboard: Authentication → Users → Add user
--    (email + password). Note their auth.users.id.

-- 2. Promote to superadmin:
UPDATE public.profiles
SET role = 'superadmin'
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'your-admin@example.com'
  LIMIT 1
);
```

After this, log in at `/superadmin/login` in the frontend with that email + password.


Skip for v1: payments, promotions, analytics, multi-branch.
