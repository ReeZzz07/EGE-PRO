-- Conversion: paymentNote — что будет после оплаты + отсылка к бесплатной диагностике.
-- content_blocks.tariffsPage перекрывает docker/api/content/tariffsPage.json.
-- Откат: supabase/rollback/0052_conversion_payment_note_down.sql

update public.content_blocks
   set data = jsonb_set(
         coalesce(data, '{}'::jsonb),
         '{paymentNote}',
         to_jsonb($t$После оплаты тариф включается сразу на 30 дней; чек — на почту (ЮKassa, карта/СБП). Автопродления и сохранения карты нет — продлить = новая оплата. Не готов платить — начни с бесплатной диагностики.$t$::text),
         true
       ),
       updated_at = now()
 where key = 'tariffsPage';
