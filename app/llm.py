"""
app/llm.py

Вызов LLM для формирования ответа на запрос пользователя.
Если API-ключа нет — работает заглушка (USE_STUB = True).
"""

import os

USE_STUB = True

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

Если точного совпадения нет — верни сообщение
«Подходящая команда не найдена. Возможно, подойдут указанные ниже варианты?»
и 3 ближайших команды.
"""


def build_context(docs: list[dict]) -> str:
    if not docs:
        return "(ничего не найдено)"

    lines = []
    for d in docs:
        block = [
            f"Название: {d.get('name', '')}",
            f"Команда: {d.get('command', '')}",
            f"Описание: {d.get('description', '')}",
            "Примеры:",
        ]
        for ex in d.get("examples", []):
            block.append(f"  - {ex}")
        lines.append("\n".join(block))

    return "\n\n---\n\n".join(lines)


def _stub_answer(query: str, docs: list[dict]) -> str:
    if not docs:
        return (
            "Подходящая команда не найдена. "
            "Возможно, подойдут указанные ниже варианты?\n\n"
            "(заглушка: список вариантов пуст)"
        )

    parts = []
    for d in docs:
        parts.append(
            f"1. {d.get('name', '')}\n"
            f"2. Команда: {d.get('command', '')}\n"
            f"3. Описание: {d.get('description', '')}\n"
            f"4. Примеры применения:\n"
            + "\n".join(f"   - {ex}" for ex in d.get("examples", []))
        )

    return "\n\n---\n\n".join(parts)


def _real_answer(query: str, docs: list[dict]) -> str:
    from openai import OpenAI

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY не задан")

    client = OpenAI(api_key=api_key)
    context = build_context(docs)
    prompt = PROMPT.format(query=query, context=context)

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
        max_tokens=1000,
        timeout=30,
    )

    return response.choices[0].message.content.strip()


def ask_llm(query: str, docs: list[dict]) -> str:
    if USE_STUB:
        return _stub_answer(query, docs)

    try:
        return _real_answer(query, docs)
    except Exception as e:
        return (
            "Не удалось получить ответ от нейросети. "
            f"Ошибка: {e}\n\n"
            "Показываю найденные команды без обработки:\n\n"
            + _stub_answer(query, docs)
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
