-- та же страховка, что и для handle_new_user: триггерная функция не должна быть вызываема напрямую через RPC.
revoke execute on function public.protect_admin_flag() from public, anon, authenticated;
