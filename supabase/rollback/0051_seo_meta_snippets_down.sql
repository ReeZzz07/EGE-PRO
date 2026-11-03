update public.content_blocks
   set data = jsonb_set(
         jsonb_set(
           coalesce(data, '{}'::jsonb),
           '{pages,tariffs,title}',
           to_jsonb($t$Тарифы — ЕГЭ·ПРО$t$::text),
           true
         ),
         '{pages,tariffs,description}',
         to_jsonb($t$Бесплатный и платные тарифы подготовки к ЕГЭ с ИИ-репетитором: банк заданий ФИПИ, персональный план, проверка сочинений по критериям.$t$::text),
         true
       ),
       updated_at = now()
 where key = 'seo';
