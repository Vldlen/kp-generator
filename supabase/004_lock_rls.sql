-- 004_lock_rls.sql — Закрываем запись на anon в Supabase (P0-6 из аудита 2026-05-14).
--
-- ДО: политики FOR ALL USING (true) WITH CHECK (true) на четырёх таблицах.
-- Anon ключ в клиентском бандле → любой посетитель сайта мог SELECT/INSERT/
-- UPDATE/DELETE по каталогу. Это значит, что злоумышленник одной curl'ой
-- мог занулить sell_price или удалить весь catalog.
--
-- ПОСЛЕ: anon может только читать; запись доступна только service_role
-- (admin-операции и наполнение каталога из бэка или Supabase Studio).
--
-- Примечание про cost_price/margin: эти колонки остаются доступны anon на
-- чтение по сознательному решению команды (см. P0-7 в аудите — закупочные
-- цены и так публикуются в Google Sheet, и команда приняла этот риск).
-- Если в будущем понадобится их спрятать — добавить VIEW catalog_public.
--
-- Запускать в Supabase SQL Editor.

BEGIN;

-- Снимаем старые политики «Allow all»
DROP POLICY IF EXISTS "Allow all for catalog" ON catalog;
DROP POLICY IF EXISTS "Allow all for hints" ON compatibility_hints;
DROP POLICY IF EXISTS "Allow all for volume_discounts" ON volume_discounts;
DROP POLICY IF EXISTS "Allow all for period_discounts" ON period_discounts;

-- Только-чтение для anon и authenticated.
-- Запись — только service_role (по умолчанию RLS не пропускает INSERT/UPDATE/
-- DELETE от anon без явной WITH CHECK-политики, поэтому никаких write-политик
-- создавать не надо).
CREATE POLICY "anon read catalog" ON catalog
  FOR SELECT TO anon, authenticated
  USING (is_active = true);

CREATE POLICY "anon read hints" ON compatibility_hints
  FOR SELECT TO anon, authenticated
  USING (is_active = true);

CREATE POLICY "anon read volume_discounts" ON volume_discounts
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "anon read period_discounts" ON period_discounts
  FOR SELECT TO anon, authenticated
  USING (true);

COMMIT;

-- Smoke-проверка после применения:
--   SET LOCAL ROLE anon;
--   SELECT count(*) FROM catalog;                       -- должно работать
--   INSERT INTO catalog (name, category) VALUES ('x','y'); -- должно вернуть permission denied
--   UPDATE catalog SET sell_price = 1;                  -- должно вернуть permission denied
--   DELETE FROM catalog;                                -- должно вернуть permission denied
--   RESET ROLE;
