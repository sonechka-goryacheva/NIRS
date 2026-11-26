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


def build_context(docs):
    if not docs:
        return "(ничего не найдено)"
    lines = []
    for d in docs:
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
        return NOTHING_FOUND
    parts = []
    for d in docs:
        parts.append(
            f"{d.get('name', '')}\n"
            f"Команда: {d.get('command', '')}\n"
            f"Описание: {d.get('description', '')}"
        )
    return "\n\n".join(parts)


def _make_prompt(query, docs, history, kind):
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
        max_tokens=80,
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
        max_tokens=80,
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