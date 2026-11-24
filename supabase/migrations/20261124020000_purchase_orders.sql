begin;

create table public.purchase_orders (
  company_id uuid not null references public.companies,
  id uuid not null,
  order_number bigint generated always as identity,
  supplier_id uuid not null,
  warehouse_id uuid not null,
  status text not null default 'draft' check (status in ('draft','ordered','partially_received','received','cancelled')),
  currency text not null check (currency in ('CAD','USD','EUR','GBP','MXN','BRL','COP','VES')),
  expected_on date,
  notes text not null default '' check (length(notes) <= 1000),
  cancellation_reason text not null default '' check (length(cancellation_reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users on delete set null,
  cancelled_by uuid references auth.users on delete set null,
  request jsonb not null,
  primary key (company_id,id),
  foreign key (company_id,supplier_id) references public.suppliers,
  foreign key (company_id,warehouse_id) references public.warehouses
);
create index on public.purchase_orders(company_id,created_at desc);
revoke all on sequence public.purchase_orders_order_number_seq from public,anon,authenticated;

create table public.purchase_order_lines (
  company_id uuid not null,
  order_id uuid not null,
  id uuid not null default gen_random_uuid(),
  product_id uuid not null,
  quantity numeric(15,3) not null check (quantity > 0 and quantity <= 999999999),
  received_quantity numeric(15,3) not null default 0 check (received_quantity >= 0 and received_quantity <= quantity),
  unit_price numeric(15,2) not null check (unit_price >= 0 and unit_price <= 999999999),
  primary key (company_id,order_id,id),
  unique (company_id,order_id,product_id),
  foreign key (company_id,order_id) references public.purchase_orders,
  foreign key (company_id,product_id) references public.products
);

create table public.purchase_order_receipts (
  company_id uuid not null,
  id uuid not null,
  order_id uuid not null,
  line_id uuid not null,
  movement_id uuid not null,
  quantity numeric(15,3) not null check (quantity > 0),
  created_at timestamptz not null default now(),
  request jsonb not null,
  primary key (company_id,id),
  unique (company_id,movement_id),
  foreign key (company_id,order_id,line_id) references public.purchase_order_lines,
  foreign key (company_id,movement_id) references public.movements
);

do $$
declare table_name text;
begin
  foreach table_name in array array['purchase_orders','purchase_order_lines','purchase_order_receipts'] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('revoke all on public.%I from public, anon, authenticated',table_name);
    execute format('grant select on public.%I to authenticated',table_name);
    execute format('create policy read_company_purchase_data on public.%I for select to authenticated using
      (exists (select 1 from public.company_members m where m.company_id = %I.company_id and m.user_id = (select auth.uid())))',table_name,table_name);
    execute format('create policy require_purchase_mfa on public.%I as restrictive for all to authenticated
      using ((select auth.jwt()->>''aal'') = ''aal2'') with check ((select auth.jwt()->>''aal'') = ''aal2'')',table_name);
  end loop;
end $$;

create function public.create_purchase_order(p_company uuid,p_order jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  order_id uuid := (p_order->>'id')::uuid;
  supplier uuid := (p_order->>'supplier_id')::uuid;
  warehouse uuid := (p_order->>'warehouse_id')::uuid;
  line jsonb;
  qty numeric;
  price numeric;
  existing_request jsonb;
begin
  perform public.require_inventory_mfa();
  if not exists (select 1 from public.company_members m where m.company_id=p_company and m.user_id=auth.uid() and m.role='admin') then
    raise exception 'Only workspace administrators can create purchase orders.' using errcode='42501';
  end if;
  if order_id is null or jsonb_typeof(p_order) is distinct from 'object' then raise exception 'Invalid purchase order.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company::text || order_id::text,47));
  select o.request into existing_request from public.purchase_orders o where o.company_id=p_company and o.id=order_id;
  if found then
    if existing_request is distinct from p_order then raise exception 'This order ID was already used for a different order.'; end if;
    return order_id;
  end if;
  if jsonb_typeof(p_order->'lines') is distinct from 'array' then raise exception 'Add at least one order line.'; end if;
  if jsonb_array_length(p_order->'lines') not between 1 and 100 then raise exception 'An order must contain between 1 and 100 products.'; end if;
  if not exists (select 1 from public.suppliers s where s.company_id=p_company and s.id=supplier)
    or not exists (select 1 from public.warehouses w where w.company_id=p_company and w.id=warehouse) then
    raise exception 'Select a supplier and warehouse in this workspace.';
  end if;
  insert into public.purchase_orders(company_id,id,supplier_id,warehouse_id,currency,expected_on,notes,created_by,request)
    values(p_company,order_id,supplier,warehouse,p_order->>'currency',nullif(p_order->>'expected_on','')::date,
      coalesce(trim(p_order->>'notes'),''),auth.uid(),p_order);
  for line in select value from jsonb_array_elements(p_order->'lines') loop
    qty := (line->>'quantity')::numeric;
    price := (line->>'unit_price')::numeric;
    if qty is null or not(qty > 0 and qty <= 999999999) or qty <> round(qty,3)
      or price is null or not(price >= 0 and price <= 999999999) or price <> round(price,2) then
      raise exception 'Check quantities (up to three decimals) and unit prices (up to two decimals).';
    end if;
    insert into public.purchase_order_lines(company_id,order_id,product_id,quantity,unit_price)
      values(p_company,order_id,(line->>'product_id')::uuid,qty,price);
  end loop;
  return order_id;
end $$;

create function public.change_purchase_order_status(p_company uuid,p_order uuid,p_action text,p_reason text default '')
returns void language plpgsql security definer set search_path = ''
as $$
declare current_status text;
begin
  perform public.require_inventory_mfa();
  if not exists (select 1 from public.company_members m where m.company_id=p_company and m.user_id=auth.uid() and m.role='admin') then
    raise exception 'Only workspace administrators can manage purchase orders.' using errcode='42501';
  end if;
  select o.status into current_status from public.purchase_orders o where o.company_id=p_company and o.id=p_order for update;
  if not found then raise exception 'Purchase order not found.'; end if;
  if p_action='confirm' then
    if current_status='ordered' then return; end if;
    if current_status<>'draft' then raise exception 'Only draft orders can be confirmed.'; end if;
    update public.purchase_orders set status='ordered',updated_at=now() where company_id=p_company and id=p_order;
  elsif p_action='cancel' then
    if current_status='cancelled' then return; end if;
    if current_status not in ('draft','ordered','partially_received') then raise exception 'Completed orders cannot be cancelled.'; end if;
    if p_reason is null or length(trim(p_reason)) not between 1 and 300 then raise exception 'Enter a cancellation reason (up to 300 characters).'; end if;
    update public.purchase_orders set status='cancelled',cancellation_reason=trim(p_reason),cancelled_by=auth.uid(),updated_at=now()
      where company_id=p_company and id=p_order;
  else raise exception 'Invalid order action.';
  end if;
end $$;

create function public.receive_purchase_order(p_company uuid,p_order uuid,p_receipt jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  receipt_id uuid := (p_receipt->>'id')::uuid;
  line_id uuid := (p_receipt->>'line_id')::uuid;
  qty numeric := (p_receipt->>'quantity')::numeric;
  current_order public.purchase_orders%rowtype;
  current_line public.purchase_order_lines%rowtype;
  existing_receipt public.purchase_order_receipts%rowtype;
  order_reference text;
begin
  perform public.require_inventory_mfa();
  if not exists (select 1 from public.company_members m where m.company_id=p_company and m.user_id=auth.uid()) then
    raise exception 'You do not have access to this workspace.' using errcode='42501';
  end if;
  if receipt_id is null or line_id is null then raise exception 'Receipt and order line IDs are required.'; end if;
  -- Shares the inventory movement lock, including protection from movement-ID collisions.
  perform pg_advisory_xact_lock(hashtextextended(p_company::text || receipt_id::text,31));
  select r.* into existing_receipt from public.purchase_order_receipts r where r.company_id=p_company and r.id=receipt_id;
  if found then
    if existing_receipt.order_id<>p_order or existing_receipt.request is distinct from p_receipt then
      raise exception 'This receipt ID was already used for different receipt details.';
    end if;
    return receipt_id;
  end if;
  if exists(select 1 from public.movements m where m.company_id=p_company and m.id=receipt_id) then
    raise exception 'This receipt ID is already used by another inventory movement.';
  end if;
  select o.* into current_order from public.purchase_orders o where o.company_id=p_company and o.id=p_order for update;
  if not found then raise exception 'Purchase order not found.'; end if;
  if current_order.status not in ('ordered','partially_received') then raise exception 'Only confirmed, open orders can be received.'; end if;
  select l.* into current_line from public.purchase_order_lines l where l.company_id=p_company and l.order_id=p_order and l.id=line_id for update;
  if not found then raise exception 'Order line not found.'; end if;
  if qty is null or not(qty > 0 and qty <= 999999999) or qty <> round(qty,3) then raise exception 'Enter a positive receipt quantity with up to three decimals.'; end if;
  if qty > current_line.quantity-current_line.received_quantity then raise exception 'Receipt quantity exceeds the quantity still outstanding.'; end if;
  order_reference := 'PO-' || lpad(current_order.order_number::text,6,'0');
  if length(coalesce(p_receipt->>'reference','')) > 150 then raise exception 'Receipt reference is too long.'; end if;
  perform public.post_inventory_movement(p_company,jsonb_build_object(
    'id',receipt_id,'kind','receipt','product_id',current_line.product_id,
    'warehouse_id',current_order.warehouse_id,'quantity',qty,'supplier_id',current_order.supplier_id,
    'lot_code',p_receipt->>'lot_code','expires_on',nullif(p_receipt->>'expires_on',''),
    'reference',order_reference || case when coalesce(trim(p_receipt->>'reference'),'')<>'' then ' / ' || trim(p_receipt->>'reference') else '' end
  ));
  insert into public.purchase_order_receipts(company_id,id,order_id,line_id,movement_id,quantity,request)
    values(p_company,receipt_id,p_order,line_id,receipt_id,qty,p_receipt);
  update public.purchase_order_lines set received_quantity=received_quantity+qty
    where company_id=p_company and order_id=p_order and id=line_id;
  update public.purchase_orders set status=case when exists (
      select 1 from public.purchase_order_lines l where l.company_id=p_company and l.order_id=p_order and l.received_quantity<l.quantity
    ) then 'partially_received' else 'received' end,updated_at=now()
    where company_id=p_company and id=p_order;
  return receipt_id;
end $$;

create function public.purchase_orders_snapshot(p_company uuid)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare result jsonb;
begin
  perform public.require_inventory_mfa();
  if not exists (select 1 from public.company_members m where m.company_id=p_company and m.user_id=auth.uid()) then
    raise exception 'You do not have access to this workspace.' using errcode='42501';
  end if;
  select jsonb_build_object(
    'can_manage',exists(select 1 from public.company_members m where m.company_id=p_company and m.user_id=auth.uid() and m.role='admin'),
    'orders',coalesce((select jsonb_agg(to_jsonb(o)-'company_id'-'request' || jsonb_build_object(
      'total',coalesce((select sum(round(l.quantity*l.unit_price,2)) from public.purchase_order_lines l where l.company_id=p_company and l.order_id=o.id),0),
      'lines',coalesce((select jsonb_agg(to_jsonb(l)-'company_id' order by l.id) from public.purchase_order_lines l where l.company_id=p_company and l.order_id=o.id),'[]'::jsonb),
      'receipts',coalesce((select jsonb_agg(to_jsonb(r)-'company_id'-'request' || jsonb_build_object(
        'lot_code',lot.code,'expires_on',lot.expires_on,'reference',movement.reference
      ) order by r.created_at desc,r.id) from public.purchase_order_receipts r
        join public.movements movement on movement.company_id=r.company_id and movement.id=r.movement_id
        join public.lots lot on lot.company_id=movement.company_id and lot.id=movement.lot_id
        where r.company_id=p_company and r.order_id=o.id),'[]'::jsonb)
    ) order by o.created_at desc,o.order_number desc) from public.purchase_orders o where o.company_id=p_company),'[]'::jsonb)
  ) into result;
  return result;
end $$;

revoke all on function public.create_purchase_order(uuid,jsonb),
  public.change_purchase_order_status(uuid,uuid,text,text), public.receive_purchase_order(uuid,uuid,jsonb),
  public.purchase_orders_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.create_purchase_order(uuid,jsonb),
  public.change_purchase_order_status(uuid,uuid,text,text), public.receive_purchase_order(uuid,uuid,jsonb),
  public.purchase_orders_snapshot(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
