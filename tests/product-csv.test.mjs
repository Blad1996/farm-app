import test from 'node:test';
import assert from 'node:assert/strict';
import { previewProductCsv } from '../app/product-csv.ts';

test('CSV preview handles UTF-8 BOM, CRLF, escaped quotes and multiline fields', () => {
  const source = '\uFEFFname,sku,category,unit,minimum\r\n"Wheat, grade A",w-1,Grain,kg,1.125\r\n"Seed ""premium""\nblend",s-1,Seed,bag,0\r\n';
  const preview = previewProductCsv(source);
  assert.deepEqual(preview.errors, []);
  assert.equal(preview.products.length, 2);
  assert.equal(preview.products[0].name, 'Wheat, grade A');
  assert.equal(preview.products[0].sku, 'W-1');
  assert.equal(preview.products[0].minimum, 1.125);
  assert.equal(preview.products[1].name, 'Seed "premium"\nblend');
});

test('CSV preview supports semicolons, header aliases and optional minimum stock', () => {
  const preview = previewProductCsv('\nProduct Name;SKU;Category;Unit\nFertilizer;F-1;Inputs;l\n');
  assert.deepEqual(preview.errors, []);
  assert.deepEqual(preview.products[0], { name: 'Fertilizer', sku: 'F-1', category: 'Inputs', unit: 'L', minimum: 0 });
});

test('CSV preview rejects malformed structure and accidental stock imports', () => {
  assert.match(previewProductCsv('name,sku,category,unit\n"Unclosed,SKU,Grain,kg').errors[0], /not closed/);
  assert.match(previewProductCsv('name,sku,category,unit\n"Bad"value,SKU,Grain,kg').errors[0], /quoting/);
  assert.match(previewProductCsv('name,sku,category,unit\nRice,RICE,Grain,kg,extra').errors[0], /number of values/);
  assert.ok(previewProductCsv('name,sku,category,unit,quantity\nRice,RICE,Grain,kg,10').errors.some(error => error.includes('stock quantities')));
  assert.ok(previewProductCsv('name,sku,unit\nRice,RICE,kg').errors.some(error => error.includes('category')));
  assert.ok(previewProductCsv('name,sku,category,unit,SKU\nRice,RICE,Grain,kg,RICE').errors.some(error => error.includes('repeated')));
});

test('CSV preview flags duplicate and existing SKUs, invalid units and invalid minimum stock', () => {
  const preview = previewProductCsv('name,sku,category,unit,minimum\nRice, rice ,Grain,kg,0\nRice 2,RICE,Grain,kg,1\nOil,OIL,Inputs,litres,-1\nSeed,SEED,Seed,bag,0.0001', ['rice']);
  assert.ok(preview.errors.some(error => error.includes('already exists')));
  assert.ok(preview.errors.some(error => error.includes('duplicate SKU')));
  assert.ok(preview.errors.some(error => error.includes('unit must')));
  assert.ok(preview.errors.some(error => error.includes('minimum stock')));
});

test('CSV preview enforces file and batch limits and leaves formulas as inert text', () => {
  assert.match(previewProductCsv('x'.repeat(1024 * 1024 + 1)).errors[0], /1 MB/);
  const header = 'name,sku,category,unit\n';
  assert.ok(previewProductCsv(header + Array.from({ length: 501 }, (_, index) => `Rice,R${index},Grain,kg`).join('\n')).errors.some(error => error.includes('500')));
  assert.equal(previewProductCsv(header + '=1+1,RICE,Grain,kg').products[0].name, '=1+1');
});
