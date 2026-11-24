'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Leaf, ShieldCheck } from 'lucide-react';
import { supabase } from './supabase';

function AuthCard({ children }: { children: ReactNode }) {
  return <main className="auth-shell"><section className="auth-card">
    <div className="auth-brand"><Leaf aria-hidden="true" /> Agro Inventory</div>{children}
  </section></main>;
}

export function SignIn() {
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !supabase) return;
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(''); setMessage('');
    try {
      const credentials = { email: String(form.get('email') ?? '').trim(), password: String(form.get('password') ?? '') };
      const response = register
        ? await supabase.auth.signUp({ ...credentials, options: { emailRedirectTo: window.location.origin } })
        : await supabase.auth.signInWithPassword(credentials);
      if (response.error) {
        setError(register ? 'Unable to create your account. Check your details or try signing in.' : 'Unable to sign in. Check your email, password, and email confirmation.');
      } else if (register && !response.data.session) {
        setMessage('Check your email to confirm your account, then return to sign in.');
      }
    } catch { setError('Unable to connect. Please try again.'); }
    finally { setBusy(false); }
  }
  return <AuthCard><h1>{register ? 'Create your account' : 'Sign in'}</h1>
    <p>Sign in with your email and password, then enter your Google Authenticator code.</p>
    <form onSubmit={submit}><fieldset disabled={busy}>
      <label className="field"><span>Email</span><input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
      <label className="field"><span>Password</span><input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={register ? 12 : undefined} maxLength={128} /></label>
      {register && <p>Use at least 12 characters and a password you do not use on other sites.</p>}
      <div className="form-actions"><button className="button">{busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}</button></div>
    </fieldset></form>
    {error && <p className="error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <button className="text-button" disabled={busy} onClick={() => { setRegister(!register); setError(''); setMessage(''); }}>{register ? 'Already have an account? Sign in' : 'Create an account'}</button>
  </AuthCard>;
}

function SecondFactor({ onVerified }: { onVerified: () => void }) {
  const [factorId, setFactorId] = useState('');
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const actionLock = useRef(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    supabase!.auth.mfa.listFactors().then(({ data, error }) => {
      if (cancelled) return;
      if (error) setError('Unable to load your verification methods.');
      else setFactorId(data.totp.find(factor => factor.status === 'verified')?.id ?? '');
      setLoading(false);
    }).catch(() => { if (!cancelled) { setError('Unable to connect.'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [retry]);

  async function enroll() {
    if (actionLock.current || !supabase) return;
    actionLock.current = true; setBusy(true); setError('');
    try {
      // Only remove unfinished enrollments; verified factors are never removed here.
      const factors = await supabase.auth.mfa.listFactors();
      if (factors.error) throw factors.error;
      const verified = factors.data.totp.find(factor => factor.status === 'verified');
      if (verified) { setFactorId(verified.id); return; }
      for (const factor of factors.data.all.filter(factor => factor.factor_type === 'totp' && factor.status === 'unverified')) {
        const removed = await supabase.auth.mfa.unenroll({ factorId: factor.id });
        if (removed.error) throw removed.error;
      }
      const result = await supabase.auth.mfa.enroll({ factorType: 'totp', issuer: 'Agro Inventory', friendlyName: 'Google Authenticator' });
      if (result.error) throw result.error;
      setFactorId(result.data.id); setQr(result.data.totp.qr_code); setSecret(result.data.totp.secret);
    } catch { setError('Unable to set up your authenticator. Please try again.'); }
    finally { actionLock.current = false; setBusy(false); }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (actionLock.current || !supabase) return;
    const form = event.currentTarget;
    const code = String(new FormData(form).get('code') ?? '').trim();
    if (!/^\d{6}$/.test(code)) { setError('Enter the six-digit code from your authenticator.'); return; }
    actionLock.current = true; setBusy(true); setError('');
    try {
      const result = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
      form.reset();
      if (result.error) { setError('Invalid or expired code. Enter the current code from your authenticator.'); return; }
      setQr(''); setSecret(''); onVerified();
    } catch { setError('Unable to verify your code. Please try again.'); }
    finally { actionLock.current = false; setBusy(false); }
  }
  return <AuthCard><ShieldCheck className="auth-shield" aria-hidden="true" />
    <h1>{qr || !factorId ? 'Set up two-step verification' : 'Verify your sign-in'}</h1>
    {loading ? <p role="status">Checking your authenticator…</p> : <>
      {!factorId && !error && <><p>Open Google Authenticator on your phone and link it to protect your inventory.</p>
        <button className="button" disabled={busy} onClick={() => void enroll()}>{busy ? 'Setting up…' : 'Link Google Authenticator'}</button></>}
      {qr && <><p>In Google Authenticator, tap + and scan this QR code.</p>
        <img className="auth-qr" src={qr} width={240} height={240} alt="QR code to link your account to your authenticator" />
        <details><summary>Enter the setup key manually</summary><code className="auth-secret">{secret}</code></details>
        <p>Do not share this QR code or setup key. Keep access to your authenticator for future sign-ins.</p></>}
      {factorId && <form onSubmit={verify}><fieldset disabled={busy}>
        <label className="field"><span>Google Authenticator code</span><input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required autoFocus /></label>
        <div className="form-actions"><button className="button">{busy ? 'Verifying…' : 'Verify and sign in'}</button></div>
      </fieldset></form>}
      {error && <p className="error" role="alert">{error}</p>}
      {error && !factorId && <button className="text-button" disabled={busy} onClick={() => setRetry(retry + 1)}>Try again</button>}
    </>}
    <p>If you have lost access to your authenticator, contact your administrator to recover your account.</p>
    <button className="text-button" disabled={busy} onClick={async () => {
      const result = await supabase!.auth.signOut();
      if (result.error) setError('Unable to sign out. Please try again.');
    }}>Sign out</button>
  </AuthCard>;
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [verifiedToken, setVerifiedToken] = useState('');
  const [checkedToken, setCheckedToken] = useState('');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!supabase) { setReady(true); return; }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession); setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);
  const token = session?.access_token ?? '';
  useEffect(() => {
    let cancelled = false;
    setError('');
    if (!supabase || !token) { setVerifiedToken(''); setCheckedToken(''); return; }
    supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(async ({ data, error }) => {
      if (cancelled) return;
      if (error) { setError('Unable to check your session security.'); return; }
      if (data.currentLevel === 'aal2') {
        const status = await supabase!.rpc('inventory_security_status');
        if (cancelled) return;
        if (status.error || status.data !== true) {
          setError('Database security setup is incomplete. Your administrator must apply the two-step verification migration.');
          return;
        }
      }
      setVerifiedToken(data.currentLevel === 'aal2' ? token : ''); setCheckedToken(token);
    }).catch(() => { if (!cancelled) setError('Unable to check your session.'); });
    return () => { cancelled = true; };
  }, [token, revision]);

  if (!supabase) return <AuthCard><h1>Account access is not configured</h1><p>Connect Supabase to enable sign-in and two-step verification. Contact your administrator.</p></AuthCard>;
  if (!ready) return <AuthCard><p role="status">Checking your session…</p></AuthCard>;
  if (!session) return <SignIn />;
  if (error) return <AuthCard><p role="alert">{error}</p><button className="button" onClick={() => setRevision(revision + 1)}>Try again</button></AuthCard>;
  if (checkedToken !== token) return <AuthCard><p role="status">Checking two-step verification…</p></AuthCard>;
  if (verifiedToken !== token) return <SecondFactor key={session.user.id} onVerified={() => setRevision(revision + 1)} />;
  return children;
}
