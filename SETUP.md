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

## Бэкапы

Все данные стека живут в двух docker-томах: `pgdata` (вся база) и `storage_data` (аватарки,
картинки заданий). Без бэкапа они существуют ровно в одном экземпляре — на диске этой машины.

```bash
scripts/backup.sh                 # пишет в ./backups/pg_<дата>.dump и storage_<дата>.tar.gz
scripts/backup.sh /куда-угодно    # или в указанный каталог
```

Скрипт только СОЗДАЁТ локальные файлы бэкапа — сам он никуда их не копирует. Для реальной защиты
от потери диска забирай `backups/` куда-то ещё (внешний диск, облачное хранилище) вручную или по
расписанию (cron/Task Scheduler).

Восстановление — `scripts/restore.sh <pg_dump файл> <storage tar.gz файл>` (останавливает
api/web, перезаписывает текущие данные, поднимает всё обратно). Необратимо — сначала убедись, что
если что-то нужно сохранить из текущего состояния, ты уже сделал новый бэкап.

## Прод-деплой

Отдельный конфиг — `docker-compose.prod.yml` (НЕ override над `docker-compose.yml`, а
самостоятельный файл — см. комментарий в его начале про то, почему override здесь не подходит).
Отличия от dev-стека: Postgres/PostgREST/`api`/`web` не публикуют порты на хост вообще —
наружу смотрит только `caddy` (80/443), который сам получает и продлевает TLS-сертификат
(Let's Encrypt) и проксирует всё на `web`; сборка фронтенда идёт внутри контейнера `web`
(на Linux-сервере, в отличие от Windows-разработки, штрафа за bind-mount I/O нет — см. выше).

Сервер — VPS с 2 vCPU / 4 ГБ RAM / 100 ГБ NVMe (например VDSina, тариф KVM 2/4/100,
~1200 ₽/мес) под Ubuntu.

1. **Провизион сервера и Docker**

   ```bash
   apt-get update && apt-get install -y ca-certificates curl gnupg
   install -m 0755 -d /etc/apt/keyrings
   curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
   chmod a+r /etc/apt/keyrings/docker.asc
   echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
     https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
     > /etc/apt/sources.list.d/docker.list
   apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
   ```

2. **Firewall** — `scripts/setup-firewall.sh` (ufw: только 22/80/443, `default deny incoming`).

3. **DNS** — A-запись домена платформы → IP сервера, ДО запуска (Caddy получает TLS-сертификат
   от Let's Encrypt при первом старте и должен достучаться до домена снаружи).

4. **Код и секреты**

   ```bash
   git clone <репозиторий> /opt/ege-pro && cd /opt/ege-pro
   cp .env.example .env
   ```

   В `.env` — настоящие значения, не заглушки из dev:
   - `VITE_SUPABASE_URL` — реальный `https://твой-домен` (не `http://localhost:3100`);
   - `CORS_ORIGIN` — тот же `https://твой-домен`;
   - `JWT_SECRET`, `POSTGRES_PASSWORD`, `AUTHENTICATOR_PASSWORD` — новые случайные строки
     (не значения из dev-`.env`, если тот когда-либо был где-то опубликован);
   - `ANTHROPIC_API_KEY` — опционально (без него ИИ-репетитор работает в офлайн-фолбэке).

5. **Запуск**

   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   docker compose -f docker-compose.prod.yml ps   # дождаться healthy у postgres/api/web
   ```

   Первый запуск `web` дольше обычного — внутри контейнера идёт `npm ci && npm run build`
   (после этого держится `healthcheck` со `start_period: 90s`).

6. **Первый администратор** — та же процедура, что в dev (см. «Первый администратор» выше),
   только через реальный домен вместо `localhost:3100`, и `docker exec` — на контейнер
   `ege-pro-postgres-1` этого сервера.

7. **Бэкапы на расписании** — `scripts/backup.sh` работает без изменений (ходит в Postgres через
   `docker compose exec`, не через порт — публикация порта в проде и не нужна). Добавь в cron,
   например копию в отдельное хранилище (второй диск, S3-совместимый бакет) — сам скрипт кладёт
   файлы только локально в `backups/`:

   ```bash
   0 3 * * * cd /opt/ege-pro && ./scripts/backup.sh >> /var/log/ege-pro-backup.log 2>&1
   ```

8. **Обновление после изменений в коде**

   ```bash
   cd /opt/ege-pro && git pull
   docker compose -f docker-compose.prod.yml up -d --build
   ```

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
