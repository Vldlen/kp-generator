-- Обновление лицензий INNO — 4 типа
-- Запустить в Supabase SQL Editor

-- Удаляем старые лицензии
DELETE FROM catalog WHERE category = 'license_inno';

-- Добавляем актуальные 4 типа лицензий
INSERT INTO catalog (name, article, category, company, description, sell_price, unit) VALUES
('inno QR',         'lic-inno-qr',      'license_inno', 'inno', 'QR-меню: меню, оплата, лояльность. Работает на телефонах клиентов, оборудование не нужно. 1 ресторан.', 8000, 'мес'),
('inno Ecomm',      'lic-inno-ecomm',   'license_inno', 'inno', 'Электронная коммерция: меню, предзаказ, бронирование, оплата, лояльность. Оборудование не нужно. 1 ресторан.', 15000, 'мес'),
('inno Kiosk',      'lic-inno-kiosk',   'license_inno', 'inno', 'Киоск самообслуживания на планшете. Требуется: планшет + кронштейн + периферия. 1 рабочее место.', 10000, 'мес'),
('inno Kiosk PRO',  'lic-inno-kiosk-pro','license_inno', 'inno', 'Полноценный киоск самообслуживания. Только готовые киоски из прайсов поставщиков. 1 рабочее место.', 16200, 'мес');
