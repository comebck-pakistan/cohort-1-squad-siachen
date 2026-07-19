import axios from 'axios';
import type { SalonContext } from './db';

// Env var is still named ANTHROPIC_API_KEY in .env (don't change the .env name
// — just the value semantically holds a MiniMax key now). Functional rename
// can come later.
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = 'MiniMax-M3';

// MiniMax API — OpenAI-compatible endpoint
const API_URL = 'https://api.minimax.io/v1/chat/completions';

// ---------------------------------------------------------------------------
// Base personality — kept short, real salon data is appended per-request
// ---------------------------------------------------------------------------
const BASE_PROMPT = `You are Halo, an AI receptionist working for a Pakistani business.
You reply to customer messages in the SAME LANGUAGE the customer uses (Urdu, English,
Hindi, or Roman Urdu). Be warm, professional, and concise.

Hard rules:
- NEVER make up prices. If you don't have a price in your context, say
  "Let me have someone from the salon confirm" and ask for their phone number.
- NEVER make up availability — only offer slots you can see in your context.
- If the customer asks medical / skin-condition questions, politely decline
  medical advice and offer to have a stylist call them back.
- Keep replies SHORT (1-3 sentences max, like a real WhatsApp message).
- If the business context says it is NOT YET CONFIGURED (no services loaded),
  gracefully say so and ask the customer to share what they need — the owner
  will respond shortly.`;

/**
 * Build the per-business system prompt by appending the salon's real data
 * (services, hours, staff count) to the base personality.
 *
 * The context may be partial (owner hasn't set everything up yet) — the
 * resulting prompt explicitly tells the LLM what's missing so it can
 * gracefully degrade.
 */
function buildSystemPrompt(ctx: SalonContext): string {
  const lines: string[] = [BASE_PROMPT, '', `## You are answering for: ${ctx.name}`];
  if (ctx.city) lines.push(`Location: ${ctx.city}`);
  lines.push(`Timezone: ${ctx.timezone}`);
  lines.push('');

  if (ctx.is_configured) {
    lines.push('## Services this salon offers');
    lines.push('Format each line as: name — duration — price');
    for (const s of ctx.services) {
      const price = s.price != null ? `PKR ${s.price}` : 'price on request';
      lines.push(`- ${s.name} — ${s.duration_minutes} min — ${price}`);
    }
    lines.push('');
  } else {
    lines.push('## Services: NOT YET CONFIGURED');
    lines.push('The salon owner has not added their menu yet. If a customer asks');
    lines.push('about services or prices, say: "The salon is still setting up our');
    lines.push('menu. Let me have the owner share our full list with you shortly."');
    lines.push('');
  }

  if (ctx.hours.length > 0) {
    lines.push('## Weekly hours');
    for (const h of ctx.hours) {
      if (!h.is_open) {
        lines.push(`- ${h.day_of_week}: closed`);
      } else {
        lines.push(`- ${h.day_of_week}: ${h.open_time}–${h.close_time}`);
      }
    }
    lines.push('');
  }

  lines.push(`## Staff: ${ctx.staff_count} active`);
  lines.push('');
  lines.push('## Booking flow (when a customer wants to book)');
  lines.push('1. Confirm which service they want');
  lines.push('2. Confirm their preferred date and time');
  lines.push('3. If you have hours for that day, confirm the time falls within them');
  lines.push('4. Ask for their full name and phone number to confirm');
  lines.push('5. Tell them the salon will confirm shortly (do NOT promise the slot)');
  lines.push('');
  lines.push('## Handling short / vague replies');
  lines.push('Customers often reply with just a time ("kal 3 bjay") or a word');
  lines.push('("haan"). ALWAYS read the recent conversation history to understand');
  lines.push('what they are referring to. Never ask "what do you mean?" — instead');
  lines.push('assume they are answering your last question and respond accordingly.');
  lines.push('If truly ambiguous after checking history, ask a specific clarifying');
  lines.push('question (e.g. "Kal konsa service book karwana hai?" not "Sorry?").');

  return lines.join('\n');
}

interface GenerateReplyOptions {
  customerMessage: string;
  salonContext: SalonContext;
  conversationHistory?: { role: 'user' | 'assistant'; content: string }[];
}

export async function generateReply({
  customerMessage,
  salonContext,
  conversationHistory = [],
}: GenerateReplyOptions): Promise<string> {
  try {
    const systemPrompt = buildSystemPrompt(salonContext);

    // OpenAI format: system message is the first item in the messages array
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
      { role: 'user', content: customerMessage },
    ];

    const response = await axios.post(
      API_URL,
      {
        model: MODEL,
        max_tokens: 500,
        messages,
      },
      {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    // OpenAI-format response: choices[0].message.content
    const rawReply: string = response.data?.choices?.[0]?.message?.content || '';
    // Strip any <think>...</think> reasoning blocks (some models return them
    // inline). WhatsApp customers should only see the final answer.
    const reply = rawReply.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    return reply || 'Sorry, I could not generate a reply. Please try again.';
  } catch (error: any) {
    console.error('LLM call failed:', error.response?.data || error.message);
    return 'Sorry, I am having trouble responding right now. Please try again in a moment.';
  }
}