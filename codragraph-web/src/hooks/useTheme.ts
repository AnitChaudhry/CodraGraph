import { useCallback, useEffect, useState } from 'react';

/**
 * Light/dark theme toggle, persisted to localStorage.
 *
 * Coordinates with the bootstrap script in index.html which sets the
 * `dark` class on `<html>` before React mounts (no flash). This hook
 * keeps the React side in sync and lets components subscribe to the
 * current value.
 */
export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'codragraph-theme';

const readInitial = (): Theme => {
  if (typeof window === 'undefined') return 'dark';
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return 'dark';
};

const apply = (theme: Theme): void => {
  if (typeof document === 'undefined') return;
  if (theme === 'dark') document.documentElement.classList.add('dark');
  else document.documentElement.classList.remove('dark');
};

export interface UseThemeResult {
  theme: Theme;
  setTheme: (next: Theme) => void;
  toggle: () => void;
}

export const useTheme = (): UseThemeResult => {
  const [theme, setThemeState] = useState<Theme>(() => readInitial());

  // Keep DOM in sync when React state changes.
  useEffect(() => {
    apply(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode / disabled storage — DOM still updates */
    }
  }, []);

  const toggle = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* swallow */
      }
      return next;
    });
  }, []);

  return { theme, setTheme, toggle };
};
