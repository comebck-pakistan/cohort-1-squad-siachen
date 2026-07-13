# 📱 WhatsApp Integration Guide
### Salon Agent — Squad Siachen | Comebck Pakistan Cohort 1

> **Read this before writing a single line of code.** This document covers how the WhatsApp integration works conceptually — the flow, the routing logic, and Meta's API contract — independent of whatever backend stack we end up using. Code samples are intentionally left out until the stack is locked; this is the shared mental model everyone builds against.

---

## Table of Contents

1. [How It Works — The Big Picture](#1-how-it-works--the-big-picture)
2. [Multi-Tenancy — One App, Many Salons](#2-multi-tenancy--one-app-many-salons)
3. [Meta Setup — Do This First](#3-meta-setup--do-this-first)
4. [Local Development with ngrok](#4-local-development-with-ngrok)
5. [Incoming Message Structure — Exact Payload](#5-incoming-message-structure--exact-payload)
6. [Sending Messages — The API Contract](#6-sending-messages--the-api-contract)
7. [Full Message Flow — End to End](#7-full-message-flow--end-to-end)
8. [Testing Checklist](#8-testing-checklist)
9. [Common Errors and Fixes](#9-common-errors-and-fixes)

---

## 1. How It Works — The Big Picture

A customer texts a salon's WhatsApp number. Here is exactly what happens:

```
Customer texts FABS Salon's WhatsApp
              ↓
Meta receives the message
              ↓
Meta sends a POST request to YOUR webhook URL
              ↓
Your server reads the phone_number_id → identifies FABS Salon
              ↓
Fetches ONLY FABS Salon's data from database
              ↓
Builds a prompt with that salon's services, slots, policies
              ↓
Sends prompt to the LLM → gets a reply
              ↓
Sends reply back via Meta using FABS Salon's phone_number_id
              ↓
Customer receives reply from FABS Salon's number ✅
```

The customer never knows there's an AI involved. They just get a fast, accurate reply from the salon's own number.

---

## 2. Multi-Tenancy — One App, Many Salons

This is the most important concept in the whole project.

**We register ONE Meta app. That app handles ALL salons.**

Each salon has their own WhatsApp number registered under our one Meta app. Meta gives each number a unique `phone_number_id`. That ID is our routing key — it tells us which salon a message belongs to.

```
Meta App (one)
    ├── FABS Salon          → phone_number_id: "001"
    ├── Salon #2            → phone_number_id: "002"  
    └── Salon #3            → phone_number_id: "003"

All messages → ONE webhook URL → routed by phone_number_id
```

### Data isolation — critical rule

Every salon's data lives in the same database but must be completely separated by `salon_id`. This applies no matter what backend we use:

**Rule: every single database query must be scoped to one salon's `salon_id`. No exceptions — a query that isn't scoped this way risks leaking one salon's bookings or conversations into another's.**

### How the routing works, conceptually

1. A message arrives at the webhook. Meta tells us which salon via `phone_number_id` in the payload metadata.
2. We look up which salon that `phone_number_id` belongs to (a simple lookup against our salons table).
3. Every step after that — fetching data, building the prompt, saving history, sending the reply — is scoped to that one salon's `salon_id`. No other salon's data is ever touched in the same request.

---

## 3. Meta Setup — Do This First

**This blocks everyone. Complete before any code is written.**

### Step 1 — Create Meta Developer Account
Go to [developers.facebook.com](https://developers.facebook.com) and sign in with a Facebook account.

### Step 2 — Create a New App
- Click "Create App"
- Select "Business" as app type
- Give it a name e.g. "Salon Agent"
- Click "Create App"

### Step 3 — Add WhatsApp Product
- In your app dashboard find "Add Products"
- Click "Set Up" on WhatsApp
- You'll be taken to the WhatsApp Getting Started page

### Step 4 — Get Your Credentials
From the WhatsApp Getting Started page, copy these — we need all four:

```env
# These go in the .env file

# Found on Getting Started page
WHATSAPP_TOKEN=EAAxxxxxxxx...        # Temporary access token (expires in 24hrs for testing)
PHONE_NUMBER_ID=1234567890           # Test phone number's ID

# Found in App Settings → Basic
META_APP_ID=123456789
META_APP_SECRET=abc123...

# Created by us — any random string
WEBHOOK_VERIFY_TOKEN=salon_agent_secret_2026
```

### Step 5 — Add a Test Phone Number
- Meta gives us a free test number for development
- We can send messages from this number to up to 5 recipient numbers
- Add your own phone number as a recipient so you can test receiving messages

### Step 6 — Set Up Webhook (after ngrok is running — see Section 4)
- In WhatsApp settings → Configuration → Webhook
- Callback URL: your ngrok URL + `/webhook` e.g. `https://abc123.ngrok.io/webhook`
- Verify Token: whatever is set as `WEBHOOK_VERIFY_TOKEN` in `.env`
- Subscribe to: `messages`
- Click Verify and Save

---

## 4. Local Development with ngrok

Meta's webhook needs a **public HTTPS URL**. Localhost is not public. ngrok creates a tunnel from the internet to your local machine.

### Install ngrok
```bash
# Mac
brew install ngrok

# Windows — download from ngrok.com/download

# Or install via npm
npm install -g ngrok
```

### Run ngrok
```bash
# Start your local server first, on whatever port it runs on

# In a NEW terminal — start ngrok, pointing at your server's port
ngrok http 3000

# You'll see something like:
# Forwarding  https://abc123def456.ngrok.io → http://localhost:3000
```

Copy the `https://` URL. That's what gets pasted into Meta's webhook settings.

### Important ngrok notes
- Every time ngrok restarts, you get a NEW URL
- The webhook URL in Meta settings must be updated every time
- Free ngrok tier is fine for development
- Never commit your ngrok URL anywhere

---

## 5. Incoming Message Structure — Exact Payload

This is what Meta actually sends. The real structure is more nested than most examples show — get this wrong and any parser breaks, regardless of language.

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "WHATSAPP_BUSINESS_ACCOUNT_ID",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "923001234567",
              "phone_number_id": "001"
            },
            "contacts": [
              {
                "profile": { "name": "Ayesha Khan" },
                "wa_id": "923009876543"
              }
            ],
            "messages": [
              {
                "from": "923009876543",
                "id": "wamid.xxxxxxxxxxxx",
                "timestamp": "1234567890",
                "text": {
                  "body": "kal appointment available hai?"
                },
                "type": "text"
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

### What to extract, and why

| Field (path) | What it is | Why it matters |
|---|---|---|
| `metadata.phone_number_id` | Which salon this message is for | This is the routing key — the entire multi-tenancy model depends on this |
| `messages[0].from` | Customer's phone number | Needed to look up/create the customer record and to send the reply back |
| `messages[0].text.body` | The actual message text | What gets passed into the LLM prompt |
| `messages[0].type` | Message type (`text`, `image`, `audio`, etc.) | Determines which branch handles it |

**Safety note (applies regardless of language):** always guard against missing fields — Meta also sends non-message webhooks (status updates like "delivered" or "read"), which won't have a `messages` array at all. Any parser must check for that before trying to read `messages[0]`.

### Message types

| Type | What it is | Handle in MVP? |
|---|---|---|
| `text` | Regular text message | ✅ Yes |
| `image` | Photo sent by customer | ⏭ V2 — needed for the image-analysis finding from research, but not required for the first working version |
| `audio` | Voice note | ⏭ V2 |
| `interactive` | Button/list reply | ⏭ V2 |
| `button` | Quick reply button tap | ⏭ V2 |

For MVP — only handle `text`. Log and ignore everything else for now.

---

## 6. Sending Messages — The API Contract

This is Meta's API contract for sending a reply — the endpoint, headers, and body shape are fixed by Meta regardless of what backend calls them.

**Endpoint:**
```
POST https://graph.facebook.com/v18.0/{phone_number_id}/messages
```

**Headers:**
```
Authorization: Bearer {access_token}
Content-Type: application/json
```

**Body:**
```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "923001234567",
  "type": "text",
  "text": {
    "preview_url": false,
    "body": "Your reply text here — max 4096 characters"
  }
}
```

Notes:
- `to` is the customer's phone number with country code, no `+` sign
- `phone_number_id` in the URL must be the *salon's* ID, not a global one — this is what makes the reply come from the right salon's number
- A successful call returns the sent message's ID; a failed call returns an error object worth logging in full during testing

### Outbound vs reply messages

| Type | When | Cost | Requires template? |
|---|---|---|---|
| Reply (within 24hrs) | Customer messaged first | Free | No — any text |
| Outbound (after 24hrs) | We initiate / send reminders | Paid | Yes — must use an approved template |

For MVP — only send replies within the 24-hour window. Reminder messages need approved templates — handle later once the core loop works.

---

## 7. Full Message Flow — End to End

This is how the pieces connect, as a sequence of steps rather than code:

1. **Identify the salon** — look up which salon owns the `phone_number_id` the message came in on.
2. **Get or create the customer** — find the customer record for this phone number under this salon, or create one if it's their first message.
3. **Load recent conversation history** — pull the last several messages for context, scoped to this salon + customer.
4. **Save the incoming message** to that conversation history.
5. **Gather salon-specific context** — services, prices, working hours, available slots, policies.
6. **Build the prompt** — combine the salon's context, the conversation history, and the new message.
7. **Get a reply from the LLM.**
8. **Save the reply** to conversation history.
9. **Send the reply** back via Meta's API, using this salon's `phone_number_id` and access token.

Each step should fail loudly (logged, not silently swallowed) so that during testing it's obvious which stage broke if the customer doesn't get a reply.

---

## 8. Testing Checklist

Use this to verify each piece works before moving to the next — framework-agnostic, applies to whatever we build:

```
WEBHOOK
☐ Server responds 200 with the challenge string on GET /webhook (Meta verification passes)
☐ POST /webhook logs the incoming message body
☐ POST /webhook responds 200 immediately, before processing (Meta requires a response within 5 seconds)

ROUTING & DATA
☐ Looking up a salon by phone_number_id returns the correct salon's data
☐ Getting/creating a customer record works and is scoped to the right salon
☐ Every database query touching bookings/conversations is scoped by salon_id

LLM
☐ The prompt sent to the LLM contains the correct salon's name, services, and hours
☐ The LLM call returns a non-empty reply
☐ Conversation history saves and loads correctly

WHATSAPP SENDING
☐ A test message sends successfully and is received on a real phone
☐ Error handling works (test with a deliberately wrong token)

FULL END TO END
☐ Customer texts the test salon number
☐ Message appears in server logs
☐ LLM generates a reply
☐ Reply is received on the customer's phone
☐ Conversation is saved in the database
```

---

## 9. Common Errors and Fixes

| Error | Cause | Fix |
|---|---|---|
| `403 on webhook verification` | Wrong verify token | Check `WEBHOOK_VERIFY_TOKEN` in `.env` matches Meta settings |
| `ngrok tunnel not found` | ngrok restarted | Copy the new ngrok URL → update Meta webhook settings |
| `401 Unauthorized on send` | Expired token | Meta test tokens expire in 24hrs — refresh from the dashboard |
| `Message not received` | Not subscribed to messages | In Meta webhook settings → subscribe to the `messages` field |
| `Cannot read phone_number_id` | Payload parsing assumes fields exist that don't (e.g. status-update webhooks) | Guard against missing fields before reading nested payload data |

---

*Last updated: Week 3 — Squad Siachen — Comebck Pakistan Cohort 1 — 2026*
