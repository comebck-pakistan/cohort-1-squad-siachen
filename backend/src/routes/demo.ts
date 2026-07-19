// Demo / jury-presentation routes.
//
// Bypasses WhatsApp entirely — same backend AI logic (Supabase routing +
// MiniMax LLM reply + message persistence) but exposed over plain HTTP.
// Lets us demo multi-tenant routing in the jury room without depending on
// Meta's flaky test-mode UX.
//
// Endpoints:
//   GET  /demo/businesses         → list all active businesses (for widget dropdown)
//   POST /demo/chat               → send a customer message, get bot reply as JSON
//
// The flow mirrors webhook.ts exactly:
//   1. Resolve business
//   2. Get-or-create customer
//   3. Get-or-create conversation
//   4. Save customer message
//   5. Generate LLM reply
//   6. Save agent reply
//   7. Return reply

import { Router, Request, Response } from 'express';
import { generateReply } from '../lib/llm';
import {
  getOrCreateCustomer,
  getOrCreateConversation,
  getRecentMessages,
  getSalonContext,
  saveMessage,
  touchConversation,
} from '../lib/db';
import { getSupabase } from '../lib/supabase';

const router = Router();

// ---------------------------------------------------------------------------
// GET /demo/businesses
// ---------------------------------------------------------------------------
router.get('/demo/businesses', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await getSupabase()
      .from('businesses')
      .select('id, name, business_type, city, timezone')
      .eq('agent_active', true)
      .order('name');

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    return res.json({ businesses: data || [] });
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
});

// ---------------------------------------------------------------------------
// POST /demo/chat
// ---------------------------------------------------------------------------
router.post('/demo/chat', async (req: Request, res: Response) => {
  try {
    const {
      business_id,
      customer_phone,
      customer_name,
      message,
    } = req.body as {
      business_id?: string;
      customer_phone?: string;
      customer_name?: string;
      message?: string;
    };

    if (!business_id || !customer_phone || !message) {
      return res.status(400).json({
        error: 'Missing required fields: business_id, customer_phone, message',
      });
    }

    // 1. Resolve business (verify it exists + is active)
    const { data: business, error: bizErr } = await getSupabase()
      .from('businesses')
      .select('id, name')
      .eq('id', business_id)
      .eq('agent_active', true)
      .maybeSingle();

    if (bizErr) {
      return res.status(500).json({ error: bizErr.message });
    }
    if (!business) {
      return res.status(404).json({ error: 'Business not found or inactive' });
    }

    // 2-4. Customer + conversation + save incoming message
    const customerId = await getOrCreateCustomer(customer_phone);
    const conversationId = await getOrCreateConversation(business.id, customerId);
    await saveMessage(conversationId, 'customer', message);
    await touchConversation(conversationId);

    // 5. Load salon context (services, hours, staff) and recent message
    //    history so the LLM has context (e.g. "tomorrow 3pm" only makes
    //    sense if the bot knows they were talking about Hair Cut).
    const salonContext = await getSalonContext(business.id);
    const conversationHistory = await getRecentMessages(conversationId, 10);
    let reply: string;
    try {
      reply = await generateReply({
        customerMessage: message,
        salonContext,
        conversationHistory,
      });
    } catch (llmErr) {
      console.error('LLM error in /demo/chat:', llmErr);
      reply = 'Sorry, I am having trouble responding right now. Please try again in a moment.';
    }

    // 6. Save agent reply
    await saveMessage(conversationId, 'agent', reply);
    await touchConversation(conversationId);

    // 7. Return
    return res.json({
      business: {
        id: business.id,
        name: business.name,
        is_configured: salonContext.is_configured,
      },
      conversation_id: conversationId,
      customer_message: message,
      reply,
    });
  } catch (e) {
    console.error('/demo/chat error:', e);
    return res.status(500).json({ error: (e as Error).message });
  }
});

export default router;