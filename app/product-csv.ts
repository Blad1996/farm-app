export type ImportedProduct = { name: string; sku: string; category: string; unit: string; minimum: number };
export type CsvPreview = { products: ImportedProduct[]; errors: string[]; rowCount: number };
export const maxCsvBytes = 1024 * 1024;
export const maxImportRows = 500;

// RFC-style quoted fields, including escaped quotes and embedded newlines.
function records(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false, closed = false;
  function cell() { row.push(field); field = ''; closed = false; }
  function endRow() { cell(); if (row.some(value => value.trim() !== '')) rows.push(row); row = []; }
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index++; }
        else { quoted = false; closed = true; }
      } else field += char;
    } else if (char === delimiter) cell();
    else if (char === '\n' || char === '\r') { if (char === '\r' && text[index + 1] === '\n') index++; endRow(); }
    else if (char === '"' && field === '' && !closed) quoted = true;
    else if (char === '"' || (closed && char.trim() !== '')) throw new Error('Invalid CSV quoting. Use double quotes around fields containing separators.');
    else if (!closed) field += char;
  }
  if (quoted) throw new Error('A quoted field is not closed. Check the CSV file.');
  if (field || row.length || closed) endRow();
  return rows;
}

export function previewProductCsv(source: string, existingSkus: string[] = []): CsvPreview {
  const errors: string[] = [], products: ImportedProduct[] = [];
  if (new TextEncoder().encode(source).length > maxCsvBytes) return { products, errors: ['Choose a CSV file of 1 MB or less.'], rowCount: 0 };
  const text = source.replace(/^\uFEFF/, '');
  const firstLine = text.split(/[\r\n]/).find(line => line.trim() !== '') || '';
  const delimiter = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
  let rows: string[][];
  try { rows = records(text, delimiter); }
  catch (error) { return { products, errors: [error instanceof Error ? error.message : 'Unable to read CSV.'], rowCount: 0 }; }
  if (!rows.length) return { products, errors: ['The CSV file is empty.'], rowCount: 0 };
  const aliases: Record<string, string> = { product_name: 'name', minimum_stock: 'minimum', minimum_stock_level: 'minimum' };
  const headers = rows.shift()!.map(value => { const key = value.trim().toLowerCase().replace(/[ -]+/g, '_'); return Object.hasOwn(aliases, key) ? aliases[key] : key; });
  const rowCount = rows.length;
  for (const required of ['name', 'sku', 'category', 'unit']) if (!headers.includes(required)) errors.push(`Missing column: ${required}.`);
  for (const header of headers) if (!['name', 'sku', 'category', 'unit', 'minimum'].includes(header)) errors.push(`Unsupported column: ${header || '(blank)'}. Download the product template; stock quantities are not imported here.`);
  if (new Set(headers).size !== headers.length) errors.push('Column names must not be repeated.');
  if (!rowCount) errors.push('Add at least one product row.');
  if (rowCount > maxImportRows) errors.push(`Import up to ${maxImportRows} products at a time.`);
  if (errors.length) return { products, errors, rowCount };
  const existing = new Set(existingSkus.map(sku => sku.trim().toUpperCase())), seen = new Set<string>();
  rows.forEach((row, index) => {
    const prefix = `Row ${index + 2}: `;
    if (row.length !== headers.length) { errors.push(prefix + 'The number of values does not match the header.'); return; }
    const values = Object.fromEntries(headers.map((header, column) => [header, row[column].trim()]));
    const sku = values.sku.toUpperCase();
    const unit = values.unit.toLowerCase() === 'l' ? 'L' : values.unit.toLowerCase();
    const minimumText = values.minimum || '0';
    const minimum = Number(minimumText);
    const rowErrors: string[] = [];
    if (!values.name || values.name.length > 100) rowErrors.push('product name must contain 1–100 characters');
    if (!sku || sku.length > 40) rowErrors.push('SKU must contain 1–40 characters');
    if (!values.category || values.category.length > 60) rowErrors.push('category must contain 1–60 characters');
    if (!['kg', 'lb', 'L', 'ea', 'case', 'bag'].includes(unit)) rowErrors.push('unit must be kg, lb, L, ea, case, or bag');
    if (!/^\d+(\.\d{1,3})?$/.test(minimumText) || !Number.isFinite(minimum) || minimum > 999999999) rowErrors.push('minimum stock must be 0–999999999 with up to three decimals');
    if (seen.has(sku)) rowErrors.push(`duplicate SKU ${sku} in this file`);
    if (existing.has(sku)) rowErrors.push(`SKU ${sku} already exists; existing products are not overwritten`);
    seen.add(sku);
    if (rowErrors.length) errors.push(prefix + rowErrors.join('; ') + '.');
    else products.push({ name: values.name, sku, category: values.category, unit, minimum });
  });
  return { products, errors, rowCount };
}
