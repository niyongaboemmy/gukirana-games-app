export const locales = ["rw", "en", "fr", "sw"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";
export const localeNames: Record<Locale, string> = {
  rw: "Kinyarwanda",
  en: "English",
  fr: "Français",
  sw: "Kiswahili",
};
