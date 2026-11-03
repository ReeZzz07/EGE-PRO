-- Rollback 0053 → previous short defaults (also via base64 for safe piping).
-- title: Тарифы — ЕГЭ·ПРО
-- description: Бесплатный и платные тарифы подготовки к ЕГЭ с ИИ-репетитором: банк заданий ФИПИ, персональный план, проверка сочинений по критериям.

update public.content_blocks
   set data = jsonb_set(
         jsonb_set(
           coalesce(data, '{}'::jsonb),
           '{pages,tariffs,title}',
           to_jsonb(convert_from(decode(
             '0KLQsNGA0LjRhNGLIOKAlCDQldCT0K3Ct9Cf0KDQng==',
             'base64'
           ), 'utf8')),
           true
         ),
         '{pages,tariffs,description}',
         to_jsonb(convert_from(decode(
           '0JHQtdGB0L/Qu9Cw0YLQvdGL0Lkg0Lgg0L/Qu9Cw0YLQvdGL0LUg0YLQsNGA0LjRhNGLINC/0L7QtNCz0L7RgtC+0LLQutC4INC6INCV0JPQrSDRgSDQmNCYLdGA0LXQv9C10YLQuNGC0L7RgNC+0Lw6INCx0LDQvdC6INC30LDQtNCw0L3QuNC5INCk0JjQn9CYLCDQv9C10YDRgdC+0L3QsNC70YzQvdGL0Lkg0L/Qu9Cw0L0sINC/0YDQvtCy0LXRgNC60LAg0YHQvtGH0LjQvdC10L3QuNC5INC/0L4g0LrRgNC40YLQtdGA0LjRj9C8Lg==',
           'base64'
         ), 'utf8')),
         true
       ),
       updated_at = now()
 where key = 'seo';
