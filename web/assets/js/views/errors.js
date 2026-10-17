/** Страница «не найдено» для неизвестных адресов. */
import { $, setTitle } from "../ui/dom.js?v=202610162235";
import { session } from "../session.js?v=202610162235";
import { unmount } from "./shell.js?v=202610162235";
import { resetChatState } from "./chat.js?v=202610162235";

export function notFoundView() {
  unmount();
  resetChatState();
  document.body.className = "theme-light page-app";
  setTitle("Страница не найдена");
  $("#app").innerHTML = `<main class="center-page"><div class="glass center-card">
    <img src="assets/img/logo.svg?v=202610162235" alt="" width="56" height="56" />
    <div class="eyebrow">Ошибка 404</div>
    <h1>Страница не найдена</h1>
    <p>Проверьте адрес или вернитесь в справочник.</p>
    <a class="btn btn-primary" href="#${session.user ? "/chat" : "/login"}">${session.user ? "К чату" : "Ко входу"}</a>
  </div></main>`;
}
