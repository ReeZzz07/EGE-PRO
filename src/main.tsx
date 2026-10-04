import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { loadSubjectAggregates } from "./lib/dbTasks";
import { initMetrika, injectCustomCode } from "./lib/metrika";
import { loadSeoSettings } from "./lib/seo";
import { captureAttribution } from "./lib/attribution";

// Метки рекламы и реферер — сразу, до рендера: роутер в App.tsx может заменить адрес и стереть ?utm_…
captureAttribution();

// Задания подгружаются лениво по предмету (см. lib/dbTasks.ts) — рендерим сразу, не дожидаясь сети.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

// Лёгкий фоновый запрос счётчиков по предметам (не блокирует первый рендер).
loadSubjectAggregates();

// Счётчик Метрики — на старте приложения, а не в Landing/Tariffs: он нужен на любой странице
// входа (например, при возврате из ЮKassa прямо на /payment/return). Номер задаётся в /admin → SEO.
// Подключается сразу: пользователя об этом уведомляет баннер (CookieBanner.tsx), а не спрашивает.
loadSeoSettings().then((s) => {
  initMetrika(s.metrikaId);
  // после счётчика: своему коду из админки уже доступен ym() и window.dataLayer
  injectCustomCode(s.customCode);
});
