-- Откат paymentNote к формулировке после GEO-пакета 0050.
update public.content_blocks
   set data = jsonb_set(
         coalesce(data, '{}'::jsonb),
         '{paymentNote}',
         to_jsonb($t$Платные тарифы — разовая оплата через ЮKassa на 30 дней, без сохранения карты и автосписаний. Продлить — новая оплата, когда срок подойдёт к концу.$t$::text),
         true
       ),
       updated_at = now()
 where key = 'tariffsPage';
