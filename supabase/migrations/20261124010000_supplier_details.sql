begin;

-- Defaults preserve existing suppliers. Existing tenant and MFA policies apply
-- to these columns; inventory_snapshot already includes every supplier column.
alter table public.suppliers
  add column company_name text not null default '' check (length(company_name) <= 100),
  add column phone text not null default '' check (length(phone) <= 40),
  add column physical_address text not null default '' check (length(physical_address) <= 300),
  add column location text not null default '' check (length(location) <= 100);

notify pgrst, 'reload schema';
commit;
