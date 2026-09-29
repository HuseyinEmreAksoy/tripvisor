import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Appearance, Platform, useColorScheme } from 'react-native';
import { useFonts } from 'expo-font';
import {
  HankenGrotesk_400Regular,
  HankenGrotesk_500Medium,
  HankenGrotesk_600SemiBold,
  HankenGrotesk_700Bold,
  HankenGrotesk_800ExtraBold,
} from '@expo-google-fonts/hanken-grotesk';
import { storageAdapter } from '@/api/storage';
import { useIsHydrating } from '@/hooks/useIsHydrating';
import {
  brandTypography,
  layout,
  radius,
  shadows,
  spacing,
  themes,
  typography,
  type Colors,
  type ThemeName,
} from './tokens';

// ─── Public types ─────────────────────────────────────────────────────────────

export type ThemeMode = ThemeName | 'system';

export interface Theme {
  name: ThemeName;
  colors: Colors;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  shadows: typeof shadows;
  /** Semantic spacing + desktop column widths (M5 Y2.4). */
  layout: typeof layout;
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

  // Brand typeface (v3): Hanken Grotesk, loaded non-blocking — the UI renders
  // with the system stack and upgrades in place when the font is ready. A
  // failed load just means the fallback stack forever (by design).
  const [fontsLoaded] = useFonts({
    HankenGrotesk_400Regular,
    HankenGrotesk_500Medium,
    HankenGrotesk_600SemiBold,
    HankenGrotesk_700Bold,
    HankenGrotesk_800ExtraBold,
  });

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

  // Web static export: the HTML was prerendered with no storage and no media
  // query (System → light). Hydrate with exactly that, then switch to the
  // stored / system theme right after. React doesn't patch mismatched style
  // attributes while hydrating, so reading the real theme here would leave
  // dark-mode visitors stuck on the light prerender.
  const hydrating = useIsHydrating();
  const activeMode: ThemeMode = hydrating ? 'system' : mode;
  const activeScheme = hydrating ? null : systemScheme;

  const value = useMemo<ThemeContextValue>(() => {
    const name: ThemeName =
      activeMode === 'system'
        ? activeScheme === 'dark'
          ? 'dark'
          : 'light'
        : activeMode;

    return {
      theme: {
        name,
        colors: themes[name],
        spacing,
        radius,
        typography: brandTypography(fontsLoaded),
        shadows,
        layout,
      },
      mode: activeMode,
      setMode,
      // Legacy compat
      override: activeMode === 'system' ? null : activeMode,
      setOverride: (n) => setMode(n === null ? 'system' : n),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMode, activeScheme, fontsLoaded]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx.theme;
}

/**
 * Non-throwing variant for leaf components that may render outside the
 * provider (isolated tests, map canvases): the active theme name, or null
 * when no ThemeProvider is mounted.
 */
export function useThemeNameOptional(): ThemeName | null {
  return useContext(ThemeContext)?.theme.name ?? null;
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
