"""Проставляет ?v=<версия> ко всем своим файлам (CSS, SVG, JS-модули), чтобы браузер
не брал устаревшие копии из кэша после обновления сайта.

    python3 web/tools/bump_version.py            # версия = текущие дата и время
    python3 web/tools/bump_version.py 1.2.0      # своя версия

Запускать после изменений в web/ перед показом или выкладкой.
"""
import pathlib, re, sys, datetime

WEB = pathlib.Path(__file__).resolve().parent.parent
ver = sys.argv[1] if len(sys.argv) > 1 else datetime.datetime.now().strftime("%Y%m%d%H%M")
V = r"(?:\?v=[\w.\-]+)?"

patterns = [
    # import ... from "./x.js" | import "./x.js" | import("./x.js")
    (re.compile(r'((?:from|(?<![{\w])import)\s*\(?\s*["\'])(\.{1,2}/[^"\'?]+\.js)' + V + r'(["\'])'), r"\1\2?v={v}\3"),
    # ссылки на свои ресурсы: assets/...css|svg|js
    (re.compile(r'(["\(])(assets/[^"\'?)\s]+\.(?:css|svg|js))' + V + r'(["\')])'), r"\1\2?v={v}\3"),
]

changed = 0
for path in list(WEB.rglob("*.js")) + list(WEB.rglob("*.html")):
    if "mock" in path.parts and path.name == "corpus.js":
        continue
    text = path.read_text(encoding="utf-8")
    new = text
    for rx, rep in patterns:
        new = rx.sub(rep.format(v=ver), new)
    if new != text:
        path.write_text(new, encoding="utf-8")
        changed += 1
print(f"Версия {ver}: обновлено файлов — {changed}")
