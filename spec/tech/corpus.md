# Корпус

## Формат записи

    {
      "name": "Название",
      "command": "команда",
      "description": "описание",
      "examples": ["пример1", "пример2", "пример3"],
      "tags": ["тег1", "тег2", "тег3", "tag4", "tag5"],
      "platform": "unix | mac | linux | windows | cross"
    }

- examples — ровно 3, tags — не меньше 5 (на русском и английском).
- `id` и `category` в файле не хранятся: сервер добавляет их при загрузке (`<имя файла>-<индекс>`, например `git-3`).

## Категории

- linux.json
- mac.json
- git.json
- docker.json
- sql.json
- python.json
- network.json
- powershell.json
