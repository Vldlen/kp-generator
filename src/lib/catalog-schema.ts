// ============================================================
// Новая схема каталога киосков (feature/kiosk-catalog-redesign)
// ------------------------------------------------------------
// Единый источник правды — Google Sheets с двумя вкладками:
//   • «Номенклатура»    — одна строка на SKU/компонент (модель, крепление,
//                          опция, фискальное устройство).
//   • «Правила семейств» — ~12 строк: клиентское имя, форм-фактор,
//                          фискальный паттерн, дефолт-процессор.
//
// Этот модуль ЧИСТЫЙ (без React/fetch): типы + парсинг + деривация.
// Форма, калькулятор и превью читают отсюда — никаких догадок по подстрокам
// в названии и никакого хардкода цен. Спека: docs/catalog-redesign/SPEC.md
// ============================================================

export type SkuType = 'модель' | 'крепление' | 'опция' | 'фискал'
export type Obligation = 'в комплекте' | 'обязательная' | 'опция'
export type FormFactor = 'настольный' | 'настенный' | 'напольный'
// внешний   — POScenter-02Ф + ФН рядом с киоском
// внутренний — Атол 42 ФА (казначей) + ФН внутрь киоска
// встроенный — ФР (Ритейл Комбо-01Ф = принтер+ФР) уже в составе киоска: в КП
//              строкой «в составе» 0 ₽ + добавляется только ФН (напр. K320)
// нет        — фискализация не требуется
export type FiscalPattern = 'внешний' | 'внутренний' | 'встроенный' | 'нет'

/** Одна строка «Номенклатуры». */
export interface CatalogItem {
  id: string                // детерминированный ключ (для чекбоксов/замены), из содержимого строки
  family: string            // нормализованный ключ семейства ('' — глобальное, напр. фискалка)
  familyRaw: string         // как в таблице (для отображения/дебага)
  type: SkuType
  name: string              // внутреннее имя (с брендом) — видит только менеджер
  processor: string | null  // ось комплектации
  scanner: 'в корпусе' | 'нет' | null  // ось комплектации (заводской сканер)
  variant: string | null    // Исполнение (цвет/тир корпуса)
  obligation: Obligation | null
  exclusiveGroup: string | null  // ключ radio-группы взаимоисключения (напр. 'принтер')
  costPrice: number
  sellPrice: number
  supplier: string | null
}

/** Одна строка «Правил семейств». */
export interface FamilyRule {
  family: string            // нормализованный ключ
  familyRaw: string
  kpName: string            // клиентское имя (шаблон)
  diagonal: string
  formFactor: FormFactor
  fiscalPattern: FiscalPattern
  builtinPrinter: '80мм' | '58мм' | null
  defaultProcessor: string | null
  photo: string | null      // URL фото семейства (колонка «Фото»)
}

// ---------- Парсинг цен (русская локаль) ----------
//
// Живая таблица хранит «р.126 840» / «126 840» / «1 200». Запятая, пробел и
// символ рубля — разделители тысяч. Точку оставляем как опциональный decimal
// (копейки). Логика унаследована из page.tsx (фикс H3: не превращать «1,200»
// в 1.2).
export function parsePrice(val: unknown): number {
  if (typeof val === 'number') return val
  const cleaned = String(val ?? '').replace(/[р₽руб.\s,]/gi, '')
  const num = Number(cleaned)
  return isNaN(num) ? 0 : num
}

/** Нормализация ключа семейства: регистр + схлопывание пробелов + trim.
 *  Убирает класс багов «Киоск Sam4s Astra·» (хвостовой пробел) и
 *  «Киоск··SuperKiosk R-156» (двойной пробел), из-за которых строгое
 *  сравнение group рвало связь модель↔опции. */
export function normalizeFamily(s: unknown): string {
  return String(s ?? '').toLowerCase().trim().replace(/\s+/g, ' ')
}

// ---------- Алиасы колонок (RU/EN, устойчивы к переименованиям) ----------
function pick(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k]
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim()
  }
  return ''
}

// ---------- Парсинг строк ----------

const SKU_TYPES: SkuType[] = ['модель', 'крепление', 'опция', 'фискал']
const OBLIGATIONS: Obligation[] = ['в комплекте', 'обязательная', 'опция']
const FORM_FACTORS: FormFactor[] = ['настольный', 'настенный', 'напольный']
const FISCAL_PATTERNS: FiscalPattern[] = ['внешний', 'внутренний', 'встроенный', 'нет']

/** true, если строка выглядит как новая схема (есть колонка «Тип»). */
export function isNewSchemaRow(row: Record<string, unknown>): boolean {
  const t = pick(row, 'Тип', 'type', 'Type').toLowerCase()
  return SKU_TYPES.includes(t as SkuType)
}

export function parseNomenclatureRow(row: Record<string, unknown>): CatalogItem | null {
  const name = pick(row, 'Наименование', 'Название', 'name', 'Name')
  const typeRaw = pick(row, 'Тип', 'type', 'Type').toLowerCase()
  if (!name || !SKU_TYPES.includes(typeRaw as SkuType)) return null

  const familyRaw = pick(row, 'Семейство', 'Группа', 'family', 'group')
  const scannerRaw = pick(row, 'Сканер', 'scanner').toLowerCase()
  const obligationRaw = pick(row, 'Обязательность', 'obligation').toLowerCase()
  const processor = pick(row, 'Процессор', 'processor') || null
  const scanner = scannerRaw === 'в корпусе' ? 'в корпусе' : scannerRaw === 'нет' ? 'нет' : null
  const variant = pick(row, 'Исполнение', 'variant', 'Цвет') || null

  return {
    // Детерминированный id из содержимого — стабилен между перезагрузками
    // (Math.random/индекс нельзя: id используются как ключи выбора в форме).
    id: [normalizeFamily(familyRaw), typeRaw, name, processor ?? '', scanner ?? '', variant ?? ''].join('|'),
    family: normalizeFamily(familyRaw),
    familyRaw,
    type: typeRaw as SkuType,
    name,
    processor,
    scanner: scanner as CatalogItem['scanner'],
    variant,
    obligation: OBLIGATIONS.includes(obligationRaw as Obligation) ? (obligationRaw as Obligation) : null,
    exclusiveGroup: pick(row, 'Взаимоисключение', 'exclusive') || null,
    costPrice: parsePrice(pick(row, 'Себестоимость', 'Закупочная', 'cost_price')),
    sellPrice: parsePrice(pick(row, 'Цена', 'Продажная', 'sell_price')),
    supplier: pick(row, 'Поставщик', 'supplier') || null,
  }
}

function normFormFactor(s: string): FormFactor {
  const v = s.toLowerCase()
  return (FORM_FACTORS.find(f => v.includes(f)) ?? 'настольный')
}
function normFiscalPattern(s: string): FiscalPattern {
  const v = s.toLowerCase()
  return (FISCAL_PATTERNS.find(f => v === f) ?? 'нет')
}

export function parseFamilyRow(row: Record<string, unknown>): FamilyRule | null {
  const familyRaw = pick(row, 'Семейство', 'family')
  if (!familyRaw) return null
  const printerRaw = pick(row, 'Встроенный принтер', 'builtin_printer')
  return {
    family: normalizeFamily(familyRaw),
    familyRaw,
    kpName: pick(row, 'Имя для КП', 'kp_name', 'КП'),
    diagonal: pick(row, 'Диагональ', 'diagonal'),
    formFactor: normFormFactor(pick(row, 'Форм-фактор', 'form_factor')),
    fiscalPattern: normFiscalPattern(pick(row, 'Фиск. паттерн', 'Фискальный паттерн', 'fiscal_pattern')),
    builtinPrinter: printerRaw.includes('80') ? '80мм' : printerRaw.includes('58') ? '58мм' : null,
    defaultProcessor: pick(row, 'Процессор по умолчанию', 'Процессор по умолч.', 'default_processor') || null,
    photo: pick(row, 'Фото', 'photo', 'image') || null,
  }
}

// ---------- Сборка каталога ----------

export interface Catalog {
  items: CatalogItem[]
  families: FamilyRule[]
  familyByKey: Map<string, FamilyRule>
}

export function buildCatalog(
  nomRows: Record<string, unknown>[],
  famRows: Record<string, unknown>[],
): Catalog {
  const items = nomRows.map(parseNomenclatureRow).filter((x): x is CatalogItem => x !== null)
  const families = famRows.map(parseFamilyRow).filter((x): x is FamilyRule => x !== null)
  const familyByKey = new Map(families.map(f => [f.family, f]))
  return { items, families, familyByKey }
}

// ============================================================
//  Деривация для формы / калькулятора
// ============================================================

/** Модели семейства (Тип=модель). */
export function familyModels(cat: Catalog, familyKey: string): CatalogItem[] {
  return cat.items.filter(i => i.type === 'модель' && i.family === familyKey)
}

/** Оси комплектации семейства — различные значения по каждой оси, в порядке
 *  появления. Форма рисует переключатель только там, где вариантов >1. */
export interface Axes {
  processor: string[]
  scanner: string[]   // 'нет' | 'в корпусе'
  variant: string[]
}
export function familyAxes(models: CatalogItem[]): Axes {
  const uniq = (vals: (string | null)[]) =>
    vals.filter((v): v is string => !!v).filter((v, i, a) => a.indexOf(v) === i)
  return {
    processor: uniq(models.map(m => m.processor)),
    scanner: uniq(models.map(m => m.scanner)),
    variant: uniq(models.map(m => m.variant)),
  }
}

export interface Selection {
  processor?: string | null
  scanner?: string | null
  variant?: string | null
}

/** Дефолтный выбор комплектации: дефолт-процессор из правил (или первый),
 *  сканер «нет» (или первый), первое исполнение. */
export function defaultSelection(models: CatalogItem[], rule?: FamilyRule): Selection {
  const axes = familyAxes(models)
  const processor = rule?.defaultProcessor && axes.processor.includes(rule.defaultProcessor)
    ? rule.defaultProcessor
    : axes.processor[0] ?? null
  return {
    processor,
    scanner: axes.scanner.includes('нет') ? 'нет' : axes.scanner[0] ?? null,
    variant: axes.variant[0] ?? null,
  }
}

/** Резолв выбранной комплектации в конкретную строку-модель.
 *  Ось игнорируется, если у семейства её нет (у модели значение null). */
export function resolveModel(models: CatalogItem[], sel: Selection): CatalogItem | null {
  const match = models.find(m =>
    (m.processor == null || sel.processor == null || m.processor === sel.processor) &&
    (m.scanner   == null || sel.scanner   == null || m.scanner   === sel.scanner) &&
    (m.variant   == null || sel.variant   == null || m.variant   === sel.variant),
  )
  return match ?? models[0] ?? null
}

/** Крепления и опции семейства, сгруппированные по обязательности. */
export interface FamilyOptions {
  included: CatalogItem[]    // в комплекте (показать, не снять, цена 0)
  mandatory: CatalogItem[]   // обязательная (по умолчанию отмечена)
  optional: CatalogItem[]    // опция (по умолчанию не отмечена)
}
export function familyOptions(cat: Catalog, familyKey: string): FamilyOptions {
  const own = cat.items.filter(i =>
    (i.type === 'крепление' || i.type === 'опция') && i.family === familyKey)
  return {
    included:  own.filter(i => i.obligation === 'в комплекте'),
    mandatory: own.filter(i => i.obligation === 'обязательная'),
    optional:  own.filter(i => i.obligation === 'опция'),
  }
}

// ---------- Фискальный пакет по паттерну ----------

const FISCAL_MATCH = {
  poscenter02f: (n: string) => /poscenter[-\s]*02/i.test(n),
  atol42fa:     (n: string) => /атол\s*42/i.test(n) || /казначей/i.test(n),
  kombo:        (n: string) => /комбо/i.test(n),
  fn15:         (n: string) => /фн\s*15/i.test(n) || /накопитель/i.test(n),
}

/** Фискальные позиции по паттерну семейства. Цены И ИМЕНА — из строк Тип=фискал
 *  «Номенклатуры» (не хардкод). Имена РЕАЛЬНЫЕ (не обезличенные): для фискального
 *  оборудования это осознанная политика — юридическая прозрачность клиенту
 *  (ККТ/ФН регистрируются в ФНС). Модели киосков при этом обезличиваются.
 *  Принтер к МС 24/32 идёт отдельной ОБЯЗАТЕЛЬНОЙ опцией, здесь не дублируется. */
export function fiscalLines(
  rule: FamilyRule | undefined,
  cat: Catalog,
): { name: string; price: number; cost: number }[] {
  if (!rule || rule.fiscalPattern === 'нет') return []
  const fiscalItems = cat.items.filter(i => i.type === 'фискал')
  const find = (pred: (n: string) => boolean) => fiscalItems.find(i => pred(i.name))

  const out: { name: string; price: number; cost: number }[] = []
  if (rule.fiscalPattern === 'встроенный') {
    // ФР (Ритейл Комбо-01Ф) уже в составе киоска — строкой «в составе» 0 ₽,
    // чтобы клиент видел ККТ (юр. прозрачность), но не платил дважды.
    const kombo = find(FISCAL_MATCH.kombo)
    if (kombo) out.push({ name: kombo.name, price: kombo.sellPrice, cost: kombo.costPrice })
  } else {
    const fr = rule.fiscalPattern === 'внешний' ? find(FISCAL_MATCH.poscenter02f)
      : rule.fiscalPattern === 'внутренний' ? find(FISCAL_MATCH.atol42fa)
      : undefined
    if (fr && fr.sellPrice > 0) out.push({ name: fr.name, price: fr.sellPrice, cost: fr.costPrice })
  }
  const fn = find(FISCAL_MATCH.fn15)
  if (fn && fn.sellPrice > 0) out.push({ name: fn.name, price: fn.sellPrice, cost: fn.costPrice })
  return out
}

// ---------- Обезличивание имён для КП ----------

/** Клиентское имя позиции. Модель → обезличенное имя из правил семейства;
 *  фискалка → РЕАЛЬНОЕ имя (юридическая прозрачность, ККТ/ФН в ФНС);
 *  опции/крепления уже безбрендовые — как есть. */
export function clientName(item: CatalogItem, rule?: FamilyRule): string {
  if (item.type === 'модель') return rule?.kpName || item.name
  return item.name
}

// ---------- Витрина семейств для карточек формы ----------

export interface FamilyCard {
  rule: FamilyRule
  fromPrice: number         // минимальная цена модели — «от N ₽»
  modelCount: number
  photo: string | null
}
export function familyCards(cat: Catalog): FamilyCard[] {
  return cat.families
    .map(rule => {
      const models = familyModels(cat, rule.family)
      if (models.length === 0) return null
      return {
        rule,
        fromPrice: Math.min(...models.map(m => m.sellPrice)),
        modelCount: models.length,
        photo: rule.photo,
      }
    })
    .filter((x): x is FamilyCard => x !== null)
}

// ============================================================
//  Сборка комплекта киоска (Kiosk PRO) — единая точка для формы и калькулятора
// ============================================================

/** Разрешает опции с учётом взаимоисключения (radio-группы `Взаимоисключение`).
 *  Правила: одиночные обязательные — всегда; одиночные опции — если выбраны;
 *  в группе взаимоисключения — выбранная, иначе обязательная-по-умолчанию. */
export function resolveChosenOptions(
  opts: FamilyOptions,
  selectedIds: ReadonlySet<string>,
): CatalogItem[] {
  const own = [...opts.mandatory, ...opts.optional]
  const groups = new Map<string, CatalogItem[]>()
  const singles: CatalogItem[] = []
  for (const o of own) {
    if (o.exclusiveGroup) {
      const g = groups.get(o.exclusiveGroup) ?? []
      g.push(o); groups.set(o.exclusiveGroup, g)
    } else singles.push(o)
  }
  const chosen: CatalogItem[] = []
  for (const o of singles) {
    if (o.obligation === 'обязательная' || selectedIds.has(o.id)) chosen.push(o)
  }
  for (const groupItems of Array.from(groups.values())) {
    const picked = groupItems.find((o: CatalogItem) => selectedIds.has(o.id))
      ?? groupItems.find((o: CatalogItem) => o.obligation === 'обязательная')
      ?? null
    if (picked) chosen.push(picked)
  }
  return chosen
}

/** Нейтральная строка комплекта (маппится в LineItem в калькуляторе). */
export interface EquipLine {
  name: string       // клиентское (обезличенное) имя
  category: string   // kiosk | mount | kiosk_option | fiscal
  qty: number
  unitPrice: number
  cost?: number      // себестоимость за единицу — для маржи менеджера (не в .pptx)
}

/** Полный комплект Kiosk PRO: модель (по комплектации) + опции (обязательные и
 *  выбранные, с взаимоисключением) + фискалка (если включена и паттерн ≠ «нет»).
 *  Все цены — из каталога, имена — обезличенные. «В комплекте» опции в строки
 *  НЕ попадают (они уже в цене модели). Всё × qty. */
export function buildKioskEquipment(
  cat: Catalog,
  familyKey: string,
  selection: Selection,
  selectedOptionIds: ReadonlySet<string>,
  fiscalOn: boolean,
  qty: number,
): EquipLine[] {
  if (qty <= 0) return []
  const rule = cat.familyByKey.get(familyKey)
  const models = familyModels(cat, familyKey)
  const lines: EquipLine[] = []

  const model = resolveModel(models, selection)
  if (model) {
    lines.push({ name: clientName(model, rule), category: 'kiosk', qty, unitPrice: model.sellPrice, cost: model.costPrice })
  }

  for (const o of resolveChosenOptions(familyOptions(cat, familyKey), selectedOptionIds)) {
    if (o.sellPrice <= 0) continue  // «в комплекте» и нулевые — не отдельной строкой
    lines.push({
      name: clientName(o, rule),
      category: o.type === 'крепление' ? 'mount' : 'kiosk_option',
      qty, unitPrice: o.sellPrice, cost: o.costPrice,
    })
  }

  if (fiscalOn) {
    for (const f of fiscalLines(rule, cat)) {
      lines.push({ name: f.name, category: 'fiscal', qty, unitPrice: f.price, cost: f.cost })
    }
  }
  return lines
}
