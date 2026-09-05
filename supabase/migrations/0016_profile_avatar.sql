-- Аватар профиля — либо путь к загруженному файлу в бакете "avatars" (см. docker/api/server.js
-- POST/DELETE /profile/avatar), либо готовый вариант из набора в виде "preset:<id>" (см.
-- src/lib/avatar.ts AVATAR_PRESETS) — рендерится на клиенте цветной иконкой, без файла на диске.
-- null — используем инициал имени (текущее поведение по умолчанию, см. ProfileView.tsx).
alter table public.profiles add column avatar_url text;
