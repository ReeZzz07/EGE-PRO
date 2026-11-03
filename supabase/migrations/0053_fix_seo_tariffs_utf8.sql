-- Re-apply SEO tariffs title/description as UTF-8 via base64 so PowerShell pipes cannot mangle Cyrillic.
-- Fixes content_blocks.seo.pages.tariffs corrupted by 0051 when applied through a non-UTF8 console.
-- Rollback: supabase/rollback/0053_fix_seo_tariffs_utf8_down.sql

update public.content_blocks
   set data = jsonb_set(
         jsonb_set(
           coalesce(data, '{}'::jsonb),
           '{pages,tariffs,title}',
           to_jsonb(convert_from(decode(
             '0KLQsNGA0LjRhNGLINCV0JPQrcK30J/QoNCeOiDQvtGCIDE5OTAg4oK9INC90LAgMzAg0LTQvdC10LksINCx0LXQtyDQsNCy0YLQvtC/0YDQvtC00LvQtdC90LjRjw==',
             'base64'
           ), 'utf8')),
           true
         ),
         '{pages,tariffs,description}',
         to_jsonb(convert_from(decode(
           '0JHQtdGB0L/Qu9Cw0YLQvdGL0Lkg0YLQsNGA0LjRhCDQuCDQv9Cw0LrQtdGC0Ysg0JDRgtGC0LXRgdGC0LDRgi/QktCj0Jcv0JLQo9CXKzog0LTQuNCw0LPQvdC+0YHRgtC40LrQsCwg0L/Qu9Cw0L0sINCx0LDQvdC6INCk0JjQn9CYINC4INCY0Jgg0LHQtdC3INCz0L7RgtC+0LLQvtCz0L4g0L7RgtCy0LXRgtCwLiDQntC/0LvQsNGC0LAg0YDQsNC30L7QstC+INC90LAgMzAg0LTQvdC10Lkg0YfQtdGA0LXQtyDQrkthc3NhLg==',
           'base64'
         ), 'utf8')),
         true
       ),
       updated_at = now()
 where key = 'seo';
