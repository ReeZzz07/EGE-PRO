-- POST /auth/login (docker/api/server.js) теперь отказывает в входе, если email_confirmed_at не
-- заполнен (см. фичу подтверждения почты). Без этого шага все аккаунты, созданные до неё, разом
-- оказались бы заблокированы после деплоя — задним числом считаем их подтверждёнными, блокировка
-- касается только новых регистраций.
update auth.users set email_confirmed_at = created_at where email_confirmed_at is null;
