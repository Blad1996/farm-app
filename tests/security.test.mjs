import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('PostgreSQL enforces MFA, tenant isolation and atomic inventory writes', async () => {
  const db = new PGlite();
  const owner = '00000000-0000-4000-8000-000000000001';
  const stranger = '00000000-0000-4000-8000-000000000002';
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create table auth.users (id uuid primary key);
      insert into auth.users values ('${owner}'), ('${stranger}');
      create function auth.jwt() returns jsonb language sql stable as
        $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as
        $$ select (auth.jwt()->>'sub')::uuid $$;
      grant usage on schema auth, public to anon, authenticated;
      grant execute on function auth.jwt(), auth.uid() to anon, authenticated;
    `);
    for (const filename of ['20261123000000_inventory.sql', '20261124000000_require_mfa.sql']) {
      await db.exec(await readFile(new URL(`../supabase/migrations/${filename}`, import.meta.url), 'utf8'));
    }
    async function asUser(userId, aal = 'aal1', role = 'authenticated') {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: userId, aal })]);
      await db.exec(`set role ${role}`);
    }
    await asUser(null, 'aal1', 'anon');
    await assert.rejects(db.query('select * from public.companies'), /permission denied/);
    await assert.rejects(db.query("select public.create_inventory_company('Unauthorized')"), /permission denied/);

    await asUser(owner);
    await assert.rejects(db.query("select public.create_inventory_company('Farm A')"), /Two-step verification is required/);
    assert.equal((await db.query('select public.inventory_security_status() as ready')).rows[0].ready, false);

    await asUser(owner, 'aal2');
    assert.equal((await db.query('select public.inventory_security_status() as ready')).rows[0].ready, true);
    const company = (await db.query("select public.create_inventory_company('Farm A') as company")).rows[0].company.id;
    const product = (await db.query("insert into public.products (company_id,name,sku,category,unit) values ($1,'Rice','RICE','Grain','kg') returning id", [company])).rows[0].id;
    const warehouse = (await db.query("insert into public.warehouses (company_id,name) values ($1,'Main') returning id", [company])).rows[0].id;
    const move = { id: '00000000-0000-4000-8000-000000000003', kind: 'receipt', product_id: product, lot_code: 'LOT-1', warehouse_id: warehouse, quantity: 20 };
    const post = input => db.query('select public.post_inventory_movement($1,$2::jsonb)', [company, JSON.stringify(input)]);

    await asUser(owner);
    for (const table of ['companies', 'company_members', 'products', 'warehouses', 'suppliers', 'lots', 'stock', 'movements']) {
      assert.deepEqual((await db.query(`select * from public.${table}`)).rows, [], `AAL1 cannot read ${table}`);
    }
    await assert.rejects(post(move), /Two-step verification is required/);
    await assert.rejects(db.query("insert into public.warehouses (company_id,name) values ($1,'Bypass')", [company]), /row-level security/);
    assert.equal((await db.query('select public.inventory_snapshot($1) as snapshot', [company])).rows[0].snapshot, null);

    await asUser(stranger, 'aal2');
    assert.deepEqual((await db.query('select * from public.companies')).rows, []);
    await assert.rejects(post(move), /do not have access/);
    await assert.rejects(db.query("insert into public.warehouses (company_id,name) values ($1,'Foreign')", [company]), /row-level security/);

    await asUser(owner, 'aal2');
    await post(move); await post(move);
    let snapshot = (await db.query('select public.inventory_snapshot($1) as snapshot', [company])).rows[0].snapshot;
    assert.equal(snapshot.stock[0].quantity, 20);
    assert.equal(snapshot.movements.length, 1, 'retry does not duplicate stock');
    await assert.rejects(post({ ...move, id: '00000000-0000-4000-8000-000000000004', kind: 'issue', quantity: 21 }), /insufficient stock/);
    snapshot = (await db.query('select public.inventory_snapshot($1) as snapshot', [company])).rows[0].snapshot;
    assert.equal(snapshot.stock[0].quantity, 20, 'failed issue leaves stock unchanged');
    await assert.rejects(db.query('update public.stock set quantity=999 where company_id=$1', [company]), /permission denied/);
    await assert.rejects(db.query("insert into public.company_members values ($1,$2,'admin')", [company, stranger]), /permission denied/);

    // A downgraded or stolen password-only session stays blocked after enrollment.
    await asUser(owner);
    await assert.rejects(post(move), /Two-step verification is required/);
  } finally { await db.close(); }
});
