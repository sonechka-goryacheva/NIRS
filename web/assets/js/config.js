/**
 * Настройки фронтенда.
 *
 * Интеграция с настоящим бэкендом:
 *   1. useMock: false
 *   2. удалить папку assets/js/mock/
 * Больше ничего менять не нужно: весь код ходит в API только через assets/js/api/.
 */
export const CONFIG = {
  apiBase: "/api",
  useMock: true,
};
