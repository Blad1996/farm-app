'use client';
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Leaf, Moon, Sun } from 'lucide-react';
import { supabase } from './supabase';
import { prepareProductPhoto } from './product-photos';
import { useAppearance } from './appearance-provider';
import { appearanceVariables, defaultAppearance, fontFamilies, normalizeAppearance, resolveTheme, safeHex, type CompanyAppearance } from './appearance-values';

const bucket = 'company-logos';
export function useCompanyAppearance(companyId: string | null) {
  const { setAppearance } = useAppearance();
  const [saved, setSaved] = useState(defaultAppearance), [canManage, setCanManage] = useState(false), [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [logoUrl, setLogoUrl] = useState('');
  const sequence = useRef(0);
  async function reload() {
    if (!companyId || !supabase) return;
    const token = ++sequence.current; setLoading(true); setError('');
    try {
      const result = await supabase.rpc('company_appearance_snapshot', { p_company: companyId }).abortSignal(AbortSignal.timeout(15000));
      if (token !== sequence.current) return;
      if (result.error || !result.data) throw new Error('Unable to load company appearance.');
      const next = normalizeAppearance(result.data.settings);
      setSaved(next); setAppearance(next); setCanManage(Boolean(result.data.can_manage)); setAvailable(true);
    } catch (failure) {
      if (token !== sequence.current) return;
      setAvailable(false); setError('Company appearance is not configured or could not be loaded. Contact your administrator to check setup.');
      throw failure;
    } finally { if (token === sequence.current) setLoading(false); }
  }
  useEffect(() => {
    setSaved(defaultAppearance); setAppearance(defaultAppearance); setCanManage(false); setAvailable(false); setLoading(false); setError(''); setLogoUrl('');
    void reload().catch(() => undefined);
    return () => { sequence.current++; setAppearance(defaultAppearance); };
    // setAppearance is the provider state setter and is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, setAppearance]);
  useEffect(() => {
    let cancelled = false; setLogoUrl('');
    async function sign() {
      if (!saved.logo_path || !supabase) return;
      const result = await supabase.storage.from(bucket).createSignedUrl(saved.logo_path, 300);
      if (!cancelled && result.data) setLogoUrl(result.data.signedUrl);
    }
    void sign().catch(() => undefined);
    const timer = setInterval(() => { void sign().catch(() => undefined); }, 240000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [saved.logo_path]);
  return { saved, canManage, available, loading, error, logoUrl, reload };
}
export type AppearanceController = ReturnType<typeof useCompanyAppearance>;

export function ThemeToggle() {
  const { theme, setPreference } = useAppearance();
  return <button type="button" onClick={() => setPreference(theme === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
    {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}{theme === 'dark' ? 'Light mode' : 'Dark mode'}
  </button>;
}
export function CompanyBrand({ controller, companyName }: { controller: AppearanceController; companyName: string }) {
  const settings = controller.saved;
  return <div className="brand"><div className={controller.logoUrl ? 'brand-mark company-logo-mark' : 'brand-mark'}>{controller.logoUrl ? <img key={controller.logoUrl} className="company-logo" src={controller.logoUrl} alt={`${settings.brand_name || companyName} logo`} onError={event => { event.currentTarget.hidden = true; }} /> : <Leaf size={23} />}</div>
    <span className="brand-title">{settings.brand_name || companyName || 'Inventory'}<span className="brand-sub">{settings.tagline}</span></span></div>;
}

export default function CompanyAppearanceSettings({ companyId, companyName, controller }: { companyId: string | null; companyName: string; controller: AppearanceController }) {
  const { theme, preference, prefersDark, setPreference } = useAppearance();
  const [draft, setDraft] = useState<CompanyAppearance>(controller.saved), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [logoBlob, setLogoBlob] = useState<Blob | null>(null), [preview, setPreview] = useState(''), [reading, setReading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null), uploadSequence = useRef(0), lock = useRef(false);
  useEffect(() => { setDraft(controller.saved); }, [controller.saved]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => () => { uploadSequence.current++; }, []);
  async function save(event: FormEvent) {
    event.preventDefault(); if (lock.current || !supabase || !companyId) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = await supabase.rpc('save_company_appearance', { p_company: companyId, p_settings: draft });
      if (result.error) throw new Error('Unable to save company appearance. Check your administrator access and setup.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to save.'); lock.current = false; setBusy(false); return; }
    setPreference('company'); setNotice('Company appearance saved.');
    await controller.reload().catch(() => setNotice('Appearance saved. Reload the app to apply the changes.'));
    lock.current = false; setBusy(false);
  }
  async function saveLogo(remove = false) {
    if (lock.current || !supabase || !companyId || (!remove && !logoBlob)) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    let path: string | null = null, attached = false;
    try {
      if (!remove) {
        path = `${companyId}/${crypto.randomUUID()}.${logoBlob!.type === 'image/webp' ? 'webp' : 'png'}`;
        const upload = await supabase.storage.from(bucket).upload(path, logoBlob!, { contentType: logoBlob!.type, cacheControl: '300', upsert: false });
        if (upload.error) throw new Error('Unable to upload the logo. Check storage setup and administrator access.');
      }
      const result = await supabase.rpc('set_company_logo', { p_company: companyId, p_path: path });
      if (result.error) throw new Error('Unable to save the logo. Check company appearance setup.');
      attached = true;
      if (result.data && result.data !== path) await supabase.storage.from(bucket).remove([result.data as string]).catch(() => undefined);
      setLogoBlob(null); setPreview(''); if (fileInput.current) fileInput.current.value = '';
      setNotice(remove ? 'Company logo removed.' : 'Company logo saved.');
      await controller.reload().catch(() => setNotice('Logo saved. Reload the app to display the change.'));
    } catch (failure) {
      // The bucket policy prevents deleting a logo that was attached despite
      // an uncertain network response.
      if (path && !attached) await supabase.storage.from(bucket).remove([path]).catch(() => undefined);
      setError(failure instanceof Error ? failure.message : 'Unable to save the logo.');
    } finally { lock.current = false; setBusy(false); }
  }
  const previewTheme = resolveTheme('company', draft.default_theme, prefersDark);
  const previewStyle = { ...appearanceVariables(draft, previewTheme), fontFamily: 'var(--app-font)', fontSize: 'var(--app-size)' } as CSSProperties;
  const colors = [['primary_color', 'Primary color'], ['sidebar_color', 'Sidebar color']] as const;
  return <>
    <section className="panel appearance-browser"><div><h2>This browser</h2><p>Current mode: {theme === 'dark' ? 'Dark' : 'Light'}. This preference does not change other users.</p></div>
      <div className="actions"><button className="button secondary" onClick={() => setPreference('light')}>Light</button><button className="button secondary" onClick={() => setPreference('dark')}>Dark</button><button className="button secondary" onClick={() => setPreference('system')}>Use system</button><button className="button secondary" disabled={preference === 'company'} onClick={() => setPreference('company')}>Use company default</button></div></section>
    {controller.loading && <p role="status">Loading company appearance…</p>}
    {controller.error && <div className="notice"><p>{controller.error}</p><button className="button secondary small" onClick={() => void controller.reload().catch(() => undefined)}>Try again</button></div>}
    {error && <p className="error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
    {controller.available && <div className="appearance-grid"><div>
      <section className="panel appearance-card"><h2>Company logo</h2><p>Shown in the workspace sidebar. Existing products and records are unaffected.</p>
        {(preview || controller.logoUrl) && <img className="appearance-logo-preview" src={preview || controller.logoUrl} alt="Company logo preview" />}
        {controller.canManage && <><label className="field"><span>Logo image</span><input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={async event => {
          const file = event.currentTarget.files?.[0], token = ++uploadSequence.current;
          setLogoBlob(null); setPreview(''); setError(''); setReading(false); if (!file) return;
          setReading(true);
          try { const blob = await prepareProductPhoto(file); if (token !== uploadSequence.current) return; setLogoBlob(blob); setPreview(URL.createObjectURL(blob)); }
          catch (failure) { if (token === uploadSequence.current) setError(failure instanceof Error ? failure.message : 'Unable to read the logo.'); }
          finally { if (token === uploadSequence.current) setReading(false); }
        }} /></label><p className="field-help">JPG, PNG, or WebP, up to 5 MB. Transparent PNG and WebP logos are supported. SVG is not accepted.</p>
          <div className="actions"><button className="button" disabled={busy || reading || !logoBlob} aria-busy={busy || reading} onClick={() => void saveLogo()}>{reading ? 'Preparing image…' : 'Save logo'}</button>
            {controller.saved.logo_path && <button className="button secondary" disabled={busy} onClick={() => void saveLogo(true)}>Remove logo</button>}</div></>}
      </section>
      <section className="panel appearance-card"><h2>Colors and typography</h2><form onSubmit={save}><fieldset disabled={busy || !controller.canManage}>
        <label className="field"><span>Company display name</span><input value={draft.brand_name} placeholder={companyName} maxLength={100} onChange={event => setDraft({ ...draft, brand_name: event.target.value })} /></label>
        <label className="field"><span>Tagline</span><input value={draft.tagline} maxLength={80} onChange={event => setDraft({ ...draft, tagline: event.target.value })} /></label>
        {colors.map(([key, title]) => <label className="field" key={key}><span>{title}</span><span className="color-field"><input type="color" aria-label={`${title} picker`} value={safeHex(draft[key], defaultAppearance[key])} onChange={event => setDraft({ ...draft, [key]: event.target.value })} /><input aria-label={`${title} hex code`} value={draft[key]} pattern="#[0-9a-fA-F]{6}" maxLength={7} required onChange={event => setDraft({ ...draft, [key]: event.target.value })} /></span></label>)}
        <div className="form-grid"><label className="field"><span>Font family</span><select value={draft.font_family} onChange={event => setDraft({ ...draft, font_family: event.target.value })}>{Object.keys(fontFamilies).map(value => <option key={value} value={value}>{value === 'system' ? 'System font' : value === 'trebuchet' ? 'Trebuchet MS' : value[0].toUpperCase() + value.slice(1)}</option>)}</select></label>
          <label className="field"><span>Text size</span><select value={draft.font_size} onChange={event => setDraft({ ...draft, font_size: event.target.value })}><option value="standard">Standard (16 px)</option><option value="large">Large (18 px)</option><option value="extra_large">Extra large (20 px)</option></select></label></div>
        <div className="form-grid"><label className="field"><span>Company default theme</span><select value={draft.default_theme} onChange={event => setDraft({ ...draft, default_theme: event.target.value })}><option value="system">Follow device setting</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
          <label className="field"><span>Corners</span><select value={draft.corner_style} onChange={event => setDraft({ ...draft, corner_style: event.target.value })}><option value="rounded">Rounded</option><option value="soft">Soft</option><option value="square">Square</option></select></label></div>
        {controller.canManage && <div className="actions"><button className="button" disabled={busy} aria-busy={busy}>{busy ? 'Saving…' : 'Save company appearance'}</button><button type="button" className="button secondary" onClick={() => setDraft({ ...defaultAppearance, logo_path: controller.saved.logo_path })}>Reset preview</button></div>}
      </fieldset></form><p className="field-help">Saving applies the company default to this browser. Fonts use the device&apos;s available typefaces; no external font requests are made.</p>
        {!controller.canManage && <p>Only workspace administrators can edit company appearance.</p>}
      </section>
    </div><aside><h2>Live preview</h2><section className="appearance-preview" data-theme={previewTheme} style={previewStyle}>
      <div className="appearance-preview-sidebar">{(preview || controller.logoUrl) && <img src={preview || controller.logoUrl} alt="Logo preview" />}<strong>{draft.brand_name || companyName}</strong><span>{draft.tagline}</span><p>Overview · Inventory · Crops</p></div>
      <div className="appearance-preview-content"><h3>Your workspace</h3><p>Preview your company colors, font, text size and theme.</p><div className="panel appearance-preview-metric"><span>Products in stock</span><strong>128</strong></div><div className="actions"><button type="button" className="button">Primary action</button><button type="button" className="button secondary">Secondary</button></div><p className="field-help">This preview is not saved until you select Save company appearance.</p></div>
    </section></aside></div>}
  </>;
}
