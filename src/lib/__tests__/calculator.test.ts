/**
 * Unit-тесты на calculateKP и хелперы LineItem.
 *
 * Покрывают:
 * - Все ветки license_type (qr / ecomm / kiosk / kiosk_pro / findir / bonda_bi)
 * - Все периоды подписки (month / quarter / half_year / year)
 * - Опциональные услуги (внедрение, контент)
 * - Edge cases (devices=0, locations=0, content_items=0)
 * - Семантику LineItem.months (Phase 3 фикса P0-3/P0-4 2026-05-14)
 * - monthlyTotal как ежемесячный платёж по подписке
 * - grandTotal = сумма всех subtotals
 *
 * Pre-Phase-8 baseline — фиксирует текущее поведение, включая известные баги
 * H1 (хаб × devices) и H2 (ФинДир для locations>20 цена тарифа «16-20»).
 * После фиксов в Phase 8 эти тесты надо будет обновить.
 */

import { describe, it, expect } from 'vitest'
import {
  calculateKP,
  lineMonths,
  recomputeLineTotal,
  type LineItem,
} from '../calculator'
import type { ParsedRequest } from '../prompt'

// ─────────────────────────────────────────────────────────────────────────
// Хелперы
// ─────────────────────────────────────────────────────────────────────────

function baseForm(over: Partial<ParsedRequest> = {}): ParsedRequest {
  return {
    company: 'inno',
    client_name: 'Тест',
    locations: 1,
    devices: 1,
    products: [],
    kiosk_type: 'desk',
    license_type: null,
    findir_tariff: null,
    selected_tablet_id: null,
    selected_kiosk_id: null,
    subscription_period: 'year',
    need_implementation: false,
    content_items: 0,
    payment_type: 'prepay100',
    notes: '',
    selected_kiosk_options: [],
    ...over,
  }
}

function findSection(kp: ReturnType<typeof calculateKP>, title: string) {
  return kp.sections.find(s => s.title === title)
}

function findItem(kp: ReturnType<typeof calculateKP>, sectionTitle: string, partOfName: string) {
  return findSection(kp, sectionTitle)?.items.find(i => i.name.includes(partOfName))
}

// ─────────────────────────────────────────────────────────────────────────
// LineItem helpers
// ─────────────────────────────────────────────────────────────────────────

describe('lineMonths', () => {
  it('returns 1 when months is undefined', () => {
    const item: LineItem = { name: 'x', category: 'y', qty: 1, unitPrice: 100, discount: 0, total: 100 }
    expect(lineMonths(item)).toBe(1)
  })

  it('returns 1 when months is 0', () => {
    const item: LineItem = { name: 'x', category: 'y', qty: 1, unitPrice: 100, discount: 0, total: 100, months: 0 }
    expect(lineMonths(item)).toBe(1)
  })

  it('returns months value when set', () => {
    const item: LineItem = { name: 'x', category: 'y', qty: 1, unitPrice: 100, discount: 0, total: 1200, months: 12 }
    expect(lineMonths(item)).toBe(12)
  })
})

describe('recomputeLineTotal', () => {
  it('basic: unitPrice × qty (no months, no discount)', () => {
    const item: LineItem = { name: 'x', category: 'y', qty: 3, unitPrice: 1000, discount: 0, total: 0 }
    expect(recomputeLineTotal(item)).toBe(3000)
  })

  it('with months: unitPrice × qty × months', () => {
    const item: LineItem = { name: 'x', category: 'y', qty: 2, unitPrice: 10000, discount: 0, total: 0, months: 12 }
    expect(recomputeLineTotal(item)).toBe(240000)
  })

  it('with 10% discount', () => {
    const item: LineItem = { name: 'x', category: 'y', qty: 1, unitPrice: 10000, discount: 10, total: 0, months: 12 }
    expect(recomputeLineTotal(item)).toBe(108000)
  })

  it('with 100% discount → 0', () => {
    const item: LineItem = { name: 'x', category: 'y', qty: 5, unitPrice: 999, discount: 100, total: 0 }
    expect(recomputeLineTotal(item)).toBe(0)
  })

  it('rounds to integer', () => {
    const item: LineItem = { name: 'x', category: 'y', qty: 1, unitPrice: 333.33, discount: 0, total: 0, months: 3 }
    // 333.33 × 3 = 999.99 → round → 1000
    expect(recomputeLineTotal(item)).toBe(1000)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// calculateKP — inno Kiosk (планшетный комплект)
// ─────────────────────────────────────────────────────────────────────────

describe('calculateKP — inno Kiosk', () => {
  it('дефолтный комплект (1 устр, настольный, год) даёт 8 позиций оборудования', () => {
    const kp = calculateKP(baseForm({ license_type: 'kiosk', devices: 1, kiosk_type: 'desk' }))
    const equip = findSection(kp, 'Оборудование')
    expect(equip).toBeDefined()
    // tablet + mount + adapter + 4 peripherals + pinpad = 8
    expect(equip!.items.length).toBe(8)
  })

  it('дефолтный комплект: subtotal = 88 200 ₽ (тот самый кейс из манагерского бага)', () => {
    const kp = calculateKP(baseForm({ license_type: 'kiosk', devices: 1, kiosk_type: 'desk' }))
    const equip = findSection(kp, 'Оборудование')
    // OnePlus Pad 3 (65000) + G80 (6200) + adapter (5300) +
    // БП (3500) + кабель (1100) + угловой (700) + хаб (3900) + пинпад (2500) = 88 200
    expect(equip!.subtotal).toBe(88200)
  })

  it('настенный — кронштейн mount-onkron-wall-fixed 2000 ₽', () => {
    const kp = calculateKP(baseForm({ license_type: 'kiosk', devices: 1, kiosk_type: 'wall' }))
    const mount = findItem(kp, 'Оборудование', 'настенн')
    expect(mount?.unitPrice).toBe(2000)
  })

  it('напольный — кронштейн mount-masterhold-kiosk 28 500 ₽', () => {
    const kp = calculateKP(baseForm({ license_type: 'kiosk', devices: 1, kiosk_type: 'floor' }))
    const mount = findItem(kp, 'Оборудование', 'напольн')
    expect(mount?.unitPrice).toBe(28500)
  })

  it('3 устройства → все equip-позиции с qty=3 и subtotal×3', () => {
    // Каждый планшет = независимая киоск-станция со своим полным комплектом,
    // включая хаб LAN и крепление эквайринга.
    const kp = calculateKP(baseForm({ license_type: 'kiosk', devices: 3, locations: 1 }))
    const equip = findSection(kp, 'Оборудование')!
    expect(equip.items.every(i => i.qty === 3)).toBe(true)
    expect(equip.subtotal).toBe(88200 * 3)  // 264 600
  })

  it('selected_tablet_id выбирает указанный планшет', () => {
    const kp = calculateKP(baseForm({
      license_type: 'kiosk',
      devices: 1,
      selected_tablet_id: 'tab-redmi-pad2pro',
    }))
    const tablet = findItem(kp, 'Оборудование', 'Планшет')
    // Redmi Pad 2 Pro → sellPrice 31000
    expect(tablet?.unitPrice).toBe(31000)
  })

  it('без selected_tablet_id берёт первый из tablets[] (OnePlus Pad 3, 65 000 ₽)', () => {
    const kp = calculateKP(baseForm({ license_type: 'kiosk', devices: 1 }))
    const tablet = findItem(kp, 'Оборудование', 'Планшет')
    expect(tablet?.unitPrice).toBe(65000)
  })

  it('лицензия inno Kiosk: unitPrice=10000/мес, months=12, total=120 000 за год', () => {
    const kp = calculateKP(baseForm({ license_type: 'kiosk', devices: 1, subscription_period: 'year' }))
    const lic = findItem(kp, 'Лицензии и подписки', 'inno Kiosk')!
    expect(lic.unitPrice).toBe(10000)
    expect(lic.months).toBe(12)
    expect(lic.qty).toBe(1)
    expect(lic.total).toBe(120000)
  })

  it('лицензия inno Kiosk месячная: total = 10 000', () => {
    const kp = calculateKP(baseForm({ license_type: 'kiosk', devices: 1, subscription_period: 'month' }))
    const lic = findItem(kp, 'Лицензии и подписки', 'inno Kiosk')!
    expect(lic.months).toBe(1)
    expect(lic.total).toBe(10000)
  })

  it('лицензия inno Kiosk × 5 устройств × год = 600 000 ₽', () => {
    const kp = calculateKP(baseForm({ license_type: 'kiosk', devices: 5, subscription_period: 'year' }))
    const lic = findItem(kp, 'Лицензии и подписки', 'inno Kiosk')!
    expect(lic.qty).toBe(5)
    expect(lic.total).toBe(600000)
  })

  it('monthlyTotal для inno Kiosk = 10 000 × devices (не × months)', () => {
    const kp = calculateKP(baseForm({ license_type: 'kiosk', devices: 3, subscription_period: 'year' }))
    expect(kp.monthlyTotal).toBe(30000)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// calculateKP — inno Kiosk PRO
// ─────────────────────────────────────────────────────────────────────────

describe('calculateKP — inno Kiosk PRO', () => {
  it('без _kiosk_* fallback → posEquipment[0] (POScenter Atlas 15", 39 400 ₽)', () => {
    const kp = calculateKP(baseForm({ license_type: 'kiosk_pro', devices: 1 }))
    const equip = findSection(kp, 'Оборудование')!
    expect(equip.items[0].unitPrice).toBe(39400)
    expect(equip.items[0].name).toContain('Atlas')
  })

  it('с _kiosk_name и _kiosk_price — используются они', () => {
    const kp = calculateKP(baseForm({
      license_type: 'kiosk_pro',
      devices: 2,
      _kiosk_name: 'Custom Kiosk Model',
      _kiosk_price: 100000,
    }))
    const equip = findSection(kp, 'Оборудование')!
    expect(equip.items[0].name).toBe('Custom Kiosk Model')
    expect(equip.items[0].unitPrice).toBe(100000)
    expect(equip.items[0].total).toBe(200000)
  })

  it('добавляет _kiosk_mount если он передан', () => {
    const kp = calculateKP(baseForm({
      license_type: 'kiosk_pro',
      devices: 1,
      _kiosk_name: 'X',
      _kiosk_price: 100000,
      _kiosk_mount_name: 'Special Mount',
      _kiosk_mount_price: 5000,
    }))
    const equip = findSection(kp, 'Оборудование')!
    const mount = equip.items.find(i => i.name === 'Special Mount')
    expect(mount?.unitPrice).toBe(5000)
  })

  it('добавляет _kiosk_options_data строками', () => {
    const kp = calculateKP(baseForm({
      license_type: 'kiosk_pro',
      devices: 1,
      _kiosk_name: 'X',
      _kiosk_price: 100000,
      _kiosk_options_data: [
        { name: 'ККТ', price: 25000 },
        { name: 'Принтер чеков', price: 15000 },
      ],
    }))
    const equip = findSection(kp, 'Оборудование')!
    expect(equip.items.find(i => i.name === 'ККТ')?.unitPrice).toBe(25000)
    expect(equip.items.find(i => i.name === 'Принтер чеков')?.unitPrice).toBe(15000)
  })

  it('лицензия inno Kiosk PRO: unitPrice=16 200/мес', () => {
    const kp = calculateKP(baseForm({ license_type: 'kiosk_pro', devices: 1, subscription_period: 'year' }))
    const lic = findItem(kp, 'Лицензии и подписки', 'inno Kiosk PRO')!
    expect(lic.unitPrice).toBe(16200)
    expect(lic.total).toBe(16200 * 12)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// calculateKP — inno QR / Ecomm (без оборудования)
// ─────────────────────────────────────────────────────────────────────────

describe('calculateKP — inno QR/Ecomm', () => {
  it('QR не создаёт секцию Оборудование', () => {
    const kp = calculateKP(baseForm({ license_type: 'qr', devices: 0, locations: 5 }))
    expect(findSection(kp, 'Оборудование')).toBeUndefined()
  })

  it('QR: лицензия × locations (не × devices)', () => {
    const kp = calculateKP(baseForm({ license_type: 'qr', devices: 0, locations: 5, subscription_period: 'year' }))
    const lic = findItem(kp, 'Лицензии и подписки', 'inno QR')!
    expect(lic.qty).toBe(5)
    expect(lic.unitPrice).toBe(8000)
    expect(lic.months).toBe(12)
    expect(lic.total).toBe(8000 * 5 * 12)
  })

  it('Ecomm: лицензия × locations × month period', () => {
    const kp = calculateKP(baseForm({ license_type: 'ecomm', devices: 0, locations: 3, subscription_period: 'month' }))
    const lic = findItem(kp, 'Лицензии и подписки', 'inno Ecomm')!
    expect(lic.qty).toBe(3)
    expect(lic.unitPrice).toBe(15000)
    expect(lic.months).toBe(1)
    expect(lic.total).toBe(45000)
  })

  it('Ecomm: half_year × 2 locations = 6 × 15000 × 2 = 180 000', () => {
    const kp = calculateKP(baseForm({ license_type: 'ecomm', devices: 0, locations: 2, subscription_period: 'half_year' }))
    const lic = findItem(kp, 'Лицензии и подписки', 'inno Ecomm')!
    expect(lic.total).toBe(180000)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// calculateKP — БОНДА (ФинДир, BONDA BI)
// ─────────────────────────────────────────────────────────────────────────

describe('calculateKP — БОНДА ФинДир', () => {
  it('Старт, 1 локация, год: цена 50 000/мес × 12 = 600 000', () => {
    const kp = calculateKP(baseForm({
      company: 'bonda',
      license_type: 'findir',
      findir_tariff: 'Старт',
      locations: 1,
      devices: 0,
      subscription_period: 'year',
    }))
    const lic = findItem(kp, 'Лицензии и подписки', 'ФинДир')!
    expect(lic.unitPrice).toBe(50000)
    expect(lic.months).toBe(12)
    expect(lic.total).toBe(600000)
  })

  it('Про, 10 локаций → ступенька 6-10 = 200 000/мес', () => {
    const kp = calculateKP(baseForm({
      company: 'bonda',
      license_type: 'findir',
      findir_tariff: 'Про',
      locations: 10,
      devices: 0,
      subscription_period: 'month',
    }))
    const lic = findItem(kp, 'Лицензии и подписки', 'ФинДир')!
    expect(lic.unitPrice).toBe(200000)
    expect(lic.total).toBe(200000)
  })

  it('Ультра, 5 локаций → ступенька 3-5 = 210 000/мес', () => {
    const kp = calculateKP(baseForm({
      company: 'bonda',
      license_type: 'findir',
      findir_tariff: 'Ультра',
      locations: 5,
      devices: 0,
      subscription_period: 'month',
    }))
    const lic = findItem(kp, 'Лицензии и подписки', 'ФинДир')!
    expect(lic.unitPrice).toBe(210000)
  })

  it('[H2 fix] Старт, 20 локаций → последняя ступень 270 000 (всё ещё в сетке)', () => {
    const kp = calculateKP(baseForm({
      company: 'bonda',
      license_type: 'findir',
      findir_tariff: 'Старт',
      locations: 20,
      devices: 0,
      subscription_period: 'month',
    }))
    const lic = findItem(kp, 'Лицензии и подписки', 'ФинДир')!
    expect(lic.unitPrice).toBe(270000)
  })

  it('[H2 fix] Старт, 50 локаций → unitPrice=0, name содержит "цена по запросу"', () => {
    // После Phase 8 фикса H2 (2026-05-14): крупная сеть выходит за тарифную
    // сетку, getFindirPrice возвращает null, calculator создаёт строку с
    // unitPrice=0 чтобы менеджер согласовал цену вручную.
    const kp = calculateKP(baseForm({
      company: 'bonda',
      license_type: 'findir',
      findir_tariff: 'Старт',
      locations: 50,
      devices: 0,
      subscription_period: 'month',
    }))
    const lic = findItem(kp, 'Лицензии и подписки', 'ФинДир')!
    expect(lic.unitPrice).toBe(0)
    expect(lic.total).toBe(0)
    expect(lic.name).toContain('цена по запросу')
  })

  it('monthlyTotal для ФинДир = цена тарифа (не × locations × months)', () => {
    const kp = calculateKP(baseForm({
      company: 'bonda',
      license_type: 'findir',
      findir_tariff: 'Старт',
      locations: 1,
      devices: 0,
      subscription_period: 'year',
    }))
    expect(kp.monthlyTotal).toBe(50000)
  })
})

describe('calculateKP — BONDA BI', () => {
  it('5 локаций × год: 30 000 × 5 × 12 = 1 800 000', () => {
    const kp = calculateKP(baseForm({
      company: 'bonda',
      license_type: 'bonda_bi',
      locations: 5,
      devices: 0,
      subscription_period: 'year',
    }))
    const lic = findItem(kp, 'Лицензии и подписки', 'BONDA BI')!
    expect(lic.qty).toBe(5)
    expect(lic.unitPrice).toBe(30000)
    expect(lic.months).toBe(12)
    expect(lic.total).toBe(1800000)
  })

  it('monthlyTotal для BONDA BI = 30 000 × locations', () => {
    const kp = calculateKP(baseForm({
      company: 'bonda',
      license_type: 'bonda_bi',
      locations: 3,
      devices: 0,
      subscription_period: 'half_year',
    }))
    expect(kp.monthlyTotal).toBe(90000)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// calculateKP — Услуги (внедрение, контент)
// ─────────────────────────────────────────────────────────────────────────

describe('calculateKP — Услуги', () => {
  it('Внедрение: 20 000 × locations', () => {
    const kp = calculateKP(baseForm({
      license_type: 'kiosk',
      need_implementation: true,
      locations: 3,
    }))
    const impl = findItem(kp, 'Услуги', 'Внедрение')!
    expect(impl.qty).toBe(3)
    expect(impl.unitPrice).toBe(20000)
    expect(impl.total).toBe(60000)
  })

  it('Внедрение НЕ добавляется при need_implementation=false', () => {
    const kp = calculateKP(baseForm({
      license_type: 'kiosk',
      need_implementation: false,
      content_items: 0,
    }))
    expect(findSection(kp, 'Услуги')).toBeUndefined()
  })

  it('Контент: 1 200 × content_items', () => {
    const kp = calculateKP(baseForm({
      license_type: 'kiosk',
      content_items: 80,
    }))
    const content = findItem(kp, 'Услуги', 'Генерация')!
    expect(content.qty).toBe(80)
    expect(content.unitPrice).toBe(1200)
    expect(content.total).toBe(96000)
  })

  it('Контент НЕ добавляется при content_items=0', () => {
    const kp = calculateKP(baseForm({
      license_type: 'kiosk',
      content_items: 0,
      need_implementation: false,
    }))
    expect(findSection(kp, 'Услуги')).toBeUndefined()
  })

  it('Услуги: оба пункта (внедрение + контент) в одной секции', () => {
    const kp = calculateKP(baseForm({
      license_type: 'kiosk',
      need_implementation: true,
      locations: 1,
      content_items: 50,
    }))
    const svc = findSection(kp, 'Услуги')!
    expect(svc.items.length).toBe(2)
    expect(svc.subtotal).toBe(20000 + 60000)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Edge cases
// ─────────────────────────────────────────────────────────────────────────

describe('calculateKP — edge cases', () => {
  it('devices=0 для Kiosk → секция Оборудование не создаётся', () => {
    const kp = calculateKP(baseForm({ license_type: 'kiosk', devices: 0 }))
    expect(findSection(kp, 'Оборудование')).toBeUndefined()
  })

  it('devices=0 для Kiosk_pro → секция Оборудование не создаётся', () => {
    const kp = calculateKP(baseForm({ license_type: 'kiosk_pro', devices: 0 }))
    expect(findSection(kp, 'Оборудование')).toBeUndefined()
  })

  it('license_type=null → нет секции Лицензии', () => {
    const kp = calculateKP(baseForm({ license_type: null }))
    expect(findSection(kp, 'Лицензии и подписки')).toBeUndefined()
  })

  it('grandTotal = сумма всех subtotals', () => {
    const kp = calculateKP(baseForm({
      license_type: 'kiosk',
      devices: 1,
      need_implementation: true,
      content_items: 50,
    }))
    const expected = kp.sections.reduce((sum, s) => sum + s.subtotal, 0)
    expect(kp.grandTotal).toBe(expected)
  })

  it('grandTotal > 0 для типового КП', () => {
    const kp = calculateKP(baseForm({
      license_type: 'kiosk',
      devices: 1,
      subscription_period: 'year',
    }))
    expect(kp.grandTotal).toBeGreaterThan(0)
  })

  it('paymentType: prepay100 → "100% предоплата"', () => {
    const kp = calculateKP(baseForm({ payment_type: 'prepay100' }))
    expect(kp.paymentType).toContain('100%')
  })

  it('paymentType: installment3 → содержит "Рассрочка"', () => {
    const kp = calculateKP(baseForm({ payment_type: 'installment3' }))
    expect(kp.paymentType).toContain('Рассрочка')
  })

  it('company пробрасывается в KPResult', () => {
    const kp = calculateKP(baseForm({ company: 'bonda', license_type: 'findir', findir_tariff: 'Старт', devices: 0 }))
    expect(kp.company).toBe('bonda')
  })

  it('clientName и notes пробрасываются', () => {
    const kp = calculateKP(baseForm({
      client_name: 'Тест Кафе',
      notes: 'Срочно нужно',
      license_type: 'qr',
      devices: 0,
    }))
    expect(kp.clientName).toBe('Тест Кафе')
    expect(kp.notes).toBe('Срочно нужно')
  })

  it('пустой license_type без услуг и оборудования → пустая sections, grandTotal=0', () => {
    const kp = calculateKP(baseForm({ license_type: null, devices: 0, content_items: 0, need_implementation: false }))
    expect(kp.sections.length).toBe(0)
    expect(kp.grandTotal).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Семантика месяцев у подписочных строк (Phase 3)
// ─────────────────────────────────────────────────────────────────────────

describe('calculateKP — LineItem.months для всех подписок', () => {
  type PeriodCase = { period: 'month' | 'quarter' | 'half_year' | 'year'; months: number }
  const periodCases: PeriodCase[] = [
    { period: 'month', months: 1 },
    { period: 'quarter', months: 3 },
    { period: 'half_year', months: 6 },
    { period: 'year', months: 12 },
  ]
  it.each(periodCases)('inno Kiosk × $period → months=$months', ({ period, months }: PeriodCase) => {
    const kp = calculateKP(baseForm({ license_type: 'kiosk', devices: 1, subscription_period: period }))
    const lic = findItem(kp, 'Лицензии и подписки', 'inno Kiosk')!
    expect(lic.months).toBe(months)
  })

  it('ФинДир: months проставлен', () => {
    const kp = calculateKP(baseForm({
      company: 'bonda', license_type: 'findir', findir_tariff: 'Старт',
      devices: 0, locations: 1, subscription_period: 'half_year',
    }))
    const lic = findItem(kp, 'Лицензии и подписки', 'ФинДир')!
    expect(lic.months).toBe(6)
  })

  it('BONDA BI: months проставлен', () => {
    const kp = calculateKP(baseForm({
      company: 'bonda', license_type: 'bonda_bi',
      devices: 0, locations: 2, subscription_period: 'quarter',
    }))
    const lic = findItem(kp, 'Лицензии и подписки', 'BONDA BI')!
    expect(lic.months).toBe(3)
  })

  it('строки оборудования НЕ имеют months (или months=undefined)', () => {
    const kp = calculateKP(baseForm({ license_type: 'kiosk', devices: 1 }))
    const equip = findSection(kp, 'Оборудование')!
    for (const item of equip.items) {
      expect(item.months).toBeUndefined()
    }
  })

  it('строки услуг НЕ имеют months', () => {
    const kp = calculateKP(baseForm({
      license_type: 'kiosk', need_implementation: true, content_items: 10,
    }))
    const svc = findSection(kp, 'Услуги')!
    for (const item of svc.items) {
      expect(item.months).toBeUndefined()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Pre-Phase-8 baseline: фиксация известных багов H1/H3 для регрессии
// ─────────────────────────────────────────────────────────────────────────

describe('calculateKP — все позиции оборудования × devices (каждый планшет = свой комплект)', () => {
  it('хаб LAN и крепление пинпада тоже × devices, не × locations', () => {
    // Каждый планшет — самостоятельная киоск-станция со своим хабом и
    // своим креплением эквайринга. Они НЕ общие на локацию.
    const kp = calculateKP(baseForm({ license_type: 'kiosk', devices: 3, locations: 1 }))
    const hub = findItem(kp, 'Оборудование', 'Сетевой хаб')!
    const pinpad = findItem(kp, 'Оборудование', 'Крепление для терминала')!
    expect(hub.qty).toBe(3)
    expect(hub.total).toBe(3900 * 3)
    expect(pinpad.qty).toBe(3)
    expect(pinpad.total).toBe(2500 * 3)
  })

  it('1 устройство × 1 локация — всё × 1', () => {
    const kp = calculateKP(baseForm({ license_type: 'kiosk', devices: 1, locations: 1 }))
    const equip = findSection(kp, 'Оборудование')!
    expect(equip.items.every(i => i.qty === 1)).toBe(true)
    expect(equip.subtotal).toBe(88200)
  })
})
