begin;

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100)
);
create table public.company_members (
  company_id uuid not null references public.companies on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null check (role in ('admin', 'operator')),
  primary key (company_id, user_id)
);
create index on public.company_members (user_id);

create table public.products (
  company_id uuid not null references public.companies,
  id uuid not null default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  sku text not null check (length(trim(sku)) between 1 and 40),
  category text not null check (length(trim(category)) between 1 and 60),
  unit text not null check (unit in ('kg', 'lb', 'L', 'ea', 'case', 'bag')),
  minimum numeric(15,3) not null default 0 check (minimum >= 0 and minimum <= 999999999),
  primary key (company_id, id)
);
create unique index on public.products (company_id, upper(trim(sku)));
create table public.warehouses (
  company_id uuid not null references public.companies,
  id uuid not null default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  location text not null default '' check (length(location) <= 100),
  primary key (company_id, id)
);
create unique index on public.warehouses (company_id, lower(trim(name)));
create table public.suppliers (
  company_id uuid not null references public.companies,
  id uuid not null default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  email text not null default '' check (length(email) <= 150),
  primary key (company_id, id)
);
create unique index on public.suppliers (company_id, lower(trim(name)));

create table public.lots (
  company_id uuid not null,
  id uuid not null default gen_random_uuid(),
  product_id uuid not null,
  code text not null check (length(trim(code)) between 1 and 60),
  expires_on date,
  supplier_id uuid,
  primary key (company_id, id),
  unique (company_id, product_id, code),
  foreign key (company_id, product_id) references public.products,
  foreign key (company_id, supplier_id) references public.suppliers
);
create table public.stock (
  company_id uuid not null,
  lot_id uuid not null,
  warehouse_id uuid not null,
  quantity numeric(15,3) not null check (quantity >= 0),
  primary key (company_id, lot_id, warehouse_id),
  foreign key (company_id, lot_id) references public.lots,
  foreign key (company_id, warehouse_id) references public.warehouses
);
create table public.movements (
  company_id uuid not null,
  id uuid not null,
  lot_id uuid not null,
  kind text not null check (kind in ('receipt', 'issue', 'transfer')),
  quantity numeric(15,3) not null check (quantity > 0),
  warehouse_id uuid not null,
  destination_id uuid,
  reference text not null default '' check (length(reference) <= 200),
  created_at timestamptz not null default now(),
  actor_id uuid references auth.users on delete set null,
  primary key (company_id, id),
  foreign key (company_id, lot_id) references public.lots,
  foreign key (company_id, warehouse_id) references public.warehouses,
  foreign key (company_id, destination_id) references public.warehouses,
  check ((kind = 'transfer' and destination_id is not null and destination_id <> warehouse_id)
    or (kind <> 'transfer' and destination_id is null))
);
create index on public.movements (company_id, created_at desc);

alter table public.company_members enable row level security;
alter table public.companies enable row level security;
create policy read_own_memberships on public.company_members for select to authenticated using (user_id = (select auth.uid()));
create policy read_company on public.companies for select to authenticated using (
  exists (select 1 from public.company_members as m where m.company_id = companies.id and m.user_id = (select auth.uid()))
);
revoke all on public.company_members, public.companies from public, anon, authenticated;
grant select on public.company_members, public.companies to authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array['products', 'warehouses', 'suppliers', 'lots', 'stock', 'movements'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    execute format('create policy read_company_data on public.%I for select to authenticated using
      (exists (select 1 from public.company_members as m where m.company_id = %I.company_id and m.user_id = (select auth.uid())))',
      table_name, table_name);
  end loop;
  foreach table_name in array array['products', 'warehouses', 'suppliers'] loop
    execute format('grant insert on public.%I to authenticated', table_name);
    execute format('create policy add_catalogue_record on public.%I for insert to authenticated with check
      (exists (select 1 from public.company_members as m where m.company_id = %I.company_id and m.user_id = (select auth.uid()) and m.role = ''admin''))',
      table_name, table_name);
  end loop;
end $$;

create function public.create_inventory_company(p_name text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  company public.companies%rowtype;
begin
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

create function public.inventory_snapshot(p_company uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'name', company.name,
    'products', coalesce((select jsonb_agg(to_jsonb(p) - 'company_id' order by p.name) from public.products p where p.company_id = company.id), '[]'::jsonb),
    'warehouses', coalesce((select jsonb_agg(to_jsonb(w) - 'company_id' order by w.name) from public.warehouses w where w.company_id = company.id), '[]'::jsonb),
    'suppliers', coalesce((select jsonb_agg(to_jsonb(s) - 'company_id' order by s.name) from public.suppliers s where s.company_id = company.id), '[]'::jsonb),
    'lots', coalesce((select jsonb_agg(to_jsonb(l) - 'company_id' order by l.expires_on nulls last, l.code) from public.lots l where l.company_id = company.id), '[]'::jsonb),
    'stock', coalesce((select jsonb_agg(to_jsonb(s) - 'company_id') from public.stock s where s.company_id = company.id and s.quantity > 0), '[]'::jsonb),
    'movements', coalesce((select jsonb_agg(to_jsonb(m) - 'company_id' - 'actor_id' order by m.created_at desc, m.id)
      from (select * from public.movements where company_id = company.id order by created_at desc, id limit 500) m), '[]'::jsonb)
  )
  from public.companies company where company.id = p_company;
$$;

create function public.post_inventory_movement(p_company uuid, p_move jsonb)
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

revoke all on function public.create_inventory_company(text),
  public.inventory_snapshot(uuid), public.post_inventory_movement(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.create_inventory_company(text),
  public.inventory_snapshot(uuid), public.post_inventory_movement(uuid, jsonb) to authenticated;
commit;
