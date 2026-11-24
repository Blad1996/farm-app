begin;

alter table public.products add column photo_path text;
alter table public.products add constraint product_photo_path_scope check (
  photo_path is null or (photo_path like company_id::text || '/' || id::text || '/%'
    and photo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|png|jpg)$')
);

create table public.product_imports (
  company_id uuid not null references public.companies,
  batch_id uuid not null,
  rows jsonb not null,
  imported integer not null check(imported between 1 and 500),
  created_at timestamptz not null default now(),
  primary key(company_id,batch_id)
);
alter table public.product_imports enable row level security;
revoke all on public.product_imports from public,anon,authenticated;
grant select on public.product_imports to authenticated;
create policy read_product_imports on public.product_imports for select to authenticated using (
  exists(select 1 from public.company_members m where m.company_id=product_imports.company_id and m.user_id=(select auth.uid()))
);
create policy require_import_mfa on public.product_imports as restrictive for all to authenticated
  using ((select auth.jwt()->>'aal')='aal2') with check ((select auth.jwt()->>'aal')='aal2');

create function public.import_inventory_products(p_company uuid,p_batch uuid,p_rows jsonb)
returns integer language plpgsql security definer set search_path=''
as $$
declare previous public.product_imports%rowtype; row_data jsonb; minimum_value numeric; total integer;
begin
  perform public.require_inventory_mfa();
  if not exists(select 1 from public.company_members m where m.company_id=p_company and m.user_id=auth.uid() and m.role='admin') then
    raise exception 'Only workspace administrators can import products.' using errcode='42501';
  end if;
  if p_batch is null then raise exception 'An import batch ID is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company::text || p_batch::text,53));
  select b.* into previous from public.product_imports b where b.company_id=p_company and b.batch_id=p_batch;
  if found then
    if previous.rows is distinct from p_rows then raise exception 'This import ID was already used for different products.'; end if;
    return previous.imported;
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Provide a product array.'; end if;
  total:=jsonb_array_length(p_rows);
  if total not between 1 and 500 then raise exception 'Import between 1 and 500 products at a time.'; end if;
  for row_data in select value from jsonb_array_elements(p_rows) loop
    minimum_value:=coalesce((row_data->>'minimum')::numeric,0);
    if not(minimum_value >= 0 and minimum_value <= 999999999) or minimum_value<>round(minimum_value,3) then
      raise exception 'Minimum stock must be non-negative with up to three decimals.';
    end if;
    insert into public.products(company_id,name,sku,category,unit,minimum)
      values(p_company,trim(row_data->>'name'),upper(trim(row_data->>'sku')),trim(row_data->>'category'),row_data->>'unit',minimum_value);
  end loop;
  insert into public.product_imports(company_id,batch_id,rows,imported) values(p_company,p_batch,p_rows,total);
  return total;
end $$;
revoke all on function public.import_inventory_products(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.import_inventory_products(uuid,uuid,jsonb) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('product-photos','product-photos',false,5242880,array['image/jpeg','image/png','image/webp'])
  on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp'];

-- Narrow permission helper for this bucket, including anonymous denial. The
-- definer only returns a boolean and always binds access to auth.uid() and MFA.
create function public.can_access_product_photo(p_name text,p_write boolean default false,p_delete boolean default false)
returns boolean language sql stable security definer set search_path=''
as $$
  select coalesce(auth.jwt()->>'aal','')='aal2'
    and p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|png|jpg)$'
    and exists(select 1 from public.products p join public.company_members m on m.company_id=p.company_id
      where p.company_id::text=split_part(p_name,'/',1) and p.id::text=split_part(p_name,'/',2)
      and m.user_id=auth.uid() and (not p_write or m.role='admin'))
    and (not p_delete or not exists(select 1 from public.products p where p.photo_path=p_name));
$$;
revoke all on function public.can_access_product_photo(text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.can_access_product_photo(text,boolean,boolean) to anon,authenticated;

create policy read_product_photo on storage.objects for select to authenticated
  using(bucket_id='product-photos' and public.can_access_product_photo(name));
create policy upload_product_photo on storage.objects for insert to authenticated
  with check(bucket_id='product-photos' and public.can_access_product_photo(name,true));
create policy delete_unused_product_photo on storage.objects for delete to authenticated
  using(bucket_id='product-photos' and public.can_access_product_photo(name,true,true));
-- Restrictive policies prevent broad policies for unrelated buckets from
-- accidentally granting access to this bucket. Existing buckets are unaffected.
create policy protect_product_photo_reads on storage.objects as restrictive for select to public
  using(bucket_id<>'product-photos' or public.can_access_product_photo(name));
create policy protect_product_photo_uploads on storage.objects as restrictive for insert to public
  with check(bucket_id<>'product-photos' or public.can_access_product_photo(name,true));
create policy protect_product_photo_updates on storage.objects as restrictive for update to public
  using(bucket_id<>'product-photos') with check(bucket_id<>'product-photos');
create policy protect_product_photo_deletes on storage.objects as restrictive for delete to public
  using(bucket_id<>'product-photos' or public.can_access_product_photo(name,true,true));

create function public.set_inventory_product_photo(p_company uuid,p_product uuid,p_path text)
returns text language plpgsql security definer set search_path=''
as $$
declare old_path text;
begin
  perform public.require_inventory_mfa();
  if not exists(select 1 from public.company_members m where m.company_id=p_company and m.user_id=auth.uid() and m.role='admin') then
    raise exception 'Only workspace administrators can manage product photos.' using errcode='42501';
  end if;
  select p.photo_path into old_path from public.products p where p.company_id=p_company and p.id=p_product for update;
  if not found then raise exception 'Product not found.'; end if;
  if p_path is not null then
    if not (p_path like p_company::text || '/' || p_product::text || '/%') or not public.can_access_product_photo(p_path,true) then
      raise exception 'The photo does not belong to this product.' using errcode='42501';
    end if;
    if not exists(select 1 from storage.objects o where o.bucket_id='product-photos' and o.name=p_path
      and o.metadata->>'mimetype' in ('image/jpeg','image/png','image/webp')
      and (o.metadata->>'size')::bigint between 1 and 5242880) then raise exception 'Upload a valid product photo first.'; end if;
  end if;
  update public.products set photo_path=p_path where company_id=p_company and id=p_product;
  return old_path;
end $$;
revoke all on function public.set_inventory_product_photo(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.set_inventory_product_photo(uuid,uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
