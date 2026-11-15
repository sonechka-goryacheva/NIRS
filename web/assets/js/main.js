/**
 * Точка входа. Маршруты приложения и права доступа к ним.
 *
 *   #/login, #/register            — без входа (и для гостевого режима — чтобы зарегистрироваться)
 *   #/chat, #/chat/:id             — вошедшие, в т.ч. гостевой режим
 *   #/dataset[/:category[/:id]]    — вошедшие (поверх чата)
 *   #/profile                      — вошедшие (поверх чата)
 *   #/learn, #/learn/:topic        — обучение: темы и тест (поверх чата)
 *   #/admin/commands, #/admin/users — только admin (поверх чата)
 */
import "./theme.js?v=202611160100"; // тема до первой отрисовки
import "./ui/select.js?v=202611160100"; // выпадающие списки в стиле темы
import { CONFIG } from "./config.js?v=202611160100";
if (CONFIG.useMock) await import("./mock/index.js?v=202611160100");

import * as router from "./router.js?v=202611160100";
import { session } from "./session.js?v=202611160100";
import { onUnauthorized } from "./api/http.js?v=202611160100";
import { toast } from "./ui/toast.js?v=202611160100";
import { authView } from "./views/auth.js?v=202611160100";
import { chatView } from "./views/chat.js?v=202611160100";
import { datasetView } from "./views/dataset.js?v=202611160100";
import { profileView } from "./views/profile.js?v=202611160100";
import { adminCommandsView, adminUsersView } from "./views/admin.js?v=202611160100";
import { notFoundView } from "./views/errors.js?v=202611160100";
import { learnView } from "./views/learn.js?v=202611160100";
import { getCategories } from "./views/categories.js?v=202611160100";

router.define("/", () => router.go(session.user ? "/chat" : "/login", { replace: true }), { auth: false });
router.define("/login", (ctx) => authView(ctx, "login"), { auth: false, guestOnly: true });
router.define("/register", (ctx) => authView(ctx, "register"), { auth: false, guestOnly: true });
router.define("/chat", chatView);
router.define("/chat/:id", chatView);
router.define("/dataset", datasetView);
router.define("/dataset/:category", datasetView);
router.define("/dataset/:category/:id", datasetView);
router.define("/profile", profileView);
router.define("/learn", learnView);
router.define("/learn/:topic", learnView);
router.define("/admin", () => router.go("/admin/commands", { replace: true }), { roles: ["admin"] });
router.define("/admin/commands", adminCommandsView, { roles: ["admin"] });
router.define("/admin/users", adminUsersView, { roles: ["admin"] });
router.fallback(notFoundView);

router.setGuard((route, ctx) => {
  const user = session.user;
  if (route.auth && !user) return "/login?next=" + encodeURIComponent(ctx.path);
  if (route.guestOnly && user && user.role !== "guest") return "/chat";
  if (route.roles && !route.roles.includes(user.role)) { toast("Недостаточно прав", "error"); return "/chat"; }
  return null;
});

// Сессия истекла на любом запросе → на вход, с возвратом на текущую страницу
onUnauthorized(() => {
  if (!session.user) return;
  session.clear();
  toast("Сессия истекла, войдите снова", "error");
  router.go("/login?next=" + encodeURIComponent(router.current().path), { replace: true });
});

await session.load();
if (session.user) getCategories().catch(() => {});
router.start();
