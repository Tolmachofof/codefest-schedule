# CodeFest Schedule

Инструмент для управления расписанием конференций. Позволяет создавать конференции, залы, доклады и перерывы, размещать их на сетке расписания с помощью drag-and-drop.

## Стек

- **Frontend:** React, TypeScript, Tailwind CSS, Vite
- **Backend:** FastAPI, SQLAlchemy, PostgreSQL
- **Auth:** JWT в httpOnly cookie
- **Инфраструктура:** Docker, Nginx

## Возможности

- Управление конференциями, залами и треками
- Drag-and-drop расписание с сеткой по 20 минут
- Неразмещённые доклады (без зала и времени)
- Авторизация с таблицей пользователей
- Журнал действий с указанием автора
- Интеграция с Kaiten (автосоздание докладов по вебхуку)

## Быстрый старт

### Требования

- Docker и Docker Compose

### Запуск

```bash
cp backend/.env.example .env
# Отредактируй .env — задай SECRET_KEY

make build
make create-user
```

Приложение будет доступно на [http://localhost](http://localhost).

## Команды

```bash
make up           # запустить
make down         # остановить
make build        # пересобрать и запустить
make logs         # смотреть логи
make ps           # статус контейнеров
make create-user  # создать пользователя
```

## Конфигурация

Переменные окружения задаются в файле `.env` в корне проекта:

| Переменная     | Описание                              | По умолчанию                                        |
|----------------|---------------------------------------|-----------------------------------------------------|
| `DATABASE_URL` | Строка подключения к PostgreSQL       | `postgresql://codefest:codefest@db:5432/codefest`   |
| `SECRET_KEY`   | Секрет для подписи JWT                | —                                                   |
| `COOKIE_SECURE`| Флаг Secure для cookie (true на prod) | `false`                                             |

## Деплой в продакшн

Для прода используется отдельный compose-файл без встроенной базы данных:

```bash
# .env
DATABASE_URL=postgresql://user:password@host:5432/codefest
SECRET_KEY=<случайная строка, минимум 32 символа>
COOKIE_SECURE=true

docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec backend python create_user.py admin yourpassword
```
