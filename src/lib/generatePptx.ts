/**
 * generatePptx.ts
 *
 * Генерирует КП как .pptx:
 * 1. Берём базовый шаблон (QR или Kiosk) — все слайды уже внутри
 * 2. Редактируем КП-слайд из commercial_template.pptx (заполняем данные)
 * 3. Вставляем КП-слайд в нужную позицию базового шаблона
 *
 * Шаблоны:
 * - inno_qr_template.pptx      → QR, Ecomm (КП после слайда 3)
 * - inno_kiosk_template.pptx   → Kiosk, Kiosk PRO (КП после слайда 4)
 * - commercial_template.pptx   → слайд с таблицей КП (138 shapes)
 */

import { type KPResult } from './calculator'
import type { ParsedRequest } from './prompt'

// ================================================================
//  Лимиты строк в .pptx после dynamic row expansion (Phase 5, 2026-05-14)
//
//  Шаблон commercial_template.pptx физически содержит 7 строк в карточке
//  «Оборудование», 1 в «Лицензии и подписки» и 2 в «Услуги». Раньше лишние
//  строки молча обрезались (P0-1).
//
//  Теперь fillCard клонирует row-shapes на лету для секций, где items >
//  чем шаблонных слотов. Геометрические потолки ниже выведены эмпирически
//  по доступному месту на слайде (5143500 EMU высоты, row gap 218815 EMU).
//  При превышении этих значений вёрстка не поместится — watchdog сработает
//  и заблокирует выгрузку.
// ================================================================

// Лимиты подобраны эмпирически: ниже линии card-bottom (Y≈4119563) на слайде
// находится футер «К оплате», поэтому каждая extra-row крадёт ~218815 EMU из
// зазора ~1024000 EMU. Безопасный потолок ≈ 4 extras. Если упрётесь — либо
// растим .pptx до 16:9 large, либо двигаем футер ниже отдельной правкой.
export const PPTX_TEMPLATE_LIMITS: Record<string, number> = {
  'Оборудование': 11,  // 7 шаблонных + 4 клона
  'Лицензии и подписки': 3,
  'Услуги': 6,  // 2 шаблонных + 4 клона
}

export interface PptxOverflowIssue {
  sectionTitle: string
  itemCount: number
  templateLimit: number
}

/**
 * Проверяет, не превышает ли KPResult лимиты шаблона .pptx.
 * Возвращает массив проблемных секций (пустой если всё ОК).
 * Вызывать ПЕРЕД generateKPPptx — если массив непустой, выгрузку нужно
 * заблокировать и показать менеджеру список секций к сокращению.
 */
export function checkPptxOverflow(kp: KPResult): PptxOverflowIssue[] {
  const issues: PptxOverflowIssue[] = []
  for (const section of kp.sections) {
    const limit = PPTX_TEMPLATE_LIMITS[section.title]
    if (limit !== undefined && section.items.length > limit) {
      issues.push({
        sectionTitle: section.title,
        itemCount: section.items.length,
        templateLimit: limit,
      })
    }
    // Секция с title, не описанным в шаблоне (например, добавленная вручную),
    // целиком теряется в .pptx, но входит в grandTotal — это ещё один класс
    // overflow. Сигналим как issue с limit=0.
    if (limit === undefined) {
      issues.push({
        sectionTitle: section.title,
        itemCount: section.items.length,
        templateLimit: 0,
      })
    }
  }
  return issues
}

function fmtNum(n: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n)
}

// ================================================================
//  Карта shapes — ВСЕ shapes каждого блока (включая разделители)
// ================================================================

interface RowDef {
  texts: [string, string, string, string, string]
  separators: string[]
}

/**
 * Геометрия карточки для динамического расширения (Phase 5, 2026-05-14).
 * Если задана — fillCard сможет клонировать row-shapes когда items больше
 * чем строк в шаблоне.
 */
interface CardGeometry {
  rowYs: number[]          // Y-позиции существующих строк
  rowGap: number           // шаг между новыми клонированными строками (EMU)
  sampleRowIndex: number   // какая строка с separators служит шаблоном для клонов
  totalSepY: number        // оригинальные Y элементов ИТОГО
  totalLabelY: number
  totalValueY: number
  containerHeight: number  // оригинальная высота контейнера
}

interface CardMap {
  container: string
  title: string
  headerTexts: string[]
  headerSeps: string[]
  rows: RowDef[]
  totalSep: string
  totalLabel: string
  totalValue: string
  geometry?: CardGeometry
}

// --- Левая карточка: Оборудование (7 строк) ---
const LEFT_CARD: CardMap = {
  container: 'Shape 3',
  title: 'Text 4',
  headerTexts: ['Text 6', 'Text 8', 'Text 10', 'Text 12', 'Text 14'],
  headerSeps: ['Shape 5', 'Shape 7', 'Shape 9', 'Shape 11', 'Shape 13'],
  rows: [
    { texts: ['Text 16', 'Text 18', 'Text 20', 'Text 22', 'Text 24'], separators: ['Shape 15', 'Shape 17', 'Shape 19', 'Shape 21', 'Shape 23'] },
    { texts: ['Text 26', 'Text 28', 'Text 30', 'Text 32', 'Text 34'], separators: ['Shape 25', 'Shape 27', 'Shape 29', 'Shape 31', 'Shape 33'] },
    { texts: ['Text 36', 'Text 38', 'Text 40', 'Text 42', 'Text 44'], separators: ['Shape 35', 'Shape 37', 'Shape 39', 'Shape 41', 'Shape 43'] },
    { texts: ['Text 46', 'Text 48', 'Text 50', 'Text 52', 'Text 54'], separators: ['Shape 45', 'Shape 47', 'Shape 49', 'Shape 51', 'Shape 53'] },
    { texts: ['Text 56', 'Text 58', 'Text 60', 'Text 62', 'Text 64'], separators: ['Shape 55', 'Shape 57', 'Shape 59', 'Shape 61', 'Shape 63'] },
    { texts: ['Text 66', 'Text 68', 'Text 70', 'Text 72', 'Text 74'], separators: ['Shape 65', 'Shape 67', 'Shape 69', 'Shape 71', 'Shape 73'] },
    { texts: ['Text 75', 'Text 76', 'Text 77', 'Text 78', 'Text 79'], separators: [] },
  ],
  totalSep: 'Shape 80',
  totalLabel: 'Text 81',
  totalValue: 'Text 82',
}

// --- Правая верхняя: Лицензии и подписки (1 строка) ---
const RIGHT_TOP_CARD: CardMap = {
  container: 'Shape 83',
  title: 'Text 84',
  headerTexts: ['Text 86', 'Text 88', 'Text 90', 'Text 92', 'Text 94'],
  headerSeps: ['Shape 85', 'Shape 87', 'Shape 89', 'Shape 91', 'Shape 93'],
  rows: [
    { texts: ['Text 95', 'Text 96', 'Text 97', 'Text 98', 'Text 99'], separators: [] },
  ],
  totalSep: 'Shape 100',
  totalLabel: 'Text 101',
  totalValue: 'Text 102',
}

// --- Правая нижняя: Услуги (2 строки) ---
const RIGHT_BOTTOM_CARD: CardMap = {
  container: 'Shape 103',
  title: 'Text 104',
  headerTexts: ['Text 106', 'Text 108', 'Text 110', 'Text 112', 'Text 114'],
  headerSeps: ['Shape 105', 'Shape 107', 'Shape 109', 'Shape 111', 'Shape 113'],
  rows: [
    { texts: ['Text 116', 'Text 118', 'Text 120', 'Text 122', 'Text 124'], separators: ['Shape 115', 'Shape 117', 'Shape 119', 'Shape 121', 'Shape 123'] },
    { texts: ['Text 125', 'Text 126', 'Text 127', 'Text 128', 'Text 129'], separators: [] },
  ],
  totalSep: 'Shape 130',
  totalLabel: 'Text 131',
  totalValue: 'Text 132',
}

const HEADER = { clientName: 'Text 1', date: 'Text 2' }
const SLIDE_TITLE = 'Text 0'  // "Детализация стоимости" — общий заголовок слайда
const FOOTER = { grandTotal: 'Text 136' }

// ================================================================
//  Размеры слайда (КП-шаблон предмасштабирован до 10×5.63")
// ================================================================

const SLIDE_W = 9144000
const SLIDE_H = 5143500

// ================================================================
//  XML helpers
// ================================================================

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function replaceShapeText(xml: string, shapeName: string, newText: string): string {
  const namePattern = `name="${shapeName}"`
  const nameIdx = xml.indexOf(namePattern)
  if (nameIdx === -1) return xml

  let spStart = xml.lastIndexOf('<p:sp>', nameIdx)
  if (spStart === -1) spStart = xml.lastIndexOf('<p:sp ', nameIdx)
  if (spStart === -1) return xml

  const spEnd = xml.indexOf('</p:sp>', nameIdx)
  if (spEnd === -1) return xml
  const spEndFull = spEnd + '</p:sp>'.length

  let block = xml.substring(spStart, spEndFull)
  let firstDone = false
  // Матчим <a:t>text</a:t> И <a:t xml:space="preserve">text</a:t>
  block = block.replace(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g, () => {
    if (!firstDone) { firstDone = true; return `<a:t>${escapeXml(newText)}</a:t>` }
    return '<a:t></a:t>'
  })

  return xml.substring(0, spStart) + block + xml.substring(spEndFull)
}

function removeShape(xml: string, shapeName: string): string {
  const namePattern = `name="${shapeName}"`
  const nameIdx = xml.indexOf(namePattern)
  if (nameIdx === -1) return xml

  let spStart = xml.lastIndexOf('<p:sp>', nameIdx)
  if (spStart === -1) spStart = xml.lastIndexOf('<p:sp ', nameIdx)
  if (spStart === -1) return xml

  const spEnd = xml.indexOf('</p:sp>', nameIdx)
  if (spEnd === -1) return xml

  return xml.substring(0, spStart) + xml.substring(spEnd + '</p:sp>'.length)
}

function getAllCardShapeNames(card: CardMap): string[] {
  const names: string[] = [card.container, card.title, card.totalSep, card.totalLabel, card.totalValue]
  names.push(...card.headerTexts)
  names.push(...card.headerSeps)
  for (const row of card.rows) {
    names.push(...row.texts)
    names.push(...row.separators)
  }
  return names
}

function removeCard(xml: string, card: CardMap): string {
  for (const name of getAllCardShapeNames(card)) {
    xml = removeShape(xml, name)
  }
  return xml
}

/**
 * Расширяет card.rows клонами row-shapes, если items > чем строк в шаблоне.
 * Работает только для карточек с заданной geometry (LEFT_CARD, RIGHT_BOTTOM_CARD).
 * Возвращает обновлённые xml + список эффективных строк (включая клоны).
 */
function expandCardRows(
  xml: string,
  card: CardMap,
  neededRows: number,
): { xml: string; rows: RowDef[] } {
  if (!card.geometry || neededRows <= card.rows.length) {
    return { xml, rows: card.rows }
  }

  const extras = neededRows - card.rows.length
  const sample = card.rows[card.geometry.sampleRowIndex]
  const sampleY = card.geometry.rowYs[card.geometry.sampleRowIndex]
  const lastTemplateY = card.geometry.rowYs[card.geometry.rowYs.length - 1]

  let nextId = findMaxCNvId(xml) + 1
  const newRows: RowDef[] = [...card.rows]

  for (let i = 0; i < extras; i++) {
    const newRowY = lastTemplateY + (i + 1) * card.geometry.rowGap
    const dy = newRowY - sampleY

    const newTexts: [string, string, string, string, string] = [
      `Text Ext ${nextId}_0`,
      `Text Ext ${nextId}_1`,
      `Text Ext ${nextId}_2`,
      `Text Ext ${nextId}_3`,
      `Text Ext ${nextId}_4`,
    ]
    const newSeps = sample.separators.map((_, j) => `Shape Ext ${nextId}_${j}`)

    // Клонируем тексты
    for (let j = 0; j < 5; j++) {
      xml = cloneShape(xml, sample.texts[j], newTexts[j], nextId++, dy)
    }
    // Клонируем разделители
    for (let j = 0; j < sample.separators.length; j++) {
      xml = cloneShape(xml, sample.separators[j], newSeps[j], nextId++, dy)
    }

    newRows.push({ texts: newTexts, separators: newSeps })
  }

  return { xml, rows: newRows }
}

function fillCard(xml: string, card: CardMap, section: KPResult['sections'][0] | null): string {
  if (!section) return removeCard(xml, card)

  xml = replaceShapeText(xml, card.title, section.title)

  // Phase 5: если items больше чем строк в шаблоне — клонируем недостающие.
  const expanded = expandCardRows(xml, card, section.items.length)
  xml = expanded.xml
  const effectiveRows = expanded.rows

  for (let i = 0; i < effectiveRows.length; i++) {
    const row = effectiveRows[i]
    if (i < section.items.length) {
      const item = section.items[i]
      // \u0414\u043b\u044f \u043f\u043e\u0434\u043f\u0438\u0441\u043e\u0447\u043d\u044b\u0445 \u0441\u0442\u0440\u043e\u043a (item.months > 1) \u2014 \u0426\u0435\u043d\u0430 \u043f\u043e\u043a\u0430\u0437\u044b\u0432\u0430\u0435\u0442\u0441\u044f \u043a\u0430\u043a
      // \u00ab10 000/\u043c\u0435\u0441\u00bb, \u0447\u0442\u043e\u0431\u044b \u043a\u043b\u0438\u0435\u043d\u0442 \u043d\u0435 \u043f\u0443\u0442\u0430\u043b \u0435\u0451 \u0441 \u0441\u0443\u043c\u043c\u0430\u0440\u043d\u043e\u0439 \u0437\u0430 \u043f\u0435\u0440\u0438\u043e\u0434.
      // Phase 3 \u0444\u0438\u043a\u0441\u0430 P0-3/P0-4 (2026-05-14).
      const isSub = item.months && item.months > 1
      const priceCell = isSub
        ? `${fmtNum(item.unitPrice)}/\u043c\u0435\u0441`
        : fmtNum(item.unitPrice)
      xml = replaceShapeText(xml, row.texts[0], item.name)
      xml = replaceShapeText(xml, row.texts[1], String(item.qty))
      xml = replaceShapeText(xml, row.texts[2], priceCell)
      xml = replaceShapeText(xml, row.texts[3], item.discount > 0 ? `-${item.discount}%` : '\u2014')
      xml = replaceShapeText(xml, row.texts[4], fmtNum(item.total))
    } else {
      for (const name of row.texts) xml = removeShape(xml, name)
      for (const name of row.separators) xml = removeShape(xml, name)
    }
  }

  xml = replaceShapeText(xml, card.totalLabel, 'ИТОГО')
  xml = replaceShapeText(xml, card.totalValue, fmtNum(section.subtotal) + ' \u20BD')

  return xml
}

// ================================================================
//  Перепозиционирование и адаптивная раскладка (EMU)
// ================================================================

// Координаты из предмасштабированного шаблона (EMU, уже ×0.5 от оригинала)
const LEFT_X = 476250
const RIGHT_X = 4624388
const CARD_WIDTH = 4043363

const RIGHT_TOP_Y = 841958
const RIGHT_BOTTOM_Y = 2423741
const FULL_RIGHT_HEIGHT = 3277605

const LEFT_CARD_HEIGHT = 3277605
const RIGHT_BOTTOM_HEIGHT = 1695822

// Точные Y-позиции строк данных
const LEFT_ROW_Y = [1380344, 1599158, 1817973, 2036788, 2364879, 2583694, 2802508]
const LEFT_TOTAL_Y = { sep: 3142506, label: 3252044, value: 3218706 }
const LEFT_ROW_GAP = 218815  // шаг между новыми клонированными строками

const RB_ROW_Y = [2962126, 3180941]
const RB_TOTAL_Y = { sep: 3411662, label: 3521199, value: 3487862 }
const RB_ROW_GAP = 218815

// Привязываем геометрию к карточкам, чтобы fillCard смог их расширять.
// sampleRowIndex выбран так, чтобы быть строкой с полным набором separators
// (для LEFT — index 4, для RB — index 0).
LEFT_CARD.geometry = {
  rowYs: LEFT_ROW_Y,
  rowGap: LEFT_ROW_GAP,
  sampleRowIndex: 4,
  totalSepY: LEFT_TOTAL_Y.sep,
  totalLabelY: LEFT_TOTAL_Y.label,
  totalValueY: LEFT_TOTAL_Y.value,
  containerHeight: LEFT_CARD_HEIGHT,
}
RIGHT_BOTTOM_CARD.geometry = {
  rowYs: RB_ROW_Y,
  rowGap: RB_ROW_GAP,
  sampleRowIndex: 0,
  totalSepY: RB_TOTAL_Y.sep,
  totalLabelY: RB_TOTAL_Y.label,
  totalValueY: RB_TOTAL_Y.value,
  containerHeight: RIGHT_BOTTOM_HEIGHT,
}

/** Ищет максимальный id из всех <p:cNvPr id="N" …/> в XML. Используется
 *  при клонировании shape'ов — нужен уникальный id для каждого нового. */
function findMaxCNvId(xml: string): number {
  let max = 0
  const re = /<p:cNvPr\s+id="(\d+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    const n = parseInt(m[1])
    if (n > max) max = n
  }
  return max
}

/** Клонирует shape с новым name, новым cNvPr id и сдвигом dy.
 *  Клон вставляется сразу после оригинала. Возвращает обновлённый XML. */
function cloneShape(
  xml: string,
  sourceName: string,
  newName: string,
  newCNvId: number,
  dy: number,
): string {
  const namePattern = `name="${sourceName}"`
  const nameIdx = xml.indexOf(namePattern)
  if (nameIdx === -1) return xml

  let spStart = xml.lastIndexOf('<p:sp>', nameIdx)
  if (spStart === -1) spStart = xml.lastIndexOf('<p:sp ', nameIdx)
  if (spStart === -1) return xml

  const spEnd = xml.indexOf('</p:sp>', nameIdx) + '</p:sp>'.length
  let block = xml.substring(spStart, spEnd)

  // Уникальный name
  block = block.replace(namePattern, `name="${newName}"`)
  // Уникальный cNvPr id
  block = block.replace(/<p:cNvPr\s+id="\d+"/, `<p:cNvPr id="${newCNvId}"`)
  // Сдвигаем только первое вхождение <a:off> (это основной transform shape'а;
  // внутренние <a:off> в gradient stops и т.п. не должны меняться)
  let firstOff = true
  block = block.replace(/<a:off x="(\d+)" y="(\d+)"/g, (full, x, y) => {
    if (!firstOff) return full
    firstOff = false
    return `<a:off x="${x}" y="${parseInt(y) + dy}"`
  })

  // Вставить клон сразу после оригинала
  return xml.substring(0, spEnd) + block + xml.substring(spEnd)
}

/** Сдвигает shape по оси (dx, dy) */
function shiftShape(xml: string, shapeName: string, dx: number, dy: number): string {
  const namePattern = `name="${shapeName}"`
  const nameIdx = xml.indexOf(namePattern)
  if (nameIdx === -1) return xml

  let spStart = xml.lastIndexOf('<p:sp>', nameIdx)
  if (spStart === -1) spStart = xml.lastIndexOf('<p:sp ', nameIdx)
  if (spStart === -1) return xml

  const spEnd = xml.indexOf('</p:sp>', nameIdx) + '</p:sp>'.length
  let block = xml.substring(spStart, spEnd)
  block = block.replace(/<a:off x="(\d+)" y="(\d+)"/, (_, x, y) => {
    return `<a:off x="${parseInt(x) + dx}" y="${parseInt(y) + dy}"`
  })
  return xml.substring(0, spStart) + block + xml.substring(spEnd)
}

/** Меняет размер shape */
function resizeShape(xml: string, shapeName: string, newCx: number | null, newCy: number | null): string {
  const namePattern = `name="${shapeName}"`
  const nameIdx = xml.indexOf(namePattern)
  if (nameIdx === -1) return xml

  let spStart = xml.lastIndexOf('<p:sp>', nameIdx)
  if (spStart === -1) spStart = xml.lastIndexOf('<p:sp ', nameIdx)
  if (spStart === -1) return xml

  const spEnd = xml.indexOf('</p:sp>', nameIdx) + '</p:sp>'.length
  let block = xml.substring(spStart, spEnd)
  block = block.replace(/<a:ext cx="(\d+)" cy="(\d+)"/, (_, cx, cy) => {
    return `<a:ext cx="${newCx !== null ? newCx : parseInt(cx)}" cy="${newCy !== null ? newCy : parseInt(cy)}"`
  })
  return xml.substring(0, spStart) + block + xml.substring(spEnd)
}

/** Сдвигает ВСЕ shapes карточки */
function shiftCard(xml: string, card: CardMap, dx: number, dy: number): string {
  for (const name of getAllCardShapeNames(card)) {
    xml = shiftShape(xml, name, dx, dy)
  }
  return xml
}

/**
 * Растягивает карточку на новую ширину, пропорционально перераспределяя
 * x-позиции и ширины всех дочерних элементов.
 */
function widenCard(
  xml: string,
  card: CardMap,
  origCardX: number,
  origCardW: number,
  newCardX: number,
  newCardW: number,
): string {
  const scaleX = newCardW / origCardW

  for (const shapeName of getAllCardShapeNames(card)) {
    const namePattern = `name="${shapeName}"`
    const nameIdx = xml.indexOf(namePattern)
    if (nameIdx === -1) continue

    let spStart = xml.lastIndexOf('<p:sp>', nameIdx)
    if (spStart === -1) spStart = xml.lastIndexOf('<p:sp ', nameIdx)
    if (spStart === -1) continue

    const spEnd = xml.indexOf('</p:sp>', nameIdx) + '</p:sp>'.length
    let block = xml.substring(spStart, spEnd)

    // Пересчитать x → пропорционально новой ширине
    block = block.replace(/<a:off x="(\d+)" y="(\d+)"/, (_, x, y) => {
      const relX = parseInt(x) - origCardX
      const newX = newCardX + Math.round(relX * scaleX)
      return `<a:off x="${newX}" y="${y}"`
    })

    // Растянуть ширину элемента (контейнер, разделители, ячейки)
    block = block.replace(/<a:ext cx="(\d+)" cy="(\d+)"/, (_, cx, cy) => {
      return `<a:ext cx="${Math.round(parseInt(cx) * scaleX)}" cy="${cy}"`
    })

    xml = xml.substring(0, spStart) + block + xml.substring(spEnd)
  }

  return xml
}

/**
 * Подстраивает геометрию карточки под фактическое число позиций.
 * Сжимает, если items < чем строк в шаблоне (подтягивает ИТОГО вверх).
 * Растягивает, если items > чем строк в шаблоне (пушит ИТОГО вниз + растит
 * контейнер). Phase 5 фикса P0-1 (2026-05-14).
 */
function adjustCardGeometry(xml: string, card: CardMap, actualItems: number): string {
  if (!card.geometry || actualItems <= 0) return xml
  const g = card.geometry

  // Y последней визуальной строки (с учётом возможных клонов)
  const lastRowY = actualItems <= g.rowYs.length
    ? g.rowYs[actualItems - 1]
    : g.rowYs[g.rowYs.length - 1] + (actualItems - g.rowYs.length) * g.rowGap

  // Зазор «последняя строка → ИТОГО-разделитель» из шаблона
  const gapToSep = g.totalSepY - g.rowYs[g.rowYs.length - 1]
  const targetSepY = lastRowY + gapToSep
  const shift = g.totalSepY - targetSepY  // positive = подтянуть вверх, negative = пушить вниз

  xml = shiftShape(xml, card.totalSep, 0, -shift)
  xml = shiftShape(xml, card.totalLabel, 0, -shift)
  xml = shiftShape(xml, card.totalValue, 0, -shift)
  xml = resizeShape(xml, card.container, null, g.containerHeight - shift)

  return xml
}

// ================================================================
//  Helpers
// ================================================================

async function fetchBuf(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url)
  return res.arrayBuffer()
}

function findMaxRId(xml: string): number {
  let max = 0
  const re = /Id="rId(\d+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    const n = parseInt(m[1]); if (n > max) max = n
  }
  return max
}

function findMaxSldId(xml: string): number {
  let max = 256
  const re = /<p:sldId id="(\d+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    const n = parseInt(m[1]); if (n > max) max = n
  }
  return max
}

// ================================================================
//  EXPORT
// ================================================================

export async function generateKPPptx(
  kp: KPResult,
  parsed: ParsedRequest,
  _isInno: boolean,
): Promise<void> {
  const JSZip = (await import('jszip')).default

  // ---------- 1. Определяем базовый шаблон ----------

  const isQR = parsed.license_type === 'qr' || parsed.license_type === 'ecomm'
  const baseTemplatePath = isQR
    ? '/templates/inno_qr_template.pptx'
    : '/templates/inno_kiosk_template.pptx'
  const kpInsertAfter = isQR ? 3 : 4  // после какого слайда вставить КП

  // ---------- 2. Загружаем оба шаблона ----------

  const [baseBuf, kpBuf] = await Promise.all([
    fetchBuf(baseTemplatePath),
    fetchBuf('/templates/commercial_template.pptx'),
  ])

  const baseZip = await JSZip.loadAsync(baseBuf)
  const kpZip = await JSZip.loadAsync(kpBuf)

  // ---------- 3. Редактируем КП-слайд (шаблон уже предмасштабирован) ----------

  let kpSlideXml = await kpZip.file('ppt/slides/slide1.xml')!.async('string')

  kpSlideXml = replaceShapeText(kpSlideXml, HEADER.clientName, kp.clientName)
  kpSlideXml = replaceShapeText(kpSlideXml, HEADER.date, kp.date)

  const equipSection = kp.sections.find(s => s.title === 'Оборудование') || null
  const licSection = kp.sections.find(s => s.title === 'Лицензии и подписки') || null
  const svcSection = kp.sections.find(s => s.title === 'Услуги') || null

  kpSlideXml = fillCard(kpSlideXml, LEFT_CARD, equipSection)
  kpSlideXml = fillCard(kpSlideXml, RIGHT_TOP_CARD, licSection)
  kpSlideXml = fillCard(kpSlideXml, RIGHT_BOTTOM_CARD, svcSection)

  // --- A. Подгонка геометрии: ИТОГО подтягивается к последней строке
  //         (сжимает при <7 items, растягивает при >7 для Оборудования).

  if (equipSection) {
    kpSlideXml = adjustCardGeometry(kpSlideXml, LEFT_CARD, equipSection.items.length)
  }
  if (svcSection) {
    kpSlideXml = adjustCardGeometry(kpSlideXml, RIGHT_BOTTOM_CARD, svcSection.items.length)
  }

  // --- B. Адаптивная раскладка: перемещение и масштабирование ---

  const hasLeft = !!equipSection
  const hasRT = !!licSection
  const hasRB = !!svcSection

  if (hasLeft && hasRT && !hasRB) {
    // Услуг нет → растянуть Лицензии на всю высоту правой колонки
    kpSlideXml = resizeShape(kpSlideXml, RIGHT_TOP_CARD.container, null, FULL_RIGHT_HEIGHT)
  }

  if (hasLeft && !hasRT && hasRB) {
    // Лицензий нет → Услуги вверх на место Лицензий
    const dy = RIGHT_TOP_Y - RIGHT_BOTTOM_Y
    kpSlideXml = shiftCard(kpSlideXml, RIGHT_BOTTOM_CARD, 0, dy)
    kpSlideXml = resizeShape(kpSlideXml, RIGHT_BOTTOM_CARD.container, null, FULL_RIGHT_HEIGHT)
  }

  if (!hasLeft) {
    // Оборудования нет → растягиваем карточки на полную ширину (обе колонки)
    const FULL_WIDTH = RIGHT_X + CARD_WIDTH - LEFT_X  // от левого края до правого

    if (hasRT) {
      kpSlideXml = widenCard(kpSlideXml, RIGHT_TOP_CARD, RIGHT_X, CARD_WIDTH, LEFT_X, FULL_WIDTH)
    }
    if (hasRB) {
      kpSlideXml = widenCard(kpSlideXml, RIGHT_BOTTOM_CARD, RIGHT_X, CARD_WIDTH, LEFT_X, FULL_WIDTH)
    }

    if (hasRT && !hasRB) {
      // Только Лицензии → растянуть ещё и по высоте
      kpSlideXml = resizeShape(kpSlideXml, RIGHT_TOP_CARD.container, null, FULL_RIGHT_HEIGHT)
    }
    if (!hasRT && hasRB) {
      // Только Услуги → вверх на место Лицензий + растянуть по высоте
      const dy = RIGHT_TOP_Y - RIGHT_BOTTOM_Y
      kpSlideXml = shiftCard(kpSlideXml, RIGHT_BOTTOM_CARD, 0, dy)
      kpSlideXml = resizeShape(kpSlideXml, RIGHT_BOTTOM_CARD.container, null, FULL_RIGHT_HEIGHT)
    }
  }

  kpSlideXml = replaceShapeText(kpSlideXml, FOOTER.grandTotal, fmtNum(kp.grandTotal) + ' \u20BD')

  // ---------- 4. Вставляем КП-слайд в базовый шаблон ----------

  // Находим номер для нового слайда
  const baseFiles = Object.keys(baseZip.files)
  const existingSlideNums = baseFiles
    .map(f => f.match(/slides\/slide(\d+)\.xml$/))
    .filter(Boolean)
    .map(m => parseInt(m![1]))
  const newSlideNum = Math.max(...existingSlideNums) + 1

  // Находим layout, который используют существующие слайды (берём от первого)
  const slide1Rels = await baseZip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string')
  const layoutMatch = slide1Rels.match(/Target="\.\.\/slideLayouts\/slideLayout(\d+)\.xml"/)
  const layoutNum = layoutMatch ? layoutMatch[1] : '1'

  // Сохраняем КП-слайд
  baseZip.file(`ppt/slides/slide${newSlideNum}.xml`, kpSlideXml)

  // Rels для КП-слайда — ссылка на существующий layout
  const kpSlideRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout${layoutNum}.xml"/>
</Relationships>`
  baseZip.file(`ppt/slides/_rels/slide${newSlideNum}.xml.rels`, kpSlideRels)

  // ---------- 5. Обновляем метаданные PPTX ----------

  let contentTypes = await baseZip.file('[Content_Types].xml')!.async('string')
  let presXml = await baseZip.file('ppt/presentation.xml')!.async('string')
  let presRels = await baseZip.file('ppt/_rels/presentation.xml.rels')!.async('string')

  // Content Type для нового слайда
  contentTypes = contentTypes.replace('</Types>',
    `<Override PartName="/ppt/slides/slide${newSlideNum}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`)

  // Rel для нового слайда
  const maxRId = findMaxRId(presRels)
  const newSlideRId = `rId${maxRId + 1}`

  presRels = presRels.replace('</Relationships>',
    `<Relationship Id="${newSlideRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${newSlideNum}.xml"/></Relationships>`)

  // Вставляем в sldIdLst после N-го слайда
  const maxSldId = findMaxSldId(presXml)
  const newSldId = maxSldId + 1
  const kpSldEntry = `<p:sldId id="${newSldId}" r:id="${newSlideRId}"/>`

  const sldIdListMatch = presXml.match(/<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/)
  if (sldIdListMatch) {
    const sldEntries: string[] = []
    const entryRe = /<p:sldId[^/]*\/>/g
    let em: RegExpExecArray | null
    while ((em = entryRe.exec(sldIdListMatch[1])) !== null) {
      sldEntries.push(em[0])
    }
    sldEntries.splice(kpInsertAfter, 0, kpSldEntry)
    presXml = presXml.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/,
      `<p:sldIdLst>${sldEntries.join('')}</p:sldIdLst>`)
  }

  baseZip.file('[Content_Types].xml', contentTypes)
  baseZip.file('ppt/presentation.xml', presXml)
  baseZip.file('ppt/_rels/presentation.xml.rels', presRels)

  // ---------- 6. Скачиваем ----------

  const blob = await baseZip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `KP_${kp.clientName.replace(/[^a-zA-Zа-яА-Я0-9]/g, '_')}_${new Date().toISOString().slice(0, 10)}.pptx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
