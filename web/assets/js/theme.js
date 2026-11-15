/**
 * Тема оформления: "light" | "dark" | "system" (как в ОС).
 * Выбор хранится в браузере (localStorage), применяется атрибутом <html data-theme="light|dark">.
 * Токены обеих тем — в assets/css/theme.css.
 */
const KEY = "nirs.theme";
const MODES = ["system", "light", "dark"];
const media = matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set();

function read() {
  try { const v = localStorage.getItem(KEY); return MODES.includes(v) ? v : "system"; } catch { return "system"; }
}

/** Выбор пользователя: system | light | dark */
export function themeMode() { return read(); }

/** Тема, которая действует сейчас: light | dark */
export function currentTheme() {
  const m = read();
  return m === "system" ? (media.matches ? "dark" : "light") : m;
}

export function applyTheme() {
  const t = currentTheme();
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "dark" ? "#0c2a26" : "#f1faf6");
  listeners.forEach((fn) => fn(t));
}

export function setThemeMode(mode) {
  try { localStorage.setItem(KEY, MODES.includes(mode) ? mode : "system"); } catch {}
  applyTheme();
}

/** Быстрое переключение светлая ↔ тёмная (кнопка с солнцем/луной). */
export function toggleTheme() { setThemeMode(currentTheme() === "dark" ? "light" : "dark"); }

export function onThemeChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

media.addEventListener?.("change", () => { if (read() === "system") applyTheme(); });
applyTheme();
