export type Product = { id: string; name: string; sku: string; category: string; unit: string; minimum: number };
export type Warehouse = { id: string; name: string; location: string };
export type Supplier = { id: string; name: string; company_name: string; email: string; phone: string; physical_address: string; location: string };
export type Lot = { id: string; product_id: string; code: string; expires_on: string | null; supplier_id: string | null };
export type MovementKind = 'receipt' | 'issue' | 'transfer';
export type Movement = {
  id: string; lot_id: string; kind: MovementKind; quantity: number;
  warehouse_id: string; destination_id: string | null; reference: string; created_at: string;
};
export type Stock = { lot_id: string; warehouse_id: string; quantity: number };
export type Inventory = { name: string; products: Product[]; warehouses: Warehouse[]; suppliers: Supplier[]; lots: Lot[]; movements: Movement[]; stock: Stock[] };
export type MoveInput = {
  id: string; kind: MovementKind; product_id: string; lot_code: string; warehouse_id: string;
  destination_id: string | null; expires_on: string | null; supplier_id: string | null; quantity: number; reference: string;
};

export const emptyInventory: Inventory = { name: '', products: [], warehouses: [], suppliers: [], lots: [], movements: [], stock: [] };
export const units = ['kg', 'lb', 'L', 'ea', 'case', 'bag'];
export const movementLabels = { receipt: 'Receipt', issue: 'Issue', transfer: 'Transfer' };
export const number = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 3 });
const canadianTimeZone = 'America/Toronto';
export const day = (value = new Date()) => value.toLocaleDateString('sv-SE', { timeZone: canadianTimeZone });
export function daysFromNow(offset: number) {
  const date = new Date(`${day()}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
export function displayDate(value: string) {
  const date = value.length === 10 ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', timeZone: canadianTimeZone });
}

export function dashboard(data: Inventory) {
  const productByLot = new Map(data.lots.map(lot => [lot.id, lot.product_id]));
  const totals = new Map<string, number>();
  const lotsInStock = new Set<string>();
  for (const row of data.stock) {
    const product = productByLot.get(row.lot_id);
    if (product) totals.set(product, (totals.get(product) ?? 0) + Math.round(row.quantity * 1000));
    if (row.quantity > 0) lotsInStock.add(row.lot_id);
  }
  const onHand = (productId: string) => (totals.get(productId) ?? 0) / 1000;
  const low = data.products.filter(p => p.minimum > 0 && onHand(p.id) <= p.minimum);
  const expiring = data.lots.filter(lot => lot.expires_on && lot.expires_on <= daysFromNow(30) &&
    lotsInStock.has(lot.id));
  return { onHand, low, expiring };
}

export function applyDemoMovement(data: Inventory, move: MoveInput): Inventory {
  if (data.movements.some(existing => existing.id === move.id)) return data;
  if (!Number.isFinite(move.quantity) || move.quantity <= 0 || move.quantity > 999999999 ||
    Number(move.quantity.toFixed(3)) !== move.quantity) throw new Error('Enter a positive quantity with up to three decimals.');
  if (!data.products.some(product => product.id === move.product_id) ||
    !data.warehouses.some(warehouse => warehouse.id === move.warehouse_id) || !move.lot_code.trim()) {
    throw new Error('Select a product, lot and warehouse.');
  }
  if (move.kind === 'transfer' && (move.destination_id === move.warehouse_id ||
    !data.warehouses.some(warehouse => warehouse.id === move.destination_id))) {
    throw new Error('Select a different destination warehouse.');
  }
  let lot = data.lots.find(item => item.product_id === move.product_id && item.code === move.lot_code);
  const lots = [...data.lots];
  if (!lot && move.kind === 'receipt') {
    lot = { id: crypto.randomUUID(), product_id: move.product_id, code: move.lot_code, expires_on: move.expires_on, supplier_id: move.supplier_id };
    lots.push(lot);
  }
  if (!lot) throw new Error('Select an existing lot.');
  if (move.kind === 'receipt' && ((move.expires_on && move.expires_on !== lot.expires_on) ||
    (move.supplier_id && move.supplier_id !== lot.supplier_id))) throw new Error('This lot already has different supplier or expiry details.');
  if (move.kind === 'issue' && lot.expires_on && lot.expires_on < day()) throw new Error('Expired lots cannot be issued.');
  const lotId = lot.id;
  const stock = data.stock.map(item => ({ ...item }));
  function change(warehouseId: string, delta: number) {
    const row = stock.find(item => item.lot_id === lotId && item.warehouse_id === warehouseId);
    const next = Number(((row?.quantity ?? 0) + delta).toFixed(3));
    if (next < 0) throw new Error('There is insufficient stock for this lot in the selected warehouse.');
    if (row) row.quantity = next;
    else stock.push({ lot_id: lotId, warehouse_id: warehouseId, quantity: next });
  }
  change(move.warehouse_id, move.kind === 'receipt' ? move.quantity : -move.quantity);
  if (move.kind === 'transfer' && move.destination_id) change(move.destination_id, move.quantity);
  const entry: Movement = { id: move.id, kind: move.kind, quantity: move.quantity, lot_id: lotId,
    warehouse_id: move.warehouse_id, destination_id: move.destination_id, reference: move.reference, created_at: new Date().toISOString() };
  return { ...data, lots, stock, movements: [entry, ...data.movements] };
}

export function makeDemo(): Inventory {
  const catalog: [string, string, string, string, number, number][] = [
    ['Hard red wheat', 'GRN-001', 'Grain', 'kg', 250, 2180],
    ['Canola seed', 'SED-002', 'Seed', 'kg', 150, 860],
    ['Organic rolled oats', 'GRN-003', 'Grain', 'kg', 100, 92],
    ['Liquid fertilizer 10–34–0', 'INP-004', 'Inputs', 'L', 200, 1450],
    ['Kraft grain sacks', 'PKG-005', 'Packaging', 'ea', 250, 180],
    ['Frozen blueberries', 'PRD-006', 'Produce', 'kg', 150, 760],
    ['Food-grade liners', 'PKG-007', 'Packaging', 'ea', 120, 620],
    ['Pearled barley', 'GRN-008', 'Grain', 'kg', 250, 630],
  ];
  const products = catalog.map(([name, sku, category, unit, minimum], i) => ({ id: `p${i}`, name, sku, category, unit, minimum }));
  const warehouses = [{ id: 'w0', name: 'Main Warehouse', location: 'Guelph, ON' },
    { id: 'w1', name: 'Cold Storage', location: 'Cambridge, ON' }, { id: 'w2', name: 'West Distribution', location: 'London, ON' }];
  const suppliers = [{ id: 's0', name: 'Valley Grain Supply', company_name: 'Valley Grain Supply', email: 'orders@valleygrain.example', phone: '', physical_address: '', location: 'Guelph, ON, Canada' },
    { id: 's1', name: 'Northern Produce Co.', company_name: 'Northern Produce Co.', email: 'sales@northernproduce.example', phone: '', physical_address: '', location: 'Cambridge, ON, Canada' }];
  const lots = products.map((product, i) => ({ id: `l${i}`, product_id: product.id, code: `LOT-${1041 + i}`,
    expires_on: i === 2 ? daysFromNow(13) : i === 5 ? daysFromNow(24) : null, supplier_id: i === 5 ? 's1' : 's0' }));
  const stock = lots.map((lot, i) => ({ lot_id: lot.id, warehouse_id: i === 5 ? 'w1' : i === 6 ? 'w2' : 'w0', quantity: catalog[i][5] }));
  const activity = [[4, 2], [6, 3], [5, 4], [9, 5], [7, 3], [4, 4], [8, 3]];
  const movements: Movement[] = activity.flatMap(([receipts, issues], index) =>
    Array.from({ length: receipts + issues }, (_, i) => {
      const row = stock[(index + i) % stock.length];
      return { id: `m${index}-${i}`, kind: i < receipts ? 'receipt' as const : 'issue' as const,
        lot_id: row.lot_id, quantity: 8 + (i * 13) % 72, warehouse_id: row.warehouse_id,
        destination_id: null, reference: '', created_at: new Date(`${daysFromNow(index - 6)}T12:${String(i).padStart(2, '0')}:00Z`).toISOString() };
    })).reverse();
  return { name: 'Demo workspace', products, warehouses, suppliers, lots, stock, movements };
}
