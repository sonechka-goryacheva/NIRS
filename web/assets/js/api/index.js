/**
 * Ручки сервиса. Контракт — spec/tech/api.md.
 * Типы (JSDoc) описывают то, что возвращает бэкенд.
 *
 * @typedef {{login: string, role: "guest"|"user"|"admin", created_at: string, last_login_at: string|null}} User
 *   guest — гостевой вход без регистрации (логин вида guest-xxxxxx), данные удаляются при выходе
 * @typedef {User & {chats_count: number}} AdminUser
 * @typedef {{key: string, label: string, count: number, personal?: boolean}} Category
 *   personal — «Мои команды» (key "my"): личный датасет пользователя
 * @typedef {{id: string, category: string, name: string, command: string, description: string,
 *            examples: string[], tags: string[], platform: "linux"|"mac"|"windows"|"unix"|"cross"}} Command
 * @typedef {{type: "found", commands: Command[], related: Command[]} |
 *           {type: "not_found", message: string, commands: Command[]}} Reply
 *   not_found.commands — от 0 до 3 команд с реальным совпадением слов; пусто — показываем только message.
 * @typedef {{id: string, role: "user", text: string, created_at: string} |
 *           {id: string, role: "assistant", reply: Reply, created_at: string}} Message
 * @typedef {{id: string, title: string, created_at: string, updated_at: string, match?: string|null}} ChatSummary
 *   match — только при поиске (?q=): фрагмент сообщения с совпадением; null — совпало название
 * @typedef {ChatSummary & {messages: Message[]}} Chat
 */
import { request } from "./http.js?v=202611161110";

const enc = encodeURIComponent;

export const authApi = {
  /** @returns {Promise<User>} 401 — нет сессии */
  me: () => request("GET", "/auth/me", { silent401: true }),
  /** @returns {Promise<User>} */
  login: (login, password) => request("POST", "/auth/login", { body: { login, password }, silent401: true }),
  /** @returns {Promise<User & {recovery_code: string}>} 201, сразу авторизует; код показать один раз */
  register: (login, password) => request("POST", "/auth/register", { body: { login, password } }),
  /** Гостевой вход без регистрации. @returns {Promise<User>} 201 */
  guest: () => request("POST", "/auth/guest"),
  logout: () => request("POST", "/auth/logout"),
  /** «Забыли пароль?» — без сессии. @returns {Promise<{recovery_code: string}>} новый код */
  resetPassword: (login, recovery_code, new_password) =>
    request("POST", "/auth/reset-password", { body: { login, recovery_code, new_password }, silent401: true }),
  /** Смена пароля вошедшим пользователем, без старого пароля. */
  changePassword: (new_password) => request("POST", "/auth/change-password", { body: { new_password } }),
  /** Выпустить новый код восстановления. @returns {Promise<{recovery_code: string}>} */
  newRecoveryCode: () => request("POST", "/auth/recovery-code"),
};

export const datasetApi = {
  /** @returns {Promise<Category[]>} */
  categories: () => request("GET", "/categories"),
  /** @returns {Promise<Command[]>} */
  commands: ({ category, q } = {}) => request("GET", "/commands", { query: { category, q } }),
  /** @returns {Promise<Command>} */
  command: (id) => request("GET", `/commands/${enc(id)}`),
};

/**
 * Обучение: тесты по темам (категориям справочника и «Моим командам»).
 * @typedef {{key: string, label: string, count: number, available: boolean, personal?: boolean,
 *            best: number|null, last: number|null, attempts: number, mistakes: number}} Topic
 *   best/last — % верных ответов за полный тест; mistakes — сколько команд ждут повторения
 * @typedef {{id: string, type: "task"|"explain"|"name"|"example", prompt: string, subject: string|null, options: string[]}} Question
 */
export const learnApi = {
  /** @returns {Promise<Topic[]>} */
  topics: () => request("GET", "/learn/topics"),
  /** @param {"all"|"mistakes"} mode @param {10|"all"} size сколько вопросов (для mode "all")
   *  @returns {Promise<{id: string, topic: string, mode: string, total: number, questions: Question[]}>} 201 */
  start: (topic, mode = "all", size = 10) => request("POST", "/learn/quizzes", { body: { topic, mode, size } }),
  /** @returns {Promise<{correct: boolean, correct_option: number, command: Command}>} */
  answer: (quizId, question_id, option) => request("POST", `/learn/quizzes/${enc(quizId)}/answers`, { body: { question_id, option } }),
  /** @returns {Promise<{correct: number, total: number, answered: number, best: number|null, mistakes: number}>} */
  finish: (quizId) => request("POST", `/learn/quizzes/${enc(quizId)}/finish`),
  /** Сбросить прогресс темы. */
  reset: (topic) => request("DELETE", `/learn/topics/${enc(topic)}`),
};

/** Личный датасет (только зарегистрированные; гостю 403). */
export const myCommandsApi = {
  /** @returns {Promise<Command[]>} */
  list: () => request("GET", "/my/commands"),
  /** @param {object[]} commands @param {"append"|"replace"} mode
   *  @returns {Promise<{added: number, skipped: {index: number, reason: string}[], total: number}>} */
  import: (commands, mode = "append") => request("POST", "/my/commands/import", { body: { commands, mode } }),
  /** @returns {Promise<Command>} */
  update: (id, cmd) => request("PUT", `/my/commands/${enc(id)}`, { body: cmd }),
  remove: (id) => request("DELETE", `/my/commands/${enc(id)}`),
  clear: () => request("DELETE", "/my/commands"),
};

export const chatsApi = {
  /** @param {string} [q] поиск по истории @returns {Promise<ChatSummary[]>} новые сверху */
  list: (q) => request("GET", "/chats", { query: { q } }),
  /** @returns {Promise<Chat>} */
  get: (id) => request("GET", `/chats/${enc(id)}`),
  /** Новый чат с первым сообщением. @returns {Promise<{chat: ChatSummary, messages: Message[]}>} */
  create: (message) => request("POST", "/chats", { body: { message } }),
  /** Следующее сообщение в чате. @returns {Promise<{chat: ChatSummary, messages: Message[]}>} */
  send: (id, message) => request("POST", `/chats/${enc(id)}/messages`, { body: { message } }),
  /** @returns {Promise<ChatSummary>} */

  // 👇 ДОБАВИТЬ ЭТОТ МЕТОД ЗДЕСЬ 👇
  /** Загрузка изображения для OCR. @returns {Promise<{chat: ChatSummary, messages: Message[], extracted_text: string}>} */
  uploadImage: async (id, file) => {
    const formData = new FormData();
    formData.append('file', file);
    
    // Используем fetch напрямую, так как стандартный request() ожидает JSON
    const response = await fetch(`/api/chats/${enc(id)}/upload-image`, {
      method: 'POST',
      body: formData,
      credentials: 'include' // Обязательно: отправляет cookie сессии
    });
    
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Ошибка сети' }));
      throw new Error(err.detail || 'Ошибка загрузки изображения');
    }
    
    return response.json();
  },
  // 👆 КОНЕЦ ДОБАВЛЕННОГО МЕТОДА 👆



  rename: (id, title) => request("PATCH", `/chats/${enc(id)}`, { body: { title } }),
  remove: (id) => request("DELETE", `/chats/${enc(id)}`),
};

export const adminApi = {
  commands: {
    /** @returns {Promise<Command>} */
    create: (cmd) => request("POST", "/admin/commands", { body: cmd }),
    /** @returns {Promise<Command>} */
    update: (id, cmd) => request("PUT", `/admin/commands/${enc(id)}`, { body: cmd }),
    remove: (id) => request("DELETE", `/admin/commands/${enc(id)}`),
  },
  users: {
    /** @returns {Promise<AdminUser[]>} */
    list: ({ q, role } = {}) => request("GET", "/admin/users", { query: { q, role } }),
    /** @returns {Promise<AdminUser>} */
    get: (login) => request("GET", `/admin/users/${enc(login)}`),
    /** @returns {Promise<AdminUser>} 201 */
    create: ({ login, password, role }) => request("POST", "/admin/users", { body: { login, password, role } }),
    /** patch: {role?, password?} @returns {Promise<AdminUser>} */
    update: (login, patch) => request("PATCH", `/admin/users/${enc(login)}`, { body: patch }),
    remove: (login) => request("DELETE", `/admin/users/${enc(login)}`),
  },
};
