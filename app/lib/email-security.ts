import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
function key(value: string) { const decoded = Buffer.from(value, 'base64'); if (decoded.length !== 32) throw new Error('Email encryption is not configured.'); return decoded; }
export function encryptEmailSecret(secret: string, companyId: string, keyText: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(keyText), iv);
  cipher.setAAD(Buffer.from(companyId));
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64')}`;
}
export function decryptEmailSecret(value: string, companyId: string, keyText: string) {
  if (!value.startsWith('v1:')) throw new Error('Unsupported email credential format.');
  const packed = Buffer.from(value.slice(3), 'base64'); if (packed.length < 29) throw new Error('Invalid credential.');
  const decipher = createDecipheriv('aes-256-gcm', key(keyText), packed.subarray(0, 12));
  decipher.setAAD(Buffer.from(companyId)); decipher.setAuthTag(packed.subarray(12, 28));
  return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8');
}
export function validCronAuthorization(header: string | null, secret: string | undefined) {
  if (!secret || secret.length < 32 || !header) return false;
  const actual = Buffer.from(header), expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function validEmail(value: string) { return value.length <= 254 && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(value); }
export function farmReminderMessage(alerts: { kind: string; name: string; due_on: string; overdue: boolean }[]) {
  // Deliberately select only the fields authorized by the user. No amounts,
  // stock balances, notes, company details or credentials enter the message.
  const clean = (value: string) => value.replace(/[\r\n]/g, ' ').slice(0, 120);
  return { subject: 'Agro Inventory — farm reminders', text: ['Your farm reminders', '', ...alerts.map(alert =>
    `- ${alert.overdue ? 'OVERDUE' : 'DUE SOON'} | ${clean(alert.kind)} | ${clean(alert.name)} | ${clean(alert.due_on)}`), '', 'Open Agro Inventory to review your reminders.'].join('\n') };
}
