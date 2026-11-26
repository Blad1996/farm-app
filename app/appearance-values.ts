export type CompanyAppearance = { brand_name: string; tagline: string; primary_color: string; sidebar_color: string; font_family: string; font_size: string; default_theme: string; corner_style: string; logo_path: string | null };
export type ThemePreference = 'company' | 'system' | 'light' | 'dark';
export const defaultAppearance: CompanyAppearance = { brand_name: '', tagline: 'Agriculture & food', primary_color: '#276447', sidebar_color: '#142b21', font_family: 'system', font_size: 'standard', default_theme: 'system', corner_style: 'rounded', logo_path: null };
export const fontFamilies: Record<string, string> = { system: '"Segoe UI", system-ui, sans-serif', arial: 'Arial, Helvetica, sans-serif', verdana: 'Verdana, Geneva, sans-serif', georgia: 'Georgia, "Times New Roman", serif', trebuchet: '"Trebuchet MS", Arial, sans-serif' };
export const safeHex = (value: string, fallback: string) => /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
function rgb(hex: string) { return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)); }
function luminance(hex: string) { return rgb(hex).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0); }
export function contrastRatio(a: string, b: string) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
export const contrastText = (background: string) => contrastRatio(background, '#ffffff') >= contrastRatio(background, '#000000') ? '#ffffff' : '#000000';
export function mixColors(a: string, b: string, weight: number) { const x = rgb(a), y = rgb(b); return '#' + x.map((value, index) => Math.round(value * (1 - weight) + y[index] * weight).toString(16).padStart(2, '0')).join(''); }
export function normalizeAppearance(value?: Partial<CompanyAppearance> | null): CompanyAppearance {
  const result = { ...defaultAppearance, ...value };
  result.primary_color = safeHex(result.primary_color, defaultAppearance.primary_color);
  result.sidebar_color = safeHex(result.sidebar_color, defaultAppearance.sidebar_color);
  if (!Object.hasOwn(fontFamilies, result.font_family)) result.font_family = 'system';
  if (!['standard', 'large', 'extra_large'].includes(result.font_size)) result.font_size = 'standard';
  if (!['system', 'light', 'dark'].includes(result.default_theme)) result.default_theme = 'system';
  if (!['square', 'soft', 'rounded'].includes(result.corner_style)) result.corner_style = 'rounded';
  return result;
}
export function resolveTheme(preference: ThemePreference, companyTheme: string, prefersDark: boolean): 'light' | 'dark' {
  const choice = preference === 'company' ? companyTheme : preference;
  return choice === 'dark' || (choice === 'system' && prefersDark) ? 'dark' : 'light';
}
export function appearanceVariables(settings: CompanyAppearance, theme: 'light' | 'dark') {
  const value = normalizeAppearance(settings), primary = value.primary_color, sidebar = value.sidebar_color, sidebarText = contrastText(sidebar);
  const surface = theme === 'dark' ? '#18222d' : '#ffffff', foreground = theme === 'dark' ? '#e6edf3' : '#182820';
  let link = primary;
  for (let step = 1; contrastRatio(link, surface) < 4.5 && step <= 10; step++) link = mixColors(primary, foreground, step / 10);
  const hover = mixColors(primary, foreground, 0.12);
  return {
    '--green': primary, '--on-primary': contrastText(primary), '--primary-hover': hover, '--on-primary-hover': contrastText(hover), '--accent-text': link,
    '--dark': sidebar, '--sidebar-ink': sidebarText, '--sidebar-muted': mixColors(sidebarText, sidebar, 0.2),
    '--sidebar-hover': mixColors(sidebar, sidebarText, 0.1), '--sidebar-active': mixColors(sidebar, sidebarText, 0.18), '--sidebar-border': mixColors(sidebar, sidebarText, 0.28),
    '--app-font': fontFamilies[value.font_family], '--app-size': ({ standard: '16px', large: '18px', extra_large: '20px' } as Record<string, string>)[value.font_size],
    '--panel-radius': ({ square: '0px', soft: '6px', rounded: '12px' } as Record<string, string>)[value.corner_style],
    '--control-radius': ({ square: '0px', soft: '4px', rounded: '8px' } as Record<string, string>)[value.corner_style],
  };
}
