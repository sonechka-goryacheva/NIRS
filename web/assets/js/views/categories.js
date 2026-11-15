/** Кэш категорий (нужны в датасете, админке и подписях карточек). */
import { datasetApi } from "../api/index.js?v=202611160130";
import { setCategoryLabels } from "../ui/command-card.js?v=202611160130";
import { session } from "../session.js?v=202611160130";

let cache = null;
// Набор категорий зависит от пользователя («Мои команды» есть только у зарегистрированных)
session.onChange(() => { cache = null; });
export async function getCategories({ fresh = false } = {}) {
  if (!cache || fresh) {
    cache = await datasetApi.categories();
    setCategoryLabels(Object.fromEntries(cache.map((c) => [c.key, c.label])));
  }
  return cache;
}
export function invalidateCategories() { cache = null; }
