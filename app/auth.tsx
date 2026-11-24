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
        setError(register ? 'No se pudo crear la cuenta. Revisa los datos o intenta iniciar sesión.' : 'No se pudo iniciar sesión. Revisa el correo, la contraseña y la confirmación de tu correo.');
      } else if (register && !response.data.session) {
        setMessage('Revisa tu correo y confirma la cuenta. Luego vuelve para iniciar sesión.');
      }
    } catch { setError('No se pudo conectar. Inténtalo de nuevo.'); }
    finally { setBusy(false); }
  }
  return <AuthCard><h1>{register ? 'Crea tu cuenta' : 'Inicia sesión'}</h1>
    <p>Ingresa con tu correo y contraseña. Después verificaremos tu código de Google Authenticator.</p>
    <form onSubmit={submit}><fieldset disabled={busy}>
      <label className="field"><span>Correo electrónico</span><input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
      <label className="field"><span>Contraseña</span><input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={register ? 12 : undefined} maxLength={128} /></label>
      {register && <p>Usa al menos 12 caracteres y una contraseña que no utilices en otros sitios.</p>}
      <div className="form-actions"><button className="button">{busy ? 'Espera…' : register ? 'Crear cuenta' : 'Entrar'}</button></div>
    </fieldset></form>
    {error && <p className="error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <button className="text-button" disabled={busy} onClick={() => { setRegister(!register); setError(''); setMessage(''); }}>{register ? 'Ya tengo cuenta' : 'Crear una cuenta'}</button>
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
      if (error) setError('No se pudieron consultar tus métodos de verificación.');
      else setFactorId(data.totp.find(factor => factor.status === 'verified')?.id ?? '');
      setLoading(false);
    }).catch(() => { if (!cancelled) { setError('No se pudo conectar.'); setLoading(false); } });
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
    } catch { setError('No se pudo preparar el autenticador. Inténtalo de nuevo.'); }
    finally { actionLock.current = false; setBusy(false); }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (actionLock.current || !supabase) return;
    const form = event.currentTarget;
    const code = String(new FormData(form).get('code') ?? '').trim();
    if (!/^\d{6}$/.test(code)) { setError('Introduce los seis dígitos del autenticador.'); return; }
    actionLock.current = true; setBusy(true); setError('');
    try {
      const result = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
      form.reset();
      if (result.error) { setError('Código incorrecto o vencido. Usa el código actual del autenticador.'); return; }
      setQr(''); setSecret(''); onVerified();
    } catch { setError('No se pudo verificar. Inténtalo de nuevo.'); }
    finally { actionLock.current = false; setBusy(false); }
  }
  return <AuthCard><ShieldCheck className="auth-shield" aria-hidden="true" />
    <h1>{qr || !factorId ? 'Activa la verificación en dos pasos' : 'Verifica tu acceso'}</h1>
    {loading ? <p role="status">Comprobando tu autenticador…</p> : <>
      {!factorId && !error && <><p>Abre Google Authenticator en tu teléfono. Vincúlalo para proteger tu inventario.</p>
        <button className="button" disabled={busy} onClick={() => void enroll()}>{busy ? 'Preparando…' : 'Vincular Google Authenticator'}</button></>}
      {qr && <><p>En Google Authenticator, pulsa + y escanea este QR.</p>
        <img className="auth-qr" src={qr} width={240} height={240} alt="QR para vincular tu cuenta con el autenticador" />
        <details><summary>Introducir la clave manualmente</summary><code className="auth-secret">{secret}</code></details>
        <p>No compartas este QR ni la clave. Conserva el acceso a tu autenticador para futuros inicios de sesión.</p></>}
      {factorId && <form onSubmit={verify}><fieldset disabled={busy}>
        <label className="field"><span>Código de Google Authenticator</span><input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required autoFocus /></label>
        <div className="form-actions"><button className="button">{busy ? 'Verificando…' : 'Verificar y entrar'}</button></div>
      </fieldset></form>}
      {error && <p className="error" role="alert">{error}</p>}
      {error && !factorId && <button className="text-button" disabled={busy} onClick={() => setRetry(retry + 1)}>Reintentar</button>}
    </>}
    <p>Si perdiste el autenticador, contacta al administrador para recuperar tu acceso.</p>
    <button className="text-button" disabled={busy} onClick={async () => {
      const result = await supabase!.auth.signOut();
      if (result.error) setError('No se pudo cerrar la sesión. Inténtalo de nuevo.');
    }}>Cerrar sesión</button>
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
      if (error) { setError('No se pudo comprobar la seguridad de tu sesión.'); return; }
      if (data.currentLevel === 'aal2') {
        const status = await supabase!.rpc('inventory_security_status');
        if (cancelled) return;
        if (status.error || status.data !== true) {
          setError('La protección de la base de datos no está lista. El administrador debe aplicar la migración de verificación en dos pasos.');
          return;
        }
      }
      setVerifiedToken(data.currentLevel === 'aal2' ? token : ''); setCheckedToken(token);
    }).catch(() => { if (!cancelled) setError('No se pudo comprobar tu sesión.'); });
    return () => { cancelled = true; };
  }, [token, revision]);

  if (!supabase) return <AuthCard><h1>Acceso pendiente de configuración</h1><p>Falta conectar Supabase para habilitar el inicio de sesión y la verificación en dos pasos. Contacta al administrador.</p></AuthCard>;
  if (!ready) return <AuthCard><p role="status">Comprobando sesión…</p></AuthCard>;
  if (!session) return <SignIn />;
  if (error) return <AuthCard><p role="alert">{error}</p><button className="button" onClick={() => setRevision(revision + 1)}>Reintentar</button></AuthCard>;
  if (checkedToken !== token) return <AuthCard><p role="status">Comprobando verificación en dos pasos…</p></AuthCard>;
  if (verifiedToken !== token) return <SecondFactor key={session.user.id} onVerified={() => setRevision(revision + 1)} />;
  return children;
}
