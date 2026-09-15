import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const port = Number(process.env.PORT) || 3000;

// В докер-стеке (docker-compose.yml) бэкенд — отдельные контейнеры postgrest/api на своей сети;
// прокси здесь даёт фронтенду единый origin (localhost:3100), не завязываясь на CORS/лишний порт.
// BACKEND_PROXY_HOST пуст вне докера — тогда proxy просто не участвует ни в чём (VITE_SUPABASE_URL
// в этом случае указывает на облачный/иной адрес напрямую, см. .env.example).
const backendHost = process.env.BACKEND_PROXY_HOST; // например "api" / "postgrest" внутри docker-сети

// xfwd: true — прокси дописывает X-Forwarded-For настоящим IP браузера (тем, что видит сам на
// TCP-уровне, подделать нельзя) при пересылке на api/postgrest. Без этого api видел бы во ВСЕХ
// запросах один и тот же адрес — адрес контейнера web (единственная точка, через которую браузеры
// сюда попадают) — и рейт-лимитер по IP (см. docker/api/server.js) считал бы всех учеников платформы
// одним пользователем, деля между ними один общий лимит. api должен доверять ровно этому одному
// хопу (app.set("trust proxy", 1) там же) — не больше, иначе сам заголовок можно подделать напрямую.
const XFWD = { xfwd: true };
const apiProxy = backendHost
  ? {
      "/rest/v1": { target: `http://postgrest:3000`, changeOrigin: true, rewrite: (p) => p.replace(/^\/rest\/v1/, ""), ...XFWD },
      "/auth": { target: `http://api:8787`, changeOrigin: true, ...XFWD },
      "/profile": { target: `http://api:8787`, changeOrigin: true, ...XFWD },
      "/storage": { target: `http://api:8787`, changeOrigin: true, ...XFWD },
      "/admin": { target: `http://api:8787`, changeOrigin: true, ...XFWD },
      "/ai-tutor": { target: `http://api:8787`, changeOrigin: true, ...XFWD },
      "/health": { target: `http://api:8787`, changeOrigin: true, ...XFWD },
      // Раньше — статические файлы в public/ (см. src/lib/seo.ts, docker/api/server.js) — теперь
      // генерируются api из public.app_settings, редактируются в /admin → SEO. Проксируем их сюда
      // же, а не отдаём статикой, иначе этот путь конфликтовал бы с уже собранным файлом.
      "/robots.txt": { target: `http://api:8787`, changeOrigin: true, ...XFWD },
      "/sitemap.xml": { target: `http://api:8787`, changeOrigin: true, ...XFWD },
    }
  : undefined;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port,
    strictPort: true,
    hmr: {
      port,
      // port выше — это порт, на котором Vite слушает ВНУТРИ контейнера (всегда 3000).
      // Браузер же подключается снаружи через порт, который docker-compose.yml пробрасывает
      // на хост (сейчас 3100) — без этого WS для HMR лез на несуществующий localhost:3000
      // и бесконечно переподключался (лишняя нагрузка + подвисания в консоли браузера).
      clientPort: Number(process.env.HMR_CLIENT_PORT) || port,
    },
    // Polling для bind-mount с Windows-хоста пробовали — даже с редким интервалом и исключением
    // output/ давал нестабильность (зависания, скачки CPU) из-за огромного дерева файлов в
    // репозитории. Вместо этого: после правок исходников — `docker compose restart web`.
    proxy: apiProxy,
  },
  // Прод-сборка (npm run build && npm run preview) — то, что реально крутится в docker-compose.yml
  // по умолчанию сейчас: dev-режим Vite отдаёт ~40+ несведённых модулей отдельными HTTP-запросами
  // (специально, ради быстрого HMR) — с задержкой сети через Docker Desktop на Windows это ощутимо
  // умножало время первой загрузки. Собранный бандл — 2-5 файлов, тот же прокси нужен и здесь.
  preview: {
    host: "0.0.0.0",
    port,
    strictPort: true,
    proxy: apiProxy,
    // Vite 6 по умолчанию проверяет заголовок Host у preview-сервера (защита от DNS rebinding
    // для локально запущенного дев-сервера) и отклоняет всё, кроме localhost/127.0.0.1 — в проде
    // (docker-compose.prod.yml) сюда стучится Caddy как реверс-прокси и пересылает ORIGINAL Host
    // браузера (настоящий домен, ege-pro.ru или что угодно), а не localhost — без этой строки
    // Caddy получал бы от vite 403 на любой реальный запрос (найдено при первом прод-деплое на
    // чистом сервере, см. SETUP.md → "Прод-деплой"). Разрешать можно: контейнер web НИКОГДА не
    // публикует порт на хост (ни в dev — там 3100 у docker-compose.yml идёт напрямую к vite, минуя
    // проверку хоста, потому что это и есть localhost, — ни в проде), реальная граница доверия —
    // сетевая изоляция docker, а не эта проверка, рассчитанная на совсем другую угрозу.
    allowedHosts: true,
  },
});
