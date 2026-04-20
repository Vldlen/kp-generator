-- Заливка каталога из catalog.ts
-- Запустить ПОСЛЕ 001_create_products.sql

-- ==================== ПЛАНШЕТЫ ====================
INSERT INTO catalog (name, article, category, company, description, specs, cost_price, sell_price, margin, unit, warranty) VALUES
('OnePlus Pad 3',          'tab-oneplus-pad3',    'tablet', 'inno', '13.2" AMOLED, флагманский планшет для киосков', '13.2" AMOLED, Snapdragon', 37500, 65000, 36.5, 'шт', NULL),
('OnePlus Pad Go 2',       'tab-oneplus-padgo2',  'tablet', 'inno', '12.1" LCD, оптимальное соотношение цена/качество', '12.1" LCD', 21500, 35000, 32.4, 'шт', NULL),
('Honor Pad 10',            'tab-honor-pad10',     'tablet', 'inno', '12.1" LCD, бюджетный вариант', '12.1" LCD', 21400, 34000, 30.8, 'шт', NULL),
('Redmi Pad 2 Pro',         'tab-redmi-pad2pro',   'tablet', 'inno', '12.1" LCD, Xiaomi экосистема', '12.1" LCD', 19300, 31000, 31.5, 'шт', NULL),
('Poco Pad M1',             'tab-poco-pad-m1',     'tablet', 'inno', '12.1" LCD, самый бюджетный', '12.1" LCD', 18500, 30000, 32.2, 'шт', NULL);

-- ==================== POS-ТЕРМИНАЛЫ ====================
INSERT INTO catalog (name, article, category, company, description, specs, cost_price, sell_price, margin, unit, warranty) VALUES
('POScenter Atlas 15"',      'pos-atlas-15',       'pos_terminal', 'inno', '15" PCAP тачскрин, Intel J4125, 8GB RAM, 128GB SSD, MSR', '15" PCAP, Intel Celeron J4125, 8GB RAM, 128GB SSD, MSR, подставка S-90', 29900, 39400, 24, 'шт', '12 месяцев'),
('POScenter Atlas-2 15"',    'pos-atlas2-15',      'pos_terminal', 'inno', '15" PCAP тачскрин, Intel N5095, 8GB RAM, 128GB SSD, MSR', '15" PCAP, Intel Pentium N5095, 8GB RAM, 128GB SSD, MSR', 30900, 45800, 32, 'шт', '12 месяцев'),
('POScenter Atlas Pro 15"',  'pos-atlas-pro',      'pos_terminal', 'inno', '15" PCAP тачскрин, Intel N97, 8GB RAM, 128GB SSD, MSR', '15" PCAP, Intel Core N97, 8GB RAM, 128GB SSD, MSR, подставка V1', 38900, 51800, 25, 'шт', '12 месяцев'),
('POScenter POS101 Pro 15"', 'pos-pos101-pro',     'pos_terminal', 'inno', '15" PCAP тачскрин, Intel N100, 8GB RAM, 128GB SSD, MSR', '15" PCAP, Intel Core N100, 8GB RAM, 128GB SSD, MSR', 47400, 68700, 31, 'шт', '12 месяцев'),
('Sam4s Jupiter (Forza) 15"','pos-sam4s-jupiter',  'pos_terminal', 'inno', '15" PCT тачскрин, Intel J6412, 4GB RAM, 120GB SSD, MSR', '15" PCT, Intel J6412, 4GB RAM (апгрейд 8GB +3000₽), SSD 120GB, MSR', 52000, 69100, 25, 'шт', '3 года'),
('Sam4s Jupiter i3 15"',     'pos-sam4s-jupiter-i3','pos_terminal', 'inno', '15" PCT тачскрин, Intel i3-1115G4, 8GB RAM, 120GB SSD, MSR', '15" PCT, Intel Core i3-1115G4, 8GB RAM, SSD 120GB, MSR', 59000, 78000, 24, 'шт', '3 года');

-- ==================== КРОНШТЕЙНЫ (все в одной категории) ====================
INSERT INTO catalog (name, article, category, company, description, specs, cost_price, sell_price, margin, unit) VALUES
('ONKRON настольный кронштейн G80',    'mount-onkron-desk-g80',   'mount', 'inno', 'Настольная подставка с регулировкой', 'Настольный', 3500, 6200, 37.9, 'шт'),
('ONKRON настенный кронштейн (фикс.)', 'mount-onkron-wall-fixed', 'mount', 'inno', 'Фиксированное настенное крепление', 'Настенный, фиксированный', 3200, 5300, 33.6, 'шт'),
('ONKRON настенный кронштейн G150',    'mount-onkron-wall-g150',  'mount', 'inno', 'Подвижное настенное крепление (поворотный)', 'Настенный, поворотный', 4200, 7200, 35.8, 'шт'),
('MasterHold настольный кронштейн',    'mount-masterhold-desk',   'mount', 'inno', 'Профессиональная настольная подставка', 'Настольный', 6500, 11900, 39.9, 'шт'),
('MasterHold стойка-киоск',            'mount-masterhold-kiosk',  'mount', 'inno', 'Напольная стойка для киоска самообслуживания', 'Напольный', 18178, 28500, 29.8, 'шт');

-- ==================== АДАПТЕРЫ ====================
INSERT INTO catalog (name, article, category, company, description, specs, cost_price, sell_price, margin, unit) VALUES
('ONKRON адаптер для планшета', 'mount-onkron-adapter', 'adapter', 'inno', 'Универсальный адаптер для крепления планшета на кронштейне', NULL, 900, 2000, 50.5, 'шт');

-- ==================== ПЕРИФЕРИЯ ====================
INSERT INTO catalog (name, article, category, company, description, specs, cost_price, sell_price, margin, unit) VALUES
('Зарядное устройство 65W (Baseus GaN5)', 'peri-charger-65w',    'peripheral', 'inno', 'Быстрая зарядка GaN для планшета', NULL, 2500, 3500, 21.4, 'шт'),
('Кабель Type-C 240W 2м',                 'peri-cable-typec-2m', 'peripheral', 'inno', 'Усиленный USB-C кабель', NULL, 690, 1100, 31, 'шт'),
('USB-C угловой адаптер',                  'peri-angle-adapter',  'peripheral', 'inno', 'Угловой переходник для аккуратной укладки кабеля', NULL, 450, 700, 29.3, 'шт'),
('Мультипорт-хаб с LAN (UGREEN)',         'peri-hub-lan',        'peripheral', 'inno', 'USB-C хаб с Ethernet для стабильного интернета', NULL, 2200, 3900, 37.9, 'шт'),
('Крепление для пинпада',                  'mount-pinpad-bracket','peripheral', 'inno', 'Стальной кронштейн для терминала оплаты', NULL, 200, 2500, 91.2, 'шт');

-- ==================== ФИСКАЛЬНЫЕ РЕГИСТРАТОРЫ ====================
INSERT INTO catalog (name, article, category, company, description, specs, cost_price, sell_price, margin, unit) VALUES
('Фискальный регистратор', 'peri-fiscal', 'fiscal', 'inno', 'ККТ для печати чеков и передачи данных в ФНС', NULL, 15000, 22000, 31.8, 'шт');

-- ==================== УСЛУГИ ====================
INSERT INTO catalog (name, article, category, company, description, cost_price, sell_price, unit) VALUES
('Внедрение и настройка',             'svc-inno-impl',    'service', 'inno',  'Настройка и интеграция системы на локации', 0, 15000, 'локация'),
('Генерация контента (карточки меню)', 'svc-inno-content', 'service', 'inno',  'Дизайн карточек товаров и промо-материалов', 0, 800, 'позиция'),
('BONDA BI',                           'svc-bonda-bi',     'service', 'bonda', 'Бизнес-аналитика для ресторанов', 0, 30000, 'локация/мес');

-- ==================== СКИДКИ ЗА ОБЪЁМ ЛИЦЕНЗИЙ ====================
INSERT INTO volume_discounts (product_category, min_qty, discount_percent) VALUES
('license_inno', 11, 10),
('license_inno', 41, 20),
('license_inno', 100, 30),
('service_impl', 10, 10),
('service_impl', 20, 20),
('service_content', 50, 10),
('service_content', 100, 20);

-- ==================== СКИДКИ ЗА ПЕРИОД ====================
INSERT INTO period_discounts (period_key, period_months, discount_percent, label) VALUES
('month',     1,  0,  '1 месяц'),
('quarter',   3,  5,  '3 месяца'),
('half_year', 6,  10, '6 месяцев'),
('year',      12, 15, '12 месяцев');

-- ==================== ПОДСКАЗКИ СОВМЕСТИМОСТИ ====================
INSERT INTO compatibility_hints (trigger_category, condition, hint_text, hint_type) VALUES
('mount', 'type_change_to_wall',   'Для настенного крепления рекомендуется добавить хаб с LAN для стабильного интернета', 'info'),
('mount', 'type_change_to_floor',  'Для стойки MasterHold адаптер для планшета не нужен — можно убрать из КП', 'info'),
('mount', 'type_change',           'Проверьте, нужен ли адаптер для планшета с этим кронштейном', 'info'),
('tablet', 'model_change',         'Убедитесь, что адаптер кронштейна совместим с новой моделью планшета', 'info');
