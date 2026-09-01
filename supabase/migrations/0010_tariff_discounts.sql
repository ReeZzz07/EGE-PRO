-- Скидки на тарифы — админ может задать цену со скидкой (sale_price_rub), тогда на публичной
-- странице тарифов старая цена (price_rub) показывается зачёркнутой рядом с новой. NULL — скидки
-- нет, тариф показывается как обычно. Ограничение в базе — подстраховка на случай прямых правок
-- в БД в обход формы (сама форма в AdminTariffs.tsx уже не даёт ввести цену выше исходной).
alter table public.tariffs add column sale_price_rub int;

alter table public.tariffs add constraint tariffs_sale_price_valid
  check (sale_price_rub is null or (sale_price_rub >= 0 and sale_price_rub < price_rub));
