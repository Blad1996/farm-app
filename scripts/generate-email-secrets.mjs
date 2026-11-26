import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const file = new URL('../.env.local', import.meta.url);
let source = await readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
const lines = source.split(/\r?\n/);
let added = 0;
for (const [name, encoding] of [['FARM_EMAIL_ENCRYPTION_KEY', 'base64'], ['CRON_SECRET', 'hex']]) {
  const index = lines.findIndex(line => line.startsWith(name + '='));
  if (index >= 0 && lines[index].slice(name.length + 1).trim()) continue;
  const entry = name + '=' + randomBytes(32).toString(encoding);
  if (index >= 0) lines[index] = entry; else lines.push(entry);
  added++;
}
if (added) await writeFile(file, lines.join('\n').trim() + '\n');
console.log(`${added} server-only email keys added. Existing keys were preserved. Secret values are not displayed.`);
