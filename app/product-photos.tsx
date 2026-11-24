'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Package, X } from 'lucide-react';
import type { Product } from './inventory';
import { supabase } from './supabase';

export const photoBucket = 'product-photos';
const maxPhotoBytes = 5 * 1024 * 1024;

async function validatePhoto(file: File) {
  if (!file.size || file.size > maxPhotoBytes) throw new Error('Choose a JPG, PNG, or WebP image of 5 MB or less.');
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (!png && !jpg && !webp) throw new Error('This file is not a supported image. Choose JPG, PNG, or WebP.');
}

export async function prepareProductPhoto(file: File): Promise<Blob> {
  await validatePhoto(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 24000000) throw new Error('Choose an image with no more than 24 megapixels.');
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not process this image.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    // Re-encode rather than retain uploaded metadata or active file formats.
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Unable to process this image.')), 'image/webp', 0.85));
    if (!['image/webp', 'image/png'].includes(blob.type) || blob.size > maxPhotoBytes) throw new Error('Unable to prepare this photo. Choose a smaller image.');
    return blob;
  } finally { URL.revokeObjectURL(url); }
}

export async function uploadProductPhoto(companyId: string, productId: string, blob: Blob) {
  if (!supabase) throw new Error('Connect your workspace first.');
  const path = `${companyId}/${productId}/${crypto.randomUUID()}.${blob.type === 'image/webp' ? 'webp' : 'png'}`;
  const uploaded = await supabase.storage.from(photoBucket).upload(path, blob, { contentType: blob.type, cacheControl: '300', upsert: false });
  if (uploaded.error) throw new Error('Unable to upload the photo. Check that product photo storage is enabled and that you have administrator access.');
  const attached = await supabase.rpc('set_inventory_product_photo', { p_company: companyId, p_product: productId, p_path: path });
  if (attached.error) {
    // The delete policy only allows unreferenced files: an uncertain network
    // result can never cause removal of a photo that was successfully attached.
    await supabase.storage.from(photoBucket).remove([path]).catch(() => undefined);
    throw new Error('Unable to attach the photo. Contact your administrator to check product photo setup.');
  }
  const previous = attached.data as string | null;
  if (previous && previous !== path) await supabase.storage.from(photoBucket).remove([previous]).catch(() => undefined);
}

export function ProductPhotoInput({ required = false }: { required?: boolean }) {
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const attempt = useRef(0);
  useEffect(() => () => { attempt.current++; }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  return <div><label className="field"><span>Product photo {required ? '' : '(optional)'}</span>
    <input name="product_photo" type="file" accept="image/jpeg,image/png,image/webp" required={required} onChange={async event => {
      const input = event.currentTarget, file = input.files?.[0], request = ++attempt.current;
      setPreview(''); setError(''); input.setCustomValidity('');
      if (!file) return;
      input.setCustomValidity('Please wait while the photo is checked.');
      try {
        await validatePhoto(file);
        if (request !== attempt.current) return;
        input.setCustomValidity(''); setPreview(URL.createObjectURL(file));
      } catch (failure) {
        if (request !== attempt.current) return;
        const message = failure instanceof Error ? failure.message : 'Unable to read this image.';
        input.setCustomValidity(message); setError(message);
      }
    }} /></label>
    <p className="field-help">JPG, PNG, or WebP. Maximum 5 MB. Photos are resized before upload.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {preview && <img className="product-photo-preview" src={preview} alt="Selected product photo preview" />}
  </div>;
}

export function useProductPhotoUrls(products: Product[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = JSON.stringify([...new Set(products.map(product => product.photo_path).filter((path): path is string => Boolean(path)))].sort());
  useEffect(() => {
    let cancelled = false;
    setUrls({});
    const paths = JSON.parse(key) as string[];
    async function load() {
      if (!supabase || !paths.length) return;
      const next: Record<string, string> = {};
      for (let offset = 0; offset < paths.length; offset += 100) {
        const response = await supabase.storage.from(photoBucket).createSignedUrls(paths.slice(offset, offset + 100), 300);
        for (const item of response.data ?? []) if (item.path && item.signedUrl && !item.error) next[item.path] = item.signedUrl;
      }
      if (!cancelled) setUrls(next);
    }
    void load().catch(() => undefined);
    const timer = setInterval(() => { void load().catch(() => undefined); }, 240000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [key]);
  return urls;
}

export function ProductThumbnail({ product, url }: { product: Product; url?: string }) {
  return <span className="product-thumbnail"><Package size={22} aria-hidden="true" />
    {url && <img key={url} src={url} alt={`${product.name} product photo`} loading="lazy" onError={event => { event.currentTarget.hidden = true; }} />}</span>;
}

export function ProductPhotoDialog({ companyId, product, close, refresh }: { companyId: string | null; product: Product; close: () => void; refresh: () => Promise<void> }) {
  const ref = useRef<HTMLDialogElement>(null), locked = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  const dismiss = () => { if (!locked.current) close(); };
  async function change(form: HTMLFormElement | null) {
    if (locked.current || !companyId || !supabase) return;
    locked.current = true; setBusy(true); setError('');
    try {
      if (form) {
        const file = new FormData(form).get('product_photo');
        if (!(file instanceof File) || !file.size) throw new Error('Choose a product photo.');
        await uploadProductPhoto(companyId, product.id, await prepareProductPhoto(file));
      } else {
        const result = await supabase.rpc('set_inventory_product_photo', { p_company: companyId, p_product: product.id, p_path: null });
        if (result.error) throw new Error('Unable to remove the photo. Check your administrator access.');
        if (result.data) await supabase.storage.from(photoBucket).remove([result.data as string]).catch(() => undefined);
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to save the photo.'); locked.current = false; setBusy(false); return; }
    // Attachment is committed; refresh failure must not look like upload failure.
    await refresh().catch(() => undefined);
    locked.current = false; setBusy(false); close();
  }
  return <dialog ref={ref} aria-labelledby="photo-dialog-title" onCancel={event => { event.preventDefault(); dismiss(); }}>
    <div className="dialog-head"><h2 id="photo-dialog-title">{product.photo_path ? 'Replace product photo' : 'Add product photo'}</h2><button type="button" className="icon-button" aria-label="Close dialog" disabled={busy} onClick={dismiss}><X size={21} /></button></div>
    <p>{product.name} · {product.sku}</p><form onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void change(event.currentTarget); }}>
      <fieldset disabled={busy}><ProductPhotoInput required /></fieldset>{error && <p className="error" role="alert">{error}</p>}
      <div className="form-actions">{product.photo_path && <button type="button" className="button secondary" disabled={busy} onClick={() => void change(null)}>Remove photo</button>}
        <button type="button" className="button secondary" disabled={busy} onClick={dismiss}>Cancel</button><button className="button" disabled={busy} aria-busy={busy}>{busy ? 'Saving…' : 'Save photo'}</button></div>
    </form></dialog>;
}
