# Запуск ЕГЭ·ПРО локально (Docker)

Платформа больше не зависит от облачного Supabase — весь бэкенд поднимается локально через
Docker Compose: Postgres + PostgREST (REST API поверх БД с теми же RLS-политиками, что и раньше)
+ свой лёгкий сервис auth/storage/ai-tutor (`docker/api`) + фронтенд (собранный Vite-бандл).

## Требования

- Docker Desktop (запущен)
- Node.js 20+ **на хосте** — обязательно (не опционально): сборку фронтенда (`npm run build`)
  нужно гонять на хосте, не в контейнере (см. ниже почему).

## Запуск

```bash
npm install
npm run build
docker compose up -d
```

Первый запуск:
- поднимет Postgres и применит все миграции из `supabase/migrations/*.sql` (тот же набор,
  что раньше катился в облако — RLS-политики не менялись);
- соберёт образ `docker/api` (auth + хранилище файлов на диске + прокси к Anthropic для
  ИИ-репетитора);
- контейнер `web` поставит npm-зависимости и запустит `vite preview` — раздаёт уже собранный
  тобой на хосте `./dist` (см. ниже).

Открой **http://localhost:3100** — это единственный адрес, который нужен: Vite сам
проксирует `/rest/v1`, `/auth`, `/storage`, `/ai-tutor` на соответствующие контейнеры
(см. `vite.config.js` → `server.proxy`/`preview.proxy`), поэтому CORS и лишние порты не нужны.

Погасить стек: `docker compose down` (данные останутся в volume `pgdata`/`storage_data`).
Полный сброс (стереть БД и файлы): `docker compose down -v`.

### Почему сборка — на хосте, а не в контейнере

Контейнер `web` монтирует репозиторий с Windows-диска через bind-mount — чтение множества
мелких файлов через эту границу (Windows → Docker Desktop → Linux-контейнер) на порядок
медленнее нативного. `vite build` перебирает все исходники и почти сразу утыкается в I/O —
сборка внутри контейнера может зависать на 2+ минуты при почти нулевой загрузке CPU, тогда как
на хосте та же сборка занимает ~15–20 секунд. Поэтому: **после каждой правки кода — `npm run
build` на хосте, затем `docker compose restart web`**, а не `npm run dev` в самом контейнере
(тем более что live-reload через bind-mount на Windows тоже ненадёжен — см. `vite.config.js`,
комментарий про polling).

## Первый администратор

На чистой базе нет ни одного пользователя. Создай через API и включи `is_admin` напрямую в БД:

```bash
curl -X POST http://localhost:3100/auth/signup -H "content-type: application/json" \
  -d '{"email":"you@example.com","password":"ваш-пароль","full_name":"Имя"}'

docker exec -i ege-pro-postgres-1 psql -U postgres -d postgres -c \
  "update public.profiles set is_admin = true where id = (select id from auth.users where email='you@example.com');"
```

## Секреты (.env в корне проекта)

```
VITE_SUPABASE_URL=http://localhost:3100
VITE_SUPABASE_ANON_KEY=local-anon-key-unused   # не используется по-настоящему, но должна быть непустой
JWT_SECRET=<поменяй на свою длинную случайную строку>
ANTHROPIC_API_KEY=sk-ant-...                    # без него ИИ-репетитор работает в офлайн-фолбэке
ADMIN_EMAIL=...                                  # для scripts/import/publish-*.mjs
ADMIN_PASSWORD=...
```

`JWT_SECRET` должен совпадать у контейнеров `api` и `postgrest` — оба берут его из одной
переменной в `docker-compose.yml` (`${JWT_SECRET}`), так что достаточно поменять один раз в `.env`.

## Импорт банка заданий

```bash
node scripts/import/publish-neofamily.mjs --admin-email=... --admin-password=... \
  [--subject=biologiya] [--base-url=http://localhost:3100]
node scripts/import/publish-to-supabase.mjs --subject=biologiya --db-subject=bio \
  --admin-email=... --admin-password=...
```

Оба скрипта теперь ходят в локальный стек через `scripts/import/lib/local-backend.mjs`
(обычный `fetch`, без `@supabase/supabase-js`) — файлы льются на диск в volume
`storage_data`, ограничение только в свободном месте на диске, не в облачной квоте.

Банк грузится в приложение **лениво по предмету** (`src/lib/dbTasks.ts`), а не весь сразу —
при ~58 тыс. заданий полная выгрузка была бы ~130 МБ на каждую загрузку страницы и упиралась
в `PGRST_DB_MAX_ROWS=20000` у PostgREST. Задания подгружаются, когда пользователь реально
открывает предмет (банк заданий / диагностика / пробник); лёгкие агрегаты (сколько всего
заданий/баллов по предмету) грузятся отдельно и сразу, чтобы счётчики не были нулевыми.

### Ручной импорт через админку

Помимо CLI-скриптов выше, администратор может залить ZIP-архив с заданиями (и картинками)
прямо через `/admin` → вкладка «Импорт» — без терминала. Формат архива и схема JSON
объяснены прямо в этой вкладке (там же — раскрывающийся блок «Формат архива»). Обрабатывает
`docker/api/importArchive.js` (эндпоинт `POST /admin/import-archive`).

## Архитектурные заметки

- **Правки внутри `docker/api/` требуют `docker compose build api` + `docker compose up -d api`**,
  просто `restart` не подхватит новый код — в отличие от `web` (там меняется только
  `vite.config.js`/переменные окружения) у `api`-сервиса нет bind-mount исходников, `Dockerfile`
  копирует их при сборке образа.

- `.from()`-запросы на фронтенде (`src/lib/supabase.ts`) идут через настоящий
  `@supabase/postgrest-js` — протокол не поменялся, поэтому весь код, кроме auth/storage/
  ai-tutor, переписывать не пришлось.
- `auth.uid()`/`auth.role()` в Postgres — свои функции (`docker/pg-init/0000_bootstrap.sql`),
  читают JWT-клеймы, которые PostgREST кладёт в `request.jwt.claims` — RLS-политики из
  `supabase/migrations/*.sql` работают без изменений.
- Хранилище файлов — обычный диск (volume `storage_data`), не S3-совместимое API;
  `docker/api/server.js` отдаёт файлы по `GET /storage/:bucket/*path`.
