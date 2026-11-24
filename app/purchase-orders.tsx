'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Plus, RefreshCw, X } from 'lucide-react';
import type { Inventory } from './inventory';
import { displayDate, number } from './inventory';
import { supabase } from './supabase';

type Status = 'draft' | 'ordered' | 'partially_received' | 'received' | 'cancelled';
type Line = { id: string; product_id: string; quantity: number; received_quantity: number; unit_price: number };
type Receipt = { id: string; line_id: string; movement_id: string; quantity: number; created_at: string; lot_code: string; expires_on: string | null; reference: string };
type Order = { id: string; order_number: number; supplier_id: string; warehouse_id: string; status: Status; currency: string;
  expected_on: string | null; notes: string; cancellation_reason: string; created_at: string; total: number; lines: Line[]; receipts: Receipt[] };
type Snapshot = { orders: Order[]; can_manage: boolean };
type DraftLine = { key: string; product_id: string; quantity: string; unit_price: string };
type Action = { kind: 'confirm' | 'cancel'; order: Order } | { kind: 'receive'; order: Order; line: Line; requestId: string };
const labels: Record<Status, string> = { draft: 'Draft', ordered: 'Ordered', partially_received: 'Partially received', received: 'Received', cancelled: 'Cancelled' };
const currencies = ['CAD', 'USD', 'EUR', 'GBP', 'MXN', 'BRL', 'COP', 'VES'];
const orderNumber = (order: Order) => `PO-${String(order.order_number).padStart(6, '0')}`;
const money = (amount: number, currency: string) => new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(amount);
const formText = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const newLine = (): DraftLine => ({ key: crypto.randomUUID(), product_id: '', quantity: '1', unit_price: '0.00' });

function apiError(error: { code?: string; message?: string }) {
  if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(error.code ?? '')) {
    return new Error('Purchase orders are not configured yet. Contact your administrator to enable this module.');
  }
  return new Error(error.message || 'Unable to save. Please try again.');
}

function PurchaseDialog({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog className="purchase-dialog" ref={ref} aria-labelledby="purchase-dialog-title" onCancel={event => { event.preventDefault(); close(); }}>
    <div className="dialog-head"><h2 id="purchase-dialog-title">{title}</h2><button type="button" className="icon-button" onClick={close} aria-label="Close dialog"><X size={21} /></button></div>{children}
  </dialog>;
}

export default function PurchaseOrders({ companyId, inventory, query, refreshInventory }: {
  companyId: string | null; inventory: Inventory; query: string; refreshInventory: () => Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>({ orders: [], can_manage: false });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const [createId, setCreateId] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [currency, setCurrency] = useState('CAD');
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const pending = useRef(false);

  async function fetchOrders() {
    if (!supabase || !companyId) throw new Error('Open a connected workspace first.');
    const result = await supabase.rpc('purchase_orders_snapshot', { p_company: companyId });
    if (result.error) throw apiError(result.error);
    return result.data as Snapshot;
  }
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setLoadError('');
    fetchOrders().then(data => { if (!cancelled) setSnapshot(data); })
      .catch(error => { if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Unable to load purchase orders.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // companyId and revision are the only inputs to the query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, revision]);

  const supplierName = (id: string) => inventory.suppliers.find(item => item.id === id)?.company_name || inventory.suppliers.find(item => item.id === id)?.name || 'Unknown supplier';
  const warehouseName = (id: string) => inventory.warehouses.find(item => item.id === id)?.name || 'Unknown warehouse';
  const product = (id: string) => inventory.products.find(item => item.id === id);
  const selected = snapshot.orders.find(order => order.id === selectedId);
  const filtered = snapshot.orders.filter(order => (statusFilter === 'all' || order.status === statusFilter) &&
    [orderNumber(order), supplierName(order.supplier_id), warehouseName(order.warehouse_id), labels[order.status], order.notes,
      ...order.lines.map(line => product(line.product_id)?.name || '')].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  const draftTotal = lines.reduce((sum, line) => sum + Math.round((Number(line.quantity) * Number(line.unit_price) + Number.EPSILON) * 100), 0) / 100;
  const openOrders = snapshot.orders.filter(order => order.status === 'ordered' || order.status === 'partially_received');

  function beginCreate() {
    setCreateId(crypto.randomUUID()); setLines([newLine()]); setCurrency('CAD'); setFormError(''); setNotice('');
  }
  function closeModal() { if (!pending.current) { setCreateId(''); setAction(null); setFormError(''); } }
  function editLine(key: string, field: keyof Omit<DraftLine, 'key'>, value: string) {
    setLines(current => current.map(line => line.key === key ? { ...line, [field]: value } : line));
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || !supabase || !companyId) return;
    pending.current = true; setBusy(true); setFormError(''); setNotice('');
    const form = new FormData(event.currentTarget);
    let savedOrderId = '';
    try {
      if (createId) {
        const result = await supabase.rpc('create_purchase_order', { p_company: companyId, p_order: {
          id: createId, supplier_id: formText(form, 'supplier'), warehouse_id: formText(form, 'warehouse'), currency,
          expected_on: formText(form, 'expected_on') || null, notes: formText(form, 'notes'),
          lines: lines.map(line => ({ product_id: line.product_id, quantity: Number(line.quantity), unit_price: Number(line.unit_price) })),
        } });
        if (result.error) throw apiError(result.error);
        savedOrderId = result.data as string;
      } else if (action?.kind === 'receive') {
        const result = await supabase.rpc('receive_purchase_order', { p_company: companyId, p_order: action.order.id, p_receipt: {
          id: action.requestId, line_id: action.line.id, quantity: Number(formText(form, 'quantity')),
          lot_code: formText(form, 'lot_code').toUpperCase(), expires_on: formText(form, 'expires_on') || null, reference: formText(form, 'reference'),
        } });
        if (result.error) throw apiError(result.error);
      } else if (action) {
        const result = await supabase.rpc('change_purchase_order_status', { p_company: companyId, p_order: action.order.id, p_action: action.kind, p_reason: formText(form, 'reason') });
        if (result.error) throw apiError(result.error);
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to save. Please try again.');
      pending.current = false; setBusy(false); return;
    }
    // Close after a successful mutation even if refreshing fails, so the user
    // never mistakes a refresh failure for an unsaved order or receipt.
    setCreateId(''); setAction(null);
    if (savedOrderId) setSelectedId(savedOrderId);
    setNotice('Saved successfully.');
    const refreshed = await Promise.allSettled([fetchOrders(), refreshInventory()]);
    if (refreshed[0].status === 'fulfilled') setSnapshot(refreshed[0].value);
    if (refreshed.some(result => result.status === 'rejected')) setNotice('Saved successfully. Refresh the page to reload the latest order and stock balances.');
    pending.current = false; setBusy(false);
  }

  if (loading) return <section className="panel"><p className="empty" role="status">Loading purchase orders…</p></section>;
  if (loadError) return <section className="panel purchase-empty"><h2>Purchase orders unavailable</h2><p role="alert">{loadError}</p><button className="button secondary" onClick={() => setRevision(revision + 1)}>Try again</button></section>;
  const canCreate = Boolean(inventory.products.length && inventory.suppliers.length && inventory.warehouses.length);

  return <>
    <div className="purchase-toolbar"><div><strong>{openOrders.length} open {openOrders.length === 1 ? 'order' : 'orders'}</strong><p>Receipts update stock only after an order is confirmed.</p></div>
      <div className="actions"><button className="button secondary" disabled={busy} onClick={() => setRevision(revision + 1)}><RefreshCw size={16} />Refresh</button>
        {snapshot.can_manage && <button className="button" disabled={busy || !canCreate} onClick={beginCreate}><Plus size={17} />Create purchase order</button>}</div></div>
    {!canCreate && <p className="notice">Add a supplier, a warehouse, and at least one product before creating a purchase order.</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    <label className="field purchase-filter"><span>Status</span><select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="all">All statuses</option>
      {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <section className="panel page-panel"><div className="table-wrap"><table><thead><tr>{['Order', 'Supplier', 'Warehouse', 'Expected', 'Status', 'Total before tax', 'Details'].map(label => <th key={label}>{label}</th>)}</tr></thead>
      <tbody>{filtered.map(order => <tr key={order.id}><td><strong>{orderNumber(order)}</strong></td><td>{supplierName(order.supplier_id)}</td><td>{warehouseName(order.warehouse_id)}</td><td>{order.expected_on ? displayDate(order.expected_on) : '—'}</td>
        <td><span className={`tag ${order.status === 'received' ? 'green' : order.status === 'cancelled' ? 'peach' : 'blue'}`}>{labels[order.status]}</span></td><td>{money(order.total, order.currency)}</td>
        <td><button className="button secondary small" onClick={() => setSelectedId(selectedId === order.id ? '' : order.id)}>{selectedId === order.id ? 'Hide' : 'View'}</button></td></tr>)}</tbody></table></div>
      {!filtered.length && <p className="empty">No purchase orders match.</p>}</section>

    {selected && <section className="panel purchase-details"><div className="panel-head"><div><h2>{orderNumber(selected)}</h2><p>{supplierName(selected.supplier_id)} · {warehouseName(selected.warehouse_id)}</p></div>
      <div className="actions">{snapshot.can_manage && selected.status === 'draft' && <button className="button" disabled={busy} onClick={() => { setAction({ kind: 'confirm', order: selected }); setFormError(''); }}>Confirm order</button>}
        {snapshot.can_manage && ['draft', 'ordered', 'partially_received'].includes(selected.status) && <button className="button secondary" disabled={busy} onClick={() => { setAction({ kind: 'cancel', order: selected }); setFormError(''); }}>{selected.status === 'partially_received' ? 'Cancel remaining' : 'Cancel order'}</button>}</div></div>
      {selected.notes && <p className="purchase-notes">{selected.notes}</p>}
      {selected.cancellation_reason && <p className="purchase-notes">Cancellation reason: {selected.cancellation_reason}</p>}
      <div className="table-wrap"><table><thead><tr>{['Product', 'Ordered', 'Received', 'Outstanding', 'Unit price', 'Line total', 'Receive'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
        {selected.lines.map(line => <tr key={line.id}><td>{product(line.product_id)?.name || 'Unknown product'}</td><td>{number.format(line.quantity)} {product(line.product_id)?.unit}</td><td>{number.format(line.received_quantity)}</td><td>{number.format(line.quantity - line.received_quantity)}</td>
          <td>{money(line.unit_price, selected.currency)}</td><td>{money(Math.round((line.quantity * line.unit_price + Number.EPSILON) * 100) / 100, selected.currency)}</td>
          <td>{['ordered', 'partially_received'].includes(selected.status) && line.received_quantity < line.quantity ? <button className="button secondary small" disabled={busy} onClick={() => { setAction({ kind: 'receive', order: selected, line, requestId: crypto.randomUUID() }); setFormError(''); }}>Receive</button> : '—'}</td></tr>)}
      </tbody></table></div>
      <div className="panel-head"><h3>Receipt history</h3></div>
      {selected.receipts.length ? <div className="table-wrap"><table><thead><tr><th>Product</th><th>Lot</th><th>Quantity</th><th>Expiry</th><th>Received</th><th>Reference</th></tr></thead><tbody>{selected.receipts.map(receipt => <tr key={receipt.id}>
        <td>{product(selected.lines.find(line => line.id === receipt.line_id)?.product_id || '')?.name || 'Unknown product'}</td><td>{receipt.lot_code}</td><td>{number.format(receipt.quantity)}</td><td>{receipt.expires_on ? displayDate(receipt.expires_on) : '—'}</td><td>{displayDate(receipt.created_at)}</td><td>{receipt.reference}</td></tr>)}</tbody></table></div> : <p className="empty">No receipts recorded.</p>}
    </section>}

    {(createId || action) && <PurchaseDialog title={createId ? 'Create purchase order' : action?.kind === 'receive' ? `Receive ${orderNumber(action.order)}` : action?.kind === 'confirm' ? 'Confirm purchase order' : 'Cancel purchase order'} close={closeModal}>
      <form onSubmit={save}><fieldset disabled={busy}>
        {createId && <>
          <div className="form-grid"><label className="field"><span>Supplier</span><select name="supplier" required defaultValue=""><option value="">Select supplier</option>{inventory.suppliers.map(item => <option key={item.id} value={item.id}>{item.company_name || item.name}</option>)}</select></label>
            <label className="field"><span>Receiving warehouse</span><select name="warehouse" required defaultValue=""><option value="">Select warehouse</option>{inventory.warehouses.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
          <div className="form-grid"><label className="field"><span>Expected delivery date</span><input name="expected_on" type="date" /></label>
            <label className="field"><span>Currency</span><select value={currency} onChange={event => setCurrency(event.target.value)}>{currencies.map(value => <option key={value}>{value}</option>)}</select></label></div>
          <h3>Products</h3>{lines.map((line, index) => <div className="purchase-line" key={line.key}>
            <label className="field"><span>Product {index + 1}</span><select required value={line.product_id} onChange={event => editLine(line.key, 'product_id', event.target.value)}><option value="">Select product</option>
              {inventory.products.filter(item => item.id === line.product_id || !lines.some(other => other.product_id === item.id)).map(item => <option key={item.id} value={item.id}>{item.name} · {item.unit}</option>)}</select></label>
            <div className="form-grid"><label className="field"><span>Quantity {product(line.product_id) ? `(${product(line.product_id)!.unit})` : ''}</span><input type="number" min="0.001" max="999999999" step="0.001" required value={line.quantity} onChange={event => editLine(line.key, 'quantity', event.target.value)} /></label>
              <label className="field"><span>Unit price ({currency})</span><input type="number" min="0" max="999999999" step="0.01" required value={line.unit_price} onChange={event => editLine(line.key, 'unit_price', event.target.value)} /></label></div>
            {lines.length > 1 && <button type="button" className="text-button" onClick={() => setLines(current => current.filter(item => item.key !== line.key))}>Remove product {index + 1}</button>}
          </div>)}
          <button type="button" className="button secondary small" disabled={lines.length >= Math.min(100, inventory.products.length)} onClick={() => setLines(current => [...current, newLine()])}>Add product line</button>
          <p><strong>Order total before tax: {money(Number.isFinite(draftTotal) ? draftTotal : 0, currency)}</strong></p>
          <label className="field"><span>Notes</span><textarea name="notes" rows={3} maxLength={1000} /></label><p>The order will be saved as a draft. Confirm it before receiving products.</p>
        </>}
        {action?.kind === 'confirm' && <p>Confirm {orderNumber(action.order)} for {supplierName(action.order.supplier_id)}? You can then record deliveries. This does not send the order to the supplier.</p>}
        {action?.kind === 'cancel' && <><p>Cancel the outstanding quantities on {orderNumber(action.order)}? Products already received will remain in stock.</p><label className="field"><span>Cancellation reason</span><textarea name="reason" required maxLength={300} rows={3} /></label></>}
        {action?.kind === 'receive' && <>
          <p><strong>{product(action.line.product_id)?.name}</strong> · {warehouseName(action.order.warehouse_id)}</p>
          <p>Outstanding: {number.format(action.line.quantity - action.line.received_quantity)} {product(action.line.product_id)?.unit}</p>
          <div className="form-grid"><label className="field"><span>Quantity received</span><input name="quantity" type="number" min="0.001" step="0.001" max={Number((action.line.quantity - action.line.received_quantity).toFixed(3))} defaultValue={Number((action.line.quantity - action.line.received_quantity).toFixed(3))} required /></label>
            <label className="field"><span>Lot code</span><input name="lot_code" maxLength={60} required /></label></div>
          <label className="field"><span>Expiry date</span><input name="expires_on" type="date" /></label>
          <label className="field"><span>Delivery reference</span><input name="reference" maxLength={150} /></label><p>Save each lot separately. Stock and outstanding quantities update together.</p>
        </>}
      </fieldset>{formError && <p className="error" role="alert">{formError}</p>}
        <div className="form-actions"><button type="button" className="button secondary" disabled={busy} onClick={closeModal}>Back</button><button className="button" disabled={busy}>{busy ? 'Saving…' : createId ? 'Save draft' : action?.kind === 'receive' ? 'Save receipt' : action?.kind === 'confirm' ? 'Confirm order' : 'Cancel order'}</button></div>
      </form>
    </PurchaseDialog>}
  </>;
}
