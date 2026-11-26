'use client';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { appearanceVariables, defaultAppearance, resolveTheme, type CompanyAppearance, type ThemePreference } from './appearance-values';

type Context = { settings: CompanyAppearance; setAppearance: (value: CompanyAppearance) => void; preference: ThemePreference; setPreference: (value: ThemePreference) => void; theme: 'light' | 'dark'; prefersDark: boolean };
const AppearanceContext = createContext<Context | null>(null);
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [settings, setAppearance] = useState(defaultAppearance), [preference, updatePreference] = useState<ThemePreference>('company'), [prefersDark, setPrefersDark] = useState(false);
  useEffect(() => {
    try { const stored = localStorage.getItem('agro-theme-preference'); if (stored && ['company', 'system', 'light', 'dark'].includes(stored)) updatePreference(stored as ThemePreference); } catch { /* Theme still works if browser storage is unavailable. */ }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const changed = () => setPrefersDark(media.matches); changed(); media.addEventListener('change', changed);
    const storage = (event: StorageEvent) => { if (event.key === 'agro-theme-preference') updatePreference(['company', 'system', 'light', 'dark'].includes(event.newValue || '') ? event.newValue as ThemePreference : 'company'); };
    window.addEventListener('storage', storage);
    return () => { media.removeEventListener('change', changed); window.removeEventListener('storage', storage); };
  }, []);
  const theme = resolveTheme(preference, settings.default_theme, prefersDark);
  useEffect(() => {
    const root = document.documentElement, variables = appearanceVariables(settings, theme);
    root.dataset.theme = theme;
    for (const [key, value] of Object.entries(variables)) root.style.setProperty(key, value);
    return () => { for (const key of Object.keys(variables)) root.style.removeProperty(key); };
  }, [settings, theme]);
  const context = useMemo(() => ({ settings, setAppearance, preference, theme, prefersDark, setPreference: (value: ThemePreference) => {
    updatePreference(value); try { localStorage.setItem('agro-theme-preference', value); } catch { /* Browser-only preference remains active. */ }
  } }), [settings, preference, theme, prefersDark]);
  return <AppearanceContext.Provider value={context}>{children}</AppearanceContext.Provider>;
}
export function useAppearance() { const context = useContext(AppearanceContext); if (!context) throw new Error('AppearanceProvider is required.'); return context; }
