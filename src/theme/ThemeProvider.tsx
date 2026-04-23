import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { radius, spacing, themes, typography, type Colors, type ThemeName } from './tokens';

export interface Theme {
  name: ThemeName;
  colors: Colors;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
}

interface ThemeContextValue {
  theme: Theme;
  override: ThemeName | null;
  setOverride: (name: ThemeName | null) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [override, setOverride] = useState<ThemeName | null>(null);

  const value = useMemo<ThemeContextValue>(() => {
    const name: ThemeName = override ?? (systemScheme === 'dark' ? 'dark' : 'light');
    return {
      theme: {
        name,
        colors: themes[name],
        spacing,
        radius,
        typography,
      },
      override,
      setOverride,
    };
  }, [override, systemScheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx.theme;
}

export function useThemeControls() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeControls must be used inside <ThemeProvider>');
  return { override: ctx.override, setOverride: ctx.setOverride };
}
