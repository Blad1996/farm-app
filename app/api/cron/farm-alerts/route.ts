import { createClient } from '@supabase/supabase-js';
import { farmReminderMessage, validCronAuthorization, validEmail } from '../../../lib/email-security';
import { decryptGmail, emailEncryptionKey } from '../../../lib/farm-email-server';
import type { FarmAlert } from '../../../farm-types';
export const runtime = 'nodejs';
export const maxDuration = 60;
type Job = { company_id: string; delivery_date: string; claim_token: string };
export async function GET(request: Request) {
  if (!validCronAuthorization(request.headers.get('authorization'), process.env.CRON_SECRET)) return Response.json({ error: 'Unauthorized.' }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: 'Automatic sending needs server setup.' }, { status: 503 });
  try { emailEncryptionKey(); } catch { return Response.json({ error: 'Email encryption needs server setup.' }, { status: 503 }); }
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const claimed = await client.rpc('claim_farm_email_jobs', { p_limit: 5 });
  if (claimed.error) return Response.json({ error: 'Unable to claim notification jobs.' }, { status: 503 });
  const outcomes = await Promise.all((claimed.data as Job[]).map(async job => {
    let state = 'failed', errorCode = 'account_unavailable';
    let gmail: ReturnType<typeof decryptGmail> | undefined;
    try {
      // Address comes only from auth.users, verified again by this service RPC.
      // Neither request parameters nor the settings address array are used.
      const result = await client.rpc('farm_email_delivery_context', { p_company: job.company_id, p_date: job.delivery_date, p_token: job.claim_token });
      if (result.error) throw new Error('Delivery no longer authorized.');
      const context = result.data as { email: string; ciphertext: string; recipient: string; alerts: FarmAlert[] };
      if (!validEmail(context.recipient) || !context.alerts.length) throw new Error('No active delivery.');
      gmail = decryptGmail(context, job.company_id);
      state = 'uncertain'; errorCode = 'smtp_result_unknown';
      const sent = await gmail.transport.sendMail({ from: { name: 'Agro Inventory', address: gmail.email }, to: { address: context.recipient, name: '' },
        ...farmReminderMessage(context.alerts), messageId: `<farm-${job.company_id}-${job.delivery_date}@agro-inventory.local>` });
      if (sent.accepted.length === 1 && !sent.rejected.length) { state = 'sent'; errorCode = ''; }
    } catch { /* No secrets or provider responses are written into delivery logs. */ }
    finally { gmail?.transport.close(); }
    const done = await client.rpc('finish_farm_email_job', { p_company: job.company_id, p_date: job.delivery_date, p_token: job.claim_token, p_state: state, p_error: errorCode });
    return done.error ? 'uncertain' : state;
  }));
  return Response.json({ processed: outcomes.length, accepted: outcomes.filter(value => value === 'sent').length, needsReview: outcomes.filter(value => value !== 'sent').length });
}
