import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { encryptEmailSecret, decryptEmailSecret, farmReminderMessage, validCronAuthorization, validEmail } from '../app/lib/email-security.ts';

test('Gmail credentials are encrypted, authenticated, and bound to a workspace', () => {
  const key = randomBytes(32).toString('base64'), secret = 'abcdefghijklmnop';
  const encrypted = encryptEmailSecret(secret, 'workspace-a', key);
  assert.ok(!encrypted.includes(secret));
  assert.equal(decryptEmailSecret(encrypted, 'workspace-a', key), secret);
  assert.notEqual(encrypted, encryptEmailSecret(secret, 'workspace-a', key), 'each ciphertext uses a fresh nonce');
  assert.throws(() => decryptEmailSecret(encrypted, 'workspace-b', key));
  assert.throws(() => decryptEmailSecret(encrypted, 'workspace-a', randomBytes(32).toString('base64')));
  const bytes = Buffer.from(encrypted.slice(3), 'base64'); bytes[bytes.length - 1] ^= 1;
  assert.throws(() => decryptEmailSecret(`v1:${bytes.toString('base64')}`, 'workspace-a', key));
});
test('cron authentication fails closed and messages exclude unapproved fields', () => {
  const secret = randomBytes(32).toString('hex');
  assert.equal(validCronAuthorization(`Bearer ${secret}`, secret), true);
  assert.equal(validCronAuthorization('Bearer wrong', secret), false);
  assert.equal(validCronAuthorization(null, secret), false);
  assert.equal(validCronAuthorization('Bearer ', undefined), false);
  assert.equal(validCronAuthorization('Bearer short', 'short'), false);
  const message = farmReminderMessage([{ kind: 'maintenance', name: 'Tractor\nOne', due_on: '2026-11-26', overdue: true, amount: 999, notes: 'PRIVATE_NOTES', password: 'PRIVATE_PASSWORD', recipient: 'outsider@example.test' }]);
  assert.match(message.text, /maintenance \| Tractor One \| 2026-11-26/);
  for (const value of ['999', 'PRIVATE_NOTES', 'PRIVATE_PASSWORD', 'outsider@']) assert.ok(!message.text.includes(value));
  assert.equal(validEmail('user@example.test'), true);
  assert.equal(validEmail('user@example.test\r\nBcc: victim@example.test'), false);
});
