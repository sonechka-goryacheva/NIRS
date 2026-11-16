/** Кнопка «солнце/луна»: быстро переключает светлую и тёмную тему (на входе и в боковой панели). */
import { icon } from "./icons.js?v=202611161110";
import { currentTheme, toggleTheme, onThemeChange } from "../theme.js?v=202611161110";

export function themeButtonHtml(cls = "icon-btn") {
  const dark = currentTheme() === "dark";
  const label = dark ? "Светлая тема" : "Тёмная тема";
  return `<button type="button" class="${cls}" data-theme-toggle aria-label="${label}" title="${label}">${icon(dark ? "sun" : "moon")}</button>`;
}

document.addEventListener("click", (e) => { if (e.target.closest("[data-theme-toggle]")) toggleTheme(); });
onThemeChange((t) => document.querySelectorAll("[data-theme-toggle]").forEach((b) => {
  const label = t === "dark" ? "Светлая тема" : "Тёмная тема";
  b.innerHTML = icon(t === "dark" ? "sun" : "moon");
  b.setAttribute("aria-label", label);
  b.title = label;
}));
