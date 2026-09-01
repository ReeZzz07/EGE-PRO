import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const port = Number(process.env.PORT) || 3000;

// В докер-стеке (docker-compose.yml) бэкенд — отдельные контейнеры postgrest/api на своей сети;
// прокси здесь даёт фронтенду единый origin (localhost:3100), не завязываясь на CORS/лишний порт.
// BACKEND_PROXY_HOST пуст вне докера — тогда proxy просто не участвует ни в чём (VITE_SUPABASE_URL
// в этом случае указывает на облачный/иной адрес напрямую, см. .env.example).
const backendHost = process.env.BACKEND_PROXY_HOST; // например "api" / "postgrest" внутри docker-сети

const apiProxy = backendHost
  ? {
      "/rest/v1": { target: `http://postgrest:3000`, changeOrigin: true, rewrite: (p) => p.replace(/^\/rest\/v1/, "") },
      "/auth": { target: `http://api:8787`, changeOrigin: true },
      "/storage": { target: `http://api:8787`, changeOrigin: true },
      "/admin": { target: `http://api:8787`, changeOrigin: true },
      "/ai-tutor": { target: `http://api:8787`, changeOrigin: true },
      "/health": { target: `http://api:8787`, changeOrigin: true },
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
  },
});
