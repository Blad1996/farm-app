'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { FarmSnapshot, NotificationSettings } from './farm-types';
import { supabase } from './supabase';
import GmailConnection, { type EmailSetupStatus } from './gmail-connection';

const timezones = ['America/Caracas', 'America/Toronto', 'America/New_York', 'America/Bogota', 'America/Mexico_City', 'America/Sao_Paulo', 'Europe/Madrid', 'UTC'];
export default function FarmEmailSettings({ companyId, snapshot, refreshed }: { companyId: string; snapshot: FarmSnapshot; refreshed: () => Promise<void> }) {
  const [settings, setSettings] = useState<NotificationSettings>(snapshot.settings || { enabled: false, recipients: [], lead_days: 7, timezone: 'America/Caracas', maintenance: true, irrigation: true, harvest: false });
  const [setup, setSetup] = useState<EmailSetupStatus | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => {
    if (snapshot.settings) setSettings({ ...snapshot.settings, enabled: snapshot.settings.recipient_user_id === setup?.userId && snapshot.settings.enabled });
  }, [snapshot.settings, setup?.userId]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy || !supabase) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await supabase.rpc('save_farm_notification_preferences', { p_company: companyId, p_settings: {
        enabled: settings.enabled, lead_days: settings.lead_days, timezone: settings.timezone, maintenance: settings.maintenance, irrigation: settings.irrigation, harvest: settings.harvest,
      } });
      if (result.error) throw new Error(result.error.message);
      setNotice(settings.enabled ? 'Preferences saved. Reminders are addressed only to your verified email. Automatic delivery requires the deployed scheduler.' : 'Preferences saved. Email sending is disabled; in-app alerts remain available.');
      await refreshed();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to save preferences.'); }
    finally { setBusy(false); }
  }
  return <section className="panel farm-notification-settings"><h2>Notification preferences</h2>
    <p>Messages contain crop or asset name, reminder type and due date/status. Payment amounts, stock balances and credentials are excluded.</p>
    {snapshot.can_manage && <GmailConnection companyId={companyId} account={snapshot.email_account} refreshed={refreshed} onSetup={setSetup} />}
    <form onSubmit={save}><fieldset disabled={busy || !snapshot.can_manage || !setup?.schemaReady}>
      <label className="field"><span>{snapshot.can_manage ? 'Your notification email' : 'Workspace notification email'}</span><input type="email" value={snapshot.can_manage ? setup?.recipient || '' : snapshot.settings?.recipients?.[0] || ''} readOnly placeholder="Checking your verified email…" /></label>
      {snapshot.settings?.recipient_user_id && setup && snapshot.settings.recipient_user_id !== setup.userId && <p className="notice">Saving will replace this workspace&apos;s previous notification recipient with your own verified account.</p>}
      <p>This address comes from your verified account and cannot be edited here. One active recipient is configured per workspace; saving uses your own account.</p>
      <label className="farm-enable"><input type="checkbox" checked={settings.enabled} disabled={!snapshot.email_account} onChange={event => setSettings({ ...settings, enabled: event.target.checked })} />Email reminders to my verified account</label>
      <div className="form-grid"><label className="field"><span>Alert lead time (days)</span><input type="number" min={1} max={90} required value={settings.lead_days} onChange={event => setSettings({ ...settings, lead_days: Number(event.target.value) })} /></label>
        <label className="field"><span>Farm time zone</span><select value={settings.timezone} onChange={event => setSettings({ ...settings, timezone: event.target.value })}>{Array.from(new Set([...timezones, settings.timezone])).map(value => <option key={value}>{value}</option>)}</select></label></div>
      <p>Email topics (in-app reminders remain visible):</p><div className="farm-checkboxes">{(['maintenance', 'irrigation', 'harvest'] as const).map(key => <label key={key}><input type="checkbox" checked={settings[key]} onChange={event => setSettings({ ...settings, [key]: event.target.checked })} />{key === 'maintenance' ? 'Vehicle and machinery maintenance' : key === 'irrigation' ? 'Planned irrigation' : 'Expected harvest'}</label>)}</div>
      {snapshot.can_manage && <button className="button" disabled={busy || !setup?.schemaReady} aria-busy={busy}>{busy ? 'Saving…' : 'Save notification preferences'}</button>}
    </fieldset></form>{error && <p className="error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!snapshot.can_manage && <p>Only a workspace administrator can change notification preferences.</p>}
    <h3>Daily delivery history</h3><div className="table-wrap"><table><thead><tr><th>Date</th><th>Result</th><th>Attempts</th></tr></thead><tbody>{snapshot.deliveries.map(item => <tr key={item.delivery_date}><td>{item.delivery_date}</td><td>{item.state === 'sent' ? 'Accepted by Gmail' : item.state === 'uncertain' ? 'Needs review — check inbox' : item.state}</td><td>{item.attempts}</td></tr>)}</tbody></table>{!snapshot.deliveries.length && <p>No scheduled deliveries recorded.</p>}</div>
  </section>;
}
