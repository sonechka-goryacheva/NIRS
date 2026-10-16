/**
 * Ручки сервиса. Контракт — spec/tech/api.md.
 * Типы (JSDoc) описывают то, что возвращает бэкенд.
 *
 * @typedef {{login: string, role: "user"|"admin", created_at: string, last_login_at: string|null}} User
 * @typedef {User & {chats_count: number}} AdminUser
 * @typedef {{key: string, label: string, count: number}} Category
 * @typedef {{id: string, category: string, name: string, command: string, description: string,
 *            examples: string[], tags: string[], platform: "linux"|"mac"|"windows"|"unix"|"cross"}} Command
 * @typedef {{type: "found", commands: Command[], related: Command[]} |
 *           {type: "not_found", message: string, commands: Command[]}} Reply
 *   not_found.commands — от 0 до 3 команд с реальным совпадением слов; пусто — показываем только message.
 * @typedef {{id: string, role: "user", text: string, created_at: string} |
 *           {id: string, role: "assistant", reply: Reply, created_at: string}} Message
 * @typedef {{id: string, title: string, created_at: string, updated_at: string}} ChatSummary
 * @typedef {ChatSummary & {messages: Message[]}} Chat
 */
import { request } from "./http.js?v=202610162235";

const enc = encodeURIComponent;

export const authApi = {
  /** @returns {Promise<User>} 401 — нет сессии */
  me: () => request("GET", "/auth/me", { silent401: true }),
  /** @returns {Promise<User>} */
  login: (login, password) => request("POST", "/auth/login", { body: { login, password }, silent401: true }),
  /** @returns {Promise<User>} 201, сразу авторизует */
  register: (login, password) => request("POST", "/auth/register", { body: { login, password } }),
  logout: () => request("POST", "/auth/logout"),
  /** Работает и без сессии (форма на странице входа). */
  changePassword: (login, old_password, new_password) =>
    request("POST", "/auth/change-password", { body: { login, old_password, new_password }, silent401: true }),
};

export const datasetApi = {
  /** @returns {Promise<Category[]>} */
  categories: () => request("GET", "/categories"),
  /** @returns {Promise<Command[]>} */
  commands: ({ category, q } = {}) => request("GET", "/commands", { query: { category, q } }),
  /** @returns {Promise<Command>} */
  command: (id) => request("GET", `/commands/${enc(id)}`),
};

export const chatsApi = {
  /** @returns {Promise<ChatSummary[]>} новые сверху */
  list: () => request("GET", "/chats"),
  /** @returns {Promise<Chat>} */
  get: (id) => request("GET", `/chats/${enc(id)}`),
  /** Новый чат с первым сообщением. @returns {Promise<{chat: ChatSummary, messages: Message[]}>} */
  create: (message) => request("POST", "/chats", { body: { message } }),
  /** Следующее сообщение в чате. @returns {Promise<{chat: ChatSummary, messages: Message[]}>} */
  send: (id, message) => request("POST", `/chats/${enc(id)}/messages`, { body: { message } }),
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
