/**
 * generatePptx.ts
 *
 * Генерирует КП как .pptx:
 * 1. Берём базовый шаблон презентации (QR или Kiosk) — уже содержит все слайды
 * 2. Берём КП-слайд из commercial_template.pptx, редактируем данные
 * 3. Вставляем КП-слайд в нужную позицию базового шаблона
 * 4. Сохраняем итоговый .pptx
 *
 * Шаблоны:
 * - /public/templates/inno_qr_template.pptx      → QR, Ecomm (КП после слайда 3)
 * - /public/templates/inno_kiosk_template.pptx    → Kiosk, Kiosk PRO (КП после слайда 4)
 * - /public/templates/commercial_template.pptx    → слайд с таблицей КП (138 shapes)
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
//  Перепозиционирование карточек (EMU)
// ================================================================

const RIGHT_TOP_Y = 1683916
const RIGHT_BOTTOM_Y = 4847481
const FULL_RIGHT_HEIGHT = 6555209

function shiftShapeY(xml: string, shapeName: string, deltaY: number): string {
  const namePattern = `name="${shapeName}"`
  const nameIdx = xml.indexOf(namePattern)
  if (nameIdx === -1) return xml

  let spStart = xml.lastIndexOf('<p:sp>', nameIdx)
  if (spStart === -1) spStart = xml.lastIndexOf('<p:sp ', nameIdx)
  if (spStart === -1) return xml

  const spEnd = xml.indexOf('</p:sp>', nameIdx) + '</p:sp>'.length
  let block = xml.substring(spStart, spEnd)
  block = block.replace(/<a:off x="(\d+)" y="(\d+)"/, (_, x, y) => {
    return `<a:off x="${x}" y="${parseInt(y) + deltaY}"`
  })
  return xml.substring(0, spStart) + block + xml.substring(spEnd)
}

function resizeShapeHeight(xml: string, shapeName: string, newCy: number): string {
  const namePattern = `name="${shapeName}"`
  const nameIdx = xml.indexOf(namePattern)
  if (nameIdx === -1) return xml

  let spStart = xml.lastIndexOf('<p:sp>', nameIdx)
  if (spStart === -1) spStart = xml.lastIndexOf('<p:sp ', nameIdx)
  if (spStart === -1) return xml

  const spEnd = xml.indexOf('</p:sp>', nameIdx) + '</p:sp>'.length
  let block = xml.substring(spStart, spEnd)
  block = block.replace(/<a:ext cx="(\d+)" cy="(\d+)"/, (_, cx, _cy) => {
    return `<a:ext cx="${cx}" cy="${newCy}"`
  })
  return xml.substring(0, spStart) + block + xml.substring(spEnd)
}

function shiftCard(xml: string, card: CardMap, deltaY: number): string {
  for (const name of getAllCardShapeNames(card)) {
    xml = shiftShapeY(xml, name, deltaY)
  }
  return xml
}

// ================================================================
//  Helpers
// ================================================================

async function fetchBuf(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url)
  return res.arrayBuffer()
}

/** Находим максимальный числовой rId в XML */
function findMaxRId(xml: string): number {
  let max = 0
  const re = /Id="rId(\d+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    const n = parseInt(m[1]); if (n > max) max = n
  }
  return max
}

/** Находим максимальный sldId */
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
//  EXPORT — Главная функция генерации PPTX
// ================================================================

export async function generateKPPptx(
  kp: KPResult,
  parsed: ParsedRequest,
  _isInno: boolean,
): Promise<void> {
  const JSZip = (await import('jszip')).default

  // ---------- 1. Определяем шаблоны ----------

  const isQR = parsed.license_type === 'qr' || parsed.license_type === 'ecomm'
  // QR/Ecomm → QR шаблон, KP после слайда 3
  // Kiosk/Kiosk PRO → Kiosk шаблон, KP после слайда 4
  const baseTemplatePath = isQR
    ? '/templates/inno_qr_template.pptx'
    : '/templates/inno_kiosk_template.pptx'
  const kpInsertAfter = isQR ? 3 : 4

  // ---------- 2. Загружаем оба шаблона ----------

  const [baseBuf, kpBuf] = await Promise.all([
    fetchBuf(baseTemplatePath),
    fetchBuf('/templates/commercial_template.pptx'),
  ])

  const baseZip = await JSZip.loadAsync(baseBuf)
  const kpZip = await JSZip.loadAsync(kpBuf)

  // ---------- 3. Редактируем КП-слайд ----------

  let kpSlideXml = await kpZip.file('ppt/slides/slide1.xml')!.async('string')

  kpSlideXml = replaceShapeText(kpSlideXml, HEADER.clientName, kp.clientName)
  kpSlideXml = replaceShapeText(kpSlideXml, HEADER.date, kp.date)

  const equipSection = kp.sections.find(s => s.title === 'Оборудование') || null
  const licSection = kp.sections.find(s => s.title === 'Лицензии и подписки') || null
  const svcSection = kp.sections.find(s => s.title === 'Услуги') || null

  kpSlideXml = fillCard(kpSlideXml, LEFT_CARD, equipSection)
  kpSlideXml = fillCard(kpSlideXml, RIGHT_TOP_CARD, licSection)
  kpSlideXml = fillCard(kpSlideXml, RIGHT_BOTTOM_CARD, svcSection)

  // Перепозиционирование
  if (!licSection && svcSection) {
    const deltaY = RIGHT_TOP_Y - RIGHT_BOTTOM_Y
    kpSlideXml = shiftCard(kpSlideXml, RIGHT_BOTTOM_CARD, deltaY)
    kpSlideXml = resizeShapeHeight(kpSlideXml, RIGHT_BOTTOM_CARD.container, FULL_RIGHT_HEIGHT)
  }
  if (licSection && !svcSection) {
    kpSlideXml = resizeShapeHeight(kpSlideXml, RIGHT_TOP_CARD.container, FULL_RIGHT_HEIGHT)
  }

  kpSlideXml = replaceShapeText(kpSlideXml, FOOTER.grandTotal, fmtNum(kp.grandTotal) + ' \u20BD')

  // ---------- 4. Копируем зависимости КП-слайда в базовый шаблон ----------

  // Находим макс. номера layout и master в базовом шаблоне
  const baseFiles = Object.keys(baseZip.files)
  const layoutNums = baseFiles
    .map(f => f.match(/slideLayouts\/slideLayout(\d+)\.xml$/))
    .filter(Boolean)
    .map(m => parseInt(m![1]))
  const masterNums = baseFiles
    .map(f => f.match(/slideMasters\/slideMaster(\d+)\.xml$/))
    .filter(Boolean)
    .map(m => parseInt(m![1]))
  const themeNums = baseFiles
    .map(f => f.match(/theme\/theme(\d+)\.xml$/))
    .filter(Boolean)
    .map(m => parseInt(m![1]))

  const newLayoutNum = Math.max(...layoutNums) + 1
  const newMasterNum = Math.max(...masterNums) + 1
  const newThemeNum = Math.max(...themeNums) + 1

  // Копируем theme из КП
  const kpTheme = await kpZip.file('ppt/theme/theme1.xml')!.async('string')
  baseZip.file(`ppt/theme/theme${newThemeNum}.xml`, kpTheme)

  // Копируем slideMaster из КП (обновляем ссылки на layout и theme)
  let kpMaster = await kpZip.file('ppt/slideMasters/slideMaster1.xml')!.async('string')
  baseZip.file(`ppt/slideMasters/slideMaster${newMasterNum}.xml`, kpMaster)

  // slideMaster rels: ссылки на slideLayout и theme
  const masterRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout${newLayoutNum}.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme${newThemeNum}.xml"/>
</Relationships>`
  baseZip.file(`ppt/slideMasters/_rels/slideMaster${newMasterNum}.xml.rels`, masterRels)

  // Копируем slideLayout из КП (обновляем ссылку на master)
  let kpLayout = await kpZip.file('ppt/slideLayouts/slideLayout1.xml')!.async('string')
  baseZip.file(`ppt/slideLayouts/slideLayout${newLayoutNum}.xml`, kpLayout)

  const layoutRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster${newMasterNum}.xml"/>
</Relationships>`
  baseZip.file(`ppt/slideLayouts/_rels/slideLayout${newLayoutNum}.xml.rels`, layoutRels)

  // ---------- 5. Добавляем КП-слайд в базовый шаблон ----------

  // Определяем номер нового слайда (не конфликтует с существующими)
  const existingSlideNums = baseFiles
    .map(f => f.match(/slides\/slide(\d+)\.xml$/))
    .filter(Boolean)
    .map(m => parseInt(m![1]))
  const newSlideNum = Math.max(...existingSlideNums) + 1

  // Сохраняем отредактированный КП-слайд
  baseZip.file(`ppt/slides/slide${newSlideNum}.xml`, kpSlideXml)

  // Rels для КП-слайда (ссылка на наш layout)
  const slideRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout${newLayoutNum}.xml"/>
</Relationships>`
  baseZip.file(`ppt/slides/_rels/slide${newSlideNum}.xml.rels`, slideRels)

  // ---------- 6. Обновляем метаданные PPTX ----------

  let contentTypes = await baseZip.file('[Content_Types].xml')!.async('string')
  let presXml = await baseZip.file('ppt/presentation.xml')!.async('string')
  let presRels = await baseZip.file('ppt/_rels/presentation.xml.rels')!.async('string')

  // Добавляем Content Type для нового слайда, layout, master, theme
  contentTypes = contentTypes.replace('</Types>', [
    `<Override PartName="/ppt/slides/slide${newSlideNum}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    `<Override PartName="/ppt/slideLayouts/slideLayout${newLayoutNum}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>`,
    `<Override PartName="/ppt/slideMasters/slideMaster${newMasterNum}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>`,
    `<Override PartName="/ppt/theme/theme${newThemeNum}.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>`,
    '</Types>',
  ].join(''))

  // Добавляем rel для нового слайда и slideMaster в presentation.xml.rels
  const maxRId = findMaxRId(presRels)
  const newSlideRId = `rId${maxRId + 1}`
  const newMasterRId = `rId${maxRId + 2}`

  presRels = presRels.replace('</Relationships>', [
    `<Relationship Id="${newSlideRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${newSlideNum}.xml"/>`,
    `<Relationship Id="${newMasterRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster${newMasterNum}.xml"/>`,
    '</Relationships>',
  ].join(''))

  // Добавляем slideMaster в sldMasterIdLst
  const maxSldMasterId = 2147483647  // safe high number
  presXml = presXml.replace('</p:sldMasterIdLst>',
    `<p:sldMasterId id="${maxSldMasterId}" r:id="${newMasterRId}"/></p:sldMasterIdLst>`)

  // Вставляем КП-слайд в правильную позицию в sldIdLst
  const maxSldId = findMaxSldId(presXml)
  const newSldId = maxSldId + 1
  const kpSldEntry = `<p:sldId id="${newSldId}" r:id="${newSlideRId}"/>`

  // Разбираем sldIdLst, вставляем после N-го слайда
  const sldIdListMatch = presXml.match(/<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/)
  if (sldIdListMatch) {
    const sldEntries: string[] = []
    const entryRe = /<p:sldId[^/]*\/>/g
    let em: RegExpExecArray | null
    while ((em = entryRe.exec(sldIdListMatch[1])) !== null) {
      sldEntries.push(em[0])
    }
    // Вставляем КП-слайд после позиции kpInsertAfter
    sldEntries.splice(kpInsertAfter, 0, kpSldEntry)
    presXml = presXml.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/,
      `<p:sldIdLst>${sldEntries.join('')}</p:sldIdLst>`)
  }

  // Сохраняем обновлённые метаданные
  baseZip.file('[Content_Types].xml', contentTypes)
  baseZip.file('ppt/presentation.xml', presXml)
  baseZip.file('ppt/_rels/presentation.xml.rels', presRels)

  // ---------- 7. Скачиваем ----------

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
