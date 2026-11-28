"""
app/llm.py — LLM генерирует короткую фразу + упоминание терминала.
"""
import os

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

USE_STUB = os.getenv("USE_STUB", "true").strip().lower() not in ("false", "0", "no")
LLM_BACKEND = os.getenv("LLM_BACKEND", "ollama").strip().lower()
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1").strip()
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:1.5b").strip()

PROMPT = """Ты — справочник IT-команд. Отвечай ТОЛЬКО на русском.

Запрос пользователя: {query}

История диалога:
{history}

Найденные команды:
{context}

ЗАДАЧА: Напиши ОДНО короткое предложение (до 20 слов), которое:
1. Объясняет назначение найденных команд.
2. Обязательно содержит фразу «в терминале» или «в командной строке».

Примеры правильных ответов:
- "Для поиска файлов в системе используйте следующие команды в терминале:"
- "Чтобы управлять правами доступа, введите в терминале следующие команды:"
- "Для работы с Git подойдут следующие команды, которые нужно ввести в терминале:"
- "Если не хватает прав при запуске, помогут следующие команды в терминале:"

ПРАВИЛА:
- ТОЛЬКО одно предложение.
- НЕ перечисляй команды (они уже показаны карточками ниже).
- НЕ пиши источники.
- НЕ используй markdown (**, #, `).
- Если запрос — жалоба («не работает», «ничего не получается»), напиши: "Попробуйте уточнить задачу или указать операционную систему (Linux/Windows/macOS)."
- Если запрос — уточнение («другую», «предпоследнюю»), напиши: "Вот другие варианты команд из предыдущего запроса:"
"""

NOTHING_FOUND = "Подходящая команда не найдена. Попробуйте описать задачу иначе — например, укажите операционную систему."

ARTICLE_NOTHING = "В документах другой команды нет ответа на этот вопрос."

ARTICLE_PROMPT = """Ты отвечаешь по документам другой команды. Пиши по-русски.

Вопрос: {query}

Документы:
{context}

Напиши ответ на вопрос своими словами, 4–6 предложений.
Используй только факты из этих документов.
Не упоминай терминал, командную строку и IT-команды.
Не придумывай калории, дозы, диагнозы, меню и персональные нормы, которых нет в тексте.
Если точного ответа в документах нет, прямо напиши, что в документах этого нет.
В конце одна строка: Источники: [ID], [ID].
"""


def is_article(docs) -> bool:
    """Документы другой команды, а не команды справочника."""
    return any(d.get("category") == "team" for d in docs)


def build_context(docs):
    if not docs:
        return "(ничего не найдено)"
    lines = []
    for d in docs:
        if d.get("category") == "team":
            lines.append(f"[{d.get('id')}] {d.get('name', '')}\n{d.get('description', '')}")
            continue
        block = [
            f"[{d['id']}] {d.get('name', '')}",
            f"Команда: {d.get('command', '')}",
            f"Описание: {d.get('description', '')}",
        ]
        for ex in d.get("examples", [])[:2]:
            block.append(f"  Пример: {ex}")
        lines.append("\n".join(block))
    return "\n\n".join(lines)


def build_history(messages, max_messages=6):
    if not messages:
        return "(история пуста)"
    recent = messages[-max_messages:]
    lines = []
    for m in recent:
        if m["role"] == "user":
            lines.append(f"Пользователь: {m.get('text', '')}")
        else:
            t = m.get("reply", {}).get("text", "") or ""
            lines.append(f"Ассистент: {t[:150]}")
    return "\n".join(lines)


def _stub_answer(query, docs, kind="found"):
    if not docs:
        return ARTICLE_NOTHING if kind == "nothing" else NOTHING_FOUND
    if is_article(docs):
        src = "Источники: " + ", ".join(f"[{d.get('id')}]" for d in docs if d.get("id"))
        text = "\n\n".join(d.get("description", "") for d in docs if d.get("category") == "team")
        if kind == "similar":
            text = ARTICLE_NOTHING + "\n\n" + text
        return text + ("\n\n" + src if src else "")
    parts = []
    for d in docs:
        parts.append(
            f"{d.get('name', '')}\n"
            f"Команда: {d.get('command', '')}\n"
            f"Описание: {d.get('description', '')}"
        )
    return "\n\n".join(parts)


def _make_prompt(query, docs, history, kind):
    if is_article(docs):
        return ARTICLE_PROMPT.format(query=query, context=build_context(docs))
    return PROMPT.format(
        query=query,
        context=build_context(docs),
        history=build_history(history)
    )


def _ollama_answer(query, docs, history, kind="found"):
    from openai import OpenAI
    client = OpenAI(base_url=OLLAMA_BASE_URL, api_key="ollama")
    r = client.chat.completions.create(
        model=OLLAMA_MODEL,
        messages=[{"role": "user", "content": _make_prompt(query, docs, history, kind)}],
        temperature=0.2,
        max_tokens=700 if is_article(docs) else 80,
        timeout=120,
    )
    return r.choices[0].message.content.strip()


def _real_answer(query, docs, history, kind="found"):
    from openai import OpenAI
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY не задан")
    client = OpenAI(api_key=api_key)
    r = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": _make_prompt(query, docs, history, kind)}],
        temperature=0.2,
        max_tokens=700 if is_article(docs) else 80,
        timeout=30,
    )
    return r.choices[0].message.content.strip()


def ask_llm(query, docs, history=None, kind="found", stub=None):
    if history is None:
        history = []
    if not docs:
        return NOTHING_FOUND
    if USE_STUB if stub is None else stub:
        return _stub_answer(query, docs, kind)
    try:
        if LLM_BACKEND == "openai":
            return _real_answer(query, docs, history, kind)
        return _ollama_answer(query, docs, history, kind)
    except Exception as e:
        return f"Ошибка LLM: {e}\n\n" + _stub_answer(query, docs, kind)


if __name__ == "__main__":
    test_docs = [
        {
            "id": "linux-13",
            "name": "Права доступа",
            "command": "chmod +x <file>",
            "description": "Делает файл исполняемым.",
            "examples": ["chmod +x script.sh", "chmod +x deploy.sh"],
        }
    ]
    print(ask_llm("как сделать файл исполняемым", test_docs))