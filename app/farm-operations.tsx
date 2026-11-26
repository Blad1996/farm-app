'use client';

import { useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react';
import { Plus, RefreshCw, X } from 'lucide-react';
import type { Inventory } from './inventory';
import { displayDate, number } from './inventory';
import { supabase } from './supabase';
import FarmEmailSettings from './farm-email-settings';
import { addFarmDays, amountByCurrency, farmCurrencies, farmMoney, farmToday, type FarmSnapshot, type FarmView } from './farm-types';

type RecordData = Record<string, string | number | boolean | null>;
type FormState = { kind: string; requestId: string; data: RecordData; existing: boolean };
const titles: Record<string, string> = { crop: 'Crop', irrigation: 'Irrigation', seed: 'Seed distribution', expense: 'Expense', asset: 'Vehicle or machine', maintenance: 'Maintenance service' };
const label = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase());
const options = (values: string[]) => values.map(value => [value, label(value)] as [string, string]);

function GridTable({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return <section className="panel page-panel"><div className="table-wrap"><table><thead><tr>{headers.map(header => <th key={header}>{header}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}</tbody></table></div>{!rows.length && <p className="empty">No records match.</p>}</section>;
}
function FarmDialog({ title, close, busy, children }: { title: string; close: () => void; busy: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = ref.current; node?.showModal(); return () => node?.close(); }, []);
  return <dialog className="purchase-dialog" ref={ref} aria-labelledby="farm-dialog-title" onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <div className="dialog-head"><h2 id="farm-dialog-title">{title}</h2><button type="button" className="icon-button" disabled={busy} onClick={close} aria-label="Close dialog"><X size={20} /></button></div>{children}
  </dialog>;
}

export default function FarmOperations({ companyId, inventory, view, query, refreshInventory }: { companyId: string | null; inventory: Inventory; view: FarmView; query: string; refreshInventory: () => Promise<void> }) {
  const [data, setData] = useState<FarmSnapshot | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [notice, setNotice] = useState(''), [revision, setRevision] = useState(0), [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false), [formError, setFormError] = useState('');
  const [cropFilter, setCropFilter] = useState(''), [assetFilter, setAssetFilter] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState('');
  const lock = useRef(false);
  async function load() {
    if (!supabase || !companyId) throw new Error('Open a connected workspace first.');
    const response = await supabase.rpc('farm_snapshot', { p_company: companyId }).abortSignal(AbortSignal.timeout(20000));
    if (response.error) throw new Error(['PGRST202', '42883'].includes(response.error.code) ? 'Farm modules are not configured yet. Contact your administrator to enable them.' : 'Unable to load farm operations. Please try again.');
    return response.data as FarmSnapshot;
  }
  useEffect(() => {
    let stopped = false; setLoading(true); setError('');
    load().then(value => { if (!stopped) setData(value); }).catch(failure => { if (!stopped) setError(failure.message); }).finally(() => { if (!stopped) setLoading(false); });
    return () => { stopped = true; };
    // Reload only when the workspace or explicit refresh changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, revision]);

  function open(kind: string, existing?: object) {
    const today = farmToday(data?.settings?.timezone);
    const defaults: Record<string, RecordData> = {
      crop: { name: '', crop_type: 'Corn', variety: '', field_name: '', area: 1, area_unit: 'ha', planted_on: '', expected_harvest_on: '', status: 'planned', notes: '' },
      irrigation: { crop_id: '', occurred_on: today, method: 'drip', volume_litres: 0, duration_minutes: 30, status: 'planned', amount_paid: 0, currency: 'CAD', notes: '' },
      seed: { crop_id: '', product_id: '', warehouse_id: '', lot_code: '', occurred_on: today, recipient: '', quantity: 1, amount_paid: 0, currency: 'CAD' },
      expense: { crop_id: '', asset_id: '', category: 'other', description: '', paid_on: today, amount: '', currency: 'CAD' },
      asset: { name: '', category: 'vehicle', asset_type: 'truck', registration: '', make_model: '', purchased_on: '', purchase_paid: 0, currency: 'CAD', status: 'active', maintenance_interval_days: 90, next_maintenance_on: addFarmDays(today, 90), notes: '' },
      maintenance: { asset_id: '', serviced_on: today, next_due_on: addFarmDays(today, 90), description: '', provider: '', amount_paid: 0, currency: 'CAD' },
    };
    setForm({ kind, requestId: crypto.randomUUID(), existing: Boolean(existing), data: { ...defaults[kind], ...existing, id: (existing as { id?: string })?.id || crypto.randomUUID() } as RecordData }); setFormError('');
  }
  function maintenance(assetId: string) {
    const asset = data!.assets.find(item => item.id === assetId)!;
    const today = farmToday(data?.settings?.timezone);
    open('maintenance');
    setForm(current => current && ({ ...current, data: { ...current.data, asset_id: assetId, currency: asset.currency, next_due_on: addFarmDays(today, asset.maintenance_interval_days) } }));
  }
  function change(key: string, value: string) {
    setForm(current => {
      if (!current) return current;
      const next = { ...current.data, [key]: value };
      if (current.kind === 'seed' && ['product_id', 'warehouse_id'].includes(key)) next.lot_code = '';
      if (current.kind === 'irrigation' && key === 'status' && value !== 'completed') next.amount_paid = 0;
      if (current.kind === 'maintenance' && ['asset_id', 'serviced_on'].includes(key)) {
        const asset = data?.assets.find(item => item.id === next.asset_id);
        if (asset && next.serviced_on) { next.next_due_on = addFarmDays(String(next.serviced_on), asset.maintenance_interval_days); next.currency = asset.currency; }
      }
      return { ...current, data: next };
    });
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!form || !supabase || !companyId || lock.current) return;
    lock.current = true; setBusy(true); setFormError('');
    try {
      const response = await supabase.rpc('save_farm_record', { p_company: companyId, p_request: form.requestId, p_kind: form.kind, p_record: form.data });
      if (response.error) throw new Error(response.error.message);
    } catch (failure) { setFormError(failure instanceof Error ? failure.message : 'Unable to save.'); lock.current = false; setBusy(false); return; }
    setForm(null); setNotice('Saved successfully.');
    const refreshed = await Promise.allSettled([load(), refreshInventory()]);
    if (refreshed[0].status === 'fulfilled') setData(refreshed[0].value);
    if (refreshed.some(result => result.status === 'rejected')) setNotice('Saved. Reload the page to refresh all balances.');
    lock.current = false; setBusy(false);
  }
  if (loading) return <section className="panel"><p className="empty" role="status">Loading farm operations…</p></section>;
  if (error || !data) return <section className="panel purchase-empty"><p role="alert">{error || 'Unable to load farm operations.'}</p><button className="button secondary" onClick={() => setRevision(revision + 1)}>Try again</button></section>;
  const cropName = (id: string | null) => data.crops.find(item => item.id === id)?.name || '—';
  const assetName = (id: string | null) => data.assets.find(item => item.id === id)?.name || '—';
  const matches = (...parts: unknown[]) => parts.join(' ').toLowerCase().includes(query.trim().toLowerCase());
  const dateMatch = (value: string) => (!from || value >= from) && (!to || value <= to);
  const costs = (crop: string) => amountByCurrency(data.expenses.filter(item => item.crop_id === crop).map(item => ({ amount: item.amount, currency: item.currency }))).map(item => farmMoney(item.amount, item.currency)).join(' · ') || '—';
  const kind = ({ crops: 'crop', irrigation: 'irrigation', seeds: 'seed', expenses: 'expense', assets: 'asset', notifications: '' })[view];
  const input = (title: string, key: string, type = 'text', required = true, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => <label className="field"><span>{title}</span><input type={type} required={required} value={String(form?.data[key] ?? '')} onChange={event => change(key, event.target.value)} {...extra} /></label>;
  const select = (title: string, key: string, entries: [string, string][], required = true, disabled = false) => <label className="field"><span>{title}</span><select required={required} disabled={disabled} value={String(form?.data[key] ?? '')} onChange={event => change(key, event.target.value)}><option value="">{required ? `Select ${title.toLowerCase()}` : 'None'}</option>{entries.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>;
  const currency = () => select('Currency', 'currency', farmCurrencies.map(value => [value, value]), true, form?.kind === 'asset' && form.existing);
  const paid = (key = 'amount_paid') => <div className="form-grid">{input('Amount paid', key, 'number', true, { min: 0, max: 999999999, step: '0.01', readOnly: form?.kind === 'asset' && form.existing })}{currency()}</div>;
  const cropSelect = () => select('Crop', 'crop_id', data.crops.map(item => [item.id, `${item.name} · ${item.field_name}`]));
  const notes = () => <label className="field"><span>Notes (optional)</span><textarea maxLength={1000} rows={3} value={String(form?.data.notes ?? '')} onChange={event => change('notes', event.target.value)} /></label>;
  const seedProduct = inventory.products.find(item => item.id === form?.data.product_id);
  const availableLots = inventory.stock.filter(item => item.warehouse_id === form?.data.warehouse_id && item.quantity > 0).flatMap(row => {
    const lot = inventory.lots.find(item => item.id === row.lot_id && item.product_id === form?.data.product_id);
    return lot ? [{ ...lot, available: row.quantity }] : [];
  });
  const filteredExpenses = data.expenses.filter(item => (!cropFilter || item.crop_id === cropFilter) && (!assetFilter || item.asset_id === assetFilter) && dateMatch(item.paid_on) && matches(item.description, item.category, cropName(item.crop_id), assetName(item.asset_id)));
  const filteredAlerts = data.alerts.filter(item => matches(item.kind, item.name));
  return <>
    <div className="purchase-toolbar"><p>Records and amounts paid are saved in your company workspace.</p><div className="actions"><button className="button secondary" disabled={busy} onClick={() => setRevision(revision + 1)}><RefreshCw size={16} />Refresh</button>
      {data.can_manage && kind && <button className="button" disabled={busy} onClick={() => open(kind)}><Plus size={17} />Add {titles[kind].toLowerCase()}</button>}</div></div>
    {notice && <p className="notice" role="status">{notice}</p>}
    {view === 'crops' && <GridTable headers={['Crop / variety', 'Field', 'Area', 'Planted', 'Expected harvest', 'Status', 'Amount paid', 'Actions']} rows={data.crops.filter(item => matches(item.name, item.crop_type, item.variety, item.field_name)).map(item => [
      <><strong>{item.name}</strong><br />{item.crop_type}{item.variety ? ` · ${item.variety}` : ''}</>, item.field_name, `${number.format(item.area)} ${item.area_unit}`, item.planted_on ? displayDate(item.planted_on) : '—', item.expected_harvest_on ? displayDate(item.expected_harvest_on) : '—', label(item.status), costs(item.id),
      data.can_manage ? <button className="button secondary small" onClick={() => open('crop', item)}>Edit</button> : '—',
    ])} />}
    {view === 'irrigation' && <><p>Plan irrigation, then edit the planned record to mark it completed and record the amount actually paid.</p>
      <GridTable headers={['Crop', 'Date', 'Method', 'Water (L)', 'Minutes', 'Status', 'Amount paid', 'Actions']} rows={data.irrigation.filter(item => matches(cropName(item.crop_id), item.method, item.status, item.notes)).map(item => [cropName(item.crop_id), displayDate(item.occurred_on), label(item.method), number.format(item.volume_litres), item.duration_minutes, label(item.status), farmMoney(item.amount_paid, item.currency),
        data.can_manage && item.status === 'planned' ? <button className="button secondary small" onClick={() => open('irrigation', item)}>Edit / complete</button> : '—'])} /></>}
    {view === 'seeds' && <><p>Each distribution issues stock from the selected warehouse and lot. Expired or insufficient stock is blocked.</p>
      <GridTable headers={['Date', 'Crop', 'Product', 'Lot', 'Warehouse', 'Quantity', 'Recipient', 'Amount paid']} rows={data.seeds.filter(item => matches(cropName(item.crop_id), inventory.products.find(p => p.id === item.product_id)?.name, item.recipient, item.lot_code)).map(item => [displayDate(item.occurred_on), cropName(item.crop_id), inventory.products.find(p => p.id === item.product_id)?.name || '—', item.lot_code, inventory.warehouses.find(w => w.id === item.warehouse_id)?.name || '—', `${number.format(item.quantity)} ${inventory.products.find(p => p.id === item.product_id)?.unit || ''}`, item.recipient || '—', farmMoney(item.amount_paid, item.currency)])} /></>}
    {view === 'expenses' && <><div className="farm-filters"><label className="field"><span>Crop</span><select value={cropFilter} onChange={event => setCropFilter(event.target.value)}><option value="">All crops</option>{data.crops.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="field"><span>Vehicle / machinery</span><select value={assetFilter} onChange={event => setAssetFilter(event.target.value)}><option value="">All assets</option>{data.assets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="field"><span>From</span><input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label><label className="field"><span>To</span><input type="date" value={to} onChange={event => setTo(event.target.value)} /></label></div>
      <div className="farm-totals">{amountByCurrency(filteredExpenses.map(item => ({ amount: item.amount, currency: item.currency }))).map(item => <div className="panel" key={item.currency}><span>Total paid · {item.currency}</span><strong>{farmMoney(item.amount, item.currency)}</strong></div>)}</div>
      <p>Seed, irrigation, purchase and maintenance payments appear here automatically. Add other payments separately; do not enter them twice. Currencies are never combined.</p>
      <GridTable headers={['Paid on', 'Category', 'Description', 'Crop', 'Asset', 'Amount paid', 'Source']} rows={filteredExpenses.map(item => [displayDate(item.paid_on), label(item.category), item.description, cropName(item.crop_id), assetName(item.asset_id), farmMoney(item.amount, item.currency), label(item.source_type)])} /></>}
    {view === 'assets' && <><div className="farm-totals"><div className="panel"><span>Vehicles (not retired)</span><strong>{data.assets.filter(item => item.category === 'vehicle' && item.status !== 'retired').length}</strong></div><div className="panel"><span>Machinery (not retired)</span><strong>{data.assets.filter(item => item.category === 'machinery' && item.status !== 'retired').length}</strong></div><div className="panel"><span>Maintenance alerts</span><strong>{data.alerts.filter(item => item.kind === 'maintenance').length}</strong></div></div>
      <GridTable headers={['Asset', 'Category / type', 'Registration / serial', 'Status', 'Next maintenance', 'Alert', 'Actions']} rows={data.assets.filter(item => matches(item.name, item.registration, item.make_model, item.category, item.asset_type)).map(item => { const alert = data.alerts.find(a => a.kind === 'maintenance' && a.id === item.id); return [<><strong>{item.name}</strong><br />{item.make_model}</>, `${label(item.category)} · ${label(item.asset_type)}`, item.registration || '—', label(item.status), displayDate(item.next_maintenance_on), alert ? <span className={`tag ${alert.overdue ? 'peach' : 'amber'}`}>{alert.overdue ? 'Overdue' : 'Due soon'}</span> : item.status === 'retired' ? '—' : 'Scheduled', data.can_manage ? <div className="actions"><button className="button secondary small" onClick={() => open('asset', item)}>Edit</button><button className="button secondary small" onClick={() => maintenance(item.id)}>Log maintenance</button></div> : '—']; })} />
      <h2>Maintenance history</h2><GridTable headers={['Asset', 'Serviced', 'Work performed', 'Provider', 'Amount paid', 'Next due']} rows={data.maintenance.filter(item => matches(assetName(item.asset_id), item.description, item.provider)).map(item => [assetName(item.asset_id), displayDate(item.serviced_on), item.description, item.provider || '—', farmMoney(item.amount_paid, item.currency), displayDate(item.next_due_on)])} /></>}
    {view === 'notifications' && <><h2>Farm alerts</h2><GridTable headers={['Type', 'Crop / asset', 'Due date', 'Status']} rows={filteredAlerts.map(item => [label(item.kind), item.name, displayDate(item.due_on), <span className={`tag ${item.overdue ? 'peach' : 'amber'}`}>{item.overdue ? 'Overdue' : 'Due soon'}</span>])} />
      <FarmEmailSettings companyId={companyId!} snapshot={data} refreshed={async () => setData(await load())} />
    </>}
    {form && <FarmDialog title={`${form.existing ? 'Edit' : 'Add'} ${titles[form.kind].toLowerCase()}`} busy={busy} close={() => { if (!lock.current) setForm(null); }}>
      <form onSubmit={save}><fieldset disabled={busy}>
        {form.kind === 'crop' && <>{input('Crop name', 'name', 'text', true, { maxLength: 100 })}{select('Crop type', 'crop_type', [...new Set(['Corn', 'Wheat', 'Rice', 'Soybean', 'Vegetables', 'Fruit', 'Other', ...data.crops.map(item => item.crop_type)])].map(value => [value, value]))}{input('Variety', 'variety', 'text', false, { maxLength: 100 })}{input('Field / plot name', 'field_name', 'text', true, { maxLength: 100 })}<div className="form-grid">{input('Area', 'area', 'number', true, { min: 0.001, max: 999999999, step: '0.001' })}{select('Area unit', 'area_unit', [['ha', 'Hectares'], ['acre', 'Acres'], ['m2', 'Square metres']])}</div><div className="form-grid">{input('Planting date', 'planted_on', 'date', false)}{input('Expected harvest', 'expected_harvest_on', 'date', false)}</div>{select('Status', 'status', options(['planned', 'growing', 'harvested', 'cancelled']))}{notes()}</>}
        {form.kind === 'irrigation' && <>{cropSelect()}{input('Date', 'occurred_on', 'date')}{select('Method', 'method', options(['drip', 'sprinkler', 'surface', 'manual', 'other']))}<div className="form-grid">{input('Water volume (litres)', 'volume_litres', 'number', true, { min: 0, max: 999999999, step: '0.001' })}{input('Duration (minutes)', 'duration_minutes', 'number', true, { min: 1, max: 10080, step: 1 })}</div>{select('Status', 'status', options(['planned', 'completed', 'cancelled']))}{form.data.status === 'completed' ? paid() : <p>Record the actual payment when marking irrigation completed.</p>}{notes()}</>}
        {form.kind === 'seed' && <>{cropSelect()}{select('Seed product', 'product_id', inventory.products.map(item => [item.id, `${item.name} · ${item.unit}`]))}{select('Warehouse', 'warehouse_id', inventory.warehouses.map(item => [item.id, item.name]))}{select('Lot', 'lot_code', availableLots.map(item => [item.code, `${item.code} · ${number.format(item.available)} ${seedProduct?.unit || ''} available${item.expires_on ? ` · expires ${item.expires_on}` : ''}`]), true, !form.data.product_id || !form.data.warehouse_id)}{input(`Quantity (${seedProduct?.unit || 'product unit'})`, 'quantity', 'number', true, { min: 0.001, max: 999999999, step: '0.001' })}{input('Distribution date', 'occurred_on', 'date')}{input('Recipient / team', 'recipient', 'text', false, { maxLength: 100 })}{paid()}<p>Enter only money actually paid for this distribution. Stock is deducted when you save.</p></>}
        {form.kind === 'expense' && <>{select('Category', 'category', options(['seeds', 'irrigation', 'equipment', 'maintenance', 'fuel', 'labor', 'other']))}{input('Description', 'description', 'text', true, { maxLength: 300 })}{input('Payment date', 'paid_on', 'date')}{paid('amount')}{select('Crop', 'crop_id', data.crops.map(item => [item.id, item.name]), false)}{select('Asset', 'asset_id', data.assets.map(item => [item.id, item.name]), false)}</>}
        {form.kind === 'asset' && <>{input('Asset name', 'name', 'text', true, { maxLength: 100 })}<div className="form-grid">{select('Category', 'category', options(['vehicle', 'machinery']))}{select('Type', 'asset_type', options(['truck', 'pickup', 'tractor', 'harvester', 'pump', 'trailer', 'other']))}</div>{input('Registration / serial number', 'registration', 'text', false, { maxLength: 60 })}{input('Make / model', 'make_model', 'text', false, { maxLength: 100 })}{input('Purchase date', 'purchased_on', 'date', Number(form.data.purchase_paid) > 0, { readOnly: form.existing })}{paid('purchase_paid')}{select('Status', 'status', options(['active', 'in_maintenance', 'retired']))}<div className="form-grid">{input('Maintenance interval (days)', 'maintenance_interval_days', 'number', true, { min: 1, max: 3650, step: 1 })}{input('Next maintenance date', 'next_maintenance_on', 'date')}</div>{notes()}</>}
        {form.kind === 'maintenance' && <>{select('Asset', 'asset_id', data.assets.map(item => [item.id, item.name]))}<div className="form-grid">{input('Service date', 'serviced_on', 'date')}{input('Next maintenance date', 'next_due_on', 'date')}</div>{input('Work performed', 'description', 'text', true, { maxLength: 300 })}{input('Service provider', 'provider', 'text', false, { maxLength: 100 })}{paid()}<p>The latest service advances the asset maintenance schedule. Historical services do not replace a newer schedule.</p></>}
      </fieldset>{formError && <p className="error" role="alert">{formError}</p>}<div className="form-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => setForm(null)}>Cancel</button><button className="button" disabled={busy} aria-busy={busy}>{busy ? 'Saving…' : 'Save record'}</button></div></form>
    </FarmDialog>}
  </>;
}
