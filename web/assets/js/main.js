/**
 * Точка входа. Маршруты приложения и права доступа к ним.
 *
 *   #/login, #/register            — только для гостей
 *   #/chat, #/chat/:id             — вошедшие
 *   #/dataset[/:category[/:id]]    — вошедшие (поверх чата)
 *   #/profile                      — вошедшие (поверх чата)
 *   #/admin/commands, #/admin/users — только admin (поверх чата)
 */
import { CONFIG } from "./config.js?v=202610162235";
if (CONFIG.useMock) await import("./mock/index.js?v=202610162235");

import * as router from "./router.js?v=202610162235";
import { session } from "./session.js?v=202610162235";
import { onUnauthorized } from "./api/http.js?v=202610162235";
import { toast } from "./ui/toast.js?v=202610162235";
import { authView } from "./views/auth.js?v=202610162235";
import { chatView } from "./views/chat.js?v=202610162235";
import { datasetView } from "./views/dataset.js?v=202610162235";
import { profileView } from "./views/profile.js?v=202610162235";
import { adminCommandsView, adminUsersView } from "./views/admin.js?v=202610162235";
import { notFoundView } from "./views/errors.js?v=202610162235";
import { getCategories } from "./views/categories.js?v=202610162235";

router.define("/", () => router.go(session.user ? "/chat" : "/login", { replace: true }), { auth: false });
router.define("/login", (ctx) => authView(ctx, "login"), { auth: false, guestOnly: true });
router.define("/register", (ctx) => authView(ctx, "register"), { auth: false, guestOnly: true });
router.define("/chat", chatView);
router.define("/chat/:id", chatView);
router.define("/dataset", datasetView);
router.define("/dataset/:category", datasetView);
router.define("/dataset/:category/:id", datasetView);
router.define("/profile", profileView);
router.define("/admin", () => router.go("/admin/commands", { replace: true }), { roles: ["admin"] });
router.define("/admin/commands", adminCommandsView, { roles: ["admin"] });
router.define("/admin/users", adminUsersView, { roles: ["admin"] });
router.fallback(notFoundView);

router.setGuard((route, ctx) => {
  const user = session.user;
  if (route.auth && !user) return "/login?next=" + encodeURIComponent(ctx.path);
  if (route.guestOnly && user) return "/chat";
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
