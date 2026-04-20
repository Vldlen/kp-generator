-- Единый каталог товаров для КП-генератора
-- Таблица "catalog" (не "products" — та занята под прайсы поставщиков в price-compare)
-- Запустить в Supabase SQL Editor

-- Таблица каталога
CREATE TABLE IF NOT EXISTS catalog (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  article       text,
  category      text NOT NULL,
  company       text NOT NULL DEFAULT 'inno',
  description   text,
  specs         text,
  cost_price    numeric DEFAULT 0,
  sell_price    numeric NOT NULL DEFAULT 0,
  margin        numeric DEFAULT 0,
  supplier      text,
  supplier_article text,
  unit          text DEFAULT 'шт',
  warranty      text,
  is_active     boolean DEFAULT true,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_catalog_category ON catalog(category);
CREATE INDEX IF NOT EXISTS idx_catalog_company ON catalog(company);
CREATE INDEX IF NOT EXISTS idx_catalog_active ON catalog(is_active);

-- Подсказки совместимости
CREATE TABLE IF NOT EXISTS compatibility_hints (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_category text NOT NULL,
  trigger_product  text,
  condition       text,
  hint_text       text NOT NULL,
  hint_type       text DEFAULT 'info',
  is_active       boolean DEFAULT true
);

-- Скидки за объём лицензий
CREATE TABLE IF NOT EXISTS volume_discounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_category text NOT NULL,
  min_qty         integer NOT NULL,
  discount_percent numeric NOT NULL
);

-- Скидки за период подписки
CREATE TABLE IF NOT EXISTS period_discounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_key      text NOT NULL UNIQUE,
  period_months   integer NOT NULL,
  discount_percent numeric NOT NULL,
  label           text NOT NULL
);

-- RLS: разрешить всё для anon (до авторизации)
ALTER TABLE catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE compatibility_hints ENABLE ROW LEVEL SECURITY;
ALTER TABLE volume_discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE period_discounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for catalog" ON catalog FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for hints" ON compatibility_hints FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for volume_discounts" ON volume_discounts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for period_discounts" ON period_discounts FOR ALL USING (true) WITH CHECK (true);

-- Триггер обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER catalog_updated_at
  BEFORE UPDATE ON catalog
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
