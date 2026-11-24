import assert from 'node:assert/strict';
import test from 'node:test';
import { applyDemoMovement, dashboard, daysFromNow, emptyInventory } from '../app/inventory.ts';

const initial = {
  ...emptyInventory,
  products: [{ id: 'p', name: 'Wheat', sku: 'WHEAT', unit: 'kg', category: 'Grain', minimum: 3 }],
  warehouses: [{ id: 'a', name: 'A', location: '' }, { id: 'b', name: 'B', location: '' }],
};
const receipt = { id: 'first', kind: 'receipt', product_id: 'p', lot_code: 'W1', warehouse_id: 'a',
  destination_id: null, expires_on: daysFromNow(1), supplier_id: null, quantity: 10.125, reference: '' };

test('receipt creates a lot and counts stock only once when retried', () => {
  const data = applyDemoMovement(initial, receipt);
  assert.equal(data.lots.length, 1);
  assert.equal(data.stock[0].quantity, 10.125);
  assert.equal(applyDemoMovement(data, receipt), data);
  assert.equal(dashboard(data).expiring.length, 1);
});

test('a transfer debits and credits the same lot without changing total stock', () => {
  const data = applyDemoMovement(initial, receipt);
  const next = applyDemoMovement(data, { ...receipt, id: 'transfer', kind: 'transfer', destination_id: 'b', quantity: 3.125 });
  assert.deepEqual(next.stock.map(row => row.quantity), [7, 3.125]);
  assert.equal(dashboard(next).onHand('p'), 10.125);
  assert.equal(data.stock[0].quantity, 10.125);
  assert.throws(() => applyDemoMovement(next, { ...receipt, id: 'invalid', kind: 'transfer', destination_id: 'a' }), /different destination/);
});

test('issues cannot exceed stock or use an expired lot', () => {
  const data = applyDemoMovement(initial, receipt);
  assert.throws(() => applyDemoMovement(data, { ...receipt, id: 'issue', kind: 'issue', quantity: 11 }), /insufficient stock/);
  const next = applyDemoMovement(data, { ...receipt, id: 'issue', kind: 'issue', quantity: 7.125 });
  assert.equal(dashboard(next).low.length, 1);
  const expired = applyDemoMovement(initial, { ...receipt, expires_on: daysFromNow(-1) });
  assert.throws(() => applyDemoMovement(expired, { ...receipt, id: 'issue', kind: 'issue', quantity: 1 }), /Expired lots/);
});

test('receipts for the same lot cannot silently change expiry and respect decimal precision', () => {
  const data = applyDemoMovement(initial, receipt);
  assert.throws(() => applyDemoMovement(data, { ...receipt, id: 'other', expires_on: daysFromNow(2) }), /different supplier or expiry/);
  assert.throws(() => applyDemoMovement(initial, { ...receipt, quantity: 0.0009 }), /three decimals/);
});
