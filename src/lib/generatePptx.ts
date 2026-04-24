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

interface CardMap {
  container: string
  title: string
  headerTexts: string[]
  headerSeps: string[]
  rows: RowDef[]
  totalSep: string
  totalLabel: string
  totalValue: string
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
const FOOTER = { grandTotal: 'Text 136' }

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
  block = block.replace(/<a:t>([^<]*)<\/a:t>/g, () => {
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

function fillCard(xml: string, card: CardMap, section: KPResult['sections'][0] | null): string {
  if (!section) return removeCard(xml, card)

  xml = replaceShapeText(xml, card.title, section.title)

  for (let i = 0; i < card.rows.length; i++) {
    const row = card.rows[i]
    if (i < section.items.length) {
      const item = section.items[i]
      xml = replaceShapeText(xml, row.texts[0], item.name)
      xml = replaceShapeText(xml, row.texts[1], String(item.qty))
      xml = replaceShapeText(xml, row.texts[2], fmtNum(item.unitPrice))
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

// Координаты из шаблона
const LEFT_X = 952500
const RIGHT_X = 9248775
const CARD_WIDTH = 8086725
const SLIDE_W = 18288000

const RIGHT_TOP_Y = 1683916
const RIGHT_BOTTOM_Y = 4847481
const FULL_RIGHT_HEIGHT = 6555209  // = высота левой карточки

const LEFT_CARD_HEIGHT = 6555209
const RIGHT_TOP_HEIGHT = 2954015
const RIGHT_BOTTOM_HEIGHT = 3391644

// Шаг между строками данных (EMU)
const LEFT_ROW_STEP = 474055       // 7 строк в левой карточке
const RIGHT_BOTTOM_ROW_STEP = 437629  // 2 строки в правой нижней

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

/** Компактифицирует карточку: сдвигает ИТОГО вверх + ужимает контейнер */
function compactCard(
  xml: string, card: CardMap, actualItems: number, maxRows: number, rowStep: number, originalHeight: number,
): string {
  if (actualItems >= maxRows) return xml
  const unusedRows = maxRows - actualItems
  const shift = unusedRows * rowStep

  // Сдвигаем ИТОГО-зону вверх
  xml = shiftShape(xml, card.totalSep, 0, -shift)
  xml = shiftShape(xml, card.totalLabel, 0, -shift)
  xml = shiftShape(xml, card.totalValue, 0, -shift)

  // Ужимаем контейнер
  xml = resizeShape(xml, card.container, null, originalHeight - shift)

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

  // ---------- 3. Редактируем КП-слайд (старая рабочая логика) ----------

  let kpSlideXml = await kpZip.file('ppt/slides/slide1.xml')!.async('string')

  kpSlideXml = replaceShapeText(kpSlideXml, HEADER.clientName, kp.clientName)
  kpSlideXml = replaceShapeText(kpSlideXml, HEADER.date, kp.date)

  const equipSection = kp.sections.find(s => s.title === 'Оборудование') || null
  const licSection = kp.sections.find(s => s.title === 'Лицензии и подписки') || null
  const svcSection = kp.sections.find(s => s.title === 'Услуги') || null

  kpSlideXml = fillCard(kpSlideXml, LEFT_CARD, equipSection)
  kpSlideXml = fillCard(kpSlideXml, RIGHT_TOP_CARD, licSection)
  kpSlideXml = fillCard(kpSlideXml, RIGHT_BOTTOM_CARD, svcSection)

  // --- A. Компактификация: ИТОГО поднимается к последней строке ---

  if (equipSection) {
    kpSlideXml = compactCard(kpSlideXml, LEFT_CARD,
      equipSection.items.length, LEFT_CARD.rows.length, LEFT_ROW_STEP, LEFT_CARD_HEIGHT)
  }
  if (svcSection) {
    kpSlideXml = compactCard(kpSlideXml, RIGHT_BOTTOM_CARD,
      svcSection.items.length, RIGHT_BOTTOM_CARD.rows.length, RIGHT_BOTTOM_ROW_STEP, RIGHT_BOTTOM_HEIGHT)
  }

  // --- B. Вертикальная адаптация правой колонки ---

  if (!licSection && svcSection) {
    // Лицензий нет → Услуги поднимаются на место Лицензий, растягиваются
    kpSlideXml = shiftCard(kpSlideXml, RIGHT_BOTTOM_CARD, 0, RIGHT_TOP_Y - RIGHT_BOTTOM_Y)
    kpSlideXml = resizeShape(kpSlideXml, RIGHT_BOTTOM_CARD.container, null, FULL_RIGHT_HEIGHT)
  }
  if (licSection && !svcSection) {
    // Услуг нет → Лицензии растягиваются на всю высоту
    kpSlideXml = resizeShape(kpSlideXml, RIGHT_TOP_CARD.container, null, FULL_RIGHT_HEIGHT)
  }

  // --- C. Горизонтальное центрирование (нет Оборудования) ---

  if (!equipSection) {
    // Правые карточки → в центр слайда
    const centerX = Math.round((SLIDE_W - CARD_WIDTH) / 2)
    const dx = centerX - RIGHT_X

    if (licSection) kpSlideXml = shiftCard(kpSlideXml, RIGHT_TOP_CARD, dx, 0)
    if (svcSection) kpSlideXml = shiftCard(kpSlideXml, RIGHT_BOTTOM_CARD, dx, 0)

    // Если только одна карточка — растянуть на всю высоту
    if (licSection && !svcSection) {
      kpSlideXml = resizeShape(kpSlideXml, RIGHT_TOP_CARD.container, null, FULL_RIGHT_HEIGHT)
    }
    if (!licSection && svcSection) {
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
