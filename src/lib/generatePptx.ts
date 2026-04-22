/**
 * generatePptx.ts
 *
 * Генерирует КП как .pptx, РЕДАКТИРУЯ настоящий шаблон PowerPoint.
 * Шаблон: /public/templates/commercial_template.pptx
 *
 * Подход:
 * 1. Открываем шаблон через JSZip (PPTX = ZIP с XML)
 * 2. Находим текстовые shapes по имени и заменяем содержимое
 * 3. Добавляем слайды-картинки (до/после) как новые слайды
 * 4. Сохраняем итоговый .pptx
 */

import { formatMoney, type KPResult } from './calculator'
import type { ParsedRequest } from './prompt'
import {
  innoSlidesBefore, innoSlidesAfter, innoEquipmentSlides,
  bondaSlidesBefore, bondaSlidesAfter,
} from './slides'

/** Число без ₽ */
function fmtNum(n: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n)
}

// ================================================================
//  Карта shapes в шаблоне (имена из PPTX XML)
// ================================================================

/** 5 текстовых полей одной строки: [name, qty, price, discount, total] */
type RowShapes = [string, string, string, string, string]

interface CardMap {
  title: string
  rows: RowShapes[]
  totalLabel: string
  totalValue: string
}

// Левая карточка (7 строк данных)
const LEFT_CARD: CardMap = {
  title: 'Text 4',
  rows: [
    ['Text 16', 'Text 18', 'Text 20', 'Text 22', 'Text 24'],
    ['Text 26', 'Text 28', 'Text 30', 'Text 32', 'Text 34'],
    ['Text 36', 'Text 38', 'Text 40', 'Text 42', 'Text 44'],
    ['Text 46', 'Text 48', 'Text 50', 'Text 52', 'Text 54'],
    ['Text 56', 'Text 58', 'Text 60', 'Text 62', 'Text 64'],
    ['Text 66', 'Text 68', 'Text 70', 'Text 72', 'Text 74'],
    ['Text 75', 'Text 76', 'Text 77', 'Text 78', 'Text 79'],
  ],
  totalLabel: 'Text 81',
  totalValue: 'Text 82',
}

// Правая верхняя карточка (1 строка данных)
const RIGHT_TOP_CARD: CardMap = {
  title: 'Text 84',
  rows: [
    ['Text 95', 'Text 96', 'Text 97', 'Text 98', 'Text 99'],
  ],
  totalLabel: 'Text 101',
  totalValue: 'Text 102',
}

// Правая нижняя карточка (2 строки данных)
const RIGHT_BOTTOM_CARD: CardMap = {
  title: 'Text 104',
  rows: [
    ['Text 116', 'Text 118', 'Text 120', 'Text 122', 'Text 124'],
    ['Text 125', 'Text 126', 'Text 127', 'Text 128', 'Text 129'],
  ],
  totalLabel: 'Text 131',
  totalValue: 'Text 132',
}

// Шапка и подвал
const HEADER = {
  clientName: 'Text 1',
  date: 'Text 2',
}

const FOOTER = {
  grandTotal: 'Text 136',
}

// ================================================================
//  XML helpers — замена текста в shapes
// ================================================================

/**
 * Заменяет текст в shape по имени.
 * Находит <p:cNvPr name="Text N"/> и меняет все <a:t> в этом shape.
 */
function replaceShapeText(xml: string, shapeName: string, newText: string): string {
  // Находим позицию shape с нужным именем
  const namePattern = `name="${shapeName}"`
  const nameIdx = xml.indexOf(namePattern)
  if (nameIdx === -1) return xml

  // Находим <p:sp> блок, содержащий этот name
  // Идём назад от nameIdx до <p:sp или <p:sp>
  let spStart = xml.lastIndexOf('<p:sp>', nameIdx)
  if (spStart === -1) spStart = xml.lastIndexOf('<p:sp ', nameIdx)
  if (spStart === -1) return xml

  // Находим закрывающий </p:sp>
  const spEnd = xml.indexOf('</p:sp>', nameIdx)
  if (spEnd === -1) return xml
  const spEndFull = spEnd + '</p:sp>'.length

  // Извлекаем блок shape
  let shapeBlock = xml.substring(spStart, spEndFull)

  // Заменяем все <a:t>...</a:t> в этом блоке
  // Первый <a:t> получает полный текст, остальные — пустые
  let firstReplaced = false
  shapeBlock = shapeBlock.replace(/<a:t>([^<]*)<\/a:t>/g, (_match) => {
    if (!firstReplaced) {
      firstReplaced = true
      return `<a:t>${escapeXml(newText)}</a:t>`
    }
    return '<a:t></a:t>'
  })

  return xml.substring(0, spStart) + shapeBlock + xml.substring(spEndFull)
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Заполняет карточку данными секции.
 * Если строк в секции меньше чем слотов — оставшиеся очищаем.
 * Если больше — обрезаем (в шаблоне фиксированное кол-во слотов).
 */
function fillCard(xml: string, card: CardMap, section: KPResult['sections'][0] | null): string {
  let result = xml

  if (!section) {
    // Секции нет — очищаем всё
    result = replaceShapeText(result, card.title, '')
    for (const row of card.rows) {
      for (const shapeName of row) {
        result = replaceShapeText(result, shapeName, '')
      }
    }
    result = replaceShapeText(result, card.totalLabel, '')
    result = replaceShapeText(result, card.totalValue, '')
    return result
  }

  // Заголовок секции
  result = replaceShapeText(result, card.title, section.title)

  // Строки данных
  for (let i = 0; i < card.rows.length; i++) {
    const row = card.rows[i]
    if (i < section.items.length) {
      const item = section.items[i]
      result = replaceShapeText(result, row[0], item.name)
      result = replaceShapeText(result, row[1], String(item.qty))
      result = replaceShapeText(result, row[2], fmtNum(item.unitPrice))
      result = replaceShapeText(result, row[3], item.discount > 0 ? `-${item.discount}%` : '\u2014')
      result = replaceShapeText(result, row[4], fmtNum(item.total))
    } else {
      // Пустая строка
      for (const shapeName of row) {
        result = replaceShapeText(result, shapeName, '')
      }
    }
  }

  // ИТОГО
  result = replaceShapeText(result, card.totalLabel, 'ИТОГО')
  result = replaceShapeText(result, card.totalValue, fmtNum(section.subtotal) + ' \u20BD')

  return result
}

// ================================================================
//  Добавление слайдов-картинок
// ================================================================

const SLIDE_W_EMU = 18288000 // 20 дюймов
const SLIDE_H_EMU = 10287000 // 11.25 дюймов

function makeImageSlideXml(rId: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm>
      </p:grpSpPr>
      <p:pic>
        <p:nvPicPr>
          <p:cNvPr id="2" name="SlideImage"/>
          <p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>
          <p:nvPr/>
        </p:nvPicPr>
        <p:blipFill>
          <a:blip r:embed="${rId}"/>
          <a:stretch><a:fillRect/></a:stretch>
        </p:blipFill>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="${SLIDE_W_EMU}" cy="${SLIDE_H_EMU}"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
      </p:pic>
    </p:spTree>
  </p:cSld>
</p:sld>`
}

function makeSlideRels(layoutRId: string, imageRId: string, mediaPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="${layoutRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="${imageRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${mediaPath}"/>
</Relationships>`
}

async function fetchImageAsArrayBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url)
  return res.arrayBuffer()
}

// ================================================================
//  EXPORT: генерация полного КП
// ================================================================

export async function generateKPPptx(
  kp: KPResult,
  parsed: ParsedRequest,
  isInno: boolean,
): Promise<void> {
  const JSZip = (await import('jszip')).default

  // 1. Загружаем шаблон
  const templateBuf = await fetchImageAsArrayBuffer('/templates/commercial_template.pptx')
  const zip = await JSZip.loadAsync(templateBuf)

  // 2. Читаем и модифицируем slide1.xml (коммерческий слайд)
  let slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string')

  // Заменяем шапку
  slideXml = replaceShapeText(slideXml, HEADER.clientName, kp.clientName)
  slideXml = replaceShapeText(slideXml, HEADER.date, kp.date)

  // Маппинг секций КП на карточки шаблона
  const equipSection = kp.sections.find(s => s.title === 'Оборудование') || null
  const licSection = kp.sections.find(s => s.title === 'Лицензии и подписки') || null
  const svcSection = kp.sections.find(s => s.title === 'Услуги') || null

  // Если нет «Оборудование», но есть другие — ставим самую большую секцию в левую карточку
  let leftSection = equipSection
  let rightTopSection = licSection
  let rightBottomSection = svcSection

  if (!leftSection && (rightTopSection || rightBottomSection)) {
    // Берём самую большую из имеющихся для левой карточки
    const all = kp.sections.slice()
    all.sort((a, b) => b.items.length - a.items.length)
    leftSection = all[0] || null
    const remaining = all.slice(1)
    rightTopSection = remaining[0] || null
    rightBottomSection = remaining[1] || null
  }

  slideXml = fillCard(slideXml, LEFT_CARD, leftSection)
  slideXml = fillCard(slideXml, RIGHT_TOP_CARD, rightTopSection)
  slideXml = fillCard(slideXml, RIGHT_BOTTOM_CARD, rightBottomSection)

  // Итого
  slideXml = replaceShapeText(slideXml, FOOTER.grandTotal, fmtNum(kp.grandTotal) + ' \u20BD')

  // Сохраняем модифицированный слайд
  zip.file('ppt/slides/slide1.xml', slideXml)

  // 3. Собираем список слайдов-картинок (до и после)
  const slidesBefore = isInno ? innoSlidesBefore : bondaSlidesBefore
  const slidesAfter = isInno ? innoSlidesAfter : bondaSlidesAfter
  const licType = parsed.license_type || 'kiosk'
  const equipSlides = isInno ? (innoEquipmentSlides[licType] || []) : []

  const allImageSlides = [
    ...slidesBefore.map(s => ({ file: s.file, position: 'before' as const })),
    ...equipSlides.map(s => ({ file: s.file, position: 'after' as const })),
    ...slidesAfter.map(s => ({ file: s.file, position: 'after' as const })),
  ]

  // 4. Добавляем слайды-картинки в PPTX
  // Читаем текущие файлы
  let contentTypes = await zip.file('[Content_Types].xml')!.async('string')
  let presXml = await zip.file('ppt/presentation.xml')!.async('string')
  let presRels = await zip.file('ppt/_rels/presentation.xml.rels')!.async('string')

  // Находим текущие максимальные ID
  const rIdMatches = presRels.match(/Id="rId(\d+)"/g) || []
  let maxRId = 0
  for (const m of rIdMatches) {
    const num = parseInt(m.match(/\d+/)![0])
    if (num > maxRId) maxRId = num
  }

  const sldIdMatches = presXml.match(/id="(\d+)"/g) || []
  let maxSldId = 256
  for (const m of sldIdMatches) {
    const num = parseInt(m.match(/\d+/)![0])
    if (num > maxSldId) maxSldId = num
  }

  // Текущий слайд — slide1 (коммерческий). Его sldId и rId уже в presentation.xml
  // Нам нужно добавить новые слайды ДО и ПОСЛЕ него

  // Загружаем все картинки параллельно
  const imageData: { file: string; data: ArrayBuffer; position: 'before' | 'after' }[] = []
  for (const s of allImageSlides) {
    try {
      const data = await fetchImageAsArrayBuffer(`/slides/${s.file}`)
      imageData.push({ file: s.file, data, position: s.position })
    } catch {
      // skip missing
    }
  }

  // Создаём слайды
  const beforeSlides: string[] = [] // rId для sldIdLst
  const afterSlides: string[] = []

  for (let i = 0; i < imageData.length; i++) {
    const img = imageData[i]
    const slideNum = i + 2 // slide1 уже занят (коммерческий)
    const rId = `rId${maxRId + 1 + i}`
    const sldId = maxSldId + 1 + i
    const mediaName = `image_slide_${i + 1}.jpeg`
    const slidePath = `ppt/slides/slide${slideNum}.xml`
    const slideRelsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`
    const mediaPath = `ppt/media/${mediaName}`

    // Добавляем картинку
    zip.file(mediaPath, img.data)

    // Создаём XML слайда
    zip.file(slidePath, makeImageSlideXml('rId2'))

    // Создаём .rels для слайда
    zip.file(slideRelsPath, makeSlideRels('rId1', 'rId2', `../media/${mediaName}`))

    // Добавляем в [Content_Types].xml
    const ctEntry = `<Override PartName="/${slidePath}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
    contentTypes = contentTypes.replace('</Types>', ctEntry + '</Types>')

    // Добавляем связь в presentation.xml.rels
    const relEntry = `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${slideNum}.xml"/>`
    presRels = presRels.replace('</Relationships>', relEntry + '</Relationships>')

    // Запоминаем для sldIdLst
    const sldEntry = `<p:sldId id="${sldId}" r:id="${rId}"/>`
    if (img.position === 'before') {
      beforeSlides.push(sldEntry)
    } else {
      afterSlides.push(sldEntry)
    }
  }

  // Обновляем sldIdLst в presentation.xml
  // Текущий формат: <p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>
  // Нужно вставить before-слайды перед существующим и after-слайды после
  const existingSldId = presXml.match(/<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/)?.[1] || ''
  const newSldIdLst = `<p:sldIdLst>${beforeSlides.join('')}${existingSldId}${afterSlides.join('')}</p:sldIdLst>`
  presXml = presXml.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, newSldIdLst)

  // Добавляем image content types если нет
  if (!contentTypes.includes('Extension="jpeg"')) {
    contentTypes = contentTypes.replace('</Types>', '<Default Extension="jpeg" ContentType="image/jpeg"/></Types>')
  }
  if (!contentTypes.includes('Extension="jpg"')) {
    contentTypes = contentTypes.replace('</Types>', '<Default Extension="jpg" ContentType="image/jpeg"/></Types>')
  }

  // Сохраняем обратно
  zip.file('[Content_Types].xml', contentTypes)
  zip.file('ppt/presentation.xml', presXml)
  zip.file('ppt/_rels/presentation.xml.rels', presRels)

  // 5. Генерируем файл и скачиваем
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `KP_${kp.clientName.replace(/[^a-zA-Zа-яА-Я0-9]/g, '_')}_${new Date().toISOString().slice(0, 10)}.pptx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
