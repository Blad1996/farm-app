'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { ArrowDownLeft, ArrowLeftRight, ArrowRight, ArrowUpRight, Boxes, CalendarDays, CircleHelp,
  Clock3, Download, LayoutDashboard, Leaf, LogOut, Menu, Package, Plus, Search, Truck, Warehouse, X } from 'lucide-react';
import { applyDemoMovement, dashboard, day, daysFromNow, displayDate, emptyInventory, makeDemo, movementLabels,
  number, units, type Inventory, type MoveInput, type Movement, type MovementKind } from './inventory';
import { supabase } from './supabase';

const navigation = [
  { label: 'Overview', icon: LayoutDashboard, id: 'overview' },
  { label: 'Inventory', icon: Boxes, id: 'inventory' },
  { label: 'Movements', icon: ArrowLeftRight, id: 'movements' },
  { label: 'Warehouses', icon: Warehouse, id: 'warehouses' },
  { label: 'Suppliers', icon: Truck, id: 'suppliers' },
] as const;
type View = typeof navigation[number]['id'];
type Modal = 'movement' | 'product' | 'warehouse' | 'supplier' | 'help';
type Company = { id: string; name: string };

const demoKey = 'agro-inventory-v1';
const field = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

export default function Workspace() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [data, setData] = useState<Inventory>(emptyInventory);
  const [view, setView] = useState<View>('overview');
  const [modal, setModal] = useState<Modal | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loadingData, setLoadingData] = useState(Boolean(supabase));
  const [moveKind, setMoveKind] = useState<MovementKind>('receipt');
  const [selectedProduct, setSelectedProduct] = useState('');
  const [requestId, setRequestId] = useState('');
  const userId = session?.user.id;

  useEffect(() => {
    if (!supabase) {
      try {
        const stored = localStorage.getItem(demoKey);
        setData(stored ? JSON.parse(stored) : makeDemo());
      } catch { setData(makeDemo()); }
      setReady(true);
      return;
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function loadCompany(id: string) {
    const response = await supabase!.rpc('inventory_snapshot', { p_company: id });
    if (response.error) throw response.error;
    if (!response.data) throw new Error('Workspace access is unavailable.');
    return response.data as Inventory;
  }

  useEffect(() => {
    if (!supabase || !userId) return;
    const client = supabase;
    let cancelled = false;
    setLoadingData(true);
    setLoadError('');
    setCompany(null);
    setData(emptyInventory);
    (async () => {
      try {
        const { data: companies, error } = await client.from('companies').select('id,name').order('name').limit(1);
        if (error) throw error;
        const first = companies?.[0] ?? null;
        const inventory = first ? await loadCompany(first.id) : emptyInventory;
        if (!cancelled) { setCompany(first); setData(inventory); }
      } catch {
        if (!cancelled) setLoadError('The workspace could not load. Check the database setup and reload the page.');
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  async function createCompany(form: FormData) {
    const response = await supabase!.rpc('create_inventory_company', { p_name: field(form, 'name') });
    if (response.error) throw response.error;
    const newCompany = response.data as Company;
    setCompany(newCompany);
    setData({ ...emptyInventory, name: newCompany.name });
  }

  function go(next: View) { setView(next); setQuery(''); setMenuOpen(false); }
  function open(next: Modal) {
    setNotice('');
    if (next === 'movement') {
      setMoveKind('receipt');
      setSelectedProduct(data.products[0]?.id ?? '');
      setRequestId(crypto.randomUUID());
    }
    setModal(next);
  }
  function saveDemo(next: Inventory) {
    localStorage.setItem(demoKey, JSON.stringify(next));
    setData(next);
  }

  async function submit(form: FormData) {
    const id = company?.id;
    if (supabase && !id) throw new Error('Open a workspace first.');
    if (modal === 'movement') {
      const move: MoveInput = {
        id: requestId, kind: moveKind, product_id: field(form, 'product'), lot_code: field(form, 'lot').toUpperCase(),
        warehouse_id: field(form, 'warehouse'), destination_id: field(form, 'destination') || null,
        expires_on: field(form, 'expiration') || null, supplier_id: field(form, 'supplier') || null,
        quantity: Number(field(form, 'quantity')), reference: field(form, 'reference'),
      };
      if (supabase) {
        const { error } = await supabase.rpc('post_inventory_movement', { p_company: id, p_move: move });
        if (error) throw error;
      } else saveDemo(applyDemoMovement(data, move));
    } else {
      const name = field(form, 'name');
      if (!name) throw new Error('Enter a name.');
      if (modal === 'product') {
        const product = { id: crypto.randomUUID(), name, sku: field(form, 'sku').toUpperCase(),
          unit: field(form, 'unit'), category: field(form, 'category'), minimum: Number(field(form, 'minimum') || 0) };
        if (!product.sku || !product.category) throw new Error('Enter a SKU and category.');
        if (data.products.some(existing => existing.sku === product.sku)) throw new Error('That SKU is already in use.');
        if (supabase) {
          const { error } = await supabase.from('products').insert({ ...product, company_id: id });
          if (error) throw error;
        } else saveDemo({ ...data, products: [...data.products, product] });
      }
      if (modal === 'warehouse') {
        const warehouse = { id: crypto.randomUUID(), name, location: field(form, 'location') };
        if (data.warehouses.some(existing => existing.name.toLowerCase() === name.toLowerCase())) throw new Error('That warehouse name is already in use.');
        if (supabase) {
          const { error } = await supabase.from('warehouses').insert({ ...warehouse, company_id: id });
          if (error) throw error;
        } else saveDemo({ ...data, warehouses: [...data.warehouses, warehouse] });
      }
      if (modal === 'supplier') {
        const supplier = { id: crypto.randomUUID(), name, email: field(form, 'email') };
        if (data.suppliers.some(existing => existing.name.toLowerCase() === name.toLowerCase())) throw new Error('That supplier name is already in use.');
        if (supabase) {
          const { error } = await supabase.from('suppliers').insert({ ...supplier, company_id: id });
          if (error) throw error;
        } else saveDemo({ ...data, suppliers: [...data.suppliers, supplier] });
      }
    }
    setModal(null);
    setNotice('Saved successfully.');
    if (supabase && id) {
      try { setData(await loadCompany(id)); }
      catch { setNotice('Saved. Reload the page to refresh the workspace.'); }
    }
  }

  const stats = dashboard(data);
  const matches = (...parts: string[]) => parts.join(' ').toLowerCase().includes(query.trim().toLowerCase());
  const products = data.products.filter(item => matches(item.name, item.sku, item.category));
  const stockRows = data.stock.flatMap(row => {
    const lot = data.lots.find(item => item.id === row.lot_id);
    const product = data.products.find(item => item.id === lot?.product_id);
    const warehouse = data.warehouses.find(item => item.id === row.warehouse_id);
    return lot && product && warehouse && row.quantity > 0 && matches(product.name, product.sku, warehouse.name, lot.code)
      ? [{ ...row, lot, product, warehouse }] : [];
  });

  function downloadInventory() {
    const cell = (value: string | number) => {
      let content = String(value);
      if (typeof value === 'string' && /^[\s]*[=+\-@]/.test(content)) content = "'" + content;
      return `"${content.replaceAll('"', '""')}"`;
    };
    const lines = [['Product', 'SKU', 'Lot', 'Warehouse', 'Quantity', 'Unit', 'Expiry'],
      ...stockRows.map(row => [row.product.name, row.product.sku, row.lot.code, row.warehouse.name,
        row.quantity, row.product.unit, row.lot.expires_on ?? ''])];
    const href = URL.createObjectURL(new Blob(['\ufeff' + lines.map(line => line.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = href; link.download = `inventory-${day()}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  if (!ready || (supabase && session && loadingData)) return <div className="auth-shell"><p>Loading workspace…</p></div>;
  if (supabase && !session) return <SignIn />;
  if (loadError) return <div className="auth-shell"><p role="alert">{loadError}</p><button className="button" onClick={() => window.location.reload()}>Reload</button></div>;
  if (supabase && !company) return <div className="auth-shell"><section className="auth-card"><Brand /><h1>Create a workspace</h1>
    <p>Set up your company to start recording inventory.</p><Form onSave={createCompany} action="Create workspace">
      <Field label="Company name" name="name" required maxLength={100} />
    </Form><button className="text-button" onClick={() => void supabase?.auth.signOut()}>Sign out</button></section></div>;

  const headings = {
    overview: ['Inventory overview', 'Monitor stock, lots, and warehouse activity.'],
    inventory: ['Inventory', 'Track products and stock by lot and warehouse.'],
    movements: ['Stock movements', 'Review receipts, issues, and warehouse transfers.'],
    warehouses: ['Warehouses', 'Manage the locations where inventory is stored.'],
    suppliers: ['Suppliers', 'Keep supplier contacts linked to incoming lots.'],
  };
  const modalTitles = { movement: 'Record movement', product: 'Add product', warehouse: 'Add warehouse', supplier: 'Add supplier', help: 'Getting started' };
  const movementRows = data.movements.filter(move => {
    const lot = data.lots.find(item => item.id === move.lot_id);
    const product = data.products.find(item => item.id === lot?.product_id);
    return matches(lot?.code ?? '', product?.name ?? '', movementLabels[move.kind], move.reference);
  });

  return <div className="shell">
    <aside className={`sidebar ${menuOpen ? 'is-open' : ''}`}>
      <Brand />
      <div className="workspace-name"><div className="workspace-mark"><Warehouse size={17} /></div><div><strong>{data.name}</strong><span>{supabase ? 'Inventory workspace' : 'Sample data'}</span></div></div>
      <nav aria-label="Workspace"><p className="nav-label">Workspace</p>{navigation.map(({ id, label, icon: Icon }) =>
        <button key={id} aria-current={view === id ? 'page' : undefined} className={view === id ? 'active' : ''} onClick={() => go(id)}><Icon size={19} />{label}</button>)}</nav>
      <div className="sidebar-footer"><button onClick={() => open('help')}><CircleHelp size={18} />{supabase ? 'Getting started' : 'About this demo'}</button>
        <div className="profile"><span className="avatar">{session?.user.email?.slice(0, 2).toUpperCase() ?? 'DM'}</span>
          <div><strong>{session?.user.email ?? 'Demo user'}</strong><span>{supabase ? 'Signed in' : 'Local workspace'}</span></div>
          {supabase && <button className="icon-button logout" title="Sign out" aria-label="Sign out" onClick={async () => {
            if (!supabase) return;
            const result = await supabase.auth.signOut();
            if (!result.error) { setCompany(null); setData(emptyInventory); setModal(null); go('overview'); }
            else setNotice('Sign-out failed. Please try again.');
          }}><LogOut size={17} /></button>}</div></div>
    </aside>
    {menuOpen && <button className="menu-overlay" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <main className="main">
      <div className="topbar"><div className="breadcrumb"><button className="icon-button menu-toggle" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle navigation"><Menu size={22} /></button>
        <span>Workspace</span><span className="slash">/</span><strong>{navigation.find(item => item.id === view)?.label}</strong></div>
        <span className="today"><CalendarDays size={16} />{displayDate(day())}</span></div>
      <div className="content">
        <header className="page-head"><div><h1>{headings[view][0]}</h1><p>{headings[view][1]}</p></div>
          <div className="actions">{view === 'inventory' && <button className="button secondary" onClick={downloadInventory}><Download size={17} />Export CSV</button>}
            <button className="button" onClick={() => open(view === 'inventory' ? 'product' : view === 'warehouses' ? 'warehouse' : view === 'suppliers' ? 'supplier' : 'movement')}>
              <Plus size={19} />{view === 'inventory' ? 'Add product' : view === 'warehouses' ? 'Add warehouse' : view === 'suppliers' ? 'Add supplier' : 'Record movement'}</button></div></header>
        {notice && <div className="notice" role="status">{notice}<button className="icon-button" aria-label="Dismiss notice" onClick={() => setNotice('')}><X size={16} /></button></div>}

        {view === 'overview' && <>
          <div className="metrics">
            <Metric icon={<Package size={20} />} label="Tracked products" value={data.products.length} detail="Product catalogue" />
            <Metric icon={<Boxes size={20} />} label="Low-stock products" value={stats.low.length} detail="At or below minimum" tone="amber" />
            <Metric icon={<Clock3 size={20} />} label="Expiring or expired lots" value={stats.expiring.length} detail="Through the next 30 days" tone="peach" />
            <Metric icon={<Warehouse size={20} />} label="Warehouses" value={data.warehouses.length} detail="Storage locations" tone="blue" />
          </div>
          <div className="overview-grid">
            <MovementChart movements={data.movements} />
            <section className="panel alerts"><div className="panel-head"><div><h2>Needs attention</h2><p>Stock levels and lot expiry</p></div><span className="alert-count">{stats.low.length + stats.expiring.length}</span></div>
              <div className="alert-list">
                {stats.low.slice(0, 3).map(product => <div className="alert-row" key={product.id}><div className="alert-icon amber"><Boxes size={17} /></div>
                  <div><strong>{product.name}</strong><span>{number.format(stats.onHand(product.id))} {product.unit} on hand</span></div><span className="tag amber">Low stock</span></div>)}
                {stats.expiring.slice(0, 3).map(lot => <div className="alert-row" key={lot.id}><div className="alert-icon peach"><Clock3 size={17} /></div>
                  <div><strong>{data.products.find(item => item.id === lot.product_id)?.name}</strong><span>{lot.code} · {displayDate(lot.expires_on!)}</span></div>
                  <span className="tag peach">{lot.expires_on! < day() ? 'Expired' : 'Expiring'}</span></div>)}
                {!stats.low.length && !stats.expiring.length && <p className="empty">No stock or expiry alerts.</p>}
              </div>
              <button className="panel-link" onClick={() => go('inventory')}>View inventory <ArrowRight size={15} /></button>
            </section>
          </div>
          <section className="panel"><div className="panel-head"><div><h2>Recent movements</h2><p>Latest inventory transactions</p></div>
            <button className="button secondary small" onClick={() => go('movements')}>View all</button></div>
            <MovementTable data={data} rows={data.movements.slice(0, 5)} /></section>
        </>}
        {view !== 'overview' && <div className="search"><Search size={18} /><input type="search" aria-label="Filter records" placeholder="Search records…" value={query} onChange={event => setQuery(event.target.value)} /></div>}
        {view === 'inventory' && <>
          <section className="panel page-panel"><div className="panel-head"><div><h2>Stock by lot</h2><p>On-hand balances with positive stock</p></div></div>
            <Table heads={['Product', 'Lot', 'Warehouse', 'On hand', 'Expiry']} rows={stockRows.map(row => [
              <Item key={row.product.id} title={row.product.name} subtitle={row.product.sku} />, row.lot.code, row.warehouse.name,
              `${number.format(row.quantity)} ${row.product.unit}`,
              row.lot.expires_on ? <span key={row.lot.id} className={row.lot.expires_on <= daysFromNow(30) ? 'tag peach' : ''}>{displayDate(row.lot.expires_on)}</span> : '—',
            ])} empty="No stock matches. Record a receipt to add stock." /></section>
          <section className="panel page-panel"><div className="panel-head"><h2>Product catalogue</h2></div>
            <Table heads={['Product', 'Category', 'On hand', 'Minimum']} rows={products.map(product => [
              <Item key={product.id} title={product.name} subtitle={product.sku} />, product.category,
              `${number.format(stats.onHand(product.id))} ${product.unit}`, `${number.format(product.minimum)} ${product.unit}`,
            ])} empty="No products match." /></section>
        </>}
        {view === 'movements' && <section className="panel"><div className="panel-head"><div><h2>Movement history</h2><p>Most recent transactions, up to 500</p></div></div>
          <MovementTable data={data} rows={movementRows} /></section>}
        {view === 'warehouses' && <section className="panel"><div className="panel-head"><h2>Storage locations</h2></div>
          <Table heads={['Warehouse', 'Location', 'Lots in stock']} rows={data.warehouses.filter(item => matches(item.name, item.location)).map(item => [
            <Item key={item.id} title={item.name} />, item.location || '—', data.stock.filter(stock => stock.warehouse_id === item.id && stock.quantity > 0).length,
          ])} empty="No warehouses match." /></section>}
        {view === 'suppliers' && <section className="panel"><div className="panel-head"><h2>Supplier directory</h2></div>
          <Table heads={['Supplier', 'Email', 'Linked lots']} rows={data.suppliers.filter(item => matches(item.name, item.email)).map(item => [
            <Item key={item.id} title={item.name} />, item.email || '—', data.lots.filter(lot => lot.supplier_id === item.id).length,
          ])} empty="No suppliers match." /></section>}
      </div>
    </main>

    {modal && <Dialog title={modalTitles[modal]} close={() => setModal(null)}>
      {modal === 'help' ? <><p>{supabase ? 'Add a product and a warehouse, then record a receipt to create your first lot.' : 'This demonstration uses sample inventory. Your changes are saved in this browser.'}</p>
        <p>Receipts add stock. Issues reduce stock. Transfers move a lot between warehouses.</p></> :
      modal === 'movement' && (!data.products.length || !data.warehouses.length) ?
        <><p>Add a product and a warehouse before recording a movement.</p><div className="actions">
          {!data.products.length && <button className="button" onClick={() => open('product')}>Add product</button>}
          {!data.warehouses.length && <button className="button secondary" onClick={() => open('warehouse')}>Add warehouse</button>}</div></> :
      <Form onSave={submit} action={modal === 'movement' ? 'Save movement' : 'Save'} cancel={() => setModal(null)}>
        {modal === 'product' && <>
          <Field label="Product name" name="name" required maxLength={100} />
          <div className="form-grid"><Field label="SKU" name="sku" required maxLength={40} /><Field label="Category" name="category" required maxLength={60} /></div>
          <div className="form-grid"><Select label="Unit" name="unit" options={units.map(unit => [unit, unit])} />
          <Field label="Minimum stock" name="minimum" type="number" min="0" max="999999999" step="0.001" defaultValue="0" required /></div>
        </>}
        {modal === 'warehouse' && <><Field label="Warehouse name" name="name" required maxLength={100} /><Field label="City and province" name="location" placeholder="Guelph, ON" maxLength={100} /></>}
        {modal === 'supplier' && <><Field label="Supplier name" name="name" required maxLength={100} /><Field label="Email" name="email" type="email" maxLength={150} /></>}
        {modal === 'movement' && <>
          <Select label="Movement type" name="kind" value={moveKind} onChange={value => setMoveKind(value as MovementKind)} options={Object.entries(movementLabels)} />
          <Select label="Product" name="product" value={selectedProduct} onChange={setSelectedProduct} options={data.products.map(item => [item.id, `${item.name} · ${item.unit}`])} />
          <div className="form-grid">
            {moveKind === 'receipt' ? <Field label="Lot code" name="lot" required maxLength={60} placeholder="LOT-1001" /> :
              <Select key={selectedProduct} label="Lot code" name="lot" options={[['', 'Select lot'], ...data.lots.filter(lot => lot.product_id === selectedProduct).map(lot => [lot.code, lot.code] as [string, string])]} required />}
            <Field label="Quantity" name="quantity" type="number" min="0.001" max="999999999" step="0.001" required />
          </div>
          <Select label={moveKind === 'transfer' ? 'From warehouse' : 'Warehouse'} name="warehouse" options={data.warehouses.map(item => [item.id, item.name])} />
          {moveKind === 'transfer' && <Select label="To warehouse" name="destination" options={[['', 'Select warehouse'], ...data.warehouses.map(item => [item.id, item.name] as [string, string])]} required />}
          {moveKind === 'receipt' && <div className="form-grid"><Field label="Expiry date" name="expiration" type="date" />
            <Select label="Supplier" name="supplier" options={[['', 'Optional'], ...data.suppliers.map(item => [item.id, item.name] as [string, string])]} /></div>}
          <Field label="Reference or note" name="reference" maxLength={200} placeholder="PO, shipment number, or reason" />
        </>}
      </Form>}
    </Dialog>}
  </div>;
}

function Brand() { return <div className="brand"><div className="brand-mark"><Leaf size={23} /></div><span>Inventory<span className="brand-sub">Agriculture & food</span></span></div>; }

function Metric({ icon, label, value, detail, tone = 'green' }: { icon: ReactNode; label: string; value: number; detail: string; tone?: string }) {
  return <section className="metric"><div className={`metric-icon ${tone}`}>{icon}</div><p>{label}</p><strong>{number.format(value)}</strong><span>{detail}</span></section>;
}

function MovementChart({ movements }: { movements: Movement[] }) {
  const series = Array.from({ length: 7 }, (_, i) => {
    const date = daysFromNow(i - 6);
    const rows = movements.filter(move => day(new Date(move.created_at)) === date);
    return { date, label: new Date(`${date}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'short' }),
      receipts: rows.filter(move => move.kind === 'receipt').length, issues: rows.filter(move => move.kind === 'issue').length };
  });
  const max = Math.max(4, ...series.flatMap(item => [item.receipts, item.issues]));
  const step = Math.ceil(max / 4);
  return <section className="panel chart-panel"><div className="panel-head"><div><h2>Stock activity</h2><p>Receipts and issues by day</p></div><span className="period">Last 7 days</span></div>
    <div className="chart-legend"><span><i />Receipts</span><span><i />Issues</span></div>
    <div className="chart" role="img" aria-label={series.map(item => `${item.label}: ${item.receipts} receipts and ${item.issues} issues`).join('. ')}>
      <div className="chart-grid">{[4, 3, 2, 1, 0].map(i => <div key={i}><span>{i * step}</span><i /></div>)}</div>
      <div className="chart-data">{series.map(item => <div className="chart-column" key={item.date} title={`${item.label}: ${item.receipts} receipts, ${item.issues} issues`}>
        <div className="chart-bars"><i style={{ height: `${100 * item.receipts / (step * 4)}%` }} /><i style={{ height: `${100 * item.issues / (step * 4)}%` }} /></div>
        <span>{item.label}</span></div>)}</div>
    </div>
  </section>;
}

function Table({ heads, rows, empty }: { heads: string[]; rows: ReactNode[][]; empty: string }) {
  if (!rows.length) return <p className="empty">{empty}</p>;
  return <div className="table-wrap"><table><thead><tr>{heads.map(head => <th scope="col" key={head}>{head}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, i) => <td key={i}>{cell}</td>)}</tr>)}</tbody></table></div>;
}

function Item({ title, subtitle }: { title: string; subtitle?: string }) {
  return <div className="item"><span className="item-icon"><Package size={17} /></span><div><strong>{title}</strong>{subtitle && <span>{subtitle}</span>}</div></div>;
}

function MovementTable({ data, rows }: { data: Inventory; rows: Movement[] }) {
  return <Table heads={['Product', 'Movement', 'Lot', 'Warehouse', 'Quantity', 'Date', 'Reference']} empty="No movements found." rows={rows.map(move => {
    const lot = data.lots.find(item => item.id === move.lot_id);
    const product = data.products.find(item => item.id === lot?.product_id);
    const source = data.warehouses.find(item => item.id === move.warehouse_id)?.name ?? '—';
    const destination = data.warehouses.find(item => item.id === move.destination_id)?.name;
    return [<Item key={move.id} title={product?.name ?? 'Unknown product'} subtitle={product?.sku} />,
      <span key={move.kind} className={`tag ${move.kind === 'receipt' ? 'green' : move.kind === 'issue' ? 'peach' : 'blue'}`}>
        {move.kind === 'receipt' ? <ArrowDownLeft size={13} /> : move.kind === 'issue' ? <ArrowUpRight size={13} /> : <ArrowLeftRight size={13} />}
        {movementLabels[move.kind]}</span>, lot?.code ?? '—', destination ? `${source} → ${destination}` : source,
      `${number.format(move.quantity)} ${product?.unit ?? ''}`, displayDate(move.created_at), move.reference || '—'];
  })} />;
}

function Dialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = ref.current; node?.showModal(); return () => node?.close(); }, []);
  return <dialog ref={ref} aria-labelledby="dialog-title" onCancel={event => { event.preventDefault(); close(); }}>
    <div className="dialog-head"><h2 id="dialog-title">{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={close}><X size={21} /></button></div>
    {children}
  </dialog>;
}

function Form({ onSave, action, cancel, children }: { onSave: (data: FormData) => Promise<void>; action: string; cancel?: () => void; children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try { await onSave(new FormData(event.currentTarget)); }
    catch (err) { setError(String((err as { message?: string })?.message ?? 'Unable to save. Try again.')); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit}><fieldset disabled={busy}>{children}</fieldset>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="form-actions">{cancel && <button type="button" className="button secondary" disabled={busy} onClick={cancel}>Cancel</button>}
      <button className="button" disabled={busy}>{busy ? 'Please wait…' : action}</button></div></form>;
}

function Field({ label, ...input }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return <label className="field"><span>{label}</span><input {...input} /></label>;
}
function Select({ label, name, options, required, value, onChange }: {
  label: string; name: string; options: [string, string][]; required?: boolean; value?: string; onChange?: (value: string) => void;
}) {
  return <label className="field"><span>{label}</span><select name={name} required={required} value={value}
    onChange={onChange ? event => onChange(event.target.value) : undefined}>
    {options.map(([key, text]) => <option value={key} key={key}>{text}</option>)}</select></label>;
}

function SignIn() {
  const [register, setRegister] = useState(false);
  const [message, setMessage] = useState('');
  async function auth(form: FormData) {
    const credentials = { email: field(form, 'email'), password: String(form.get('password') ?? '') };
    setMessage('');
    const response = register
      ? await supabase!.auth.signUp({ ...credentials, options: { emailRedirectTo: window.location.origin } })
      : await supabase!.auth.signInWithPassword(credentials);
    if (response.error) throw response.error;
    if (register && !response.data.session) setMessage('Check your email for the confirmation link, then return to sign in.');
  }
  return <div className="auth-shell"><section className="auth-card"><Brand /><h1>{register ? 'Create an account' : 'Sign in'}</h1><p>Access your inventory workspace.</p>
    <Form key={String(register)} onSave={auth} action={register ? 'Create account' : 'Sign in'}>
      <Field label="Email" name="email" type="email" autoComplete="email" required />
      <Field label="Password" name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={register ? 8 : undefined} />
    </Form>{message && <p role="status">{message}</p>}
    <button className="text-button" onClick={() => { setRegister(!register); setMessage(''); }}>{register ? 'Already have an account? Sign in' : 'Create an account'}</button>
  </section></div>;
}
