# 📱 WhatsApp Integration Guide
### Salon Agent — Squad Siachen | Comebck Pakistan Cohort 1

> **Read this before writing a single line of code.** This document covers everything you need to understand and build the WhatsApp integration — from how Meta's API works to the exact code structure each member needs.

---

## Table of Contents

1. [How It Works — The Big Picture](#1-how-it-works--the-big-picture)
2. [Multi-Tenancy — One App, Many Salons](#2-multi-tenancy--one-app-many-salons)
3. [Meta Setup — Do This First](#3-meta-setup--do-this-first)
4. [Local Development with ngrok](#4-local-development-with-ngrok)
5. [Webhook Verification — First Code to Write](#5-webhook-verification--first-code-to-write)
6. [Incoming Message Structure — Exact Payload](#6-incoming-message-structure--exact-payload)
7. [Sending Messages — Exact API Call](#7-sending-messages--exact-api-call)
8. [Full Message Flow — End to End](#8-full-message-flow--end-to-end)
9. [What Each Member Builds](#9-what-each-member-builds)
10. [Testing Checklist](#10-testing-checklist)

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
Sends prompt to LLM API → gets a reply
              ↓
Sends reply back via Meta using FABS Salon's phone_number_id
              ↓
Customer receives reply from FABS Salon's number ✅
```

The customer never knows there's an AI involved. They just get a fast, accurate reply from the salon's own number.

---

## 2. Multi-Tenancy — One App, Many Salons

This is the most important concept in the whole project.

**You register ONE Meta app. That app handles ALL salons.**

Each salon has their own WhatsApp number registered under your one Meta app. Meta gives each number a unique `phone_number_id`. That ID is your routing key — it tells you which salon a message belongs to.

```
Meta App (one)
    ├── FABS Salon          → phone_number_id: "001"
    ├── Salon #2            → phone_number_id: "002"  
    └── Salon #3            → phone_number_id: "003"

All messages → ONE webhook URL → your server routes by phone_number_id
```

### Data isolation — critical rule

Every salon's data lives in the same database but is completely separated by `salon_id`. This is enforced at the query level:

```javascript
// ✅ CORRECT — always filter by salon_id
const bookings = await prisma.booking.findMany({
  where: { salon_id: salon.id }
})

// ❌ WRONG — never query without salon_id
const bookings = await prisma.booking.findMany()
// This would return ALL salons' bookings — never do this
```

**Rule: every single database query must include `WHERE salon_id = X`. No exceptions.**

### How the routing works

```javascript
// Step 1: Message arrives at webhook
// Meta tells you which salon via phone_number_id

const phoneNumberId = req.body.entry[0]
  .changes[0].value.metadata.phone_number_id
// e.g. "001"

// Step 2: Look up which salon this is
const salon = await prisma.salon.findUnique({
  where: { phone_number_id: phoneNumberId }
})
// Returns full FABS Salon object with all their data

// Step 3: Everything from here uses salon.id as the boundary
// No other salon's data is ever touched
```

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
From the WhatsApp Getting Started page, copy these — you need all four:

```env
# These go in your .env file

# Found on Getting Started page
WHATSAPP_TOKEN=EAAxxxxxxxx...        # Temporary access token (expires in 24hrs for testing)
PHONE_NUMBER_ID=1234567890           # Your test phone number's ID

# Found in App Settings → Basic
META_APP_ID=123456789
META_APP_SECRET=abc123...

# You create this yourself — any random string
WEBHOOK_VERIFY_TOKEN=salon_agent_secret_2026
```

### Step 5 — Add a Test Phone Number
- Meta gives you a free test number for development
- You can send messages from this number to up to 5 recipient numbers
- Add your own phone number as a recipient so you can test receiving messages

### Step 6 — Set Up Webhook (after ngrok is running — see Section 4)
- In WhatsApp settings → Configuration → Webhook
- Callback URL: your ngrok URL + `/webhook` e.g. `https://abc123.ngrok.io/webhook`
- Verify Token: whatever you set as `WEBHOOK_VERIFY_TOKEN` in your `.env`
- Subscribe to: `messages`
- Click Verify and Save

---

## 4. Local Development with ngrok

Meta's webhook needs a **public HTTPS URL**. Your localhost is not public. ngrok creates a tunnel from the internet to your local machine.

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
# Start your server first
npm run dev
# Server runs on port 3000

# In a NEW terminal — start ngrok
ngrok http 3000

# You'll see something like:
# Forwarding  https://abc123def456.ngrok.io → http://localhost:3000
```

Copy the `https://` URL. That's what you paste into Meta's webhook settings.

### Important ngrok notes
- Every time you restart ngrok you get a NEW URL
- You must update the webhook URL in Meta settings every time
- Free ngrok tier is fine for development
- Never commit your ngrok URL anywhere

---

## 5. Webhook Verification — First Code to Write

Before Meta sends you any messages, it verifies your webhook exists by sending a GET request. If you don't handle this correctly, Meta will never send you anything.

**This is Member 1's first task.**

```javascript
// src/routes/whatsapp.js

const express = require('express')
const router = express.Router()

// ─── WEBHOOK VERIFICATION (GET) ───────────────────────────────
// Meta sends this once when you set up the webhook
// Must respond with the challenge string or Meta rejects your URL

router.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode']
  const token     = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

  console.log('Webhook verification attempt:', { mode, token })

  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log('✅ Webhook verified successfully')
    res.status(200).send(challenge)  // Must send back exactly this
  } else {
    console.log('❌ Webhook verification failed — token mismatch')
    res.sendStatus(403)
  }
})

// ─── INCOMING MESSAGES (POST) ─────────────────────────────────
// Meta sends every customer message here
// Must respond with 200 immediately or Meta will retry

router.post('/webhook', async (req, res) => {
  res.sendStatus(200)  // Always respond 200 first — then process
  
  try {
    await messageController.handleIncoming(req.body)
  } catch (error) {
    console.error('Message handling error:', error)
  }
})

module.exports = router
```

**Why `res.sendStatus(200)` first?** Meta requires a response within 5 seconds or it marks your webhook as failed and retries. Processing the message (calling Claude, querying DB) takes longer than 5 seconds. So always acknowledge first, then process.

---

## 6. Incoming Message Structure — Exact Payload

This is what Meta actually sends you. The real structure is more nested than most examples show. Get this wrong and your parser breaks.

```javascript
// Full incoming POST body from Meta
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
              "phone_number_id": "001"          // ← SALON IDENTIFIER — extract this
            },
            "contacts": [
              {
                "profile": { "name": "Ayesha Khan" },
                "wa_id": "923009876543"
              }
            ],
            "messages": [
              {
                "from": "923009876543",         // ← CUSTOMER PHONE — extract this
                "id": "wamid.xxxxxxxxxxxx",
                "timestamp": "1234567890",
                "text": {
                  "body": "kal appointment available hai?" // ← MESSAGE TEXT — extract this
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

### How to safely extract the data

```javascript
// src/controllers/messageController.js

async function handleIncoming(body) {
  
  // Safety check — ignore non-message webhooks
  if (body.object !== 'whatsapp_business_account') return
  
  const entry   = body.entry?.[0]
  const change  = entry?.changes?.[0]
  const value   = change?.value
  
  // Ignore status updates (delivered, read receipts etc)
  if (!value?.messages) return
  
  const message       = value.messages[0]
  const phoneNumberId = value.metadata.phone_number_id  // Which salon
  const customerPhone = message.from                     // Customer's number
  const messageText   = message.text?.body              // What they said
  const messageType   = message.type                    // text, image, audio etc

  // Only handle text messages for now
  if (messageType !== 'text' || !messageText) {
    console.log('Non-text message received — skipping for now')
    return
  }

  console.log(`📨 Message from ${customerPhone} to salon ${phoneNumberId}: "${messageText}"`)

  // Now route to the right salon
  await routeMessage(phoneNumberId, customerPhone, messageText)
}
```

### Message types you'll receive

| Type | What it is | Handle in MVP? |
|---|---|---|
| `text` | Regular text message | ✅ Yes |
| `image` | Photo sent by customer | ⏭ V2 |
| `audio` | Voice note | ⏭ V2 |
| `interactive` | Button/list reply | ⏭ V2 |
| `button` | Quick reply button tap | ⏭ V2 |

For MVP — only handle `text`. Log and ignore everything else.

---

## 7. Sending Messages — Exact API Call

**This is Member 4's core task.**

```javascript
// src/services/whatsappService.js

const axios = require('axios')

/**
 * Send a text message via WhatsApp Cloud API
 * 
 * @param {string} phoneNumberId  - The salon's Meta phone_number_id
 * @param {string} accessToken    - The salon's WhatsApp access token
 * @param {string} toPhone        - Customer's phone number (with country code, no +)
 * @param {string} messageText    - The reply text to send
 */
async function sendMessage(phoneNumberId, accessToken, toPhone, messageText) {
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: toPhone,                    // e.g. "923001234567" — no + sign
        type: "text",
        text: {
          preview_url: false,
          body: messageText             // Max 4096 characters
        }
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    )

    console.log(`✅ Message sent to ${toPhone}:`, response.data)
    return response.data

  } catch (error) {
    console.error('❌ Failed to send WhatsApp message:', 
      error.response?.data || error.message)
    throw error
  }
}

module.exports = { sendMessage }
```

### How to test this in isolation

Before the full flow works, Member 4 can test sending independently:

```javascript
// test-send.js — run with: node test-send.js
require('dotenv').config()
const { sendMessage } = require('./src/services/whatsappService')

// Send a test message to your own phone
sendMessage(
  process.env.PHONE_NUMBER_ID,    // From your .env
  process.env.WHATSAPP_TOKEN,     // From your .env
  '923XXXXXXXXX',                  // Your own phone number (no + sign)
  'Test message from Salon Agent 🎉'
)
.then(() => console.log('Test message sent!'))
.catch(console.error)
```

If you receive the WhatsApp message on your phone — Member 4's task is complete ✅

### Important: outbound vs reply messages

| Type | When | Cost | Requires template? |
|---|---|---|---|
| Reply (within 24hrs) | Customer messaged you first | Free | No — send any text |
| Outbound (after 24hrs) | You initiate / send reminders | Paid | Yes — must use approved template |

For MVP — only send replies within the 24-hour window. Reminder messages need approved templates — handle in Week 5.

---

## 8. Full Message Flow — End to End

This is how all the pieces connect together:

```javascript
// src/controllers/messageController.js — full orchestration

const salonService        = require('../services/salonService')
const customerService     = require('../services/customerService')
const conversationService = require('../services/conversationService')
const llmService          = require('../services/llmService')
const whatsappService     = require('../services/whatsappService')
const bookingService      = require('../services/bookingService')

async function routeMessage(phoneNumberId, customerPhone, messageText) {

  // ── STEP 1: Find which salon this message belongs to ──────────
  const salon = await salonService.findByPhoneNumberId(phoneNumberId)
  if (!salon) {
    console.error(`No salon found for phone_number_id: ${phoneNumberId}`)
    return
  }

  // ── STEP 2: Get or create customer record for this salon ──────
  const customer = await customerService.getOrCreate(salon.id, customerPhone)

  // ── STEP 3: Load conversation history (last 10 messages) ──────
  const history = await conversationService.getHistory(salon.id, customer.id, 10)

  // ── STEP 4: Save incoming message to history ──────────────────
  await conversationService.save(salon.id, customer.id, 'user', messageText)

  // ── STEP 5: Build prompt with this salon's data only ──────────
  const availableSlots = await bookingService.getAvailableSlots(salon.id)
  const prompt = llmService.buildPrompt(salon, history, messageText, availableSlots)

  // ── STEP 6: Get reply from LLM (TBD — Groq/MiniMax) ──────────
  const reply = await llmService.getReply(prompt)

  // ── STEP 6.5: Escalation check — BEFORE sending ───────────────
  // Based on FABS Salon interview finding: medical/skin questions
  // must always go to a human — never answered by the agent
  const ESCALATION_TRIGGERS = [
    'skin', 'medical', 'allergy', 'reaction', 'infection',
    'rash', 'treatment', 'disease', 'doctor', 'dermatologist'
  ]

  const combined = (reply + messageText).toLowerCase()
  const needsEscalation = combined.includes('[escalate]') ||
    ESCALATION_TRIGGERS.some(trigger => combined.includes(trigger))

  let finalReply = reply

  if (needsEscalation) {
    // Notify salon owner directly
    await whatsappService.sendMessage(
      salon.phone_number_id,
      salon.whatsapp_token,
      salon.owner_phone,
      `⚠️ Customer ${customerPhone} asked a medical/skin question. Please respond directly.`
    )
    // Send holding message to customer instead of AI reply
    finalReply = "I'll connect you with our team for this. Please hold 🙏"
    console.log(`⚠️ Escalated to human for salon: ${salon.name}`)
  }

  // ── STEP 7: Save reply to history ─────────────────────────────
  await conversationService.save(salon.id, customer.id, 'assistant', finalReply)

  // ── STEP 8: Send reply via WhatsApp ───────────────────────────
  await whatsappService.sendMessage(
    salon.phone_number_id,
    salon.whatsapp_token,
    customerPhone,
    finalReply
  )

  console.log(`✅ Full flow complete for salon: ${salon.name}`)
}

module.exports = { handleIncoming, routeMessage }
```

---

## 9. What Each Member Builds

### Member 1 — Foundation & Webhook
**Owns:** `src/index.js`, `src/routes/whatsapp.js`, `src/middleware/verifyWebhook.js`, `config/db.js`, `prisma/schema.prisma`

**This week's goal:**
```
✅ Express server running on port 3000
✅ GET /webhook handles Meta verification correctly
✅ POST /webhook receives messages and logs them to console
✅ Prisma connected to Supabase
✅ Database schema pushed
```

**Test:** Set up ngrok, paste URL into Meta settings, click "Verify" — if Meta says verified, you're done ✅

---

### Member 2 — Salon Data & Bookings
**Owns:** `src/services/salonService.js`, `src/services/bookingService.js`, `src/services/customerService.js`, `src/services/promotionsService.js`, `admin/onboarding.js`

**This week's goal:**
```
✅ FABS Salon added to database via onboarding script
✅ salonService.findByPhoneNumberId("001") returns FABS Salon data
✅ customerService.getOrCreate() works correctly
✅ bookingService.getAvailableSlots() returns open time slots
```

**Test:** Run `node admin/onboarding.js` → query database → see FABS Salon data ✅

---

### Member 3 — LLM & Brain
**Owns:** `src/services/llmService.js`, `src/services/conversationService.js`, `src/controllers/messageController.js`

**This week's goal:**
```
✅ llmService.buildPrompt() generates a correct system prompt with salon data
✅ llmService.getReply() calls LLM API (TBD — Groq/MiniMax) and returns a response
✅ conversationService.save() and getHistory() work correctly
✅ messageController.routeMessage() orchestrates the full flow
```

**Test:** Call `llmService.buildPrompt(fakeSalonData, [], "price kya hai?", [])` → console.log the prompt → does it contain the right salon info? ✅

**System prompt template:**
```javascript
function buildPrompt(salon, history, newMessage, availableSlots) {
  const systemPrompt = `
You are the WhatsApp assistant for ${salon.name}.
Reply in the same language the customer uses — Urdu or English.
Be friendly, brief, and helpful. Never mention other salons.

SERVICES AND PRICES:
${salon.services.map(s => `- ${s.name}: Rs.${s.price}`).join('\n')}

WORKING HOURS:
${formatHours(salon.working_hours)}

AVAILABLE SLOTS TODAY:
${availableSlots.length > 0 
  ? availableSlots.map(s => `- ${s}`).join('\n')
  : 'No slots available today — suggest tomorrow'}

POLICIES:
${salon.policies || 'No specific policies'}

BOOKING INSTRUCTIONS:
If customer wants to book, collect in order:
1. Which service?
2. Preferred date?
3. Preferred time?
4. Their name?
Then confirm: "Your [service] is booked for [date] at [time]. See you then! 🙂"

ESCALATE TO HUMAN if:
- Customer asks ANY medical or skin-related question (allergies, reactions, infections, treatments)
- Customer is complaining or upset
- Question is about something not in your information
- Customer explicitly asks to speak to someone
When escalating, always reply: "I'll connect you with our team for this. Please hold 🙏"
Never attempt to answer medical or skin condition questions — always escalate.
`
  return { systemPrompt, history, newMessage }
}
```

---

### Member 4 — WhatsApp Messaging & Reminders
**Owns:** `src/services/whatsappService.js`, `src/jobs/reminderJob.js`

**This week's goal:**
```
✅ whatsappService.sendMessage() sends a real WhatsApp message
✅ Test message received on your own phone
✅ reminderJob.js structure written (cron execution next week)
```

**Test:** Run `node test-send.js` → receive WhatsApp message on your phone ✅

---

## 10. Testing Checklist

Use this to verify each piece works before moving to the next:

```
FOUNDATION (Member 1)
☐ npm install runs without errors
☐ npm run dev starts server on port 3000
☐ ngrok running and URL copied
☐ GET /webhook returns 200 with challenge (Meta verification passes)
☐ POST /webhook logs incoming message body to console

DATABASE (Member 2)
☐ npx prisma db push runs without errors
☐ FABS Salon visible in Supabase dashboard after onboarding script
☐ salonService.findByPhoneNumberId("001") returns salon object
☐ customerService.getOrCreate() creates new customer in DB

LLM (Member 3)
☐ LLM API key works — Groq/MiniMax (test with simple curl)
☐ buildPrompt() returns a string containing salon name and services
☐ getReply() returns a non-empty string response
☐ conversationService saves and retrieves messages correctly

WHATSAPP SENDING (Member 4)
☐ test-send.js sends message successfully
☐ Message received on real phone
☐ Error handling works (test with wrong token)

FULL END TO END
☐ Customer texts test salon number
☐ Message appears in server logs
☐ LLM generates a reply
☐ Reply received on customer's phone
☐ Conversation saved in database
```

---

## Common Errors and Fixes

| Error | Cause | Fix |
|---|---|---|
| `403 on webhook verification` | Wrong verify token | Check `WEBHOOK_VERIFY_TOKEN` in `.env` matches Meta settings |
| `ngrok tunnel not found` | ngrok restarted | Copy new ngrok URL → update Meta webhook settings |
| `401 Unauthorized on send` | Expired token | Meta test tokens expire in 24hrs — refresh from dashboard |
| `Message not received` | Not subscribed to messages | In Meta webhook settings → subscribe to `messages` field |
| `Prisma connection error` | Wrong DATABASE_URL | Check Supabase connection string in `.env` |
| `Cannot read phone_number_id` | Wrong payload parsing | Use optional chaining — `body.entry?.[0]?.changes?.[0]` |

---

*Last updated: Week 3 — Squad Siachen — Comebck Pakistan Cohort 1 — 2026*
*Changes: Added Step 6.5 escalation flow (FABS medical/skin guardrail), updated LLM references to TBD (evaluating Groq/MiniMax)*
