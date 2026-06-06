// Theme system with localStorage persistence.
// Each theme is a CSS class applied to <html> that overrides design tokens
// defined in src/styles.css.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemeId = "quant-lab" | "bloomberg" | "tv-dark" | "tv-light";

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  hint: string;
  swatch: string;
}

export const THEMES: ThemeMeta[] = [
  { id: "quant-lab", label: "Quant Lab", hint: "Dark · Emerald", swatch: "oklch(0.74 0.16 162)" },
  { id: "bloomberg", label: "Bloomberg", hint: "Black · Amber", swatch: "oklch(0.78 0.16 70)" },
  { id: "tv-dark", label: "TV Dark", hint: "Slate · Cyan", swatch: "oklch(0.75 0.14 220)" },
  { id: "tv-light", label: "TV Light", hint: "Light · Blue", swatch: "oklch(0.55 0.18 250)" },
];

const STORAGE_KEY = "wavescan:theme";
const DEFAULT_THEME: ThemeId = "quant-lab";

interface ThemeCtx {
  theme: ThemeId;
  setTheme: (t: ThemeId) => void;
}
const Ctx = createContext<ThemeCtx | null>(null);

function applyTheme(t: ThemeId) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove("theme-quant-lab", "theme-bloomberg", "theme-tv-dark", "theme-tv-light");
  root.classList.add(`theme-${t}`);
  // dark color-scheme for all themes except tv-light
  if (t === "tv-light") root.classList.remove("dark");
  else root.classList.add("dark");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(DEFAULT_THEME);

  useEffect(() => {
    const stored = (typeof window !== "undefined" && localStorage.getItem(STORAGE_KEY)) as ThemeId | null;
    const t = stored && THEMES.some((x) => x.id === stored) ? stored : DEFAULT_THEME;
    setThemeState(t);
    applyTheme(t);
  }, []);

  const setTheme = (t: ThemeId) => {
    setThemeState(t);
    applyTheme(t);
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, t);
  };

  return <Ctx.Provider value={{ theme, setTheme }}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
