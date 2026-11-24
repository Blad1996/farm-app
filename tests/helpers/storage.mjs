// Models only storage metadata/RLS for local PostgreSQL tests, not the S3 API.
export async function mockStorage(db) {
  await db.exec(`create schema storage;
    create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets,name text not null,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated;
    grant select,insert,update,delete on storage.objects to anon,authenticated;
    -- Deliberately broad existing rules: the migration must still protect its bucket.
    create policy broad_existing_read on storage.objects for select to public using(true);
    create policy broad_existing_insert on storage.objects for insert to public with check(true);
    create policy broad_existing_update on storage.objects for update to public using(true) with check(true);
    create policy broad_existing_delete on storage.objects for delete to public using(true);`);
}
