import 'server-only';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { decryptEmailSecret, validEmail } from './email-security';

export class EmailRequestError extends Error { constructor(message: string, public status = 400) { super(message); } }
export function emailEncryptionKey() {
  const value = process.env.FARM_EMAIL_ENCRYPTION_KEY;
  if (!value || Buffer.from(value, 'base64').length !== 32) throw new EmailRequestError('Email encryption needs server setup. Contact your administrator.', 503);
  return value;
}
export async function authorizeEmailRequest(request: Request, companyId: unknown) {
  if (typeof companyId !== 'string' || !/^[0-9a-f-]{36}$/i.test(companyId)) throw new EmailRequestError('A valid workspace is required.');
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new EmailRequestError('Request origin is not allowed.', 403);
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) throw new EmailRequestError('Sign in first.', 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new EmailRequestError('Workspace access is not configured.', 503);
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: authorization } } });
  const auth = await client.auth.getUser(authorization.slice(7));
  const user = auth.data.user;
  if (auth.error || !user || !user.email || !user.email_confirmed_at || !validEmail(user.email)) throw new EmailRequestError('A verified account email is required.', 401);
  // The membership SELECT is also protected by the existing AAL2 RLS policy.
  const membership = await client.from('company_members').select('role').eq('company_id', companyId).eq('user_id', user.id).maybeSingle();
  if (membership.error || membership.data?.role !== 'admin') throw new EmailRequestError('Administrator access and two-step verification are required.', 403);
  return { client, user, companyId, recipient: user.email.toLowerCase() };
}
export function gmailTransport(email: string, password: string) {
  return nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: email, pass: password },
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true }, connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 15000,
    disableFileAccess: true, disableUrlAccess: true });
}
export function decryptGmail(data: { email: string; ciphertext: string }, companyId: string) {
  if (!validEmail(data.email)) throw new Error('Invalid saved Gmail account.');
  return { email: data.email, transport: gmailTransport(data.email, decryptEmailSecret(data.ciphertext, companyId, emailEncryptionKey())) };
}
export async function emailJson(request: Request) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new EmailRequestError('JSON is required.', 415);
  const reader = request.body?.getReader(); if (!reader) throw new EmailRequestError('Invalid request.');
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const chunk = await reader.read(); if (chunk.done) break;
    length += chunk.value.byteLength;
    if (length > 8192) { await reader.cancel(); throw new EmailRequestError('Request is too large.', 413); }
    chunks.push(chunk.value);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  try { const body = JSON.parse(text); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); return body as Record<string, unknown>; }
  catch { throw new EmailRequestError('Invalid request.'); }
}
export function emailFailure(error: unknown) {
  return Response.json({ error: error instanceof EmailRequestError ? error.message : 'The email operation could not be completed. Check the connection and try again.' }, { status: error instanceof EmailRequestError ? error.status : 502 });
}
