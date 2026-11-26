begin;

alter table public.farm_notification_settings add column recipient_user_id uuid references auth.users on delete set null;
-- Previously entered addresses were only drafts, not an approved recipient.
update public.farm_notification_settings set enabled=false,recipients='{}';

create function public.enforce_farm_self_recipient()
returns trigger language plpgsql security definer set search_path='' as $$
declare uid uuid; verified_email text;
begin
  -- FK SET NULL on account deletion must disable delivery, never prevent the
  -- account from being removed or transfer its address to another identity.
  if tg_op='UPDATE' and new.recipient_user_id is null and old.recipient_user_id is not null then
    new.enabled:=false; new.recipients:='{}'; return new;
  end if;
  uid:=auth.uid();
  if coalesce(auth.jwt()->>'role','')='service_role' then uid:=new.recipient_user_id; end if;
  select lower(u.email) into verified_email from auth.users u join public.company_members m on m.user_id=u.id
    where u.id=uid and m.company_id=new.company_id and u.email_confirmed_at is not null;
  if verified_email is null then
    if new.enabled then raise exception 'A verified account email and workspace membership are required.' using errcode='42501'; end if;
    new.recipient_user_id:=null; new.recipients:='{}'; return new;
  end if;
  if new.enabled and cardinality(new.recipients)>0 and new.recipients is distinct from array[verified_email] then
    raise exception 'Notifications can only be sent to your verified account email.' using errcode='42501';
  end if;
  new.recipient_user_id:=uid; new.recipients:=array[verified_email];
  return new;
end $$;
revoke all on function public.enforce_farm_self_recipient() from public,anon,authenticated;
create trigger farm_self_recipient before insert or update on public.farm_notification_settings
  for each row execute function public.enforce_farm_self_recipient();

create function public.save_farm_notification_preferences(p_company uuid,p_settings jsonb)
returns void language plpgsql security definer set search_path='' as $$ declare recipient text; begin
  perform public.require_farm_access(p_company,true);
  select lower(email) into recipient from auth.users where id=auth.uid() and email_confirmed_at is not null;
  if recipient is null then raise exception 'Confirm your account email before configuring email notifications.'; end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_settings->>'timezone') then raise exception 'Choose a valid time zone.'; end if;
  if coalesce((p_settings->>'enabled')::boolean,false) and not exists(select 1 from public.farm_email_accounts a where a.company_id=p_company) then
    raise exception 'Connect Gmail before enabling email notifications.';
  end if;
  insert into public.farm_notification_settings(company_id,enabled,recipients,recipient_user_id,lead_days,timezone,maintenance,irrigation,harvest)
    values(p_company,coalesce((p_settings->>'enabled')::boolean,false),array[recipient],auth.uid(),(p_settings->>'lead_days')::integer,p_settings->>'timezone',
      (p_settings->>'maintenance')::boolean,(p_settings->>'irrigation')::boolean,(p_settings->>'harvest')::boolean)
    on conflict(company_id) do update set enabled=excluded.enabled,recipients=excluded.recipients,recipient_user_id=excluded.recipient_user_id,
      lead_days=excluded.lead_days,timezone=excluded.timezone,maintenance=excluded.maintenance,irrigation=excluded.irrigation,harvest=excluded.harvest;
end $$;

create table public.farm_gmail_attempts(user_id uuid primary key references auth.users on delete cascade,attempted_at timestamptz not null);
alter table public.farm_gmail_attempts enable row level security;
revoke all on public.farm_gmail_attempts from public,anon,authenticated;
create function public.claim_farm_gmail_attempt(p_company uuid)
returns void language plpgsql security definer set search_path='' as $$ declare claimed uuid; begin
  perform public.require_farm_access(p_company,true);
  if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then raise exception 'Confirm your account email first.'; end if;
  insert into public.farm_gmail_attempts(user_id,attempted_at) values(auth.uid(),now())
    on conflict(user_id) do update set attempted_at=excluded.attempted_at where farm_gmail_attempts.attempted_at<now()-interval '1 minute'
    returning user_id into claimed;
  if claimed is null then raise exception 'Wait one minute before checking another Gmail connection.'; end if;
end $$;

create or replace function public.claim_farm_email_jobs(p_limit integer default 5)
returns jsonb language plpgsql security definer set search_path='' as $$ declare result jsonb; begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service access required.' using errcode='42501'; end if;
  update public.farm_email_deliveries set state='uncertain',error_code='stale_claim' where state='sending' and claimed_at<now()-interval '15 minutes';
  insert into public.farm_email_deliveries(company_id,delivery_date,state)
    select s.company_id,(now() at time zone s.timezone)::date,'pending' from public.farm_notification_settings s
      join public.farm_email_accounts a on a.company_id=s.company_id
      join auth.users u on u.id=s.recipient_user_id and u.email_confirmed_at is not null
      join public.company_members m on m.company_id=s.company_id and m.user_id=u.id
      where s.enabled and exists(select 1 from jsonb_array_elements(public.farm_alerts(s.company_id)) alert where
        (alert->>'kind'='maintenance' and s.maintenance) or (alert->>'kind'='irrigation' and s.irrigation) or (alert->>'kind'='harvest' and s.harvest))
    on conflict(company_id,delivery_date) do nothing;
  with candidates as (
    select d.company_id,d.delivery_date from public.farm_email_deliveries d
      join public.farm_notification_settings s on s.company_id=d.company_id
      join public.farm_email_accounts a on a.company_id=s.company_id
      join auth.users u on u.id=s.recipient_user_id and u.email_confirmed_at is not null
      join public.company_members m on m.company_id=s.company_id and m.user_id=u.id
      where s.enabled and d.state in ('pending','failed') and d.attempts<3 and d.delivery_date=(now() at time zone s.timezone)::date
      order by d.company_id limit greatest(1,least(p_limit,5)) for update of d skip locked
  ), claimed as (
    update public.farm_email_deliveries d set state='sending',claim_token=gen_random_uuid(),claimed_at=now(),attempts=attempts+1
      from candidates c where d.company_id=c.company_id and d.delivery_date=c.delivery_date returning d.company_id,d.delivery_date,d.claim_token
  ) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) into result from claimed;
  return result;
end $$;

-- The worker must resolve the address at send time. Stored address arrays and
-- caller-provided destinations are never used for SMTP delivery.
create function public.farm_email_delivery_context(p_company uuid,p_date date,p_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$ declare result jsonb; begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service access required.' using errcode='42501'; end if;
  select jsonb_build_object('email',a.email,'ciphertext',a.ciphertext,'recipient',lower(u.email),
    'alerts',(select coalesce(jsonb_agg(alert),'[]'::jsonb) from jsonb_array_elements(public.farm_alerts(s.company_id)) alert where
      (alert->>'kind'='maintenance' and s.maintenance) or (alert->>'kind'='irrigation' and s.irrigation) or (alert->>'kind'='harvest' and s.harvest))) into result
    from public.farm_email_deliveries d join public.farm_notification_settings s on s.company_id=d.company_id and s.enabled
    join public.farm_email_accounts a on a.company_id=s.company_id
    join auth.users u on u.id=s.recipient_user_id and u.email_confirmed_at is not null
    join public.company_members m on m.company_id=s.company_id and m.user_id=u.id
    where d.company_id=p_company and d.delivery_date=p_date and d.claim_token=p_token and d.state='sending';
  if result is null then raise exception 'This delivery is no longer authorized.' using errcode='42501'; end if;
  return result;
end $$;

revoke all on function public.save_farm_notification_preferences(uuid,jsonb),public.claim_farm_gmail_attempt(uuid),
  public.farm_email_delivery_context(uuid,date,uuid) from public,anon,authenticated;
grant execute on function public.save_farm_notification_preferences(uuid,jsonb),public.claim_farm_gmail_attempt(uuid) to authenticated;
grant execute on function public.farm_email_delivery_context(uuid,date,uuid) to service_role;
notify pgrst,'reload schema';
commit;
