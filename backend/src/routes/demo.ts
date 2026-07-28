// Demo / jury-presentation routes.
//
// Bypasses WhatsApp entirely — same backend AI logic (Supabase routing +
// MiniMax LLM reply + structured state persistence + autonomous booking)
// but exposed over plain HTTP. Lets us demo multi-tenant routing in the
// jury room without depending on Meta's flaky test-mode UX.
//
// Endpoints:
//   GET  /demo/businesses         → list all active businesses (for widget dropdown)
//   POST /demo/chat               → send a customer message, get bot reply as JSON
//
// The flow mirrors webhook.ts exactly — both call into the SAME
// handleIncomingMessage() in lib/message-handler.ts, so the demo and
// production transports behave identically.
//   1. Resolve business
//   2. Get-or-create customer
//   3. Get-or-create conversation
//   4. Save customer message into conversation_state (structured)
//   5. Generate structured LLM reply (intent + slots + reply_text)
//   6. If intent='book' + all slots + confidence >= 70: actually create
//      the appointment in the appointments table
//   7. Save final agent reply into conversation_state (structured)
//   8. Return reply + appointment status

import { Router, Request, Response } from 'express';
import { getSupabase } from '../lib/supabase';
import { handleIncomingMessage } from '../lib/message-handler';

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

    // 2-8. Same flow as production transports — single source of truth.
    const result = await handleIncomingMessage({
      businessId: business.id,
      from: customer_phone,
      text: message,
    });

    return res.json({
      business: {
        id: business.id,
        name: business.name,
      },
      conversation_id: result.conversationId,
      customer_message: message,
      reply: result.reply,
      appointment: result.appointment,
    });
  } catch (e) {
    console.error('/demo/chat error:', e);
    return res.status(500).json({ error: (e as Error).message });
  }
});

export default router;