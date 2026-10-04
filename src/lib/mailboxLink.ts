// Кнопка «Открыть почту» на экране «Подтверди почту» (CheckEmailView.tsx): ведёт в веб-интерфейс почтового сервиса
// человека. Для Gmail — сразу поиск «по всей почте» (включая «Спам»), потому что именно туда чаще всего попадает
// первое письмо от нового сайта: у Gmail подтверждение приходило заметно реже, чем у Яндекса и Mail.ru.
export interface MailboxLink {
  label: string;
  url: string;
}

const MAIL_RU = ["mail.ru", "inbox.ru", "list.ru", "bk.ru", "internet.ru"];
const YANDEX = ["yandex.ru", "ya.ru", "yandex.com", "yandex.ua", "yandex.kz", "yandex.by"];
const OUTLOOK = ["outlook.com", "hotmail.com", "live.com", "outlook.ru"];
const ICLOUD = ["icloud.com", "me.com", "mac.com"];

export function mailboxLink(email: string): MailboxLink | null {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  if (domain === "gmail.com" || domain === "googlemail.com") {
    return { label: "Найти письмо в Gmail (в том числе в «Спаме»)", url: `https://mail.google.com/mail/u/0/#search/${encodeURIComponent("in:anywhere ЕГЭ·ПРО")}` };
  }
  if (MAIL_RU.includes(domain)) return { label: "Открыть Mail.ru", url: "https://e.mail.ru/inbox/" };
  if (YANDEX.includes(domain)) return { label: "Открыть Яндекс Почту", url: "https://mail.yandex.ru/" };
  if (OUTLOOK.includes(domain)) return { label: "Открыть Outlook", url: "https://outlook.live.com/mail/" };
  if (ICLOUD.includes(domain)) return { label: "Открыть iCloud Почту", url: "https://www.icloud.com/mail" };
  if (domain === "rambler.ru") return { label: "Открыть Рамблер/почту", url: "https://mail.rambler.ru/" };
  return null;
}
