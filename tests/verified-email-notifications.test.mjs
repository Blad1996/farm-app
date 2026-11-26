import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { mockStorage } from './helpers/storage.mjs';

test('notification addresses come only from verified account identity', async t => {
  const db = new PGlite(), admin = '40000000-0000-4000-8000-000000000001', foreign = '40000000-0000-4000-8000-000000000002';
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key); insert into auth.users values('${admin}'),('${foreign}');
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
      grant usage on schema auth,public to anon,authenticated; grant execute on function auth.jwt(),auth.uid() to anon,authenticated;`);
    await mockStorage(db);
    const directory = new URL('../supabase/migrations/', import.meta.url);
    for (const file of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(file, directory), 'utf8'));
    async function asUser(user, aal = 'aal2', role = 'authenticated') {
      await db.exec('reset role'); await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, aal, role })]); await db.exec(`set role ${role}`);
    }
    await asUser(admin);
    const company = (await db.query("select public.create_inventory_company('Mail farm') as c")).rows[0].c.id;
    const crop = { id: crypto.randomUUID(), name: 'Crop reminder', crop_type: 'Corn', field_name: 'Field', area: 1, area_unit: 'ha', status: 'growing', expected_harvest_on: '2000-01-01' };
    await db.query('select public.save_farm_record($1,$2,$3,$4)', [company, crypto.randomUUID(), 'crop', JSON.stringify(crop)]);
    // Synthetic ciphertext only. No SMTP transport or real account is used.
    await db.query('select public.save_farm_email_account($1,$2,$3)', [company, 'sender@gmail.example', `v1:${Buffer.alloc(64).toString('base64')}`]);
    const settings = { enabled: true, lead_days: 7, timezone: 'America/Caracas', maintenance: true, irrigation: true, harvest: true };
    const save = data => db.query('select public.save_farm_notification_preferences($1,$2)', [company, JSON.stringify(data)]);
    const claim = async () => (await db.query('select public.claim_farm_email_jobs(5) as jobs')).rows[0].jobs;
    const context = job => db.query('select public.farm_email_delivery_context($1,$2,$3) as context', [company, job.delivery_date, job.claim_token]);
    let job;
    await t.test('caller-provided destinations are ignored and legacy redirection is blocked', async () => {
      await save({ ...settings, recipients: ['outsider@example.test'], recipient_user_id: foreign });
      const row = (await db.query('select * from public.farm_notification_settings')).rows[0];
      assert.deepEqual(row.recipients, [`${admin}@example.test`]); assert.equal(row.recipient_user_id, admin);
      await assert.rejects(db.query('select public.save_farm_record($1,$2,$3,$4)', [company, crypto.randomUUID(), 'notifications', JSON.stringify({ id: company, ...settings, recipients: ['outsider@example.test'] })]), /only be sent to your verified/);
      await assert.rejects(db.query("update public.farm_notification_settings set recipients=array['outsider@example.test']"), /permission denied/);
      await assert.rejects(db.query('select public.claim_farm_email_jobs(5)'), /permission denied/);
      await assert.rejects(db.query('select * from public.farm_email_accounts'), /permission denied/);
    });
    await t.test('daily claims cannot be duplicated and recipient is resolved again at send time', async () => {
      await asUser(null, '', 'service_role');
      const jobs = await claim(); assert.equal(jobs.length, 1); job = jobs[0];
      assert.deepEqual(await claim(), []);
      assert.equal((await context(job)).rows[0].context.recipient, `${admin}@example.test`);
      await db.exec('reset role'); await db.query("update auth.users set email='new-verified@example.test' where id=$1", [admin]); await asUser(null, '', 'service_role');
      assert.equal((await context(job)).rows[0].context.recipient, 'new-verified@example.test', 'the cached address array is not used');
      await assert.rejects(context({ ...job, claim_token: crypto.randomUUID() }), /no longer authorized/);
    });
    await t.test('unverified and removed accounts lose delivery authorization', async () => {
      await db.exec('reset role'); await db.query('update auth.users set email_confirmed_at=null where id=$1', [admin]);
      await asUser(null, '', 'service_role'); await assert.rejects(context(job), /no longer authorized/);
      await asUser(admin); await assert.rejects(save(settings), /Confirm your account email/);
      await db.exec('reset role'); await db.query('update auth.users set email_confirmed_at=now() where id=$1', [admin]);
      await db.query('delete from public.company_members where company_id=$1 and user_id=$2', [company, admin]);
      await asUser(null, '', 'service_role'); await assert.rejects(context(job), /no longer authorized/);
      await db.exec('reset role'); await db.query("insert into public.company_members values($1,$2,'admin')", [company, admin]);
    });
    await t.test('ambiguous SMTP outcomes are not automatically retried', async () => {
      await asUser(null, '', 'service_role');
      await db.query('select public.finish_farm_email_job($1,$2,$3,$4,$5)', [company, job.delivery_date, job.claim_token, 'uncertain', 'smtp_result_unknown']);
      assert.deepEqual(await claim(), []);
      await assert.rejects(db.query('select public.finish_farm_email_job($1,$2,$3,$4,$5)', [company, job.delivery_date, job.claim_token, 'sent', '']), /no longer valid/);
    });
    await t.test('AAL1 and foreign users cannot configure Gmail or preferences', async () => {
      await asUser(admin, 'aal1'); await assert.rejects(save(settings), /Two-step/);
      await asUser(foreign); await assert.rejects(save(settings), /permission/);
      await assert.rejects(db.query('select public.get_farm_email_secret($1,false)', [company]), /permission/);
      await asUser(admin); await db.query('select public.claim_farm_gmail_attempt($1)', [company]);
      await assert.rejects(db.query('select public.claim_farm_gmail_attempt($1)', [company]), /Wait one minute/);
    });
    await t.test('deleting the recipient account disables preferences without blocking deletion', async () => {
      await db.exec('reset role');
      await db.query('delete from auth.users where id=$1', [admin]);
      const row = (await db.query('select * from public.farm_notification_settings where company_id=$1', [company])).rows[0];
      assert.equal(row.enabled, false); assert.equal(row.recipient_user_id, null); assert.deepEqual(row.recipients, []);
    });
  } finally { await db.close(); }
});
