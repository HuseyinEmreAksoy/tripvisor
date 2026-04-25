import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Appearance, Platform, useColorScheme } from 'react-native';
import { storageAdapter } from '@/api/storage';
import { radius, shadows, spacing, themes, typography, type Colors, type ThemeName } from './tokens';

// ─── Public types ─────────────────────────────────────────────────────────────

export type ThemeMode = ThemeName | 'system';

export interface Theme {
  name: ThemeName;
  colors: Colors;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  shadows: typeof shadows;
}

// ─── Internal context shape ───────────────────────────────────────────────────

interface ThemeContextValue {
  theme: Theme;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  /** @deprecated Use `mode === 'system' ? null : mode`. Kept for call-site compat. */
  override: ThemeName | null;
  /** @deprecated Use `setMode`. Kept for call-site compat. */
  setOverride: (name: ThemeName | null) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'tripvisor.theme.mode';

// ─── Synchronous initial read (web only) ─────────────────────────────────────
//
// On web, localStorage is synchronous. Reading it here avoids a
// FOUC where the page briefly renders the wrong theme.
// On native, `undefined` is returned and we default to 'system'.

function readModeSync(): ThemeMode {
  if (Platform.OS === 'web') {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
      }
    } catch {
      // Sandboxed / SSR — fall through
    }
  }
  return 'system';
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();

  // Web initializes synchronously (no FOUC). Native starts as 'system' and
  // rehydrates asynchronously from SecureStore on first mount.
  const [mode, setModeState] = useState<ThemeMode>(readModeSync);

  // Native-only async rehydration.
  useEffect(() => {
    if (Platform.OS === 'web') return; // already read synchronously above
    storageAdapter.getItem(STORAGE_KEY).then((stored) => {
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        setModeState(stored);
      }
    });
  }, []);

  // Listen for OS appearance changes when in 'system' mode.
  useEffect(() => {
    const sub = Appearance.addChangeListener(() => {
      // Trigger a re-render so the derived `name` recalculates from
      // the updated value of `useColorScheme()`.
      setModeState((prev) => prev);
    });
    return () => sub.remove();
  }, []);

  const setMode = (next: ThemeMode) => {
    setModeState(next);
    storageAdapter.setItem(STORAGE_KEY, next);
  };

  const value = useMemo<ThemeContextValue>(() => {
    const name: ThemeName =
      mode === 'system'
        ? systemScheme === 'dark'
          ? 'dark'
          : 'light'
        : mode;

    return {
      theme: {
        name,
        colors: themes[name],
        spacing,
        radius,
        typography,
        shadows,
      },
      mode,
      setMode,
      // Legacy compat
      override: mode === 'system' ? null : mode,
      setOverride: (n) => setMode(n === null ? 'system' : n),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, systemScheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx.theme;
}

export function useThemeControls() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeControls must be used inside <ThemeProvider>');
  return {
    mode: ctx.mode,
    setMode: ctx.setMode,
    // Legacy
    override: ctx.override,
    setOverride: ctx.setOverride,
  };
}
