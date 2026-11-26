'use client';
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { displayDate } from './inventory';
import type { FarmAlert } from './farm-types';

export default function FarmAlertSummary({ companyId, open }: { companyId: string | null; open: () => void }) {
  const [alerts, setAlerts] = useState<FarmAlert[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!companyId || !supabase) return;
    setAlerts(null);
    Promise.resolve(supabase.rpc('farm_alerts', { p_company: companyId }).abortSignal(AbortSignal.timeout(15000))).then(result => {
      if (!cancelled && !result.error) setAlerts(result.data as FarmAlert[]);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [companyId]);
  if (!alerts) return null;
  return <section className="panel page-panel"><div className="panel-head"><div><h2>Farm reminders</h2><p>Maintenance, irrigation and expected harvest dates</p></div><button className="button secondary small" onClick={open}>Review reminders ({alerts.length})</button></div>
    {alerts.length ? <div className="alert-list">{alerts.slice(0, 5).map(alert => <div className="alert-row" key={`${alert.kind}-${alert.id}`}><div><strong>{alert.name}</strong><span>{alert.kind} · {displayDate(alert.due_on)}</span></div><span className={`tag ${alert.overdue ? 'peach' : 'amber'}`}>{alert.overdue ? 'Overdue' : 'Due soon'}</span></div>)}</div> : <p className="empty">No upcoming farm reminders within your alert window.</p>}
  </section>;
}
