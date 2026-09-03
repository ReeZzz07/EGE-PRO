-- Индекс под дневной лимит ИИ-обращений (docker/api/server.js, checkDailyAiLimit()) — запрос
-- считает сообщения пользователя за сегодня на КАЖДЫЙ вызов /ai-tutor у тарифов с лимитом; без
-- индекса по (user_id, created_at) это частичный скан ai_messages по мере роста истории.
create index if not exists ai_messages_user_id_created_at_idx on public.ai_messages (user_id, created_at);
