// Автоматически подключается ко всем тестам (см. vitest.config.ts → test.setupFiles) —
// добавляет матчеры вроде toBeInTheDocument()/toHaveTextContent() к expect().
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// RTL умеет само подчищать DOM между тестами через afterEach, но только когда обнаруживает
// глобальный afterEach (test.globals в vitest.config.ts здесь выключен намеренно — импорты
// явные, как и в серверных тестах, см. docker/api/test/) — поэтому регистрируем явно.
afterEach(cleanup);
