/** Кэш категорий (нужны в датасете, админке и подписях карточек). */
import { datasetApi } from "../api/index.js?v=202610162235";
import { setCategoryLabels } from "../ui/command-card.js?v=202610162235";

let cache = null;
export async function getCategories({ fresh = false } = {}) {
  if (!cache || fresh) {
    cache = await datasetApi.categories();
    setCategoryLabels(Object.fromEntries(cache.map((c) => [c.key, c.label])));
  }
  return cache;
}
export function invalidateCategories() { cache = null; }
