"""
Предварительная обработка текста: нормализация → токенизация → лемматизация → стоп-слова.

Одна и та же обработка применяется к документам и к запросам (методичка, замечание 1.1).
Обоснование выбора каждого шага — rag/REPORT.md, раздел 2.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache

# Токен — непрерывная последовательность букв (латиница, кириллица) и цифр.
# Всё остальное (пробелы, пунктуация, «-», «/», «<>», «*») — разделители:
#   "docker-compose" → docker, compose;  "Get-Process" → get, process;  "du -sh" → du, sh.
TOKEN_RE = re.compile(r"[a-zа-я0-9]+")
CYRILLIC_RE = re.compile(r"[а-я]")

# Стоп-слова — после лемматизации (поэтому в начальной форме).
# Служебные части речи и «слова-связки» запросов: «как сделать…», «команда для…», «нужно…».
# Слова «команда», «сделать», «делать», «нужно» в запросах не несут смысла задачи,
# а в корпусе редки (и потому получили бы высокий IDF) — их удаление убирает ложные совпадения.
STOP_RU = frozenset("""
и в во не на с со как что чтобы для по из от до у к о об обо а но или либо же ли бы то так это этот тот
такой какой который весь всё все свой мой твой наш ваш его её их он она оно они мы вы я ты мне меня себя
быть мочь можно нужно надо нужный хотеть сделать делать команда через при под над без про
если когда где куда там тут здесь ещё уже очень лишь только даже вот
""".split())
STOP_EN = frozenset("""
a an the to of in on at by for from with and or not is are be it this that how what which do does
""".split())


@lru_cache(maxsize=1)
def _morph():
    """Морфологический анализатор pymorphy3 (создаётся один раз — загрузка словаря занимает доли секунды)."""
    import pymorphy3  # noqa: PLC0415 — импорт по требованию: без лемматизации библиотека не нужна

    return pymorphy3.MorphAnalyzer()


@lru_cache(maxsize=50_000)
def lemma(word: str) -> str:
    """Начальная форма русского слова (самый вероятный разбор pymorphy3). Латиницу не трогаем."""
    if not CYRILLIC_RE.search(word):
        return word
    return _morph().parse(word)[0].normal_form.replace("ё", "е")


@dataclass(frozen=True)
class TextConfig:
    """Какие шаги предобработки включены (нужно для сравнения вариантов в отчёте)."""

    lemmatize: bool = True
    stopwords: bool = True


def normalize(text: str) -> str:
    """Нижний регистр и «ё» → «е» (в корпусе и запросах «ё» пишут непоследовательно)."""
    return (text or "").lower().replace("ё", "е")


def tokenize(text: str) -> list[str]:
    """Разбиение нормализованного текста на токены-слова."""
    return TOKEN_RE.findall(normalize(text))


def preprocess(text: str, cfg: TextConfig = TextConfig()) -> list[str]:
    """Текст → список термов (порядок и повторы сохраняются — они нужны для TF и для запроса)."""
    terms = []
    for tok in tokenize(text):
        t = lemma(tok) if cfg.lemmatize else tok
        if cfg.stopwords and (t in STOP_RU or t in STOP_EN):
            continue
        terms.append(t)
    return terms


@dataclass
class Trace:
    """Все этапы обработки — для демонстрации (`python -m rag search … --explain`)."""

    text: str
    normalized: str
    tokens: list[str] = field(default_factory=list)
    lemmas: list[str] = field(default_factory=list)
    terms: list[str] = field(default_factory=list)


def trace(text: str, cfg: TextConfig = TextConfig()) -> Trace:
    tokens = tokenize(text)
    lemmas = [lemma(t) if cfg.lemmatize else t for t in tokens]
    terms = [t for t in lemmas if not (cfg.stopwords and (t in STOP_RU or t in STOP_EN))]
    return Trace(text=text, normalized=normalize(text), tokens=tokens, lemmas=lemmas, terms=terms)
