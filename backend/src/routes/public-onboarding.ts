import { Router, Request, Response } from 'express';
import { getSupabase } from '../lib/supabase';

const router = Router();
const RECEIPTS_BUCKET = 'onboarding-receipts';

router.post('/onboarding/submit', async (req: Request, res: Response) => {
  const body = req.body || {};
  const required = ['businessId', 'salonName', 'phone', 'city', 'salonType', 'agentName', 'payerName', 'receipt'];
  const missing = required.filter((key) => !body[key]);
  if (missing.length) return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });

  const tierMap: Record<string, 'basic' | 'pro' | 'business'> = {
    single: 'basic', boutique: 'pro', luxury: 'business',
  };
  const amountMap: Record<string, number> = { single: 5000, boutique: 12000, luxury: 25000 };
  const supabase = getSupabase();
  const businessId = String(body.businessId);
  let receiptPath: string | null = null;

  try {
    const { data: business, error: businessError } = await supabase.from('businesses')
      .update({ tier: tierMap[body.tier] || 'pro', agent_active: false })
      .eq('id', businessId).eq('name', body.salonName).select('id').single();
    if (businessError || !business) throw businessError || new Error('Created business was not found');

    const buckets = await supabase.storage.listBuckets();
    if (!buckets.data?.some((bucket) => bucket.id === RECEIPTS_BUCKET)) {
      const created = await supabase.storage.createBucket(RECEIPTS_BUCKET, { public: false });
      if (created.error && !created.error.message.toLowerCase().includes('already exists')) throw created.error;
    }

    const receipt = body.receipt as { name: string; type: string; base64: string };
    const safeName = receipt.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    receiptPath = `${businessId}/${Date.now()}-${safeName}`;
    const uploaded = await supabase.storage.from(RECEIPTS_BUCKET).upload(
      receiptPath,
      Buffer.from(receipt.base64, 'base64'),
      { contentType: receipt.type || 'application/octet-stream', upsert: false }
    );
    if (uploaded.error) throw uploaded.error;

    const { error: intakeError } = await supabase.from('onboarding_submissions').insert({
      business_id: businessId,
      salon_name: body.salonName,
      phone: body.phone,
      city: body.city,
      salon_type: body.salonType,
      agent_name: body.agentName,
      agent_tone: body.tone,
      agent_languages: body.languages,
      booking_software: body.software || null,
      services: body.services,
      collect_deposit: body.deposit,
      tier: body.tier,
      billing: body.billing,
      payment_method: body.payMethod,
      payer_name: body.payerName,
      transaction_reference: body.txnRef || null,
      receipt_bucket: RECEIPTS_BUCKET,
      receipt_path: receiptPath,
      receipt_original_name: receipt.name,
    });
    if (intakeError) throw intakeError;

    const monthlyAmount = amountMap[body.tier] || 12000;
    const start = new Date();
    const end = new Date(start);
    end.setMonth(end.getMonth() + (body.billing === 'annual' ? 12 : 1));
    const { error: paymentError } = await supabase.from('payments').insert({
      business_id: businessId,
      amount: body.billing === 'annual' ? monthlyAmount * 10 : monthlyAmount,
      status: 'pending',
      billing_period_start: start.toISOString().slice(0, 10),
      billing_period_end: end.toISOString().slice(0, 10),
      payment_method: body.payMethod,
      external_reference: body.txnRef || null,
    });
    if (paymentError) throw paymentError;

    return res.status(201).json({ businessId, receiptPath });
  } catch (error) {
    if (receiptPath) await supabase.storage.from(RECEIPTS_BUCKET).remove([receiptPath]);
    return res.status(500).json({ error: (error as Error).message || 'Onboarding submission failed' });
  }
});

export default router;
