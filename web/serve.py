"""Локальный сервер для разработки: отдаёт эту папку без кэша.

    python3 web/serve.py          # http://localhost:8080
    python3 web/serve.py 8085     # свой порт

Если порт занят (например, старым `python3 -m http.server`), сервер скажет об этом
и запустится на следующем свободном порту — смотрите адрес в выводе.
"""
import errno, http.server, os, sys

DEFAULT_PORT = 8080
VARIANT = "мятный (основной проект)"

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        # Страница сайта: просим браузер стереть весь сохранённый кэш этого адреса
        # (старые версии страниц, стилей, иконок от прежних серверов). Данные входа и демо-база не трогаются.
        if self.path.split("?")[0] in ("/", "/index.html"):
            self.send_header("Clear-Site-Data", '"cache"')
        super().end_headers()
    def log_message(self, fmt, *args):
        # коротко: какой файл браузер запросил и что получил
        print(f"  {self.command} {self.path}  →  {args[1] if len(args) > 1 else ''}")

root = os.path.dirname(os.path.abspath(__file__))
os.chdir(root)
port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
for p in range(port, port + 20):
    try:
        srv = http.server.ThreadingHTTPServer(("", p), NoCache)
    except OSError as e:
        if e.errno in (errno.EADDRINUSE, 48, 98):
            print(f"! Порт {p} занят другим сервером. Остановить его: lsof -ti :{p} | xargs kill")
            continue
        raise
    print(f"Справочник IT-команд — вариант: {VARIANT}")
    print(f"Папка: {root}")
    print(f"Откройте: http://localhost:{p}   (Ctrl+C — остановить)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nСервер остановлен.")
    break
else:
    print("Не нашёл свободный порт — остановите старые серверы: pkill -f http.server")
