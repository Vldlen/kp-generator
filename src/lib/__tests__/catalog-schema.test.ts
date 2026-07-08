import { describe, it, expect } from 'vitest'
import {
  parsePrice, normalizeFamily, isNewSchemaRow,
  buildCatalog, familyModels, familyAxes, defaultSelection, resolveModel,
  familyOptions, fiscalLines, clientName, familyCards,
  resolveChosenOptions, buildKioskEquipment,
  type Catalog,
} from '../catalog-schema'

// Фикстуры — подмножество мигрированных данных (docs/catalog-redesign/*.csv),
// покрывающее ключевые кейсы. Заголовки — как в живой таблице.
const NOM = [
  // МС 21 N: 2 оси (процессор × сканер) → 4 SKU
  { 'Семейство': 'Касса МС 21 N', 'Тип': 'модель', 'Наименование': 'Касса самообслуживания МС 21 N', 'Процессор': 'N100', 'Сканер': 'нет', 'Цена': 'р.115 248' },
  { 'Семейство': 'Касса МС 21 N', 'Тип': 'модель', 'Наименование': 'Касса самообслуживания МС 21 N', 'Процессор': 'N100', 'Сканер': 'в корпусе', 'Цена': 'р.139 327' },
  { 'Семейство': 'Касса МС 21 N', 'Тип': 'модель', 'Наименование': 'Касса самообслуживания МС 21 N', 'Процессор': 'i3', 'Сканер': 'нет', 'Цена': 'р.120 246' },
  { 'Семейство': 'Касса МС 21 N', 'Тип': 'модель', 'Наименование': 'Касса самообслуживания МС 21 N', 'Процессор': 'i3', 'Сканер': 'в корпусе', 'Цена': 'р.144 325' },
  // МС 24: модель + обязательный принтер 80 + опции (принтер 58 взаимоискл, сканер)
  { 'Семейство': 'Киоск самообслуживания МС 24', 'Тип': 'модель', 'Наименование': 'Киоск самообслуживания МС 24', 'Процессор': 'N100', 'Цена': '180768' },
  { 'Семейство': 'Киоск самообслуживания МС 24', 'Тип': 'модель', 'Наименование': 'Киоск самообслуживания МС 24', 'Процессор': 'i3', 'Цена': '186480' },
  { 'Семейство': 'Киоск самообслуживания МС 24', 'Тип': 'опция', 'Наименование': 'Принтер чеков 80мм', 'Обязательность': 'обязательная', 'Взаимоисключение': 'принтер', 'Цена': '20026' },
  { 'Семейство': 'Киоск самообслуживания МС 24', 'Тип': 'опция', 'Наименование': 'Принтер чеков 58мм', 'Обязательность': 'опция', 'Взаимоисключение': 'принтер', 'Цена': '14515' },
  { 'Семейство': 'Киоск самообслуживания МС 24', 'Тип': 'опция', 'Наименование': 'Сканер 1D/2D кодов', 'Обязательность': 'опция', 'Цена': '13608' },
  // T-215: сканер «в корпусе» как включённая опция (не ось)
  { 'Семейство': 'Киоск SuperKIOSK T-215', 'Тип': 'модель', 'Наименование': 'Киоск SuperKIOSK T-215 21.5″ N97', 'Процессор': 'N97', 'Цена': '131776' },
  { 'Семейство': 'Киоск SuperKIOSK T-215', 'Тип': 'опция', 'Наименование': 'Сканер ШК + принтер (в корпусе)', 'Обязательность': 'в комплекте', 'Цена': '0' },
  // K320: паттерн «нет» (A1 — Комбо-01Ф уже фискальный). Хвостовой пробел в семействе намеренно.
  { 'Семейство': 'POScenter K ', 'Тип': 'модель', 'Наименование': 'POScenter K320', 'Процессор': 'i5', 'Цена': '327600' },
  // Глобальная фискалка
  { 'Семейство': '', 'Тип': 'фискал', 'Наименование': 'ККТ «POScenter-02Ф» Cover', 'Цена': '38250' },
  { 'Семейство': '', 'Тип': 'фискал', 'Наименование': 'ККТ «Атол 42 ФА»', 'Цена': '33230' },
  { 'Семейство': '', 'Тип': 'фискал', 'Наименование': 'ККТ «Ритейл Комбо-01Ф» (в составе киоска)', 'Цена': '0' },
  { 'Семейство': '', 'Тип': 'фискал', 'Наименование': 'Фискальный накопитель ФН 15', 'Цена': '20832' },
]

const FAM = [
  { 'Семейство': 'Касса МС 21 N', 'Имя для КП': 'Касса самообслуживания 21.5″', 'Диагональ': '21.5″', 'Форм-фактор': 'настольный', 'Фиск. паттерн': 'внешний', 'Процессор по умолчанию': 'N100' },
  { 'Семейство': 'Киоск самообслуживания МС 24', 'Имя для КП': 'Киоск самообслуживания 24″ (напольный)', 'Диагональ': '23.8″', 'Форм-фактор': 'напольный', 'Фиск. паттерн': 'внутренний', 'Встроенный принтер': '80мм', 'Процессор по умолчанию': 'N100' },
  { 'Семейство': 'Киоск SuperKIOSK T-215', 'Имя для КП': 'Киоск самообслуживания 21.5″', 'Диагональ': '21.5″', 'Форм-фактор': 'настольный', 'Фиск. паттерн': 'внутренний', 'Процессор по умолчанию': 'N97' },
  { 'Семейство': 'POScenter K', 'Имя для КП': 'Киоск самообслуживания 32″', 'Диагональ': '32″', 'Форм-фактор': 'напольный', 'Фиск. паттерн': 'встроенный', 'Процессор по умолчанию': 'i5' },
]

const cat: Catalog = buildCatalog(NOM, FAM)
const key = (s: string) => normalizeFamily(s)

describe('parsePrice — русская локаль', () => {
  it('«р.115 248» → 115248 (пробел = разделитель тысяч)', () => {
    expect(parsePrice('р.115 248')).toBe(115248)
  })
  it('«1 200» → 1200, не 1.2', () => {
    expect(parsePrice('1 200')).toBe(1200)
    expect(parsePrice('1,200')).toBe(1200)
  })
  it('пустое/мусор → 0', () => {
    expect(parsePrice('')).toBe(0)
    expect(parsePrice('по запросу')).toBe(0)
    expect(parsePrice(50000)).toBe(50000)
  })
})

describe('normalizeFamily — устойчивость к пробелам/регистру', () => {
  it('хвостовой и двойной пробел схлопываются', () => {
    expect(normalizeFamily('POScenter K ')).toBe('poscenter k')
    expect(normalizeFamily('Киоск  SuperKiosk R-156')).toBe('киоск superkiosk r-156')
    expect(normalizeFamily('Киоск  SuperKiosk R-156')).toBe(normalizeFamily('киоск superkiosk r-156'))
  })
})

describe('isNewSchemaRow', () => {
  it('строка с «Тип» — новая схема; без — старая', () => {
    expect(isNewSchemaRow(NOM[0])).toBe(true)
    expect(isNewSchemaRow({ 'Наименование': 'Планшет', 'Цена': '35000' })).toBe(false)
  })
})

describe('buildCatalog', () => {
  it('парсит модели, опции, фискалку и семейства', () => {
    expect(cat.items.filter(i => i.type === 'модель').length).toBe(8)
    expect(cat.items.filter(i => i.type === 'фискал').length).toBe(4)
    expect(cat.families.length).toBe(4)
  })
})

describe('familyAxes + resolveModel — комплектация → SKU', () => {
  const mc21 = familyModels(cat, key('Касса МС 21 N'))
  it('МС 21 N: две оси — процессор {N100,i3} и сканер {нет,в корпусе}', () => {
    const axes = familyAxes(mc21)
    expect(axes.processor).toEqual(['N100', 'i3'])
    expect(axes.scanner).toEqual(['нет', 'в корпусе'])
  })
  it('N100 + в корпусе → 139 327 ₽', () => {
    const m = resolveModel(mc21, { processor: 'N100', scanner: 'в корпусе' })
    expect(m?.sellPrice).toBe(139327)
  })
  it('i3 + нет → 120 246 ₽', () => {
    const m = resolveModel(mc21, { processor: 'i3', scanner: 'нет' })
    expect(m?.sellPrice).toBe(120246)
  })
  it('дефолт-выбор: N100 (из правил) + сканер нет → 115 248 ₽', () => {
    const rule = cat.familyByKey.get(key('Касса МС 21 N'))
    const sel = defaultSelection(mc21, rule)
    expect(sel.processor).toBe('N100')
    expect(sel.scanner).toBe('нет')
    expect(resolveModel(mc21, sel)?.sellPrice).toBe(115248)
  })
  it('МС 24: одна ось (процессор), сканера-оси нет', () => {
    const mc24 = familyModels(cat, key('Киоск самообслуживания МС 24'))
    expect(familyAxes(mc24).scanner).toEqual([])
    expect(familyAxes(mc24).processor).toEqual(['N100', 'i3'])
  })
})

describe('familyOptions — обязательность', () => {
  it('МС 24: принтер 80 обязателен, принтер 58 и сканер — опции', () => {
    const opts = familyOptions(cat, key('Киоск самообслуживания МС 24'))
    expect(opts.mandatory.map(o => o.name)).toEqual(['Принтер чеков 80мм'])
    expect(opts.optional.map(o => o.name)).toContain('Принтер чеков 58мм')
    expect(opts.optional.map(o => o.name)).toContain('Сканер 1D/2D кодов')
  })
  it('принтеры 80 и 58 — одна radio-группа (взаимоисключение)', () => {
    const opts = familyOptions(cat, key('Киоск самообслуживания МС 24'))
    const p80 = opts.mandatory[0]
    const p58 = opts.optional.find(o => o.name.includes('58'))
    expect(p80.exclusiveGroup).toBe('принтер')
    expect(p58?.exclusiveGroup).toBe('принтер')
  })
  it('T-215: сканер+принтер «в комплекте», отдельной опцией не платится', () => {
    const opts = familyOptions(cat, key('Киоск SuperKIOSK T-215'))
    expect(opts.included.length).toBe(1)
    expect(opts.included[0].sellPrice).toBe(0)
    expect(opts.optional.length).toBe(0)
  })
})

describe('fiscalLines — по паттерну, цены из каталога', () => {
  it('внешний (МС 21) → POScenter-02Ф 38 250 + ФН 20 832 (реальные имена)', () => {
    const rule = cat.familyByKey.get(key('Касса МС 21 N'))
    const f = fiscalLines(rule, cat)
    expect(f).toEqual([
      { name: 'ККТ «POScenter-02Ф» Cover', price: 38250 },
      { name: 'Фискальный накопитель ФН 15', price: 20832 },
    ])
  })
  it('внутренний (МС 24) → Атол 33 230 + ФН 20 832', () => {
    const rule = cat.familyByKey.get(key('Киоск самообслуживания МС 24'))
    const f = fiscalLines(rule, cat)
    expect(f[0].price).toBe(33230)
    expect(f[1].price).toBe(20832)
  })
  it('K320 паттерн «встроенный» → Комбо (в составе, 0 ₽) + ФН, без Атол/принтера', () => {
    const rule = cat.familyByKey.get(key('POScenter K'))
    expect(rule?.fiscalPattern).toBe('встроенный')
    expect(fiscalLines(rule, cat)).toEqual([
      { name: 'ККТ «Ритейл Комбо-01Ф» (в составе киоска)', price: 0 },
      { name: 'Фискальный накопитель ФН 15', price: 20832 },
    ])
  })
})

describe('clientName — обезличивание', () => {
  it('модель → имя из правил (без бренда)', () => {
    const model = familyModels(cat, key('Касса МС 21 N'))[0]
    const rule = cat.familyByKey.get(key('Касса МС 21 N'))
    expect(clientName(model, rule)).toBe('Касса самообслуживания 21.5″')
    expect(clientName(model, rule)).not.toContain('МС')
  })
  it('фискалка → реальное имя (юр. прозрачность, не обезличивается)', () => {
    const fr = cat.items.find(i => /poscenter-02/i.test(i.name))!
    const fn = cat.items.find(i => /фн 15/i.test(i.name))!
    expect(clientName(fr)).toBe('ККТ «POScenter-02Ф» Cover')
    expect(clientName(fn)).toBe('Фискальный накопитель ФН 15')
  })
})

describe('familyCards — витрина для формы', () => {
  it('карточка на семейство с «от N ₽» и числом моделей', () => {
    const cards = familyCards(cat)
    expect(cards.length).toBe(4)
    const mc21 = cards.find(c => c.rule.family === key('Касса МС 21 N'))!
    expect(mc21.fromPrice).toBe(115248)   // минимальная из 4 SKU
    expect(mc21.modelCount).toBe(4)
  })
  it('K320 матчится по семейству несмотря на хвостовой пробел в номенклатуре', () => {
    // строка модели: «POScenter K », правило: «POScenter K» → нормализация связывает
    const cards = familyCards(cat)
    expect(cards.some(c => c.rule.family === key('POScenter K'))).toBe(true)
  })
})

describe('resolveChosenOptions — взаимоисключение', () => {
  const mc24 = key('Киоск самообслуживания МС 24')
  const opts = familyOptions(cat, mc24)
  it('ничего не выбрано → обязательный принтер 80 (дефолт группы)', () => {
    const chosen = resolveChosenOptions(opts, new Set())
    expect(chosen.map(o => o.name)).toEqual(['Принтер чеков 80мм'])
  })
  it('выбран принтер 58 → заменяет 80 (одна radio-группа)', () => {
    const p58 = opts.optional.find(o => o.name.includes('58'))!
    const chosen = resolveChosenOptions(opts, new Set([p58.id]))
    expect(chosen.map(o => o.name)).toEqual(['Принтер чеков 58мм'])
  })
  it('выбран сканер → добавляется поверх обязательного принтера', () => {
    const scan = opts.optional.find(o => o.name.includes('Сканер'))!
    const chosen = resolveChosenOptions(opts, new Set([scan.id]))
    expect(chosen.map(o => o.name).sort()).toEqual(['Принтер чеков 80мм', 'Сканер 1D/2D кодов'])
  })
})

describe('buildKioskEquipment — полный комплект', () => {
  const mc24 = key('Киоск самообслуживания МС 24')
  it('МС 24 N100 + фискалка: модель (обезличена) + принтер80 + Атол + ФН (реальные)', () => {
    const lines = buildKioskEquipment(cat, mc24, { processor: 'N100' }, new Set(), true, 1)
    expect(lines).toEqual([
      { name: 'Киоск самообслуживания 24″ (напольный)', category: 'kiosk', qty: 1, unitPrice: 180768 },
      { name: 'Принтер чеков 80мм', category: 'kiosk_option', qty: 1, unitPrice: 20026 },
      { name: 'ККТ «Атол 42 ФА»', category: 'fiscal', qty: 1, unitPrice: 33230 },
      { name: 'Фискальный накопитель ФН 15', category: 'fiscal', qty: 1, unitPrice: 20832 },
    ])
    // модель киоска — без бренда (МС/POScenter/Sam4s)
    const model = lines[0]
    expect(/мс|poscenter|sam4s|superkiosk/i.test(model.name)).toBe(false)
  })
  it('qty масштабирует все строки', () => {
    const lines = buildKioskEquipment(cat, mc24, { processor: 'i3' }, new Set(), false, 3)
    expect(lines[0]).toEqual({ name: 'Киоск самообслуживания 24″ (напольный)', category: 'kiosk', qty: 3, unitPrice: 186480 })
    expect(lines.every(l => l.qty === 3)).toBe(true)
  })
  it('T-215: сканер «в комплекте» (0 ₽) в строки не попадает', () => {
    const lines = buildKioskEquipment(cat, key('Киоск SuperKIOSK T-215'), { processor: 'N97' }, new Set(), true, 1)
    expect(lines.map(l => l.category)).toEqual(['kiosk', 'fiscal', 'fiscal'])  // модель + Атол + ФН, без 0-строки
  })
  it('K320: модель + Комбо (в составе, 0 ₽) + ФН', () => {
    const lines = buildKioskEquipment(cat, key('POScenter K'), { processor: 'i5' }, new Set(), true, 1)
    expect(lines.map(l => l.category)).toEqual(['kiosk', 'fiscal', 'fiscal'])
    expect(lines[0].unitPrice).toBe(327600)
    expect(lines[1]).toMatchObject({ name: 'ККТ «Ритейл Комбо-01Ф» (в составе киоска)', unitPrice: 0 })
    expect(lines[2].unitPrice).toBe(20832)
  })
})
