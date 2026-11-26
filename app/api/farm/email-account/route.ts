import { authorizeEmailRequest, emailEncryptionKey, emailFailure, emailJson, EmailRequestError, gmailTransport } from '../../../lib/farm-email-server';
import { encryptEmailSecret, validEmail } from '../../../lib/email-security';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const context = await authorizeEmailRequest(request, new URL(request.url).searchParams.get('companyId'));
    let ready = true; try { emailEncryptionKey(); } catch { ready = false; }
    const schema = await context.client.from('farm_notification_settings').select('recipient_user_id').limit(0);
    return Response.json({ recipient: context.recipient, userId: context.user.id, schemaReady: !schema.error, encryptionConfigured: ready, automaticSendingConfigured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.CRON_SECRET) });
  } catch (error) { return emailFailure(error); }
}
export async function POST(request: Request) {
  try {
    const body = await emailJson(request), { client, companyId } = await authorizeEmailRequest(request, body.companyId);
    if (body.action === 'disconnect') {
      const result = await client.rpc('disconnect_farm_email', { p_company: companyId });
      if (result.error) throw new EmailRequestError('Unable to disconnect Gmail.');
      return Response.json({ disconnected: true });
    }
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.appPassword === 'string' ? body.appPassword.replace(/\s/g, '') : '';
    if (!validEmail(email) || !/^[a-zA-Z0-9]{16}$/.test(password)) throw new EmailRequestError('Enter your Gmail address and its 16-character Google app password.');
    const key = emailEncryptionKey();
    const attempt = await client.rpc('claim_farm_gmail_attempt', { p_company: companyId });
    if (attempt.error) throw new EmailRequestError('Wait one minute before another connection attempt, and check that email setup is complete.', 429);
    const transport = gmailTransport(email, password);
    try { await transport.verify(); } catch { throw new EmailRequestError('Gmail could not be verified. Check Google two-step verification and the app password.', 422); }
    finally { transport.close(); }
    const saved = await client.rpc('save_farm_email_account', { p_company: companyId, p_email: email, p_ciphertext: encryptEmailSecret(password, companyId, key) });
    if (saved.error) throw new EmailRequestError('Unable to save the Gmail connection.');
    return Response.json({ connected: true, email });
  } catch (error) { return emailFailure(error); }
}
