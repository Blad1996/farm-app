'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { FarmSnapshot, NotificationSettings } from './farm-types';
import { supabase } from './supabase';

const timezones = ['America/Caracas', 'America/Toronto', 'America/New_York', 'America/Bogota', 'America/Mexico_City', 'America/Sao_Paulo', 'Europe/Madrid', 'UTC'];
export default function FarmEmailSettings({ companyId, snapshot, refreshed }: { companyId: string; snapshot: FarmSnapshot; refreshed: () => Promise<void> }) {
  const [settings, setSettings] = useState<NotificationSettings>(snapshot.settings || { enabled: false, recipients: [], lead_days: 7, timezone: 'America/Caracas', maintenance: true, irrigation: true, harvest: false });
  const [recipients, setRecipients] = useState((snapshot.settings?.recipients || []).join(', '));
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const request = useRef(crypto.randomUUID());
  useEffect(() => {
    if (snapshot.settings) { setSettings(snapshot.settings); setRecipients(snapshot.settings.recipients.join(', ')); }
  }, [snapshot.settings]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy || !supabase) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await supabase.rpc('save_farm_record', { p_company: companyId, p_request: request.current, p_kind: 'notifications',
        p_record: { id: companyId, ...settings, enabled: false, recipients: recipients.split(',').map(value => value.trim()).filter(Boolean) } });
      if (result.error) throw new Error(result.error.message);
      request.current = crypto.randomUUID(); setNotice('Alert preferences saved. Email sending remains disabled.');
      await refreshed();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to save preferences.'); request.current = crypto.randomUUID(); }
    finally { setBusy(false); }
  }
  return <section className="panel farm-notification-settings"><h2>Notification preferences</h2>
    <p className="notice">In-app alerts are available. Gmail connection and automatic email delivery are pending setup; no email is sent from this screen.</p>
    <p>Planned email content: crop or asset name, reminder type and due date. Payment amounts and credentials are excluded.</p>
    <form onSubmit={save}><fieldset disabled={busy || !snapshot.can_manage}>
      <label className="field"><span>Future email recipients (up to 10)</span><input type="email" multiple value={recipients} onChange={event => setRecipients(event.target.value)} placeholder="manager@example.com, team@example.com" /></label>
      <div className="form-grid"><label className="field"><span>Alert lead time (days)</span><input type="number" min={1} max={90} required value={settings.lead_days} onChange={event => setSettings({ ...settings, lead_days: Number(event.target.value) })} /></label>
        <label className="field"><span>Farm time zone</span><select value={settings.timezone} onChange={event => setSettings({ ...settings, timezone: event.target.value })}>{Array.from(new Set([...timezones, settings.timezone])).map(value => <option key={value}>{value}</option>)}</select></label></div>
      <p>Future email topics (in-app reminders remain visible):</p><div className="farm-checkboxes">{(['maintenance', 'irrigation', 'harvest'] as const).map(key => <label key={key}><input type="checkbox" checked={settings[key]} onChange={event => setSettings({ ...settings, [key]: event.target.checked })} />{key === 'maintenance' ? 'Vehicle and machinery maintenance' : key === 'irrigation' ? 'Planned irrigation' : 'Expected harvest'}</label>)}</div>
      {snapshot.can_manage && <button className="button" disabled={busy} aria-busy={busy}>{busy ? 'Saving…' : 'Save alert preferences'}</button>}
    </fieldset></form>{error && <p className="error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!snapshot.can_manage && <p>Only a workspace administrator can change notification preferences.</p>}
  </section>;
}
