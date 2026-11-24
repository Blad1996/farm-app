begin;

-- RLS protects direct table requests. Definer RPCs additionally call the guard.
create or replace function public.require_inventory_mfa()
returns void language plpgsql stable security invoker set search_path = ''
as $$
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'aal', '') <> 'aal2' then
    raise exception 'Two-step verification is required.' using errcode = '42501';
  end if;
end $$;
revoke all on function public.require_inventory_mfa() from public, anon, authenticated;
grant execute on function public.require_inventory_mfa() to authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array['companies', 'company_members', 'products', 'warehouses', 'suppliers', 'lots', 'stock', 'movements'] loop
    execute format('create policy require_two_step_verification on public.%I as restrictive for all to authenticated
      using ((select auth.jwt()->>''aal'') = ''aal2'')
      with check ((select auth.jwt()->>''aal'') = ''aal2'')', table_name);
  end loop;
end $$;

-- The UI checks this endpoint before opening the workspace, so an unapplied
-- migration cannot accidentally look like an MFA-protected installation.
create or replace function public.inventory_security_status()
returns boolean language sql stable security invoker set search_path = ''
as $$ select auth.uid() is not null and coalesce(auth.jwt()->>'aal', '') = 'aal2'; $$;
revoke all on function public.inventory_security_status() from public, anon, authenticated;
grant execute on function public.inventory_security_status() to authenticated;

create or replace function public.create_inventory_company(p_name text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  company public.companies%rowtype;
begin
  perform public.require_inventory_mfa();
  if current_user_id is null then raise exception 'Sign in first.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 29));
  select c.* into company from public.companies c join public.company_members m on m.company_id = c.id
    where m.user_id = current_user_id order by c.name, c.id limit 1;
  if not found then
    insert into public.companies (name) values (trim(p_name)) returning * into company;
    insert into public.company_members (company_id, user_id, role) values (company.id, current_user_id, 'admin');
  end if;
  return jsonb_build_object('id', company.id, 'name', company.name);
end $$;

create or replace function public.post_inventory_movement(p_company uuid, p_move jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  move_id uuid := (p_move->>'id')::uuid;
  kind_text text := p_move->>'kind';
  product uuid := (p_move->>'product_id')::uuid;
  lot_code text := upper(trim(p_move->>'lot_code'));
  source uuid := (p_move->>'warehouse_id')::uuid;
  destination uuid := (p_move->>'destination_id')::uuid;
  expiry date := (p_move->>'expires_on')::date;
  supplier uuid := (p_move->>'supplier_id')::uuid;
  qty numeric := (p_move->>'quantity')::numeric;
  note text := coalesce(trim(p_move->>'reference'), '');
  lot public.lots%rowtype;
begin
  perform public.require_inventory_mfa();
  if current_user_id is null or not exists (
    select 1 from public.company_members m where m.company_id = p_company and m.user_id = current_user_id
  ) then raise exception 'You do not have access to this workspace.'; end if;
  if move_id is null then raise exception 'Movement ID is missing.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company::text || move_id::text, 31));
  if exists (select 1 from public.movements m where m.company_id = p_company and m.id = move_id) then return move_id; end if;
  if qty is null or not (qty > 0 and qty <= 999999999) or qty <> round(qty, 3)
    then raise exception 'Enter a positive quantity with up to three decimals.'; end if;
  if kind_text is null or kind_text not in ('receipt', 'issue', 'transfer') or lot_code is null
    or length(lot_code) not between 1 and 60 or length(note) > 200
    then raise exception 'Check the movement type, lot code, and reference.'; end if;
  if not exists (select 1 from public.products p where p.company_id = p_company and p.id = product)
    or not exists (select 1 from public.warehouses w where w.company_id = p_company and w.id = source)
    then raise exception 'Select a product and warehouse in this workspace.'; end if;
  if kind_text = 'transfer' then
    if source = destination or not exists (select 1 from public.warehouses w where w.company_id = p_company and w.id = destination)
      then raise exception 'Select a different destination warehouse.'; end if;
  else
    destination := null;
  end if;

  if kind_text = 'receipt' then
    if supplier is not null and not exists (select 1 from public.suppliers s where s.company_id = p_company and s.id = supplier)
      then raise exception 'Select a supplier in this workspace.'; end if;
    insert into public.lots (company_id, product_id, code, expires_on, supplier_id)
      values (p_company, product, lot_code, expiry, supplier)
      on conflict (company_id, product_id, code) do nothing;
  end if;
  select l.* into lot from public.lots l
    where l.company_id = p_company and l.product_id = product and l.code = lot_code for update;
  if not found then raise exception 'Select an existing lot.'; end if;
  if kind_text = 'receipt' and ((expiry is not null and expiry is distinct from lot.expires_on)
    or (supplier is not null and supplier is distinct from lot.supplier_id))
    then raise exception 'This lot already has different supplier or expiry details.'; end if;
  if kind_text = 'issue' and lot.expires_on < (now() at time zone 'America/Toronto')::date
    then raise exception 'Expired lots cannot be issued.'; end if;

  if kind_text in ('issue', 'transfer') then
    update public.stock set quantity = quantity - qty
      where company_id = p_company and lot_id = lot.id and warehouse_id = source and quantity >= qty;
    if not found then raise exception 'There is insufficient stock for this lot in the selected warehouse.'; end if;
  end if;
  if kind_text in ('receipt', 'transfer') then
    insert into public.stock (company_id, lot_id, warehouse_id, quantity)
      values (p_company, lot.id, coalesce(destination, source), qty)
      on conflict (company_id, lot_id, warehouse_id) do update
      set quantity = stock.quantity + excluded.quantity;
  end if;
  insert into public.movements (company_id, id, lot_id, kind, quantity, warehouse_id, destination_id, reference, actor_id)
    values (p_company, move_id, lot.id, kind_text, qty, source, destination, note, current_user_id);
  return move_id;
end $$;

commit;
