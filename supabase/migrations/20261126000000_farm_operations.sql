begin;

create table public.farm_crops (
  company_id uuid not null references public.companies,id uuid not null,
  name text not null check(length(trim(name)) between 1 and 100),crop_type text not null check(length(trim(crop_type)) between 1 and 60),
  variety text not null default '' check(length(variety)<=100),field_name text not null check(length(trim(field_name)) between 1 and 100),
  area numeric(15,3) not null check(area>0),area_unit text not null check(area_unit in ('ha','acre','m2')),
  planted_on date,expected_harvest_on date,status text not null check(status in ('planned','growing','harvested','cancelled')),
  notes text not null default '' check(length(notes)<=1000),created_at timestamptz not null default now(),
  primary key(company_id,id),check(expected_harvest_on is null or planted_on is null or expected_harvest_on>=planted_on)
);
create table public.farm_irrigation (
  company_id uuid not null,id uuid not null,crop_id uuid not null,occurred_on date not null,
  method text not null check(method in ('drip','sprinkler','surface','manual','other')),
  volume_litres numeric(15,3) not null check(volume_litres>=0),duration_minutes integer not null check(duration_minutes between 1 and 10080),
  status text not null check(status in ('planned','completed','cancelled')),
  amount_paid numeric(15,2) not null check(amount_paid>=0),currency text not null check(currency in ('CAD','USD','EUR','GBP','MXN','BRL','COP','VES')),
  notes text not null default '' check(length(notes)<=1000),primary key(company_id,id),
  foreign key(company_id,crop_id) references public.farm_crops,
  check(status='completed' or amount_paid=0)
);
create table public.farm_assets (
  company_id uuid not null references public.companies,id uuid not null,
  name text not null check(length(trim(name)) between 1 and 100),category text not null check(category in ('vehicle','machinery')),
  asset_type text not null check(asset_type in ('truck','pickup','tractor','harvester','pump','trailer','other')),
  registration text not null default '' check(length(registration)<=60),make_model text not null default '' check(length(make_model)<=100),
  purchased_on date,purchase_paid numeric(15,2) not null default 0 check(purchase_paid>=0),
  currency text not null check(currency in ('CAD','USD','EUR','GBP','MXN','BRL','COP','VES')),
  status text not null check(status in ('active','in_maintenance','retired')),
  maintenance_interval_days integer not null check(maintenance_interval_days between 1 and 3650),
  next_maintenance_on date not null,last_service_on date,
  notes text not null default '' check(length(notes)<=1000),primary key(company_id,id),
  check(purchase_paid=0 or purchased_on is not null),check(last_service_on is null or next_maintenance_on>last_service_on)
);
create table public.farm_maintenance (
  company_id uuid not null,id uuid not null,asset_id uuid not null,serviced_on date not null,next_due_on date not null,
  description text not null check(length(trim(description)) between 1 and 300),provider text not null default '' check(length(provider)<=100),
  amount_paid numeric(15,2) not null check(amount_paid>=0),currency text not null check(currency in ('CAD','USD','EUR','GBP','MXN','BRL','COP','VES')),
  primary key(company_id,id),foreign key(company_id,asset_id) references public.farm_assets,check(next_due_on>serviced_on)
);
create table public.farm_seed_distributions (
  company_id uuid not null,id uuid not null,crop_id uuid not null,product_id uuid not null,movement_id uuid not null,
  occurred_on date not null,recipient text not null default '' check(length(recipient)<=100),
  quantity numeric(15,3) not null check(quantity>0),amount_paid numeric(15,2) not null check(amount_paid>=0),
  currency text not null check(currency in ('CAD','USD','EUR','GBP','MXN','BRL','COP','VES')),
  primary key(company_id,id),foreign key(company_id,crop_id) references public.farm_crops,
  foreign key(company_id,product_id) references public.products,foreign key(company_id,movement_id) references public.movements,
  unique(company_id,movement_id)
);
create table public.farm_expenses (
  company_id uuid not null references public.companies,id uuid not null default gen_random_uuid(),crop_id uuid,asset_id uuid,
  category text not null check(category in ('seeds','irrigation','equipment','maintenance','fuel','labor','other')),
  description text not null check(length(trim(description)) between 1 and 300),paid_on date not null,
  amount numeric(15,2) not null check(amount>0),currency text not null check(currency in ('CAD','USD','EUR','GBP','MXN','BRL','COP','VES')),
  source_type text not null,source_id uuid not null,primary key(company_id,id),unique(company_id,source_type,source_id),
  foreign key(company_id,crop_id) references public.farm_crops,foreign key(company_id,asset_id) references public.farm_assets
);
create table public.farm_write_requests (
  company_id uuid not null references public.companies,id uuid not null,kind text not null,record_id uuid not null,payload jsonb not null,
  primary key(company_id,id)
);
create table public.farm_notification_settings (
  company_id uuid primary key references public.companies,enabled boolean not null default false,
  recipients text[] not null default '{}',lead_days integer not null default 7 check(lead_days between 1 and 90),
  timezone text not null default 'America/Caracas',maintenance boolean not null default true,irrigation boolean not null default true,harvest boolean not null default false
);
create table public.farm_email_accounts (
  company_id uuid primary key references public.companies,email text not null,ciphertext text not null,
  connected_at timestamptz not null default now(),last_test_at timestamptz,
  check(length(email)<=254 and email ~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$'),
  check(length(ciphertext) between 50 and 4096 and ciphertext ~ '^v1:[A-Za-z0-9+/=]+$')
);
create table public.farm_email_deliveries (
  company_id uuid not null references public.companies,delivery_date date not null,state text not null check(state in ('pending','sending','sent','failed','uncertain')),
  claim_token uuid,claimed_at timestamptz,sent_at timestamptz,error_code text not null default '',attempts integer not null default 0,
  primary key(company_id,delivery_date)
);

do $$ declare t text; begin
  foreach t in array array['farm_crops','farm_irrigation','farm_assets','farm_maintenance','farm_seed_distributions','farm_expenses','farm_write_requests','farm_notification_settings','farm_email_accounts','farm_email_deliveries'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    if t not in ('farm_write_requests','farm_email_accounts') then
      execute format('grant select on public.%I to authenticated',t);
      execute format('create policy read_farm_company on public.%I for select to authenticated using
        (exists(select 1 from public.company_members m where m.company_id=%I.company_id and m.user_id=(select auth.uid())))',t,t);
      execute format('create policy require_farm_mfa on public.%I as restrictive for all to authenticated
        using((select auth.jwt()->>''aal'')=''aal2'') with check((select auth.jwt()->>''aal'')=''aal2'')',t);
    end if;
  end loop;
end $$;

create function public.require_farm_access(p_company uuid,p_write boolean default false)
returns void language plpgsql security definer set search_path='' as $$ begin
  if coalesce(auth.jwt()->>'role','')='service_role' then return; end if;
  perform public.require_inventory_mfa();
  if not exists(select 1 from public.company_members m where m.company_id=p_company and m.user_id=auth.uid() and (not p_write or m.role='admin')) then
    raise exception 'You do not have permission for this farm operation.' using errcode='42501';
  end if;
end $$;
revoke all on function public.require_farm_access(uuid,boolean) from public,anon,authenticated;
grant execute on function public.require_farm_access(uuid,boolean) to authenticated,service_role;

create function public.farm_number(p_value text,p_money boolean default false,p_allow_zero boolean default false)
returns numeric language plpgsql immutable set search_path='' as $$ declare n numeric; begin
  n:=coalesce(nullif(p_value,''),'0')::numeric;
  if not(n>=0 and n<=999999999) or (not p_allow_zero and n=0) or n<>round(n,case when p_money then 2 else 3 end) then
    raise exception 'Check the amount or quantity and its decimal precision.';
  end if; return n;
end $$;
revoke all on function public.farm_number(text,boolean,boolean) from public,anon,authenticated;

create function public.save_farm_record(p_company uuid,p_request uuid,p_kind text,p_record jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid:=(p_record->>'id')::uuid; old_request public.farm_write_requests%rowtype;
  qty numeric; paid numeric; crop uuid:=nullif(p_record->>'crop_id','')::uuid; asset uuid:=nullif(p_record->>'asset_id','')::uuid;
  cur text:=coalesce(p_record->>'currency','CAD'); date_value date:=nullif(p_record->>'occurred_on','')::date;
  old_irrigation public.farm_irrigation%rowtype; old_asset public.farm_assets%rowtype; crop_name text;
  recipient_list text[]; addr text;
begin
  perform public.require_farm_access(p_company,true);
  if rid is null or p_request is null or jsonb_typeof(p_record) is distinct from 'object' then raise exception 'Record and request IDs are required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company::text||p_request::text,61));
  select r.* into old_request from public.farm_write_requests r where r.company_id=p_company and r.id=p_request;
  if found then
    if old_request.kind is distinct from p_kind or old_request.payload is distinct from p_record then raise exception 'This request ID was already used for different details.'; end if;
    return old_request.record_id;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company::text||rid::text,67));
  if p_kind='crop' then
    insert into public.farm_crops(company_id,id,name,crop_type,variety,field_name,area,area_unit,planted_on,expected_harvest_on,status,notes)
      values(p_company,rid,trim(p_record->>'name'),p_record->>'crop_type',coalesce(p_record->>'variety',''),trim(p_record->>'field_name'),
        public.farm_number(p_record->>'area'),p_record->>'area_unit',nullif(p_record->>'planted_on','')::date,nullif(p_record->>'expected_harvest_on','')::date,
        p_record->>'status',coalesce(p_record->>'notes',''))
      on conflict(company_id,id) do update set name=excluded.name,crop_type=excluded.crop_type,variety=excluded.variety,field_name=excluded.field_name,
        area=excluded.area,area_unit=excluded.area_unit,planted_on=excluded.planted_on,expected_harvest_on=excluded.expected_harvest_on,status=excluded.status,notes=excluded.notes;
  elsif p_kind='irrigation' then
    paid:=public.farm_number(p_record->>'amount_paid',true,true);
    select i.* into old_irrigation from public.farm_irrigation i where i.company_id=p_company and i.id=rid for update;
    if found and old_irrigation.status<>'planned' then raise exception 'Completed or cancelled irrigation records cannot be changed.'; end if;
    insert into public.farm_irrigation(company_id,id,crop_id,occurred_on,method,volume_litres,duration_minutes,status,amount_paid,currency,notes)
      values(p_company,rid,crop,date_value,p_record->>'method',public.farm_number(p_record->>'volume_litres',false,true),
        (p_record->>'duration_minutes')::integer,p_record->>'status',paid,cur,coalesce(p_record->>'notes',''))
      on conflict(company_id,id) do update set crop_id=excluded.crop_id,occurred_on=excluded.occurred_on,method=excluded.method,volume_litres=excluded.volume_litres,
        duration_minutes=excluded.duration_minutes,status=excluded.status,amount_paid=excluded.amount_paid,currency=excluded.currency,notes=excluded.notes;
    if p_record->>'status'='completed' and paid>0 then
      insert into public.farm_expenses(company_id,crop_id,category,description,paid_on,amount,currency,source_type,source_id)
        values(p_company,crop,'irrigation','Irrigation payment',date_value,paid,cur,'irrigation',rid);
    end if;
  elsif p_kind='seed' then
    qty:=public.farm_number(p_record->>'quantity'); paid:=public.farm_number(p_record->>'amount_paid',true,true);
    select c.name into crop_name from public.farm_crops c where c.company_id=p_company and c.id=crop;
    if not found then raise exception 'Select a crop in this workspace.'; end if;
    perform pg_advisory_xact_lock(hashtextextended(p_company::text||rid::text,31));
    if exists(select 1 from public.movements m where m.company_id=p_company and m.id=rid) then raise exception 'This distribution ID is already used by a movement.'; end if;
    perform public.post_inventory_movement(p_company,jsonb_build_object('id',rid,'kind','issue','product_id',p_record->>'product_id',
      'warehouse_id',p_record->>'warehouse_id','lot_code',p_record->>'lot_code','quantity',qty,'reference','Seed distribution / '||crop_name));
    insert into public.farm_seed_distributions(company_id,id,crop_id,product_id,movement_id,occurred_on,recipient,quantity,amount_paid,currency)
      values(p_company,rid,crop,(p_record->>'product_id')::uuid,rid,date_value,coalesce(p_record->>'recipient',''),qty,paid,cur);
    if paid>0 then insert into public.farm_expenses(company_id,crop_id,category,description,paid_on,amount,currency,source_type,source_id)
      values(p_company,crop,'seeds','Seed distribution payment',date_value,paid,cur,'seed',rid); end if;
  elsif p_kind='asset' then
    paid:=public.farm_number(p_record->>'purchase_paid',true,true);
    select a.* into old_asset from public.farm_assets a where a.company_id=p_company and a.id=rid for update;
    if found and (old_asset.purchase_paid<>paid or old_asset.currency<>cur or old_asset.purchased_on is distinct from nullif(p_record->>'purchased_on','')::date) then
      raise exception 'Purchase payments are immutable. Record additional costs separately.';
    end if;
    insert into public.farm_assets(company_id,id,name,category,asset_type,registration,make_model,purchased_on,purchase_paid,currency,status,maintenance_interval_days,next_maintenance_on,notes)
      values(p_company,rid,trim(p_record->>'name'),p_record->>'category',p_record->>'asset_type',coalesce(p_record->>'registration',''),coalesce(p_record->>'make_model',''),
        nullif(p_record->>'purchased_on','')::date,paid,cur,p_record->>'status',(p_record->>'maintenance_interval_days')::integer,(p_record->>'next_maintenance_on')::date,coalesce(p_record->>'notes',''))
      on conflict(company_id,id) do update set name=excluded.name,category=excluded.category,asset_type=excluded.asset_type,registration=excluded.registration,
        make_model=excluded.make_model,status=excluded.status,maintenance_interval_days=excluded.maintenance_interval_days,next_maintenance_on=excluded.next_maintenance_on,notes=excluded.notes;
    if paid>0 and not exists(select 1 from public.farm_expenses e where e.company_id=p_company and e.source_type='asset' and e.source_id=rid) then
      insert into public.farm_expenses(company_id,asset_id,category,description,paid_on,amount,currency,source_type,source_id)
        values(p_company,rid,'equipment','Equipment purchase payment',(p_record->>'purchased_on')::date,paid,cur,'asset',rid);
    end if;
  elsif p_kind='maintenance' then
    paid:=public.farm_number(p_record->>'amount_paid',true,true);
    perform 1 from public.farm_assets a where a.company_id=p_company and a.id=asset for update;
    if not found then raise exception 'Select a vehicle or machine in this workspace.'; end if;
    insert into public.farm_maintenance(company_id,id,asset_id,serviced_on,next_due_on,description,provider,amount_paid,currency)
      values(p_company,rid,asset,(p_record->>'serviced_on')::date,(p_record->>'next_due_on')::date,trim(p_record->>'description'),coalesce(p_record->>'provider',''),paid,cur);
    update public.farm_assets set last_service_on=(p_record->>'serviced_on')::date,next_maintenance_on=(p_record->>'next_due_on')::date,
      status=case when status='in_maintenance' then 'active' else status end
      where company_id=p_company and id=asset and (last_service_on is null or last_service_on<=(p_record->>'serviced_on')::date);
    if paid>0 then insert into public.farm_expenses(company_id,asset_id,category,description,paid_on,amount,currency,source_type,source_id)
      values(p_company,asset,'maintenance',trim(p_record->>'description'),(p_record->>'serviced_on')::date,paid,cur,'maintenance',rid); end if;
  elsif p_kind='expense' then
    insert into public.farm_expenses(company_id,id,crop_id,asset_id,category,description,paid_on,amount,currency,source_type,source_id)
      values(p_company,rid,crop,asset,p_record->>'category',trim(p_record->>'description'),(p_record->>'paid_on')::date,
        public.farm_number(p_record->>'amount',true),cur,'manual',rid);
  elsif p_kind='notifications' then
    if jsonb_typeof(p_record->'recipients') is distinct from 'array' or jsonb_array_length(p_record->'recipients')>10 then raise exception 'Choose up to ten notification recipients.'; end if;
    select coalesce(array_agg(distinct lower(trim(value))),'{}') into recipient_list from jsonb_array_elements_text(p_record->'recipients');
    foreach addr in array recipient_list loop
      if length(addr)>254 or addr !~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$' then raise exception 'Enter valid recipient email addresses.'; end if;
    end loop;
    if coalesce((p_record->>'enabled')::boolean,false) and (cardinality(recipient_list)=0 or not exists(select 1 from public.farm_email_accounts a where a.company_id=p_company)) then
      raise exception 'Connect Gmail and add a recipient before enabling notifications.';
    end if;
    if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_record->>'timezone') then raise exception 'Choose a valid time zone.'; end if;
    insert into public.farm_notification_settings(company_id,enabled,recipients,lead_days,timezone,maintenance,irrigation,harvest)
      values(p_company,(p_record->>'enabled')::boolean,recipient_list,(p_record->>'lead_days')::integer,p_record->>'timezone',
        (p_record->>'maintenance')::boolean,(p_record->>'irrigation')::boolean,(p_record->>'harvest')::boolean)
      on conflict(company_id) do update set enabled=excluded.enabled,recipients=excluded.recipients,lead_days=excluded.lead_days,timezone=excluded.timezone,
        maintenance=excluded.maintenance,irrigation=excluded.irrigation,harvest=excluded.harvest;
  else raise exception 'Unknown farm record type.';
  end if;
  insert into public.farm_write_requests(company_id,id,kind,record_id,payload) values(p_company,p_request,p_kind,rid,p_record);
  return rid;
end $$;

create function public.farm_alerts(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare local_today date; horizon integer; result jsonb;
begin
  perform public.require_farm_access(p_company);
  select (now() at time zone coalesce(s.timezone,'America/Caracas'))::date,coalesce(s.lead_days,7) into local_today,horizon
    from (select 1) x left join public.farm_notification_settings s on s.company_id=p_company;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.due_on,a.name),'[]'::jsonb) into result from (
    select 'maintenance'::text as kind,id,name,next_maintenance_on as due_on,next_maintenance_on<local_today as overdue
      from public.farm_assets where company_id=p_company and status<>'retired' and next_maintenance_on<=local_today+horizon
    union all select 'irrigation',i.id,c.name,i.occurred_on,i.occurred_on<local_today from public.farm_irrigation i join public.farm_crops c on c.company_id=i.company_id and c.id=i.crop_id
      where i.company_id=p_company and i.status='planned' and i.occurred_on<=local_today+horizon
    union all select 'harvest',id,name,expected_harvest_on,expected_harvest_on<local_today from public.farm_crops
      where company_id=p_company and status='growing' and expected_harvest_on<=local_today+horizon
  ) a; return result;
end $$;

create function public.farm_snapshot(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
  perform public.require_farm_access(p_company);
  return jsonb_build_object(
    'can_manage',exists(select 1 from public.company_members m where m.company_id=p_company and m.user_id=auth.uid() and m.role='admin'),
    'crops',coalesce((select jsonb_agg(to_jsonb(c)-'company_id' order by c.created_at desc) from public.farm_crops c where c.company_id=p_company),'[]'::jsonb),
    'irrigation',coalesce((select jsonb_agg(to_jsonb(i)-'company_id' order by i.occurred_on desc) from public.farm_irrigation i where i.company_id=p_company),'[]'::jsonb),
    'seeds',coalesce((select jsonb_agg(to_jsonb(s)-'company_id'||jsonb_build_object('lot_code',lot.code,'warehouse_id',m.warehouse_id) order by s.occurred_on desc)
      from public.farm_seed_distributions s join public.movements m on m.company_id=s.company_id and m.id=s.movement_id
      join public.lots lot on lot.company_id=m.company_id and lot.id=m.lot_id where s.company_id=p_company),'[]'::jsonb),
    'assets',coalesce((select jsonb_agg(to_jsonb(a)-'company_id' order by a.name) from public.farm_assets a where a.company_id=p_company),'[]'::jsonb),
    'maintenance',coalesce((select jsonb_agg(to_jsonb(m)-'company_id' order by m.serviced_on desc) from public.farm_maintenance m where m.company_id=p_company),'[]'::jsonb),
    'expenses',coalesce((select jsonb_agg(to_jsonb(e)-'company_id' order by e.paid_on desc) from public.farm_expenses e where e.company_id=p_company),'[]'::jsonb),
    'settings',(select to_jsonb(s)-'company_id' from public.farm_notification_settings s where s.company_id=p_company),
    'email_account',(select jsonb_build_object('email',a.email,'connected_at',a.connected_at) from public.farm_email_accounts a where a.company_id=p_company),
    'deliveries',coalesce((select jsonb_agg(to_jsonb(d)-'company_id'-'claim_token' order by d.delivery_date desc) from public.farm_email_deliveries d where d.company_id=p_company),'[]'::jsonb),
    'alerts',public.farm_alerts(p_company));
end $$;

create function public.save_farm_email_account(p_company uuid,p_email text,p_ciphertext text)
returns void language plpgsql security definer set search_path='' as $$ begin
  perform public.require_farm_access(p_company,true);
  insert into public.farm_email_accounts(company_id,email,ciphertext) values(p_company,lower(trim(p_email)),p_ciphertext)
    on conflict(company_id) do update set email=excluded.email,ciphertext=excluded.ciphertext,connected_at=now();
end $$;
create function public.disconnect_farm_email(p_company uuid)
returns void language plpgsql security definer set search_path='' as $$ begin
  perform public.require_farm_access(p_company,true);
  delete from public.farm_email_accounts where company_id=p_company;
  update public.farm_notification_settings set enabled=false where company_id=p_company;
end $$;
create function public.get_farm_email_secret(p_company uuid,p_test boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$ declare account public.farm_email_accounts%rowtype; begin
  perform public.require_farm_access(p_company,true);
  select a.* into account from public.farm_email_accounts a where a.company_id=p_company for update;
  if not found then raise exception 'Connect Gmail first.'; end if;
  if p_test then
    if account.last_test_at>now()-interval '1 minute' then raise exception 'Wait one minute before sending another test email.'; end if;
    update public.farm_email_accounts set last_test_at=now() where company_id=p_company;
  end if;
  return jsonb_build_object('email',account.email,'ciphertext',account.ciphertext);
end $$;

create function public.claim_farm_email_jobs(p_limit integer default 5)
returns jsonb language plpgsql security definer set search_path='' as $$ declare result jsonb; begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service access required.' using errcode='42501'; end if;
  -- A crashed/ambiguous SMTP send must never be silently retried and duplicated.
  update public.farm_email_deliveries set state='uncertain',error_code='stale_claim' where state='sending' and claimed_at<now()-interval '15 minutes';
  insert into public.farm_email_deliveries(company_id,delivery_date,state)
    select s.company_id,(now() at time zone s.timezone)::date,'pending' from public.farm_notification_settings s
      join public.farm_email_accounts a on a.company_id=s.company_id
      where s.enabled and exists(select 1 from jsonb_array_elements(public.farm_alerts(s.company_id)) alert where
        (alert->>'kind'='maintenance' and s.maintenance) or (alert->>'kind'='irrigation' and s.irrigation) or (alert->>'kind'='harvest' and s.harvest))
    on conflict(company_id,delivery_date) do nothing;
  with candidates as (
    select d.company_id,d.delivery_date from public.farm_email_deliveries d join public.farm_notification_settings s on s.company_id=d.company_id
      join public.farm_email_accounts a on a.company_id=d.company_id
      where s.enabled and d.state in ('pending','failed') and d.attempts<3 and d.delivery_date=(now() at time zone s.timezone)::date
      order by d.delivery_date,d.company_id limit greatest(1,least(p_limit,5)) for update of d skip locked
  ), claimed as (
    update public.farm_email_deliveries d set state='sending',claim_token=gen_random_uuid(),claimed_at=now(),attempts=attempts+1
      from candidates c where d.company_id=c.company_id and d.delivery_date=c.delivery_date returning d.*
  ) select coalesce(jsonb_agg(jsonb_build_object('company_id',d.company_id,'delivery_date',d.delivery_date,'claim_token',d.claim_token,
    'company_name',c.name,'recipients',s.recipients,'alerts',(select coalesce(jsonb_agg(alert),'[]'::jsonb) from jsonb_array_elements(public.farm_alerts(d.company_id)) alert where
      (alert->>'kind'='maintenance' and s.maintenance) or (alert->>'kind'='irrigation' and s.irrigation) or (alert->>'kind'='harvest' and s.harvest)))),'[]'::jsonb) into result
      from claimed d join public.companies c on c.id=d.company_id join public.farm_notification_settings s on s.company_id=d.company_id;
  return result;
end $$;
create function public.finish_farm_email_job(p_company uuid,p_date date,p_token uuid,p_state text,p_error text default '')
returns void language plpgsql security definer set search_path='' as $$ begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service access required.' using errcode='42501'; end if;
  if p_state not in ('sent','failed','uncertain') then raise exception 'Invalid delivery result.'; end if;
  update public.farm_email_deliveries set state=p_state,error_code=left(p_error,60),sent_at=case when p_state='sent' then now() else null end
    where company_id=p_company and delivery_date=p_date and claim_token=p_token and state='sending';
  if not found then raise exception 'Delivery claim is no longer valid.'; end if;
end $$;

revoke all on function public.save_farm_record(uuid,uuid,text,jsonb),public.farm_alerts(uuid),public.farm_snapshot(uuid),
  public.save_farm_email_account(uuid,text,text),public.disconnect_farm_email(uuid),public.get_farm_email_secret(uuid,boolean),
  public.claim_farm_email_jobs(integer),public.finish_farm_email_job(uuid,date,uuid,text,text) from public,anon,authenticated;
grant execute on function public.save_farm_record(uuid,uuid,text,jsonb),public.farm_alerts(uuid),public.farm_snapshot(uuid),
  public.save_farm_email_account(uuid,text,text),public.disconnect_farm_email(uuid),public.get_farm_email_secret(uuid,boolean) to authenticated;
grant execute on function public.farm_alerts(uuid),public.farm_snapshot(uuid),public.get_farm_email_secret(uuid,boolean),
  public.claim_farm_email_jobs(integer),public.finish_farm_email_job(uuid,date,uuid,text,text) to service_role;
notify pgrst,'reload schema';
commit;
