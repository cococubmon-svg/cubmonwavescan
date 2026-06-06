import { THEMES, useTheme } from "@/lib/theme";

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="flex items-center gap-1 bg-panel-2 rounded-md p-0.5">
      {THEMES.map((t) => (
        <button
          key={t.id}
          onClick={() => setTheme(t.id)}
          title={`${t.label} · ${t.hint}`}
          className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-mono uppercase transition-colors ${
            theme === t.id
              ? "bg-brand text-brand-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <span
            className="w-2 h-2 rounded-full ring-1 ring-black/10"
            style={{ background: t.swatch }}
          />
          <span className="hidden sm:inline">{t.label}</span>
        </button>
      ))}
    </div>
  );
}
