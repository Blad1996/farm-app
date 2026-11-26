import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { mockStorage } from './helpers/storage.mjs';
import { amountByCurrency, addFarmDays } from '../app/farm-types.ts';

test('farm operations keep stock, payments and maintenance schedules consistent', async t => {
  const db = new PGlite();
  const admin = '30000000-0000-4000-8000-000000000001', foreign = '30000000-0000-4000-8000-000000000002', operator = '30000000-0000-4000-8000-000000000003';
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key); insert into auth.users values('${admin}'),('${foreign}'),('${operator}');
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
      grant usage on schema auth,public to anon,authenticated;
      grant execute on function auth.jwt(),auth.uid() to anon,authenticated;`);
    await mockStorage(db);
    const directory = new URL('../supabase/migrations/', import.meta.url);
    for (const file of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(file, directory), 'utf8'));
    async function asUser(user, aal = 'aal2', role = 'authenticated') {
      await db.exec('reset role'); await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, aal, role })]); await db.exec(`set role ${role}`);
    }
    await asUser(admin);
    const company = (await db.query("select public.create_inventory_company('Working farm') as company")).rows[0].company.id;
    const today = (await db.query("select (now() at time zone 'America/Caracas')::date::text as today")).rows[0].today;
    const yesterday = addFarmDays(today, -1), nextDue = addFarmDays(today, 90);
    const warehouse = (await db.query("insert into public.warehouses(company_id,name) values($1,'Seed store') returning id", [company])).rows[0].id;
    const product = (await db.query("insert into public.products(company_id,name,sku,category,unit) values($1,'Sowing wheat','S-W','Seed','kg') returning id", [company])).rows[0].id;
    await db.query('select public.post_inventory_movement($1,$2::jsonb)', [company, JSON.stringify({ id: crypto.randomUUID(), kind: 'receipt', product_id: product, warehouse_id: warehouse, lot_code: 'SEEDS', quantity: 100, expires_on: '2099-01-01' })]);
    await db.exec('reset role'); await db.query("insert into public.company_members values($1,$2,'operator')", [company, operator]); await asUser(admin);
    const save = (kind, record, request = crypto.randomUUID(), tenant = company) => db.query('select public.save_farm_record($1,$2,$3,$4::jsonb) as id', [tenant, request, kind, JSON.stringify(record)]);
    const snapshot = async () => (await db.query('select public.farm_snapshot($1) as data', [company])).rows[0].data;
    const balance = async () => Number((await db.query('select quantity from public.stock where company_id=$1', [company])).rows[0].quantity);
    const crop = { id: crypto.randomUUID(), name: 'North wheat', crop_type: 'Wheat', variety: 'Spring', field_name: 'North field', area: 1.5, area_unit: 'ha', planted_on: yesterday, expected_harvest_on: addFarmDays(today, 100), status: 'growing', notes: '' };
    const irrigation = { id: crypto.randomUUID(), crop_id: crop.id, occurred_on: today, method: 'drip', volume_litres: 1000, duration_minutes: 45, status: 'planned', amount_paid: 0, currency: 'CAD', notes: '' };
    const asset = { id: crypto.randomUUID(), name: 'Tractor 1', category: 'machinery', asset_type: 'tractor', registration: 'TR-001', make_model: 'Farm tractor', purchased_on: yesterday, purchase_paid: 1000, currency: 'USD', status: 'active', maintenance_interval_days: 90, next_maintenance_on: yesterday, notes: '' };

    await t.test('crop management and planned irrigation become paid records exactly once', async () => {
      await save('crop', crop); await save('irrigation', irrigation);
      let data = await snapshot(); assert.equal(data.crops[0].area, 1.5);
      assert.ok(data.alerts.some(alert => alert.kind === 'irrigation' && alert.id === irrigation.id));
      assert.equal(data.expenses.length, 0);
      const completed = { ...irrigation, status: 'completed', amount_paid: 15 }, request = crypto.randomUUID();
      await save('irrigation', completed, request); await save('irrigation', completed, request);
      data = await snapshot(); assert.equal(data.irrigation[0].status, 'completed'); assert.equal(data.expenses.length, 1); assert.equal(data.expenses[0].amount, 15);
      assert.ok(!data.alerts.some(alert => alert.id === irrigation.id));
      await assert.rejects(save('irrigation', { ...completed, amount_paid: 20 }), /cannot be changed/);
      await assert.rejects(save('irrigation', { ...irrigation, id: crypto.randomUUID(), amount_paid: 10 }), /check constraint/);
    });
    await t.test('seed distributions debit the selected lot and record payments atomically', async () => {
      const distribution = { id: crypto.randomUUID(), crop_id: crop.id, product_id: product, warehouse_id: warehouse, lot_code: 'SEEDS', occurred_on: today, recipient: 'North team', quantity: 10, amount_paid: 20, currency: 'CAD' };
      const request = crypto.randomUUID(); await save('seed', distribution, request); await save('seed', distribution, request);
      assert.equal(await balance(), 90);
      const data = await snapshot(); assert.equal(data.seeds.length, 1); assert.equal(data.seeds[0].lot_code, 'SEEDS');
      assert.equal(data.expenses.filter(expense => expense.source_type === 'seed').length, 1);
      await assert.rejects(save('seed', { ...distribution, quantity: 11 }, request), /already used/);
      await assert.rejects(save('seed', { ...distribution, id: crypto.randomUUID(), quantity: 999 }), /insufficient stock/);
      await assert.rejects(save('seed', { ...distribution, id: crypto.randomUUID(), currency: 'FAKE' }), /check constraint/);
      assert.equal(await balance(), 90, 'a failed payment validation rolls back the stock issue');
      await db.query('select public.post_inventory_movement($1,$2::jsonb)', [company, JSON.stringify({ id: crypto.randomUUID(), kind: 'receipt', product_id: product, warehouse_id: warehouse, lot_code: 'EXPIRED', quantity: 1, expires_on: '2000-01-01' })]);
      await assert.rejects(save('seed', { ...distribution, id: crypto.randomUUID(), lot_code: 'EXPIRED', quantity: 1 }), /Expired lots/);
    });
    await t.test('vehicle and machinery services advance alerts and preserve newer schedules', async () => {
      await save('asset', asset);
      let data = await snapshot(); assert.ok(data.alerts.some(alert => alert.id === asset.id && alert.overdue));
      const service = { id: crypto.randomUUID(), asset_id: asset.id, serviced_on: today, next_due_on: nextDue, description: 'Oil and filters', provider: 'Workshop', amount_paid: 75, currency: 'USD' };
      const request = crypto.randomUUID(); await save('maintenance', service, request); await save('maintenance', service, request);
      data = await snapshot(); assert.equal(data.assets[0].next_maintenance_on, nextDue); assert.equal(data.maintenance.length, 1);
      assert.ok(!data.alerts.some(alert => alert.id === asset.id));
      await save('maintenance', { ...service, id: crypto.randomUUID(), serviced_on: yesterday, next_due_on: addFarmDays(today, 10), amount_paid: 25 });
      data = await snapshot(); assert.equal(data.assets[0].next_maintenance_on, nextDue, 'historical service does not overwrite a newer date');
      await assert.rejects(save('asset', { ...asset, purchase_paid: 2000 }), /immutable/);
      const retired = { ...asset, id: crypto.randomUUID(), name: 'Retired truck', category: 'vehicle', status: 'retired', purchase_paid: 0 };
      await save('asset', retired); assert.ok(!(await snapshot()).alerts.some(alert => alert.id === retired.id));
    });
    await t.test('payments are grouped per currency and automatic sources are not counted twice', async () => {
      await save('expense', { id: crypto.randomUUID(), crop_id: '', asset_id: asset.id, category: 'fuel', description: 'Diesel', paid_on: today, amount: 7, currency: 'USD' });
      const data = await snapshot(), totals = amountByCurrency(data.expenses.map(expense => ({ amount: expense.amount, currency: expense.currency })));
      assert.deepEqual(totals, [{ currency: 'CAD', amount: 35 }, { currency: 'USD', amount: 1107 }]);
      assert.equal(data.expenses.filter(expense => expense.source_type === 'asset').length, 1);
    });
    await t.test('notification preferences affect local dates and do not enable sending without Gmail', async () => {
      const preferences = { id: company, enabled: false, recipients: [`${admin}@example.test`], lead_days: 14, timezone: 'America/Caracas', maintenance: true, irrigation: true, harvest: false };
      await save('notifications', preferences); assert.equal((await snapshot()).settings.lead_days, 14);
      await assert.rejects(save('notifications', { ...preferences, enabled: true }), /Connect Gmail/);
      await assert.rejects(save('notifications', { ...preferences, timezone: 'Invalid/Zone' }), /time zone/);
      await assert.rejects(save('notifications', { ...preferences, recipients: ['bad\r\nBcc: victim@example.test'] }), /valid recipient/);
      await assert.rejects(db.query('select * from public.farm_email_accounts'), /permission denied/);
    });
    await t.test('MFA, roles and tenant boundaries protect every new operation', async () => {
      await asUser(operator); assert.equal((await snapshot()).can_manage, false);
      await assert.rejects(save('crop', { ...crop, id: crypto.randomUUID() }), /permission/);
      await asUser(foreign); assert.equal((await db.query('select * from public.farm_crops')).rows.length, 0);
      await assert.rejects(snapshot(), /permission/); await assert.rejects(save('maintenance', { id: crypto.randomUUID() }), /permission/);
      await asUser(admin, 'aal1'); assert.equal((await db.query('select * from public.farm_assets')).rows.length, 0);
      await assert.rejects(snapshot(), /Two-step/); await assert.rejects(save('expense', { id: crypto.randomUUID() }), /Two-step/);
      await asUser(admin); await assert.rejects(db.query("update public.farm_assets set next_maintenance_on=current_date"), /permission denied/);
      await assert.rejects(db.query('delete from public.farm_expenses'), /permission denied/);
      await asUser(null, 'aal1', 'anon'); await assert.rejects(snapshot(), /permission denied/);
    });
  } finally { await db.close(); }
});
