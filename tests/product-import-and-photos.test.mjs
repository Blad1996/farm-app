import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { mockStorage } from './helpers/storage.mjs';

test('product imports and private photo metadata preserve tenant and MFA restrictions', async t => {
  const db = new PGlite();
  const admin = '20000000-0000-4000-8000-000000000001', foreign = '20000000-0000-4000-8000-000000000002', operator = '20000000-0000-4000-8000-000000000003';
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key); insert into auth.users values('${admin}'),('${foreign}'),('${operator}');
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
      grant usage on schema auth,public to anon,authenticated;
      grant execute on function auth.jwt(),auth.uid() to anon,authenticated;`);
    await mockStorage(db);
    const directory = new URL('../supabase/migrations/', import.meta.url);
    for (const filename of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(filename, directory), 'utf8'));
    await db.exec("insert into storage.buckets(id,name) values('existing-bucket','existing-bucket'); insert into storage.objects(bucket_id,name,metadata) values('existing-bucket','existing-file','{}');");
    async function asUser(user, aal = 'aal2', role = 'authenticated') {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, aal })]);
      await db.exec(`set role ${role}`);
    }
    await asUser(admin);
    const company = (await db.query("select public.create_inventory_company('Import farm') as company")).rows[0].company.id;
    await db.exec('reset role'); await db.query("insert into public.company_members values($1,$2,'operator')", [company, operator]);
    await asUser(foreign);
    const otherCompany = (await db.query("select public.create_inventory_company('Foreign farm') as company")).rows[0].company.id;
    await asUser(admin);
    const rows = [{ name: 'CSV Wheat', sku: 'CSV-W', category: 'Grain', unit: 'kg', minimum: 2.125 }, { name: 'CSV Seed', sku: 'CSV-S', category: 'Seed', unit: 'bag', minimum: 0 }];
    const batch = crypto.randomUUID();
    const runImport = (id = batch, data = rows, tenant = company) => db.query('select public.import_inventory_products($1,$2,$3::jsonb) as count', [tenant, id, JSON.stringify(data)]);
    let productId, photoPath;
    const uploadMetadata = path => db.query("insert into storage.objects(bucket_id,name,metadata) values('product-photos',$1,$2::jsonb)", [path, JSON.stringify({ mimetype: 'image/webp', size: 2000 })]);
    const setPhoto = path => db.query('select public.set_inventory_product_photo($1,$2,$3) as previous', [company, productId, path]);

    await t.test('CSV batches are atomic, preserve stock, and remain idempotent across retries', async () => {
      assert.equal((await runImport()).rows[0].count, 2); assert.equal((await runImport()).rows[0].count, 2);
      assert.equal((await db.query('select * from public.products')).rows.length, 2);
      assert.equal((await db.query('select * from public.stock')).rows.length, 0);
      await assert.rejects(runImport(batch, [{ ...rows[0], name: 'Changed' }]), /already used/);
      await assert.rejects(runImport(crypto.randomUUID(), [{ ...rows[0], sku: 'NEW' }, rows[1]]), /unique constraint/);
      assert.equal((await db.query("select * from public.products where sku='NEW'")).rows.length, 0);
      await assert.rejects(runImport(crypto.randomUUID(), [{ ...rows[0], sku: 'NEW' }, { ...rows[1], sku: 'INVALID', unit: 'wrong' }]), /check constraint/);
      assert.equal((await db.query("select * from public.products where sku='NEW'")).rows.length, 0);
      assert.equal((await db.query('select * from public.product_imports')).rows.length, 1);
      await assert.rejects(runImport(crypto.randomUUID(), Array.from({ length: 501 }, () => rows[0])), /500/);
      productId = (await db.query("select id from public.products where sku='CSV-W'")).rows[0].id;
      photoPath = `${company}/${productId}/${crypto.randomUUID()}.webp`;
    });

    await t.test('private bucket limits and scoped photos support attachment, replacement and safe cleanup', async () => {
      await db.exec('reset role');
      const bucket = (await db.query("select * from storage.buckets where id='product-photos'")).rows[0];
      assert.equal(bucket.public, false); assert.equal(Number(bucket.file_size_limit), 5242880);
      assert.deepEqual(bucket.allowed_mime_types, ['image/jpeg', 'image/png', 'image/webp']);
      await asUser(admin);
      await assert.rejects(setPhoto(photoPath), /Upload a valid product photo first/);
      await uploadMetadata(photoPath);
      assert.equal((await setPhoto(photoPath)).rows[0].previous, null);
      let snapshot = (await db.query('select public.inventory_snapshot($1) as data', [company])).rows[0].data;
      assert.equal(snapshot.products.find(product => product.id === productId).photo_path, photoPath);
      assert.equal((await db.query('delete from storage.objects where name=$1 returning id', [photoPath])).rows.length, 0, 'current photo cannot be deleted');
      assert.equal((await db.query("update storage.objects set metadata='{}' where name=$1 returning id", [photoPath])).rows.length, 0, 'photo objects cannot be overwritten');
      const next = `${company}/${productId}/${crypto.randomUUID()}.webp`; await uploadMetadata(next);
      assert.equal((await setPhoto(next)).rows[0].previous, photoPath);
      assert.equal((await db.query('delete from storage.objects where name=$1 returning id', [photoPath])).rows.length, 1, 'unreferenced prior photo can be removed');
      photoPath = next;
      await assert.rejects(setPhoto(`${otherCompany}/${productId}/${crypto.randomUUID()}.webp`), /does not belong/);
    });

    await t.test('operators can view company photos but cannot import, upload, replace or delete them', async () => {
      await asUser(operator);
      assert.equal((await db.query("select * from storage.objects where bucket_id='product-photos'")).rows.length, 1);
      await assert.rejects(runImport(crypto.randomUUID()), /Only workspace administrators/);
      await assert.rejects(setPhoto(null), /Only workspace administrators/);
      await assert.rejects(uploadMetadata(`${company}/${productId}/${crypto.randomUUID()}.webp`), /row-level security/);
      assert.equal((await db.query('delete from storage.objects where name=$1 returning id', [photoPath])).rows.length, 0);
    });

    await t.test('foreign tenants, AAL1 and anonymous users cannot access photos despite broad existing policies', async () => {
      for (const [user, aal, role] of [[foreign, 'aal2', 'authenticated'], [admin, 'aal1', 'authenticated'], [null, 'aal1', 'anon']]) {
        await asUser(user, aal, role);
        assert.equal((await db.query("select * from storage.objects where bucket_id='product-photos'")).rows.length, 0);
        assert.equal((await db.query("select * from storage.objects where bucket_id='existing-bucket'")).rows.length, 1, 'existing bucket policies remain unchanged');
        await assert.rejects(uploadMetadata(`${company}/${productId}/${crypto.randomUUID()}.webp`), /row-level security/);
        assert.equal((await db.query('delete from storage.objects where name=$1 returning id', [photoPath])).rows.length, 0);
        await assert.rejects(runImport(crypto.randomUUID()), /administrators|Two-step|permission denied/);
        await assert.rejects(setPhoto(null), /administrators|Two-step|permission denied/);
      }
      await asUser(admin);
      const previous = (await setPhoto(null)).rows[0].previous; assert.equal(previous, photoPath);
      assert.equal((await db.query('delete from storage.objects where name=$1 returning id', [previous])).rows.length, 1);
    });
  } finally { await db.close(); }
});
