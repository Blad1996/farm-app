'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { Product } from './inventory';
import { maxCsvBytes, previewProductCsv, type CsvPreview } from './product-csv';
import { supabase } from './supabase';

export default function ProductCsvImport({ companyId, products, close, onImported }: {
  companyId: string | null; products: Product[]; close: () => void; onImported: (count: number) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null), locked = useRef(false), readingId = useRef(0);
  const [preview, setPreview] = useState<CsvPreview | null>(null), [batchId, setBatchId] = useState('');
  const [error, setError] = useState(''), [reading, setReading] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => { readingId.current++; dialog?.close(); }; }, []);
  function dismiss() { if (!locked.current) close(); }
  async function importProducts() {
    if (locked.current || !supabase || !companyId || !preview?.products.length || preview.errors.length) return;
    locked.current = true; setBusy(true); setError('');
    try {
    const response = await supabase.rpc('import_inventory_products', { p_company: companyId, p_batch: batchId, p_rows: preview.products });
    if (response.error) {
      setError(response.error.code === '23505' ? 'An SKU already exists. Refresh inventory and check your CSV before trying again.' :
        ['PGRST202', '42883'].includes(response.error.code) ? 'CSV imports are not configured yet. Contact your administrator to enable them.' : response.error.message || 'Unable to import products. Please try again.');
      locked.current = false; setBusy(false); return;
    }
    await onImported(response.data as number).catch(() => undefined);
    locked.current = false; setBusy(false); close();
    } catch { setError('Unable to connect. Try again with this same preview; the import ID prevents duplicate products.'); }
    finally { locked.current = false; setBusy(false); }
  }
  return <dialog className="csv-dialog" ref={ref} aria-labelledby="csv-dialog-title" onCancel={event => { event.preventDefault(); dismiss(); }}>
    <div className="dialog-head"><h2 id="csv-dialog-title">Import products from CSV</h2><button type="button" className="icon-button" disabled={busy} aria-label="Close dialog" onClick={dismiss}><X size={21} /></button></div>
    <p>Import up to 500 new products per file. Existing SKUs are never overwritten. This imports the catalogue only; record receipts separately to add stock.</p>
    <a className="button secondary small" href="/templates/products.csv" download>Download CSV template</a>
    <label className="field"><span>CSV file</span><input type="file" accept=".csv,text/csv" disabled={busy} onChange={async event => {
      const file = event.currentTarget.files?.[0], attempt = ++readingId.current;
      setPreview(null); setError(''); setBatchId(''); setReading(false);
      if (!file) return;
      if (file.size > maxCsvBytes) { setError('Choose a CSV file of 1 MB or less.'); return; }
      setReading(true);
      try {
        const source = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
        if (attempt !== readingId.current) return;
        setPreview(previewProductCsv(source, products.map(product => product.sku))); setBatchId(crypto.randomUUID());
      } catch { if (attempt === readingId.current) setError('Unable to read this file. Save it as a UTF-8 CSV and try again.'); }
      finally { if (attempt === readingId.current) setReading(false); }
    }} /></label>
    <p className="field-help">Columns: name, sku, category, unit, minimum. Units: kg, lb, L, ea, case, bag. Maximum 1 MB. Comma and semicolon separators are supported.</p>
    {reading && <p role="status">Checking your CSV…</p>}
    {preview && <><p><strong>{preview.rowCount} product rows · {preview.products.length} valid · {preview.errors.length} validation messages</strong></p>
      {preview.errors.length > 0 && <div className="error" role="alert"><p>Fix all errors and upload the corrected file. Nothing has been imported.</p><ul>{preview.errors.slice(0, 20).map((message, index) => <li key={index}>{message}</li>)}</ul>{preview.errors.length > 20 && <p>More errors remain in this file.</p>}</div>}
      {!!preview.products.length && <div className="table-wrap"><table><thead><tr><th>Name</th><th>SKU</th><th>Category</th><th>Unit</th><th>Minimum</th></tr></thead><tbody>
        {preview.products.slice(0, 10).map(product => <tr key={product.sku}><td>{product.name}</td><td>{product.sku}</td><td>{product.category}</td><td>{product.unit}</td><td>{product.minimum}</td></tr>)}
      </tbody></table>{preview.products.length > 10 && <p>Showing the first 10 valid products.</p>}</div>}
    </>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="form-actions"><button type="button" className="button secondary" disabled={busy} onClick={dismiss}>Cancel</button>
      <button type="button" className="button" disabled={busy || reading || !preview?.products.length || Boolean(preview?.errors.length)} aria-busy={busy} onClick={() => void importProducts()}>{busy ? 'Importing…' : 'Import products'}</button></div>
  </dialog>;
}
