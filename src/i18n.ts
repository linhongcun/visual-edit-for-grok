import en from "../i18n/en.json";
import zh from "../i18n/zh.json";

export type Locale = "en" | "zh";

export type MessageKey = keyof typeof en;

const CATALOGS: Record<Locale, Record<string, string>> = {
  en: en as Record<string, string>,
  zh: zh as Record<string, string>,
};

export function normalizeLocale(value: unknown): Locale {
  if (typeof value !== "string") return "en";
  const v = value.trim().toLowerCase().replace(/_/g, "-");
  if (v === "zh" || v.startsWith("zh-")) return "zh";
  if (v === "en" || v.startsWith("en-")) return "en";
  return "en";
}

export function detectBrowserLocale(): Locale {
  if (typeof navigator === "undefined") return "en";
  const fromList = navigator.languages?.[0];
  return normalizeLocale(navigator.language || fromList);
}

export function t(
  locale: Locale,
  key: MessageKey | string,
  vars?: Record<string, string | number> | null,
): string {
  const lang = normalizeLocale(locale);
  const catalog = CATALOGS[lang] || en;
  let text = catalog[key] ?? (en as Record<string, string>)[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return text;
}

export function localeLabel(locale: Locale): string {
  return locale === "zh" ? "中文" : "English";
}
