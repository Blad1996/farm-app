'use client';
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export type EmailSetupStatus = { recipient: string; userId: string; schemaReady: boolean; encryptionConfigured: boolean; automaticSendingConfigured: boolean };
export default function GmailConnection({ companyId, account, refreshed, onSetup }: { companyId: string; account: { email: string } | null; refreshed: () => Promise<void>; onSetup: (status: EmailSetupStatus) => void }) {
  const [status, setStatus] = useState<EmailSetupStatus | null>(null), [revision, setRevision] = useState(0);
  const [email, setEmail] = useState(account?.email || ''), [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  async function headers() {
    const session = await supabase!.auth.getSession(), token = session.data.session?.access_token;
    if (!token) throw new Error('Sign in again.');
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  }
  useEffect(() => {
    let cancelled = false;
    headers().then(auth => fetch(`/api/farm/email-account?companyId=${encodeURIComponent(companyId)}`, { headers: auth, signal: AbortSignal.timeout(15000) }))
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Unable to check email setup.'); return result as EmailSetupStatus; })
      .then(result => { if (!cancelled) { setStatus(result); onSetup(result); } })
      .catch(failure => { if (!cancelled) setError(failure.message); });
    return () => { cancelled = true; };
    // onSetup is the parent state setter and is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, revision]);
  async function action(kind: 'connect' | 'disconnect' | 'test') {
    if (busy) return; setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(kind === 'test' ? '/api/farm/email-test' : '/api/farm/email-account', { method: 'POST', headers: await headers(),
        body: JSON.stringify({ companyId, ...(kind === 'connect' ? { email, appPassword: password } : kind === 'disconnect' ? { action: 'disconnect' } : {}) }), signal: AbortSignal.timeout(45000) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Unable to complete the email operation.');
      setPassword('');
      setNotice(kind === 'connect' ? 'Gmail connected. You can enable email reminders below.' : kind === 'disconnect' ? 'Gmail disconnected. Email reminders are disabled.' : `Gmail accepted the test for ${result.to}. Check your inbox and spam folder.`);
      await refreshed(); setRevision(value => value + 1);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to complete the operation.'); }
    finally { setBusy(false); }
  }
  const ready = Boolean(status?.schemaReady && status.encryptionConfigured);
  return <div className="farm-notification-block"><h3>{account ? 'Gmail connected' : 'Connect Gmail'}</h3>
    {account && <p>Sender: {account.email}</p>}
    {status && !status.schemaReady && <p className="notice">Email setup is incomplete. Your administrator must apply the latest notification migration.</p>}
    {status && !status.encryptionConfigured && <p className="notice">The server encryption key is missing. Contact your administrator before connecting Gmail.</p>}
    <form onSubmit={event => { event.preventDefault(); void action('connect'); }}><fieldset disabled={busy || !ready}>
      <label className="field"><span>Gmail / Google Workspace address</span><input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>
      <label className="field"><span>Google app password</span><input type="password" autoComplete="new-password" required maxLength={32} value={password} onChange={event => setPassword(event.target.value)} /></label>
      <p className="field-help">Use a 16-character Google app password, never your normal password. It is encrypted by the server and never shown again. Google two-step verification must be enabled.</p>
      <a href="https://support.google.com/mail/answer/185833?hl=en" target="_blank" rel="noreferrer">Google app password instructions</a>
      <div className="form-actions"><button className="button" disabled={busy || !ready} aria-busy={busy}>{busy ? 'Please wait…' : account ? 'Update Gmail connection' : 'Connect Gmail'}</button></div>
    </fieldset></form>
    {account && <div className="actions"><button type="button" className="button secondary" disabled={busy || !ready} onClick={() => void action('test')}>Send test to my email</button><button type="button" className="button secondary" disabled={busy} onClick={() => void action('disconnect')}>Disconnect Gmail</button></div>}
    {status && !status.automaticSendingConfigured && <p className="notice">Automatic delivery still needs server and scheduler configuration. Connecting Gmail alone does not start automatic sending.</p>}
    {error && <p className="error" role="alert">{error} <button type="button" className="text-button" onClick={() => setRevision(value => value + 1)}>Check setup again</button></p>}{notice && <p role="status">{notice}</p>}
  </div>;
}
