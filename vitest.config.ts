import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Отдельно от vite.config.js — тот заточен под dev-сервер/прод-сборку (проксирование на бэкенд,
// HMR-порты для Docker), тестам это не нужно, а jsdom-окружение и setupFiles внутри dev-конфига
// были бы лишним грузом на обычный `npm run dev`.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    // docker/api/test/ гоняется отдельно через `node --test` (свой package.json/node_modules,
    // серверные тесты против настоящего Postgres) — Vitest здесь только про src/.
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
