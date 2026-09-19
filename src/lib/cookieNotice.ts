// Уведомление об использовании cookie и Яндекс.Метрики. Это именно уведомление, а не запрос
// разрешения: счётчик подключается сразу (см. main.tsx), а нажатие «Понятно» лишь подтверждает,
// что пользователь ознакомлен, — после него баннер больше не показывается в этом браузере.
//
// Если localStorage недоступен (приватный режим, запрет в настройках) — подтверждение держится в
// памяти до закрытия вкладки, иначе баннер нельзя было бы закрыть вовсе.

const KEY = "cookie_notice_ack";

let acknowledgedInMemory = false;

export function isNoticeAcknowledged(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return acknowledgedInMemory;
  }
}

export function acknowledgeNotice(): void {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    acknowledgedInMemory = true;
  }
}
