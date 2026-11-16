"""
Сквозной RAG одним вызовом: вопрос → поиск BM25 → контекст → LLM → {answer, sources}.

Это «контракт интеграции» из слайдов (обработчик POST /ask): пять шагов внутри одной функции.
Её вызывает и сервер (когда он появится), и бенчмарк — поэтому проверяется тот же путь, что и в приложении.

    from rag.pipeline import ask
    r = ask("откатить неудачный коммит")
    r["answer"]    # текст ответа; в конце строка «Источники: [git-12], …»
    r["sources"]   # [{"id", "name", "command", "score"}] — то, что попало в контекст LLM
    r["type"]      # found / similar / nothing
"""

from __future__ import annotations

from .engine import SearchEngine


def ask(question: str, engine: SearchEngine | None = None, k: int = 3, stub: bool | None = None) -> dict:
    """
    1. retrieve — top-k по BM25 и тип ответа (found / similar / nothing);
    2. контекст — найденные команды с метками [ID];
    3. LLM — ответ по контексту (stub: True — заглушка, False — OpenAI, None — по USE_STUB из .env);
    4. {answer, sources, type}. Нечего передать модели (nothing) — LLM не вызывается, ответ «не найдено».
    """
    from app import llm  # noqa: PLC0415 — app.llm не должен импортироваться при импорте rag

    if engine is None:
        from app.search import get_engine  # noqa: PLC0415

        engine = get_engine()
    found = engine.answer(question, k=k)
    hits = found["hits"]
    reply = llm.ask_llm(question, [h.doc for h in hits], kind=found["type"], stub=stub)
    sources = [
        {"id": h.doc.get("id"), "name": h.doc.get("name"), "command": h.doc.get("command"), "score": round(h.score, 3)}
        for h in hits
    ]
    return {"answer": reply, "sources": sources, "type": found["type"]}
