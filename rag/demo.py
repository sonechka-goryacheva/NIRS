"""
Демонстрация RAG в терминале (без сервера и веб-интерфейса): вопрос → 3 этапа → ответ со ссылками на источники.

    python rag/demo.py                                   # 3 примера: два вопроса по теме и один не по теме
    python rag/demo.py "не хватает прав при запуске скрипта"
    python rag/demo.py "откатить коммит" -k 3 --full-prompt

Этапы:
  1. Retrieval  — поиск BM25 (rag/): top-k команд корпуса с ID и баллом BM25;
  2. Augmented  — сборка промпта: найденные команды подставляются в контекст запроса к LLM;
  3. Generation — ответ LLM (app/llm.py: заглушка по умолчанию, OpenAI при USE_STUB=false и OPENAI_API_KEY в .env)
                  + список использованных источников.
Если поиск ничего не нашёл, этапы 2–3 не выполняются: LLM не вызывается и ответ не выдумывается.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if __package__ in (None, ""):  # запуск файлом: python rag/demo.py
    sys.path.insert(0, str(ROOT))

from app import llm  # noqa: E402 — генерация ответа (модуль приложения, здесь только используется)
from rag.engine import SearchEngine  # noqa: E402

EXAMPLES = [
    "не хватает прав при запуске скрипта",
    "откатить неудачный коммит",
    "Как приготовить пасту?",
]
LINE = "─" * 78


def source_ref(doc: dict) -> str:
    """Ссылка на источник: ID и место в корпусе (файл и номер записи)."""
    category, _, idx = doc["id"].rpartition("-")
    return f"[{doc['id']}] {doc['name']} — data/corpus/{category}.json, запись № {idx}"


def run(engine: SearchEngine, question: str, k: int = 3, full_prompt: bool = False) -> None:
    print(f"\n{LINE}\nВопрос: {question}\n{LINE}")

    # 1. Retrieval
    terms = engine.query_terms(question)
    hits = engine.search(question, k=k)
    print(f"\n1) Retrieval — поиск BM25, top-{k}")
    print(f"   термы запроса после предобработки: {terms or '—'}")
    if not hits:
        print("   подходящих фрагментов в базе не найдено: ни одно слово запроса не встречается в корпусе")
        print("\n2) Augmented — пропущен: контекста нет")
        print("\n3) Generation — LLM не вызывается (нечем подкрепить ответ, чтобы не выдумывать команду)")
        print(f"\nОтвет: {llm.NOTHING_FOUND}\nИсточники: нет")
        return
    for h in hits:
        why = ", ".join(f"{c.term} {c.score:.2f}" for c in h.contributions)
        print(f"   {h.rank}. [{h.doc['id']}] балл: {h.score:.2f}   {h.doc['command']} — {h.doc['name']}   ({why})")
    kind = engine.answer(question, k=k)["type"]
    if kind == "similar":
        print("   уверенного совпадения нет — найдены только похожие команды")

    # 2. Augmented
    docs = [h.doc for h in hits]
    prompt = llm.PROMPT.format(query=question, context=llm.build_context(docs))
    print(f"\n2) Augmented — промпт для LLM: вопрос + контекст из {len(docs)} найденных команд")
    lines = prompt.strip().splitlines()
    rest = len(lines) - 14
    if full_prompt or rest <= 0:
        shown = lines
    else:
        word = "строка" if rest % 10 == 1 and rest % 100 != 11 else "строки" if 2 <= rest % 10 <= 4 and not 12 <= rest % 100 <= 14 else "строк"
        shown = lines[:14] + [f"… ещё {rest} {word} контекста (--full-prompt — показать всё)"]
    for ln in shown:
        print(f"   │ {ln}")

    # 3. Generation
    mode = "заглушка (USE_STUB=true): ответ собран из найденных команд" if llm.USE_STUB else "OpenAI (USE_STUB=false)"
    print(f"\n3) Generation — {mode}")
    answer = llm.ask_llm(question, docs)
    print("\nОтвет:")
    for ln in answer.splitlines():
        print(f"   {ln}")
    print("\nИсточники:")
    for d in docs:
        print(f"   {source_ref(d)}")


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="python rag/demo.py", description="RAG по шагам: поиск BM25 → промпт → ответ LLM")
    p.add_argument("question", nargs="*", help="вопрос (без него — 3 примера)")
    p.add_argument("-k", type=int, default=3, help="сколько команд передать в контекст (по умолчанию 3)")
    p.add_argument("--full-prompt", action="store_true", help="показать промпт целиком")
    args = p.parse_args(argv)
    engine = SearchEngine()
    questions = [" ".join(args.question)] if args.question else EXAMPLES
    for q in questions:
        run(engine, q, k=args.k, full_prompt=args.full_prompt)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
