begin;
create table public.company_appearance (
  company_id uuid primary key references public.companies,
  brand_name text not null default '' check(length(brand_name)<=100),
  tagline text not null default 'Agriculture & food' check(length(tagline)<=80),
  primary_color text not null default '#276447' check(primary_color ~ '^#[0-9a-fA-F]{6}$'),
  sidebar_color text not null default '#142b21' check(sidebar_color ~ '^#[0-9a-fA-F]{6}$'),
  font_family text not null default 'system' check(font_family in ('system','arial','verdana','georgia','trebuchet')),
  font_size text not null default 'standard' check(font_size in ('standard','large','extra_large')),
  default_theme text not null default 'system' check(default_theme in ('system','light','dark')),
  corner_style text not null default 'rounded' check(corner_style in ('square','soft','rounded')),
  logo_path text,updated_at timestamptz not null default now(),
  check(logo_path is null or (logo_path like company_id::text||'/%' and logo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|png|jpg)$'))
);
alter table public.company_appearance enable row level security;
revoke all on public.company_appearance from public,anon,authenticated;
grant select on public.company_appearance to authenticated;
create policy read_company_appearance on public.company_appearance for select to authenticated using(
  exists(select 1 from public.company_members m where m.company_id=company_appearance.company_id and m.user_id=(select auth.uid()))
);
create policy require_appearance_mfa on public.company_appearance as restrictive for all to authenticated
  using((select auth.jwt()->>'aal')='aal2') with check((select auth.jwt()->>'aal')='aal2');

create function public.company_appearance_snapshot(p_company uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$ begin
  perform public.require_inventory_mfa();
  if not exists(select 1 from public.company_members m where m.company_id=p_company and m.user_id=auth.uid()) then
    raise exception 'Workspace access is unavailable.' using errcode='42501';
  end if;
  return jsonb_build_object('settings',(select to_jsonb(a)-'company_id' from public.company_appearance a where a.company_id=p_company),
    'can_manage',exists(select 1 from public.company_members m where m.company_id=p_company and m.user_id=auth.uid() and m.role='admin'));
end $$;

create function public.save_company_appearance(p_company uuid,p_settings jsonb)
returns void language plpgsql security definer set search_path='' as $$ begin
  perform public.require_inventory_mfa();
  if not exists(select 1 from public.company_members m where m.company_id=p_company and m.user_id=auth.uid() and m.role='admin') then
    raise exception 'Only workspace administrators can change company appearance.' using errcode='42501';
  end if;
  insert into public.company_appearance(company_id,brand_name,tagline,primary_color,sidebar_color,font_family,font_size,default_theme,corner_style)
    values(p_company,trim(coalesce(p_settings->>'brand_name','')),trim(coalesce(p_settings->>'tagline','')),
      p_settings->>'primary_color',p_settings->>'sidebar_color',p_settings->>'font_family',p_settings->>'font_size',p_settings->>'default_theme',p_settings->>'corner_style')
    on conflict(company_id) do update set brand_name=excluded.brand_name,tagline=excluded.tagline,primary_color=excluded.primary_color,sidebar_color=excluded.sidebar_color,
      font_family=excluded.font_family,font_size=excluded.font_size,default_theme=excluded.default_theme,corner_style=excluded.corner_style,updated_at=now();
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('company-logos','company-logos',false,5242880,array['image/jpeg','image/png','image/webp'])
  on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp'];

create function public.can_access_company_logo(p_name text,p_write boolean default false,p_delete boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(auth.jwt()->>'aal','')='aal2' and p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|png|jpg)$'
    and exists(select 1 from public.company_members m where m.company_id::text=split_part(p_name,'/',1) and m.user_id=auth.uid() and (not p_write or m.role='admin'))
    and (not p_delete or not exists(select 1 from public.company_appearance a where a.logo_path=p_name));
$$;
revoke all on function public.can_access_company_logo(text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.can_access_company_logo(text,boolean,boolean) to anon,authenticated;
create policy read_company_logos on storage.objects for select to authenticated using(bucket_id='company-logos' and public.can_access_company_logo(name));
create policy upload_company_logos on storage.objects for insert to authenticated with check(bucket_id='company-logos' and public.can_access_company_logo(name,true));
create policy delete_unused_company_logos on storage.objects for delete to authenticated using(bucket_id='company-logos' and public.can_access_company_logo(name,true,true));
create policy protect_company_logo_reads on storage.objects as restrictive for select to public using(bucket_id<>'company-logos' or public.can_access_company_logo(name));
create policy protect_company_logo_uploads on storage.objects as restrictive for insert to public with check(bucket_id<>'company-logos' or public.can_access_company_logo(name,true));
create policy protect_company_logo_updates on storage.objects as restrictive for update to public using(bucket_id<>'company-logos') with check(bucket_id<>'company-logos');
create policy protect_company_logo_deletes on storage.objects as restrictive for delete to public using(bucket_id<>'company-logos' or public.can_access_company_logo(name,true,true));

create function public.set_company_logo(p_company uuid,p_path text)
returns text language plpgsql security definer set search_path='' as $$ declare previous text; begin
  perform public.require_inventory_mfa();
  if not exists(select 1 from public.company_members m where m.company_id=p_company and m.user_id=auth.uid() and m.role='admin') then
    raise exception 'Only workspace administrators can change the company logo.' using errcode='42501';
  end if;
  if p_path is not null then
    if split_part(p_path,'/',1)<>p_company::text or not public.can_access_company_logo(p_path,true) then raise exception 'The logo does not belong to this workspace.' using errcode='42501'; end if;
    if not exists(select 1 from storage.objects o where o.bucket_id='company-logos' and o.name=p_path
      and o.metadata->>'mimetype' in ('image/jpeg','image/png','image/webp') and (o.metadata->>'size')::bigint between 1 and 5242880) then raise exception 'Upload a valid company logo first.'; end if;
  end if;
  insert into public.company_appearance(company_id) values(p_company) on conflict(company_id) do nothing;
  select a.logo_path into previous from public.company_appearance a where a.company_id=p_company for update;
  update public.company_appearance set logo_path=p_path,updated_at=now() where company_id=p_company;
  return previous;
end $$;
revoke all on function public.company_appearance_snapshot(uuid),public.save_company_appearance(uuid,jsonb),public.set_company_logo(uuid,text) from public,anon,authenticated;
grant execute on function public.company_appearance_snapshot(uuid),public.save_company_appearance(uuid,jsonb),public.set_company_logo(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
