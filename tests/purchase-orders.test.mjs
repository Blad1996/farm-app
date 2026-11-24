import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { mockStorage } from './helpers/storage.mjs';

test('purchase order lifecycle and database authorization', async t => {
  const db = new PGlite();
  const admin = '10000000-0000-4000-8000-000000000001';
  const outsider = '10000000-0000-4000-8000-000000000002';
  const operator = '10000000-0000-4000-8000-000000000003';
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      insert into auth.users values ('${admin}'),('${outsider}'),('${operator}');
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
      grant usage on schema auth,public to anon,authenticated;
      grant execute on function auth.jwt(),auth.uid() to anon,authenticated;`);
    await mockStorage(db);
    const directory = new URL('../supabase/migrations/', import.meta.url);
    for (const migration of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
      await db.exec(await readFile(new URL(migration, directory), 'utf8'));
    }
    async function asUser(user, aal = 'aal2', role = 'authenticated') {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, aal })]);
      await db.exec(`set role ${role}`);
    }
    await asUser(admin);
    const company = (await db.query("select public.create_inventory_company('Farm A') as company")).rows[0].company.id;
    const supplier = (await db.query("insert into public.suppliers(company_id,name) values($1,'Seed supplier') returning id", [company])).rows[0].id;
    const warehouse = (await db.query("insert into public.warehouses(company_id,name) values($1,'Receiving') returning id", [company])).rows[0].id;
    const product = (await db.query("insert into public.products(company_id,name,sku,category,unit) values($1,'Wheat','WHEAT','Grain','kg') returning id", [company])).rows[0].id;
    const secondProduct = (await db.query("insert into public.products(company_id,name,sku,category,unit) values($1,'Seed','SEED','Seed','bag') returning id", [company])).rows[0].id;
    await db.exec('reset role');
    await db.query("insert into public.company_members values($1,$2,'operator')", [company, operator]);
    await asUser(outsider);
    const otherCompany = (await db.query("select public.create_inventory_company('Farm B') as company")).rows[0].company.id;
    const foreignProduct = (await db.query("insert into public.products(company_id,name,sku,category,unit) values($1,'Foreign','F','Grain','kg') returning id", [otherCompany])).rows[0].id;
    await asUser(admin);
    const baseOrder = () => ({ id: crypto.randomUUID(), supplier_id: supplier, warehouse_id: warehouse, currency: 'CAD', expected_on: '2027-01-20', notes: 'Delivery to receiving dock',
      lines: [{ product_id: product, quantity: 10, unit_price: 2.35 }, { product_id: secondProduct, quantity: 4, unit_price: 12.50 }] });
    const create = order => db.query('select public.create_purchase_order($1,$2::jsonb) as id', [company, JSON.stringify(order)]);
    const snapshot = async () => (await db.query('select public.purchase_orders_snapshot($1) as snapshot', [company])).rows[0].snapshot;
    const orderDetails = async id => (await snapshot()).orders.find(order => order.id === id);
    const inventory = async () => (await db.query('select public.inventory_snapshot($1) as snapshot', [company])).rows[0].snapshot;
    const change = (id, action, reason = '') => db.query('select public.change_purchase_order_status($1,$2,$3,$4)', [company, id, action, reason]);
    const receive = (id, receipt) => db.query('select public.receive_purchase_order($1,$2,$3::jsonb)', [company, id, JSON.stringify(receipt)]);
    const draft = baseOrder();
    let firstLine;
    let secondLine;
    let firstReceipt;

    await t.test('drafts persist products, supplier, warehouse, prices and totals without changing stock', async () => {
      await create(draft); await create(draft);
      const data = await snapshot();
      assert.equal(data.orders.length, 1, 'create retries do not duplicate the order');
      assert.equal(data.can_manage, true);
      const order = data.orders[0];
      assert.equal(order.status, 'draft'); assert.equal(order.total, 73.50);
      assert.equal(order.supplier_id, supplier); assert.equal(order.warehouse_id, warehouse);
      assert.equal(order.expected_on, '2027-01-20'); assert.equal(order.lines.length, 2);
      assert.equal((await inventory()).stock.length, 0);
      firstLine = order.lines.find(line => line.product_id === product);
      secondLine = order.lines.find(line => line.product_id === secondProduct);
      firstReceipt = { id: crypto.randomUUID(), line_id: firstLine.id, quantity: 3, lot_code: 'W-1', expires_on: '2027-10-01', reference: 'Delivery 1' };
      await assert.rejects(receive(draft.id, firstReceipt), /Only confirmed, open/);
      await assert.rejects(create({ ...draft, notes: 'Changed' }), /already used/);
    });

    await t.test('confirmed orders allow partial receipts exactly once and create linked stock movements', async () => {
      await change(draft.id, 'confirm'); await change(draft.id, 'confirm');
      await receive(draft.id, firstReceipt); await receive(draft.id, firstReceipt);
      const order = await orderDetails(draft.id);
      assert.equal(order.status, 'partially_received');
      assert.equal(order.lines.find(line => line.id === firstLine.id).received_quantity, 3);
      assert.equal(order.receipts.length, 1);
      assert.equal(order.receipts[0].lot_code, 'W-1');
      assert.equal(order.receipts[0].expires_on, '2027-10-01');
      const stock = await inventory();
      assert.equal(stock.stock[0].quantity, 3); assert.equal(stock.movements.length, 1);
      assert.equal(stock.movements[0].id, firstReceipt.id);
      assert.match(stock.movements[0].reference, /^PO-\d+ \/ Delivery 1$/);
      assert.equal(stock.lots[0].supplier_id, supplier);
      await assert.rejects(receive(draft.id, { ...firstReceipt, quantity: 4 }), /already used/);
    });

    await t.test('over-receipt, conflicting lots and movement ID collisions leave order and stock unchanged', async () => {
      await assert.rejects(receive(draft.id, { ...firstReceipt, id: crypto.randomUUID(), quantity: 8 }), /exceeds/);
      await assert.rejects(receive(draft.id, { ...firstReceipt, id: crypto.randomUUID(), quantity: 1, expires_on: '2028-01-01' }), /different supplier or expiry/);
      const collision = crypto.randomUUID();
      await db.query('select public.post_inventory_movement($1,$2::jsonb)', [company, JSON.stringify({ id: collision, kind: 'receipt', product_id: product, lot_code: 'DIRECT', warehouse_id: warehouse, quantity: 1 })]);
      await assert.rejects(receive(draft.id, { ...firstReceipt, id: collision, quantity: 1 }), /already used by another inventory movement/);
      const order = await orderDetails(draft.id);
      assert.equal(order.receipts.length, 1); assert.equal(order.lines.find(line => line.id === firstLine.id).received_quantity, 3);
      assert.equal((await inventory()).movements.length, 2);
    });

    await t.test('operators can receive but cannot create or manage orders; foreign and AAL1 sessions are blocked', async () => {
      await asUser(operator);
      assert.equal((await snapshot()).can_manage, false);
      await assert.rejects(create(baseOrder()), /Only workspace administrators/);
      await assert.rejects(change(draft.id, 'cancel', 'No longer needed'), /Only workspace administrators/);
      await receive(draft.id, { ...firstReceipt, id: crypto.randomUUID(), quantity: 7 });
      assert.equal((await orderDetails(draft.id)).status, 'partially_received', 'second product is still outstanding');
      await asUser(admin, 'aal1');
      for (const table of ['purchase_orders', 'purchase_order_lines', 'purchase_order_receipts']) assert.deepEqual((await db.query(`select * from public.${table}`)).rows, []);
      await assert.rejects(snapshot(), /Two-step verification/);
      await assert.rejects(create(baseOrder()), /Two-step verification/);
      await assert.rejects(change(draft.id, 'confirm'), /Two-step verification/);
      await assert.rejects(receive(draft.id, firstReceipt), /Two-step verification/);
      await asUser(outsider);
      assert.deepEqual((await db.query('select * from public.purchase_orders')).rows, []);
      await assert.rejects(snapshot(), /do not have access/);
      await assert.rejects(receive(draft.id, firstReceipt), /do not have access/);
      await assert.rejects(change(draft.id, 'cancel', 'Test'), /Only workspace administrators/);
      await asUser(admin);
      await assert.rejects(db.query("update public.purchase_orders set status='received' where id=$1", [draft.id]), /permission denied/);
      await assert.rejects(db.query('update public.purchase_order_lines set received_quantity=quantity where order_id=$1', [draft.id]), /permission denied/);
      await assert.rejects(db.query('delete from public.purchase_order_receipts where order_id=$1', [draft.id]), /permission denied/);
    });

    await t.test('final receipt completes the order; committed receipt retries remain safe', async () => {
      const receipt = { id: crypto.randomUUID(), line_id: secondLine.id, quantity: 4, lot_code: 'S-1', expires_on: null, reference: '' };
      await receive(draft.id, receipt);
      assert.equal((await orderDetails(draft.id)).status, 'received');
      const before = await inventory();
      await receive(draft.id, receipt);
      assert.deepEqual(await inventory(), before);
      await assert.rejects(receive(draft.id, { ...receipt, id: crypto.randomUUID(), quantity: 1 }), /Only confirmed, open/);
      await assert.rejects(change(draft.id, 'cancel', 'Late cancellation'), /Completed orders/);
    });

    await t.test('cancelling outstanding quantities preserves earlier receipts and prevents further receipts', async () => {
      const order = baseOrder(); await create(order); await change(order.id, 'confirm');
      const line = (await orderDetails(order.id)).lines.find(item => item.product_id === product);
      const receipt = { id: crypto.randomUUID(), line_id: line.id, quantity: 2, lot_code: 'CANCEL-TEST', expires_on: null, reference: '' };
      await receive(order.id, receipt);
      const before = await inventory();
      await assert.rejects(change(order.id, 'cancel'), /cancellation reason/);
      await change(order.id, 'cancel', 'Supplier cannot deliver the balance');
      const cancelled = await orderDetails(order.id);
      assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.cancellation_reason, 'Supplier cannot deliver the balance');
      assert.equal(cancelled.lines.find(item => item.id === line.id).received_quantity, 2);
      await assert.rejects(receive(order.id, { ...receipt, id: crypto.randomUUID() }), /Only confirmed, open/);
      assert.deepEqual(await inventory(), before);
    });

    await t.test('invalid lines, foreign products and unsupported currency roll back draft creation', async () => {
      const count = (await snapshot()).orders.length;
      await assert.rejects(create({ ...baseOrder(), lines: [] }), /between 1 and 100/);
      await assert.rejects(create({ ...baseOrder(), lines: [{ product_id: foreignProduct, quantity: 1, unit_price: 1 }] }), /foreign key/);
      await assert.rejects(create({ ...baseOrder(), lines: [{ product_id: product, quantity: 0.0001, unit_price: 1 }] }), /three decimals/);
      await assert.rejects(create({ ...baseOrder(), lines: [{ product_id: product, quantity: 1, unit_price: 1.001 }] }), /two decimals/);
      await assert.rejects(create({ ...baseOrder(), currency: 'FAKE' }), /check constraint/);
      assert.equal((await snapshot()).orders.length, count);
      await asUser(null, 'aal1', 'anon');
      await assert.rejects(snapshot(), /permission denied/);
      await assert.rejects(create(baseOrder()), /permission denied/);
    });
  } finally { await db.close(); }
});
