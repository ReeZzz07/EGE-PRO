import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** true, если пользователь подключил свой Supabase-проект (см. SETUP.md) */
export const isSupabaseConfigured = !!(url && anonKey);

/**
 * Клиент Supabase или null, если проект не сконфигурирован.
 * Приложение в этом случае работает в гостевом режиме: localStorage вместо БД,
 * офлайн-репетитор вместо ai-tutor Edge Function.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured ? createClient(url!, anonKey!) : null;
