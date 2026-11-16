"""
app/llm.py

Вызов LLM для формирования ответа на запрос пользователя.
По умолчанию работает заглушка (USE_STUB=true в .env или переменная не задана).
"""

import os

try:  # настройки из .env (OPENAI_API_KEY, USE_STUB), если установлен python-dotenv
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

# Заглушка без обращения к API — по умолчанию. Настоящая LLM: USE_STUB=false и OPENAI_API_KEY в .env
USE_STUB = os.getenv("USE_STUB", "true").strip().lower() not in ("false", "0", "no")

PROMPT = """Ты — справочник IT-команд.
Пользователь спрашивает: {query}

Контекст (найденные команды):
{context}

Верни ответ в формате:
1. Название
2. Команда: <command>
3. Описание: <description>
4. Примеры применения:
   - <example1>
   - <example2>
   - <example3>

Используй только команды из контекста, не придумывай свои.
Если точного совпадения нет — верни сообщение
«Подходящая команда не найдена. Возможно, подойдут указанные ниже варианты?»
и команды из контекста.
В конце одной строкой укажи источники — ID использованных команд из контекста в квадратных скобках:
«Источники: [ID], [ID]».
"""

# Поиск нашёл только похожие команды (тип ответа similar): ответ начинается с этого сообщения
SIMILAR_NOTICE = "Подходящая команда не найдена. Возможно, подойдут указанные ниже варианты?"
SIMILAR_HINT = (
    "\nУверенного совпадения в контексте нет: начни ответ со строки "
    f"«{SIMILAR_NOTICE}» и затем покажи команды из контекста."
)

# Ответ, когда поиск ничего не нашёл (spec/product/answer_format.md): LLM не вызывается — ей не на что опереться
NOTHING_FOUND = "Подходящая команда не найдена. Попробуйте описать задачу другими словами."


def build_context(docs: list[dict]) -> str:
    if not docs:
        return "(ничего не найдено)"

    lines = []
    for d in docs:
        block = [
            *([f"[{d['id']}]"] if d.get("id") else []),
            f"Название: {d.get('name', '')}",
            f"Команда: {d.get('command', '')}",
            f"Описание: {d.get('description', '')}",
            "Примеры:",
        ]
        for ex in d.get("examples", []):
            block.append(f"  - {ex}")
        lines.append("\n".join(block))

    return "\n\n---\n\n".join(lines)


def sources_line(docs: list[dict]) -> str:
    """Строка со ссылками на источники: «Источники: [git-3], [git-12]» (пусто, если у команд нет ID)."""
    ids = [f"[{d['id']}]" for d in docs if d.get("id")]
    return "Источники: " + ", ".join(ids) if ids else ""


def _stub_answer(query: str, docs: list[dict], kind: str = "found") -> str:
    if not docs:
        return NOTHING_FOUND

    parts = []
    for d in docs:
        parts.append(
            f"1. {d.get('name', '')}\n"
            f"2. Команда: {d.get('command', '')}\n"
            f"3. Описание: {d.get('description', '')}\n"
            f"4. Примеры применения:\n"
            + "\n".join(f"   - {ex}" for ex in d.get("examples", []))
        )

    text = "\n\n---\n\n".join(parts)
    if kind == "similar":
        text = SIMILAR_NOTICE + "\n\n" + text
    src = sources_line(docs)
    return text + ("\n\n" + src if src else "")


def _real_answer(query: str, docs: list[dict], kind: str = "found") -> str:
    from openai import OpenAI

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY не задан")

    client = OpenAI(api_key=api_key)
    context = build_context(docs)
    prompt = PROMPT.format(query=query, context=context) + (SIMILAR_HINT if kind == "similar" else "")

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
        max_tokens=1000,
        timeout=30,
    )

    return response.choices[0].message.content.strip()


def ask_llm(query: str, docs: list[dict], kind: str = "found", stub: bool | None = None) -> str:
    """
    Ответ по найденным командам. kind — тип ответа поиска (found / similar), stub — принудительно
    заглушка (True) или настоящая LLM (False); None — по USE_STUB из .env.
    """
    if not docs:  # защита от выдумок: без найденных команд нейросеть не спрашиваем
        return NOTHING_FOUND
    if USE_STUB if stub is None else stub:
        return _stub_answer(query, docs, kind)

    try:
        return _real_answer(query, docs, kind)
    except Exception as e:
        return (
            "Не удалось получить ответ от нейросети. "
            f"Ошибка: {e}\n\n"
            "Показываю найденные команды без обработки:\n\n"
            + _stub_answer(query, docs, kind)
        )


if __name__ == "__main__":
    test_docs = [
        {
            "name": "Права доступа",
            "command": "chmod +x <file>",
            "description": "Делает файл исполняемым.",
            "examples": [
                "chmod +x script.sh",
                "chmod +x deploy.sh",
                "chmod -R +x scripts/",
            ],
        }
    ]
    print(ask_llm("как сделать файл исполняемым", test_docs))
