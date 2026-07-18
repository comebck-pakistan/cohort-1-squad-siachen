import axios from 'axios';

const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || '';

const BASE_URL = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}`;

interface SendTextOptions {
  to: string;
  message: string;
}

export async function sendWhatsAppText({ to, message }: SendTextOptions): Promise<void> {
  try {
    await axios.post(
      `${BASE_URL}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: message },
      },
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error: any) {
    console.error('WhatsApp send failed:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Parse a Meta WhatsApp webhook payload. Returns the fields our bot
 * needs to (a) identify the salon that received the message, and
 * (b) identify the customer who sent it.
 *
 * Meta's payload structure:
 *   body.entry[0].changes[0].value.messages[0] = the incoming message
 *   body.entry[0].changes[0].value.metadata.phone_number_id = OUR number
 *     (the salon that owns the WhatsApp Business number receiving this)
 *   body.entry[0].changes[0].value.messages[0].from = customer's phone
 *
 * Returns null for non-text messages (status updates, image messages, etc.)
 * — those are ignored for now.
 */
export function extractMessageFromWebhook(body: any): {
  from: string;
  text: string;
  messageId: string;
  phoneNumberId: string;
} | null {
  try {
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message || message.type !== 'text') return null;

    return {
      from: message.from,                          // customer's phone (E.164, no '+')
      text: message.text.body,                     // message body
      messageId: message.id,                       // unique message ID
      phoneNumberId: value?.metadata?.phone_number_id, // OUR WhatsApp number's Meta ID
    };
  } catch {
    return null;
  }
}
