import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { mockStorage } from './helpers/storage.mjs';
import { defaultAppearance, normalizeAppearance, appearanceVariables, contrastRatio, resolveTheme } from '../app/appearance-values.ts';

test('custom colors remain readable and theme preferences override company defaults', () => {
  for (const primary_color of ['#ffffff', '#000000', '#ffff00', '#777777', '#0000ff', '#276447']) {
    for (const theme of ['light', 'dark']) {
      const vars = appearanceVariables({ ...defaultAppearance, primary_color }, theme);
      assert.ok(contrastRatio(primary_color, vars['--on-primary']) >= 4.5);
      assert.ok(contrastRatio(vars['--accent-text'], theme === 'dark' ? '#18222d' : '#ffffff') >= 4.5);
    }
  }
  const sanitized = normalizeAppearance({ primary_color: 'url(https://example.test)', font_family: '__proto__', corner_style: 'invalid' });
  assert.equal(sanitized.primary_color, defaultAppearance.primary_color);
  assert.equal(sanitized.font_family, 'system');
  assert.equal(resolveTheme('company', 'dark', false), 'dark');
  assert.equal(resolveTheme('light', 'dark', true), 'light');
  assert.equal(resolveTheme('system', 'light', true), 'dark');
});

test('company appearance and private logos enforce tenant, role and MFA boundaries', async t => {
  const db = new PGlite(), admin = crypto.randomUUID(), operator = crypto.randomUUID(), foreign = crypto.randomUUID();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key); insert into auth.users values('${admin}'),('${operator}'),('${foreign}');
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
      grant usage on schema auth,public to anon,authenticated; grant execute on function auth.jwt(),auth.uid() to anon,authenticated;`);
    await mockStorage(db);
    const directory = new URL('../supabase/migrations/', import.meta.url);
    for (const file of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(file, directory), 'utf8'));
    async function asUser(user, aal = 'aal2', role = 'authenticated') {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, aal, role })]);
      await db.exec(`set role ${role}`);
    }
    await asUser(admin);
    const company = (await db.query("select public.create_inventory_company('Appearance farm') as c")).rows[0].c.id;
    await db.exec('reset role'); await db.query("insert into public.company_members values($1,$2,'operator')", [company, operator]);
    await asUser(admin);
    const settings = { ...defaultAppearance, brand_name: 'My Farm', primary_color: '#123456', font_family: 'georgia', default_theme: 'dark' };
    const save = value => db.query('select public.save_company_appearance($1,$2)', [company, JSON.stringify(value)]);
    const snapshot = async () => (await db.query('select public.company_appearance_snapshot($1) as s', [company])).rows[0].s;
    const path = `${company}/${crypto.randomUUID()}.png`;
    const attach = value => db.query('select public.set_company_logo($1,$2) as previous', [company, value]);
    await t.test('admin settings persist, reject invalid CSS and prohibit direct writes', async () => {
      await save(settings); assert.equal((await snapshot()).settings.default_theme, 'dark');
      assert.equal((await snapshot()).settings.font_family, 'georgia');
      await assert.rejects(save({ ...settings, primary_color: 'red; background:url(x)' }), /check constraint/);
      await assert.rejects(save({ ...settings, font_family: 'external-font' }), /check constraint/);
      await assert.rejects(db.query("update public.company_appearance set brand_name='Other'"), /permission denied/);
      assert.equal((await snapshot()).settings.brand_name, 'My Farm');
    });
    await t.test('private logo attachment validates upload and protects current references', async () => {
      await assert.rejects(attach(path), /valid company logo/);
      await db.query("insert into storage.objects(bucket_id,name,metadata) values('company-logos',$1,$2)", [path, JSON.stringify({ mimetype: 'image/png', size: 500 })]);
      await attach(path); await save({ ...settings, logo_path: null });
      assert.equal((await snapshot()).settings.logo_path, path, 'saving colors preserves the logo');
      assert.equal((await db.query("delete from storage.objects where name=$1 returning name", [path])).rows.length, 0);
      assert.equal((await db.query("update storage.objects set metadata='{}' where name=$1 returning name", [path])).rows.length, 0);
      await assert.rejects(attach(`${foreign}/${crypto.randomUUID()}.png`), /does not belong/);
    });
    await t.test('operators can view appearance but cannot edit or upload', async () => {
      await asUser(operator); assert.equal((await snapshot()).can_manage, false);
      assert.equal((await db.query('select * from storage.objects where name=$1', [path])).rows.length, 1);
      await assert.rejects(save(settings), /administrators/); await assert.rejects(attach(null), /administrators/);
      await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('company-logos',$1)", [`${company}/${crypto.randomUUID()}.png`]), /row-level security/);
    });
    await t.test('foreign, AAL1 and anonymous sessions cannot access private branding', async () => {
      for (const [user, aal, role] of [[foreign, 'aal2', 'authenticated'], [admin, 'aal1', 'authenticated'], [null, '', 'anon']]) {
        await asUser(user, aal, role);
        await assert.rejects(snapshot()); await assert.rejects(save(settings)); await assert.rejects(attach(path));
        assert.equal((await db.query('select * from storage.objects where name=$1', [path])).rows.length, 0);
      }
    });
    await t.test('detaching permits cleanup and unrelated storage buckets keep their policies', async () => {
      await asUser(admin); assert.equal((await attach(null)).rows[0].previous, path);
      assert.equal((await db.query('delete from storage.objects where name=$1 returning name', [path])).rows.length, 1);
      await db.exec('reset role'); await db.exec("insert into storage.buckets(id,name) values('other','other')");
      await asUser(null, '', 'anon');
      await db.exec("insert into storage.objects(bucket_id,name) values('other','unrelated.txt')");
      assert.equal((await db.query("select * from storage.objects where bucket_id='other'")).rows.length, 1);
    });
  } finally { await db.close(); }
});
