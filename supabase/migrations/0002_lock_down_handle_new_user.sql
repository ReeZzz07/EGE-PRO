-- handle_new_user должен вызываться только триггером on_auth_user_created, не напрямую через RPC
-- (security advisor: anon/authenticated могли вызвать SECURITY DEFINER функцию через /rest/v1/rpc/handle_new_user).
revoke execute on function public.handle_new_user() from public, anon, authenticated;
