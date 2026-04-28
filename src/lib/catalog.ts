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
    name: 'Генерация контента',
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

// ---------- Скидка за период подписки ----------

export const periodMultiplier: Record<SubscriptionPeriod, { months: number; discount: number; label: string }> = {
  month: { months: 1, discount: 0, label: '1 месяц' },
  quarter: { months: 3, discount: 0, label: '3 месяца' },
  half_year: { months: 6, discount: 0, label: '6 месяцев' },
  year: { months: 12, discount: 0, label: '12 месяцев' },
}

// ---------- ФинДир: получить цену по тарифу и кол-ву локаций ----------

export function getFindirPrice(tariffName: string, locations: number): number {
  const tariff = findirTariffs.find(t => t.name === tariffName)
  if (!tariff) return 0
  if (locations <= 1) return tariff.pricing['1']
  if (locations <= 2) return tariff.pricing['2']
  if (locations <= 5) return tariff.pricing['3-5']
  if (locations <= 10) return tariff.pricing['6-10']
  if (locations <= 15) return tariff.pricing['11-15']
  return tariff.pricing['16-20']
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
