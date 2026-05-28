// ============================================================
// INNO Clouds — Полный каталог продуктов, услуг и оборудования
// ============================================================

// ---------- Типы ----------

export type ProductCategory = 'equipment' | 'tablet' | 'mount' | 'peripheral' | 'license' | 'service'
export type Company = 'inno' | 'bonda'
export type SubscriptionPeriod = 'month' | 'quarter' | 'half_year' | 'year'

export interface Product {
  id: string
  name: string
  kpName?: string         // обезличенное название для КП (без бренда)
  category: ProductCategory
  company: Company
  description: string
  costPrice: number       // закупочная
  sellPrice: number       // продажная
  margin: number          // маржа %
  warranty?: string       // гарантия
  specs?: string          // характеристики
  unit?: string           // единица (шт, мес, локация)
}

export interface LicenseTier {
  id: string
  name: string
  company: Company
  description: string
  pricing: Record<string, number>  // ключ = диапазон, значение = цена/мес
  period: SubscriptionPeriod
  features: string[]
}

export interface ServiceItem {
  id: string
  name: string
  company: Company
  description: string
  pricePerUnit: number
  unit: string  // "устройство", "локация", "позиция меню"
  volumeDiscount?: { minQty: number; discount: number }[]
}

// ---------- POS-оборудование (моноблоки) ----------

export const posEquipment: Product[] = [
  {
    id: 'pos-atlas-15',
    name: 'POScenter Atlas 15"',
    category: 'equipment',
    company: 'inno',
    description: '15" PCAP тачскрин, Intel J4125, 8GB RAM, 128GB SSD, MSR',
    costPrice: 29900,
    sellPrice: 39400,
    margin: 24,
    warranty: '12 месяцев',
    specs: '15" PCAP, Intel Celeron J4125, 8GB RAM, 128GB SSD, MSR, подставка S-90',
  },
  {
    id: 'pos-atlas2-15',
    name: 'POScenter Atlas-2 15"',
    category: 'equipment',
    company: 'inno',
    description: '15" PCAP тачскрин, Intel N5095, 8GB RAM, 128GB SSD, MSR',
    costPrice: 30900,
    sellPrice: 45800,
    margin: 32,
    warranty: '12 месяцев',
    specs: '15" PCAP, Intel Pentium N5095, 8GB RAM, 128GB SSD, MSR',
  },
  {
    id: 'pos-atlas-pro',
    name: 'POScenter Atlas Pro 15"',
    category: 'equipment',
    company: 'inno',
    description: '15" PCAP тачскрин, Intel N97, 8GB RAM, 128GB SSD, MSR',
    costPrice: 38900,
    sellPrice: 51800,
    margin: 25,
    warranty: '12 месяцев',
    specs: '15" PCAP, Intel Core N97, 8GB RAM, 128GB SSD, MSR, подставка V1',
  },
  {
    id: 'pos-pos101-pro',
    name: 'POScenter POS101 Pro 15"',
    category: 'equipment',
    company: 'inno',
    description: '15" PCAP тачскрин, Intel N100, 8GB RAM, 128GB SSD, MSR',
    costPrice: 47400,
    sellPrice: 68700,
    margin: 31,
    warranty: '12 месяцев',
    specs: '15" PCAP, Intel Core N100, 8GB RAM, 128GB SSD, MSR',
  },
  {
    id: 'pos-sam4s-jupiter',
    name: 'Sam4s Jupiter (Forza) 15"',
    category: 'equipment',
    company: 'inno',
    description: '15" PCT тачскрин, Intel J6412, 4GB RAM, 120GB SSD, MSR',
    costPrice: 52000,
    sellPrice: 69100,
    margin: 25,
    warranty: '3 года',
    specs: '15" PCT, Intel J6412, 4GB RAM (апгрейд 8GB +3000₽), SSD 120GB, MSR',
  },
  {
    id: 'pos-sam4s-jupiter-i3',
    name: 'Sam4s Jupiter i3 15"',
    category: 'equipment',
    company: 'inno',
    description: '15" PCT тачскрин, Intel i3-1115G4, 8GB RAM, 120GB SSD, MSR',
    costPrice: 59000,
    sellPrice: 78000,
    margin: 24,
    warranty: '3 года',
    specs: '15" PCT, Intel Core i3-1115G4, 8GB RAM, SSD 120GB, MSR',
  },
]

// ---------- Планшеты ----------

export const tablets: Product[] = [
  {
    id: 'tab-oneplus-pad3',
    name: 'OnePlus Pad 3',
    kpName: 'Планшет Android 13.2\'\', 12/256Гб',
    category: 'tablet',
    company: 'inno',
    description: '13.2" AMOLED, флагманский планшет для киосков',
    costPrice: 37500,
    sellPrice: 65000,
    margin: 36.5,
    specs: '13.2" AMOLED, 12/256Гб',
  },
  {
    id: 'tab-oneplus-padgo2',
    name: 'OnePlus Pad Go 2',
    kpName: 'Планшет Android 12.1\'\', 8/128Гб',
    category: 'tablet',
    company: 'inno',
    description: '12.1" LCD, оптимальное соотношение цена/качество',
    costPrice: 21500,
    sellPrice: 35000,
    margin: 32.4,
    specs: '12.1" LCD, 8/128Гб',
  },
  {
    id: 'tab-honor-pad10',
    name: 'Honor Pad X8a',
    kpName: 'Планшет Android 12.1\'\', 8/128Гб',
    category: 'tablet',
    company: 'inno',
    description: '12.1" LCD, бюджетный вариант',
    costPrice: 21400,
    sellPrice: 34000,
    margin: 30.8,
    specs: '12.1" LCD, 8/128Гб',
  },
  {
    id: 'tab-redmi-pad2pro',
    name: 'Redmi Pad 2 Pro',
    kpName: 'Планшет Android 12.1\'\', 8/128Гб',
    category: 'tablet',
    company: 'inno',
    description: '12.1" LCD, Xiaomi экосистема',
    costPrice: 19300,
    sellPrice: 31000,
    margin: 31.5,
    specs: '12.1" LCD, 8/128Гб',
  },
  {
    id: 'tab-poco-pad-m1',
    name: 'POCO Pad',
    kpName: 'Планшет Android 12.1\'\', 8/128Гб',
    category: 'tablet',
    company: 'inno',
    description: '12.1" LCD, самый бюджетный',
    costPrice: 18500,
    sellPrice: 30000,
    margin: 32.2,
    specs: '12.1" LCD, 8/128Гб',
  },
]

// ---------- Крепления и кронштейны ----------

export const mounts: Product[] = [
  {
    id: 'mount-onkron-wall-fixed',
    name: 'Onkron настенный неподвижный',
    kpName: 'Кронштейн настенный фиксированный',
    category: 'mount',
    company: 'inno',
    description: 'Кронштейн для телевизора настенный 10"-35" ONKRON R3 ROTO',
    costPrice: 900,
    sellPrice: 2000,
    margin: 51,
  },
  {
    id: 'mount-onkron-adapter',
    name: 'Onkron адаптер для планшета',
    kpName: 'Адаптер для планшета',
    category: 'mount',
    company: 'inno',
    description: 'Универсальный держатель ONKRON для планшета 10.1-12.9',
    costPrice: 3200,
    sellPrice: 5300,
    margin: 34,
  },
  {
    id: 'mount-onkron-wall-g150',
    name: 'Onkron настенный подвижный G150',
    kpName: 'Кронштейн настенный подвижный',
    category: 'mount',
    company: 'inno',
    description: 'ONKRON кронштейн для телевизора 13"-34" настенный G150',
    costPrice: 4200,
    sellPrice: 7200,
    margin: 36,
  },
  {
    id: 'mount-onkron-wall-g120',
    name: 'Onkron настенный подвижный G120',
    kpName: 'Кронштейн настенный подвижный',
    category: 'mount',
    company: 'inno',
    description: 'ONKRON кронштейн для телевизора 13"-34" настенный G120',
    costPrice: 3500,
    sellPrice: 5600,
    margin: 31,
  },
  {
    id: 'mount-onkron-desk-g80',
    name: 'Onkron настольный G80',
    kpName: 'Кронштейн настольный',
    category: 'mount',
    company: 'inno',
    description: 'ONKRON G80 кронштейн для монитора настольный 13"-32"',
    costPrice: 3500,
    sellPrice: 6200,
    margin: 38,
  },
  {
    id: 'mount-onkron-desk-g160',
    name: 'Onkron настольный G160',
    kpName: 'Кронштейн настольный двойной',
    category: 'mount',
    company: 'inno',
    description: 'ONKRON кронштейн для двух мониторов настольный G160, 13-32 дюйма',
    costPrice: 6800,
    sellPrice: 11300,
    margin: 34,
  },
  {
    id: 'mount-masterhold-desk',
    name: 'MasterHold настольный',
    kpName: 'Стойка настольная для планшета',
    category: 'mount',
    company: 'inno',
    description: 'Универсальный адаптер для планшетов ONKRON APM-13T',
    costPrice: 6500,
    sellPrice: 11900,
    margin: 40,
  },
  {
    id: 'mount-masterhold-kiosk',
    name: 'MasterHold комплекс креплений',
    kpName: 'Стойка напольная для киоска',
    category: 'mount',
    company: 'inno',
    description: 'Стойка для кассового оборудования: планшет, банковский терминал, фискальный регистратор',
    costPrice: 18178,
    sellPrice: 28500,
    margin: 30,
  },
  {
    id: 'mount-pinpad-bracket',
    name: 'Крепление для эквара на кронштейн',
    kpName: 'Крепление для терминала оплаты',
    category: 'mount',
    company: 'inno',
    description: 'Премиальный кронштейн для крепления банковских терминалов',
    costPrice: 200,
    sellPrice: 2500,
    margin: 91,
  },
]

// ---------- Периферия ----------

export const peripherals: Product[] = [
  {
    id: 'peri-charger-65w',
    name: 'Блок питания 65W',
    kpName: 'Блок питания 65W',
    category: 'peripheral',
    company: 'inno',
    description: 'Сетевое зарядное Baseus GaN5 Pro 65W Fast Charger 2 Type-C / 1 USB-A',
    costPrice: 2500,
    sellPrice: 3500,
    margin: 21,
  },
  {
    id: 'peri-cable-typec-2m',
    name: 'Кабель питания',
    kpName: 'Кабель питания Type-C',
    category: 'peripheral',
    company: 'inno',
    description: 'Кабель Type-C - Type-C 240W, 2m, Baseus Tungsten Gold Fast Charging Data Cable',
    costPrice: 690,
    sellPrice: 1100,
    margin: 31,
  },
  {
    id: 'peri-angle-adapter',
    name: 'Переходник угловой',
    kpName: 'Переходник угловой Type-C',
    category: 'peripheral',
    company: 'inno',
    description: 'Переходник для Steam Deck (USB Type-C Male - Type-C Female), 140 Вт, 20 Гб/с, 4K, 60 Гц',
    costPrice: 450,
    sellPrice: 700,
    margin: 29,
  },
  {
    id: 'peri-hub-lan',
    name: 'Хаб многопортовый с LAN-входом',
    kpName: 'Сетевой хаб USB-C с LAN',
    category: 'peripheral',
    company: 'inno',
    description: 'USB-Концентратор UGREEN CM512 Хаб USB-C 6-in-1 HUB, USB3.2, Type-C3.2, HDMI, RJ-45, PD100W',
    costPrice: 2200,
    sellPrice: 3900,
    margin: 38,
  },
]

// ---------- Лицензии ИННО ----------

export const innoLicenses: LicenseTier[] = [
  {
    id: 'lic-inno-kiosk',
    name: 'inno Clouds Kiosk',
    company: 'inno',
    description: 'Лицензия на киоск самообслуживания',
    pricing: {
      '1+': 10000,   // скидки отключены — ставятся вручную
    },
    period: 'month',
    features: [
      'Киоск самообслуживания',
      'Интеграция с iiko',
      'Облачное управление меню',
      'Аналитика продаж',
      'Удалённое управление',
    ],
  },
  {
    id: 'lic-inno-ff-mini',
    name: 'inno FF Mini',
    company: 'inno',
    description: 'Мини-франшиза innoClouds',
    pricing: {
      '1+': 10000,   // скидки отключены — ставятся вручную
    },
    period: 'month',
    features: [
      'Все возможности Kiosk',
      'Франчайзинговая модель',
      'Комиссия дилера 25%',
    ],
  },
]

// ---------- ФинДир (БОНДА) тарифы ----------

export interface FindirTier {
  name: string
  pricing: Record<string, number> // ключ = диапазон локаций
  features: string[]
}

export const findirTariffs: FindirTier[] = [
  {
    name: 'Старт',
    pricing: {
      '1': 50000,
      '2': 90000,
      '3-5': 145000,
      '6-10': 170000,
      '11-15': 220000,
      '16-20': 270000,
    },
    features: [
      'Персональный дашборд владельца',
      'Автоматизация складского учёта',
      'Финансовый учёт',
      'Еженедельный план-факт',
    ],
  },
  {
    name: 'Про',
    pricing: {
      '1': 65000,
      '2': 100000,
      '3-5': 175000,
      '6-10': 200000,
      '11-15': 250000,
      '16-20': 310000,
    },
    features: [
      'Все возможности тарифа «Старт»',
      'Бюджетирование на год',
      'Ежемесячный P&L и cash flow',
      'План-факт анализ в iiko',
      'Платёжный календарь',
    ],
  },
  {
    name: 'Ультра',
    pricing: {
      '1': 85000,
      '2': 120000,
      '3-5': 210000,
      '6-10': 230000,
      '11-15': 280000,
      '16-20': 350000,
    },
    features: [
      'Все возможности тарифа «Про»',
      'Управленческий баланс',
      'Маржинальный анализ портфеля',
      'Автоматизация ФОТ и графиков',
      'Анализ ценообразования',
      'Еженедельный KPI-анализ',
      'Дивидендная политика',
    ],
  },
]

// ---------- Услуги ----------

export const services: ServiceItem[] = [
  {
    id: 'svc-inno-impl',
    name: 'Внедрение innoClouds',
    company: 'inno',
    description: 'Настройка и интеграция системы на локации',
    pricePerUnit: 20000,
    unit: 'локация',
  },
  {
    id: 'svc-inno-content',
    name: 'inno clouds Контент',
    company: 'inno',
    description: 'Дизайн карточек товаров и промо-материалов',
    pricePerUnit: 1200,
    unit: 'позиция',
  },
  {
    id: 'svc-bonda-bi',
    name: 'BONDA BI',
    company: 'bonda',
    description: 'Бизнес-аналитика для ресторанов',
    pricePerUnit: 30000,
    unit: 'локация/мес',
  },
]

// ---------- Готовые комплекты (шаблоны) ----------

export interface KioskKit {
  id: string
  name: string
  description: string
  items: { productId: string; qty: number }[]
  priceTotal: number
}

export const kioskKits: KioskKit[] = [
  {
    id: 'kit-basic',
    name: 'Базовый киоск',
    description: '1 планшет + настольный кронштейн + зарядка + кабель',
    items: [
      { productId: 'tab-oneplus-padgo2', qty: 1 },
      { productId: 'mount-onkron-desk-g80', qty: 1 },
      { productId: 'peri-charger-65w', qty: 1 },
      { productId: 'peri-cable-typec-2m', qty: 1 },
    ],
    priceTotal: 45800,
  },
  {
    id: 'kit-wall',
    name: 'Настенный киоск',
    description: '1 планшет + настенный кронштейн + зарядка + кабель + хаб',
    items: [
      { productId: 'tab-oneplus-padgo2', qty: 1 },
      { productId: 'mount-onkron-wall-g150', qty: 1 },
      { productId: 'mount-onkron-adapter', qty: 1 },
      { productId: 'peri-charger-65w', qty: 1 },
      { productId: 'peri-cable-typec-2m', qty: 1 },
      { productId: 'peri-hub-lan', qty: 1 },
    ],
    priceTotal: 52900,
  },
  {
    id: 'kit-floor',
    name: 'Напольный киоск',
    description: '1 планшет + напольная стойка + зарядка + кабель + пинпад',
    items: [
      { productId: 'tab-oneplus-padgo2', qty: 1 },
      { productId: 'mount-masterhold-kiosk', qty: 1 },
      { productId: 'mount-pinpad-bracket', qty: 1 },
      { productId: 'peri-charger-65w', qty: 1 },
      { productId: 'peri-cable-typec-2m', qty: 1 },
    ],
    priceTotal: 70100,
  },
  {
    id: 'kit-pos',
    name: 'POS-терминал',
    description: 'Моноблок POScenter Atlas + фискальный регистратор',
    items: [
      { productId: 'pos-atlas-15', qty: 1 },
    ],
    priceTotal: 39400,
  },
]

// ---------- Скидки за объём лицензий ----------

export function getLicensePrice(basePrice: number, _qty: number): number {
  // Скидки отключены — ставятся вручную
  return basePrice
}

// ---------- Цены лицензий ИННО — единый источник истины ----------
//
// Phase 9 (H22, 2026-05-14): раньше эти цены жили в 3 местах одновременно —
// labels формы (page.tsx), innoLicPrices в calculator.ts, innoLicenses здесь.
// Любая смена цены требовала синхронной правки трёх файлов; дрейф — вопрос
// времени. Теперь page.tsx и calculator.ts читают этот объект.

export interface InnoLicensePrice {
  name: string
  pricePerMonth: number
  /** unit: 'location' — qty считается по локациям (QR/Ecomm),
   *  'device' — по устройствам (Kiosk/Kiosk PRO). */
  unit: 'location' | 'device'
  uiLabel: string  // что показывается в карточке формы (под названием)
}

// Имена обновлены по требованию русификации (2026-05-22). Внутренние ключи
// (qr/ecomm/kiosk/kiosk_pro) и `license_type` в коде не трогаем — это id
// продуктов; меняется только то, что видит клиент.
export const INNO_LICENSE_PRICES: Record<string, InnoLicensePrice> = {
  qr: {
    name: 'inno clouds Меню',
    pricePerMonth: 8000,
    unit: 'location',
    uiLabel: '8 000 ₽/мес · Без оборудования',
  },
  ecomm: {
    name: 'inno clouds Ресторан',
    pricePerMonth: 15000,
    unit: 'location',
    uiLabel: '15 000 ₽/мес · Без оборудования',
  },
  kiosk: {
    name: 'inno clouds Киоск',
    pricePerMonth: 10000,
    unit: 'device',
    uiLabel: '10 000 ₽/мес · Планшет + периферия',
  },
  kiosk_pro: {
    name: 'inno clouds Киоск Профи',
    pricePerMonth: 16200,
    unit: 'device',
    uiLabel: '16 200 ₽/мес · Готовый киоск',
  },
}

// ============================================================
//  Фискальное оборудование (BG-1..5, 2026-05-26)
// ============================================================
//
// Два паттерна фискализации, привязанные к группе киоска:
//
//   'internal' — модуль АТОЛ 42 ФА вставляется внутрь корпуса киоска,
//                превращает встроенный принтер в фискальный регистратор.
//                Используется на больших киосках с местом внутри.
//                Для МС 24/32 у которых принтер не идёт в комплекте —
//                добавляется отдельной строкой «Принтер чеков 80мм»
//                (по умолчанию; 58мм доступен опционально из каталога).
//
//   'external' — полноценный ФР «POScenter-02Ф Cover» ставится снаружи
//                рядом с киоском/планшетом. Используется когда внутрь
//                ничего не влезает (маленькие киоски, планшетные точки).
//
// ФН 15 идёт парой к ЛЮБОМУ ФР/ККТ — пары неразделимы.
//
// По дефолту:
//   - Kiosk PRO: пакет ВКЛЮЧЁН (у клиента нет своей кассы — нужна фискализация)
//   - Планшетный Kiosk: пакет ВЫКЛЮЧЕН (чаще клиент со своей iiko-кассой;
//     если нужен ФР — менеджер ставит галку)
//
// Имена в КП — реальные модели, без обезличивания (юридическая прозрачность).

export type FiscalPattern = 'internal' | 'external' | 'none'

export interface FiscalConfig {
  pattern: FiscalPattern
  /** Если внутренний паттерн и принтер НЕ в комплекте киоска — указать тип. */
  includeBuiltinPrinter?: 'p58' | 'p80'
}

// Описание фискальных устройств: каноническое имя для КП + паттерн поиска
// в живом каталоге (Google Sheets). Цены НЕ хардкодим — тащим из каталога
// через resolveFiscalPrices, чтобы при обновлении прайса в Sheets цены
// в КП обновлялись автоматически (фикс 2026-05-26).
export const FISCAL_DEVICES = {
  atol42fa:     {
    name: 'ККТ «Атол 42 ФА»',
    match: (n: string) => /атол\s*42/i.test(n),
  },
  poscenter02f: {
    name: 'Фискальный регистратор «POScenter-02Ф»',
    match: (n: string) => /poscenter[-\s]*02ф/i.test(n),
  },
  fn15: {
    name: 'Фискальный накопитель ФН 15',
    match: (n: string) => /фн\s*15/i.test(n) || /фискальный накопитель/i.test(n),
  },
  printer58: {
    name: 'Принтер чеков 58мм встраиваемый',
    match: (n: string) => /принтер чек.*58/i.test(n),
  },
  printer80: {
    name: 'Принтер чеков 80мм встраиваемый',
    match: (n: string) => /принтер чек.*80/i.test(n),
  },
} as const

export type FiscalDeviceKey = keyof typeof FISCAL_DEVICES
export type FiscalPriceMap = Record<FiscalDeviceKey, number>

/** Извлекает живые цены фискальных устройств из текущего каталога
 *  (Google Sheets / Supabase / fallback). Если устройство не найдено —
 *  цена 0, и calculator такую строку в КП не положит. */
export function resolveFiscalPrices(catalog: Array<{ name: string; sell_price: number }>): FiscalPriceMap {
  const result = {} as FiscalPriceMap
  for (const key of Object.keys(FISCAL_DEVICES) as FiscalDeviceKey[]) {
    const def = FISCAL_DEVICES[key]
    const product = catalog.find(p => def.match(p.name))
    result[key] = product ? Math.round(product.sell_price) : 0
  }
  return result
}

// Правила паттерна — по префиксу группы из Google Sheets (после нормализации).
// Порядок матчинга = порядок в массиве; более специфичные (длинные) префиксы
// должны идти раньше общих.
const KIOSK_FISCAL_RULES: Array<{ groupMatch: string; cfg: FiscalConfig }> = [
  // ── Pattern A — внутренний АТОЛ 42 ФА ──
  // Принтер встроен в комплект киоска — отдельной строкой не добавляется:
  { groupMatch: 'poscenter k',              cfg: { pattern: 'internal' } },
  { groupMatch: 'киоск sam4s',              cfg: { pattern: 'internal' } },
  { groupMatch: 'kiosk superkiosk l-240',   cfg: { pattern: 'internal' } },
  { groupMatch: 'kiosk superkiosk l-320',   cfg: { pattern: 'internal' } },
  { groupMatch: 'киоск superkiosk t-215',   cfg: { pattern: 'internal' } },
  { groupMatch: 'киоск superkiosk r-156',   cfg: { pattern: 'internal' } },
  // МС 24 / МС 32 — принтер в комплект НЕ входит, добавляем 80мм по умолчанию:
  { groupMatch: 'киоск самообслуживания мс 24', cfg: { pattern: 'internal', includeBuiltinPrinter: 'p80' } },
  { groupMatch: 'киоск самообслуживания мс 32', cfg: { pattern: 'internal', includeBuiltinPrinter: 'p80' } },
  // ── Pattern B — внешний POScenter-02Ф Cover ──
  { groupMatch: 'sco poscenter',                       cfg: { pattern: 'external' } },
  { groupMatch: 'касса самообслуживания мс mini',      cfg: { pattern: 'external' } },
  { groupMatch: 'касса самообслуживания мс 21 n',      cfg: { pattern: 'external' } },
  { groupMatch: 'касса самообслуживания мс 21 slim',   cfg: { pattern: 'external' } },
]

function normalizeGroup(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ')
}

/** Возвращает конфигурацию фискального пакета по группе киоска
 *  из Google Sheets. Если группа не сматчилась — null (модель новая,
 *  правило не задано, фискалка не подставится). */
export function getFiscalConfigByGroup(group: string | null | undefined): FiscalConfig | null {
  if (!group) return null
  const g = normalizeGroup(group)
  for (const rule of KIOSK_FISCAL_RULES) {
    if (g.startsWith(rule.groupMatch)) return rule.cfg
  }
  return null
}

/** Конфигурация для планшетного inno clouds Киоск (license_type='kiosk'). */
export const TABLET_KIOSK_FISCAL_CONFIG: FiscalConfig = { pattern: 'external' }

/** Предпросмотр состава фискального пакета — для UI чекбокса в форме.
 *  Цены берутся из живого price-map (resolveFiscalPrices), если устройства
 *  в каталоге нет — пункт пропускается. */
export function getFiscalPackPreview(
  config: FiscalConfig,
  prices: FiscalPriceMap,
): Array<{ name: string; price: number }> {
  const items: Array<{ name: string; price: number }> = []
  if (config.pattern === 'internal') {
    if (prices.atol42fa > 0) items.push({ name: FISCAL_DEVICES.atol42fa.name, price: prices.atol42fa })
    if (prices.fn15 > 0)     items.push({ name: FISCAL_DEVICES.fn15.name,     price: prices.fn15 })
    if (config.includeBuiltinPrinter === 'p80' && prices.printer80 > 0) {
      items.push({ name: FISCAL_DEVICES.printer80.name, price: prices.printer80 })
    } else if (config.includeBuiltinPrinter === 'p58' && prices.printer58 > 0) {
      items.push({ name: FISCAL_DEVICES.printer58.name, price: prices.printer58 })
    }
    return items
  }
  if (config.pattern === 'external') {
    if (prices.poscenter02f > 0) items.push({ name: FISCAL_DEVICES.poscenter02f.name, price: prices.poscenter02f })
    if (prices.fn15 > 0)         items.push({ name: FISCAL_DEVICES.fn15.name,         price: prices.fn15 })
  }
  return items
}

// ---------- Дополнительные лицензии (add-on'ы) ----------
//
// Расширения поверх основной ИННО-лицензии. Можно подключить любое количество
// независимо от типа основной (Меню/Ресторан/Киоск/Киоск Профи). 2026-05-26:
// первая такая лицензия — Электронная очередь. По мере появления новых
// продуктов добавлять записи сюда; форма и калькулятор подхватят автоматически.

export interface InnoAddonLicense {
  name: string
  pricePerMonth: number
  unit: 'location' | 'device' | 'kp'
  uiLabel: string  // что показывается рядом с чекбоксом в форме
}

export const INNO_ADDON_LICENSES: Record<string, InnoAddonLicense> = {
  queue: {
    name: 'inno clouds Электронная очередь',
    pricePerMonth: 2000,
    unit: 'location',
    uiLabel: '2 000 ₽/мес за локацию',
  },
}

// ---------- Скидка за период подписки ----------

export const periodMultiplier: Record<SubscriptionPeriod, { months: number; discount: number; label: string }> = {
  month: { months: 1, discount: 0, label: '1 месяц' },
  quarter: { months: 3, discount: 0, label: '3 месяца' },
  half_year: { months: 6, discount: 0, label: '6 месяцев' },
  year: { months: 12, discount: 0, label: '12 месяцев' },
}

// ---------- ФинДир: получить цену по тарифу и кол-ву локаций ----------

/**
 * Возвращает цену тарифа ФинДир за месяц для указанного числа локаций.
 *
 * Возвращает `null` если в тарифной сетке нет ступени для запрошенного объёма
 * (locations > 20 — это уровень крупной сети, цена индивидуальная). Раньше
 * (до Phase 8 фикса H2 2026-05-14) для locations > 20 функция тихо возвращала
 * цену ступени «16-20», что занижало смету на крупных сетях.
 *
 * Calculator при null генерирует строку с «цена по запросу» и unitPrice=0,
 * чтобы менеджер увидел и проставил цену вручную после согласования.
 */
export function getFindirPrice(tariffName: string, locations: number): number | null {
  const tariff = findirTariffs.find(t => t.name === tariffName)
  if (!tariff) return 0
  if (locations <= 1) return tariff.pricing['1']
  if (locations <= 2) return tariff.pricing['2']
  if (locations <= 5) return tariff.pricing['3-5']
  if (locations <= 10) return tariff.pricing['6-10']
  if (locations <= 15) return tariff.pricing['11-15']
  if (locations <= 20) return tariff.pricing['16-20']
  return null  // > 20 — цена не определена тарифом, требует индивидуального расчёта
}

// ---------- Все продукты в одном массиве ----------

export const allProducts: Product[] = [
  ...posEquipment,
  ...tablets,
  ...mounts,
  ...peripherals,
]

export function getProductById(id: string): Product | undefined {
  return allProducts.find(p => p.id === id)
}

// ---------- Условия оплаты ----------

export const paymentTerms = {
  prepay100: { label: '100% предоплата', tranches: [1.0] },
  installment3: { label: 'Рассрочка 3 мес (60/20/20)', tranches: [0.6, 0.2, 0.2] },
}
