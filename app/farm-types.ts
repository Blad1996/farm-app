export type Crop = { id: string; name: string; crop_type: string; variety: string; field_name: string; area: number; area_unit: string; planted_on: string | null; expected_harvest_on: string | null; status: string; notes: string };
export type Irrigation = { id: string; crop_id: string; occurred_on: string; method: string; volume_litres: number; duration_minutes: number; status: string; amount_paid: number; currency: string; notes: string };
export type SeedDistribution = { id: string; crop_id: string; product_id: string; movement_id: string; occurred_on: string; recipient: string; quantity: number; amount_paid: number; currency: string; lot_code: string; warehouse_id: string };
export type Asset = { id: string; name: string; category: string; asset_type: string; registration: string; make_model: string; purchased_on: string | null; purchase_paid: number; currency: string; status: string; maintenance_interval_days: number; next_maintenance_on: string; last_service_on: string | null; notes: string };
export type Maintenance = { id: string; asset_id: string; serviced_on: string; next_due_on: string; description: string; provider: string; amount_paid: number; currency: string };
export type FarmExpense = { id: string; crop_id: string | null; asset_id: string | null; category: string; description: string; paid_on: string; amount: number; currency: string; source_type: string; source_id: string };
export type FarmAlert = { id: string; kind: string; name: string; due_on: string; overdue: boolean };
export type NotificationSettings = { enabled: boolean; recipients: string[]; lead_days: number; timezone: string; maintenance: boolean; irrigation: boolean; harvest: boolean };
export type FarmSnapshot = { can_manage: boolean; crops: Crop[]; irrigation: Irrigation[]; seeds: SeedDistribution[]; assets: Asset[]; maintenance: Maintenance[]; expenses: FarmExpense[]; alerts: FarmAlert[]; settings: NotificationSettings | null; email_account: { email: string; connected_at: string } | null; deliveries: { delivery_date: string; state: string; error_code: string; attempts: number }[] };
export type FarmView = 'crops' | 'irrigation' | 'seeds' | 'expenses' | 'assets' | 'notifications';
export const farmCurrencies = ['CAD', 'USD', 'EUR', 'GBP', 'MXN', 'BRL', 'COP', 'VES'];
export function amountByCurrency(rows: { amount: number; currency: string }[]) {
  const cents = new Map<string, number>();
  for (const row of rows) cents.set(row.currency, (cents.get(row.currency) || 0) + Math.round(row.amount * 100));
  return Array.from(cents, ([currency, value]) => ({ currency, amount: value / 100 })).sort((a, b) => a.currency.localeCompare(b.currency));
}
export const farmMoney = (amount: number, currency: string) => new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(amount);
export function farmToday(timezone = 'America/Caracas') { return new Date().toLocaleDateString('sv-SE', { timeZone: timezone }); }
export function addFarmDays(date: string, days: number) { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
