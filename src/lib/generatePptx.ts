/**
 * generatePptx.ts
 *
 * Генерирует КП как .pptx, РЕДАКТИРУЯ настоящий PPTX-шаблон.
 * Шаблон: /public/templates/commercial_template.pptx
 *
 * 1. JSZip: открываем PPTX (ZIP с XML)
 * 2. Находим shapes по именам → заменяем текст
 * 3. Пустые секции → удаляем ВСЕ shapes блока (карточку + содержимое)
 * 4. Добавляем слайды-картинки до/после
 * 5. Сохраняем .pptx
 */

import { type KPResult } from './calculator'
import type { ParsedRequest } from './prompt'
import {
  innoSlidesBefore, innoSlidesAfter, innoEquipmentSlides,
  bondaSlidesBefore, bondaSlidesAfter,
} from './slides'

function fmtNum(n: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n)
}

// ================================================================
//  Карта shapes — ВСЕ shapes каждого блока (включая разделители)
// ================================================================

/** Одна строка данных: [name, qty, price, discount, total] + разделители */
interface RowDef {
  texts: [string, string, string, string, string]
  separators: string[] // Shape N — разделительные линии строки
}

interface CardMap {
  container: string      // Shape N — белая карточка (фон)
  title: string          // Text N — заголовок секции
  headerTexts: string[]  // Text N × 5 — НАИМЕНОВАНИЕ, КОЛ., ЦЕНА, СКИДКА, СУММА
  headerSeps: string[]   // Shape N × 5 — разделители под заголовками
  rows: RowDef[]         // строки данных
  totalSep: string       // Shape N — разделитель перед ИТОГО
  totalLabel: string     // Text N — "ИТОГО"
  totalValue: string     // Text N — сумма
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

/** Заменяет текст в shape по имени. Первый <a:t> получает текст, остальные очищаются. */
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

/** Полностью удаляет shape из XML по имени */
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

/** Собирает ВСЕ имена shapes карточки */
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

/** Удаляет ВСЕ shapes карточки */
function removeCard(xml: string, card: CardMap): string {
  for (const name of getAllCardShapeNames(card)) {
    xml = removeShape(xml, name)
  }
  return xml
}

/** Заполняет карточку данными. Пустые строки — удаляются вместе с разделителями. */
function fillCard(xml: string, card: CardMap, section: KPResult['sections'][0] | null): string {
  // Секции нет → удаляем весь блок
  if (!section) return removeCard(xml, card)

  // Заголовок
  xml = replaceShapeText(xml, card.title, section.title)

  // Строки данных
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
      // Пустая строка → удаляем shapes + разделители
      for (const name of row.texts) xml = removeShape(xml, name)
      for (const name of row.separators) xml = removeShape(xml, name)
    }
  }

  // ИТОГО
  xml = replaceShapeText(xml, card.totalLabel, 'ИТОГО')
  xml = replaceShapeText(xml, card.totalValue, fmtNum(section.subtotal) + ' \u20BD')

  return xml
}

// ================================================================
//  Слайды-картинки
// ================================================================

const SLIDE_W_EMU = 18288000
const SLIDE_H_EMU = 10287000

function makeImageSlideXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    <p:pic>
      <p:nvPicPr><p:cNvPr id="2" name="SlideImage"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>
      <p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
      <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${SLIDE_W_EMU}" cy="${SLIDE_H_EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
    </p:pic>
  </p:spTree></p:cSld>
</p:sld>`
}

function makeSlideRels(mediaPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${mediaPath}"/>
</Relationships>`
}

async function fetchBuf(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url)
  return res.arrayBuffer()
}

// ================================================================
//  EXPORT
// ================================================================

export async function generateKPPptx(
  kp: KPResult,
  parsed: ParsedRequest,
  isInno: boolean,
): Promise<void> {
  const JSZip = (await import('jszip')).default

  // 1. Загружаем шаблон
  const zip = await JSZip.loadAsync(await fetchBuf('/templates/commercial_template.pptx'))

  // 2. Редактируем коммерческий слайд
  let slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string')

  slideXml = replaceShapeText(slideXml, HEADER.clientName, kp.clientName)
  slideXml = replaceShapeText(slideXml, HEADER.date, kp.date)

  // Маппинг секций → карточки
  const equipSection = kp.sections.find(s => s.title === 'Оборудование') || null
  const licSection = kp.sections.find(s => s.title === 'Лицензии и подписки') || null
  const svcSection = kp.sections.find(s => s.title === 'Услуги') || null

  slideXml = fillCard(slideXml, LEFT_CARD, equipSection)
  slideXml = fillCard(slideXml, RIGHT_TOP_CARD, licSection)
  slideXml = fillCard(slideXml, RIGHT_BOTTOM_CARD, svcSection)

  slideXml = replaceShapeText(slideXml, FOOTER.grandTotal, fmtNum(kp.grandTotal) + ' \u20BD')

  zip.file('ppt/slides/slide1.xml', slideXml)

  // 3. Собираем слайды-картинки
  const slidesBefore = isInno ? innoSlidesBefore : bondaSlidesBefore
  const slidesAfter = isInno ? innoSlidesAfter : bondaSlidesAfter
  const licType = parsed.license_type || 'kiosk'
  const equipSlides = isInno ? (innoEquipmentSlides[licType] || []) : []

  const allImages = [
    ...slidesBefore.map(s => ({ file: s.file, pos: 'before' as const })),
    ...equipSlides.map(s => ({ file: s.file, pos: 'after' as const })),
    ...slidesAfter.map(s => ({ file: s.file, pos: 'after' as const })),
  ]

  // Загружаем картинки
  const loaded: { data: ArrayBuffer; pos: 'before' | 'after' }[] = []
  for (const img of allImages) {
    try {
      loaded.push({ data: await fetchBuf(`/slides/${img.file}`), pos: img.pos })
    } catch { /* skip missing */ }
  }

  // 4. Модифицируем PPTX: добавляем слайды
  let contentTypes = await zip.file('[Content_Types].xml')!.async('string')
  let presXml = await zip.file('ppt/presentation.xml')!.async('string')
  let presRels = await zip.file('ppt/_rels/presentation.xml.rels')!.async('string')

  // Находим макс. rId
  let maxRId = 0
  for (const m of presRels.matchAll(/Id="rId(\d+)"/g)) {
    const n = parseInt(m[1]); if (n > maxRId) maxRId = n
  }

  // Находим макс. sldId
  let maxSldId = 256
  for (const m of presXml.matchAll(/<p:sldId id="(\d+)"/g)) {
    const n = parseInt(m[1]); if (n > maxSldId) maxSldId = n
  }

  const beforeEntries: string[] = []
  const afterEntries: string[] = []

  for (let i = 0; i < loaded.length; i++) {
    const img = loaded[i]
    const slideNum = i + 2
    const rId = `rId${maxRId + 1 + i}`
    const sldId = maxSldId + 1 + i
    const mediaName = `slide_img_${i + 1}.jpeg`

    zip.file(`ppt/media/${mediaName}`, img.data)
    zip.file(`ppt/slides/slide${slideNum}.xml`, makeImageSlideXml())
    zip.file(`ppt/slides/_rels/slide${slideNum}.xml.rels`, makeSlideRels(`../media/${mediaName}`))

    contentTypes = contentTypes.replace('</Types>',
      `<Override PartName="/ppt/slides/slide${slideNum}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`)

    presRels = presRels.replace('</Relationships>',
      `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${slideNum}.xml"/></Relationships>`)

    const entry = `<p:sldId id="${sldId}" r:id="${rId}"/>`
    if (img.pos === 'before') beforeEntries.push(entry)
    else afterEntries.push(entry)
  }

  // Вставляем слайды в sldIdLst (до и после коммерческого)
  const existingSldId = presXml.match(/<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/)?.[1] || ''
  presXml = presXml.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/,
    `<p:sldIdLst>${beforeEntries.join('')}${existingSldId}${afterEntries.join('')}</p:sldIdLst>`)

  if (!contentTypes.includes('Extension="jpeg"'))
    contentTypes = contentTypes.replace('</Types>', '<Default Extension="jpeg" ContentType="image/jpeg"/></Types>')

  zip.file('[Content_Types].xml', contentTypes)
  zip.file('ppt/presentation.xml', presXml)
  zip.file('ppt/_rels/presentation.xml.rels', presRels)

  // 5. Скачиваем
  const blob = await zip.generateAsync({
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
