-- SEO-пакет: усилить title/description тарифов в content_blocks (перекрывает дефолт seo.ts / botPages).
-- Откат: supabase/rollback/0051_seo_meta_snippets_down.sql

update public.content_blocks
   set data = jsonb_set(
         jsonb_set(
           coalesce(data, '{}'::jsonb),
           '{pages,tariffs,title}',
           to_jsonb($t$Тарифы ЕГЭ·ПРО: от 1990 ₽ на 30 дней, без автопродления$t$::text),
           true
         ),
         '{pages,tariffs,description}',
         to_jsonb($t$Бесплатный тариф и пакеты Аттестат/ВУЗ/ВУЗ+: диагностика, план, банк ФИПИ и ИИ без готового ответа. Оплата разово на 30 дней через ЮKassa.$t$::text),
         true
       ),
       updated_at = now()
 where key = 'seo';
