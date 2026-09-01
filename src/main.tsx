import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { loadSubjectAggregates } from "./lib/dbTasks";

// Задания подгружаются лениво по предмету (см. lib/dbTasks.ts) — рендерим сразу, не дожидаясь сети.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);

// Лёгкий фоновый запрос счётчиков по предметам (не блокирует первый рендер).
loadSubjectAggregates();
