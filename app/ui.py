"""
app/ui.py

Консольный интерфейс справочника (заглушка для отладки).
Позже заменяется на GUI (Tkinter / CustomTkinter) без изменения логики.
"""

from app.search import search
from app.llm import ask_llm

BANNER = """
========================================
  Справочник IT-команд
  Введите запрос или 'exit' для выхода.
========================================
"""


def run():
    print(BANNER)
    while True:
        try:
            query = input("> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nВыход.")
            break

        if not query:
            continue
        if query.lower() in ("exit", "quit", "q"):
            print("Выход.")
            break

        docs = search(query, top_k=3)
        answer = ask_llm(query, docs)
        print()
        print(answer)
        print("-" * 40)


if __name__ == "__main__":
    run()
