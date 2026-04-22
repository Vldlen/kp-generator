/**
 * generatePptx.ts
 * Генерирует КП в формате .pptx с помощью pptxgenjs.
 *
 * Слайд «Детализация стоимости» строится программно
 * по эталону из PPTX коллеги (точные цвета, размеры, шрифты).
 * Остальные слайды вставляются как полностраничные картинки.
 */

import { formatMoney, type KPResult } from './calculator'
import type { ParsedRequest } from './prompt'
import {
  innoSlidesBefore, innoSlidesAfter, innoEquipmentSlides,
  bondaSlidesBefore, bondaSlidesAfter,
} from './slides'

// Число без символа валюты
function fmtNum(n: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n)
}

// Загрузка изображения как base64 data URL
async function loadImageBase64(src: string): Promise<string> {
  const response = await fetch(src)
  const blob = await response.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

// ================================================================
//  Секция-карточка с таблицей
// ================================================================

function addSectionCard(
  slide: any,
  pptx: any,
  x: number, y: number, w: number, h: number,
  section: KPResult['sections'][0],
  accentColor: string,
) {
  // Белая карточка с тенью
  slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h,
    fill: { color: 'FFFFFF' },
    rectRadius: 0.15,
    shadow: { type: 'outer', blur: 8, offset: 2, color: '000000', opacity: 0.06 },
    line: { width: 0 },
  })

  const pad = 0.3
  const innerX = x + pad
  const innerW = w - pad * 2

  // Заголовок секции
  slide.addText(section.title, {
    x: innerX, y: y + 0.15, w: innerW, h: 0.4,
    fontSize: 18, bold: true, color: '0B1F3A', fontFace: 'Arial',
    valign: 'middle',
  })

  // Колонки таблицы
  const colW = [
    innerW * 0.42,  // НАИМЕНОВАНИЕ
    innerW * 0.08,  // КОЛ.
    innerW * 0.17,  // ЦЕНА
    innerW * 0.13,  // СКИДКА
    innerW * 0.20,  // СУММА
  ]

  // Заголовок таблицы
  const headerRow = [
    { text: 'НАИМЕНОВАНИЕ', options: { fontSize: 8, bold: true, color: '6A7285', align: 'left' as const } },
    { text: 'КОЛ.', options: { fontSize: 8, bold: true, color: '6A7285', align: 'right' as const } },
    { text: 'ЦЕНА', options: { fontSize: 8, bold: true, color: '6A7285', align: 'right' as const } },
    { text: 'СКИДКА', options: { fontSize: 8, bold: true, color: '6A7285', align: 'right' as const } },
    { text: 'СУММА', options: { fontSize: 8, bold: true, color: '6A7285', align: 'right' as const } },
  ]

  // Строки данных
  const dataRows = section.items.map(item => [
    { text: item.name, options: { fontSize: 13, bold: true, color: '0B1F3A' } },
    { text: String(item.qty), options: { fontSize: 12, color: '29334A', align: 'right' as const } },
    { text: fmtNum(item.unitPrice), options: { fontSize: 12, color: '29334A', align: 'right' as const } },
    {
      text: item.discount > 0 ? `-${item.discount}%` : '\u2014',
      options: {
        fontSize: 12,
        bold: item.discount > 0,
        color: item.discount > 0 ? accentColor : 'B8BEC9',
        align: 'right' as const,
      },
    },
    { text: fmtNum(item.total), options: { fontSize: 13, bold: true, color: '0B1F3A', align: 'right' as const } },
  ])

  // Строка ИТОГО
  const totalRow = [
    { text: 'ИТОГО', options: { fontSize: 12, color: '6A7285' } },
    { text: '', options: {} },
    { text: '', options: {} },
    { text: '', options: {} },
    { text: fmtNum(section.subtotal) + ' \u20BD', options: { fontSize: 14, bold: true, color: '0B1F3A', align: 'right' as const } },
  ]

  // Рассчитываем высоту строк чтобы таблица поместилась
  const availH = h - 0.7 // вычитаем заголовок и отступы
  const totalRows = 1 + dataRows.length + 1 // header + data + итого
  const rowH = Math.min(0.4, Math.max(0.28, availH / totalRows))

  slide.addTable(
    [headerRow, ...dataRows, totalRow],
    {
      x: innerX,
      y: y + 0.55,
      w: innerW,
      colW,
      rowH,
      fontFace: 'Arial',
      autoPage: false,
      border: { type: 'solid', pt: 0.3, color: 'E8EBF0' },
    }
  )
}

// ================================================================
//  БОНДА ФинДир — вставляем эталон-картинку с рамкой
//  (пока оставляем как изображение, т.к. тарифный слайд статичный)
// ================================================================

async function addBondaFindirSlide(
  slide: any,
  pptx: any,
  kp: KPResult,
  parsed: ParsedRequest,
) {
  try {
    const imgData = await loadImageBase64('/slides/bonda_tariffs_ref.jpg')
    slide.background = { data: imgData }
  } catch {
    slide.background = { fill: 'F3F6FB' }
  }

  // Рамка вокруг выбранного тарифа
  const tariffMap: Record<string, number> = { 'Старт': 0, 'Про': 1, 'Ультра': 2 }
  const selectedIdx = tariffMap[parsed.findir_tariff || 'Старт'] ?? 0

  // Координаты карточек (в дюймах, слайд 20×11.25)
  // Из PIL-анализа: canvas 1920→20in, 1080→11.25in
  const cards = [
    { x: 1.25, y: 0.99, w: 4.90, h: 9.06 },
    { x: 7.03, y: 0.99, w: 4.79, h: 9.06 },
    { x: 12.70, y: 0.99, w: 5.03, h: 9.06 },
  ]

  const sel = cards[selectedIdx]
  slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x: sel.x - 0.05, y: sel.y - 0.05, w: sel.w + 0.1, h: sel.h + 0.1,
    fill: { type: 'none' },
    line: { color: 'E63C14', width: 4 },
    rectRadius: 0.15,
    shadow: { type: 'outer', blur: 12, color: 'E63C14', opacity: 0.25 },
  })
}

// ================================================================
//  Слайд «Детализация стоимости»
// ================================================================

async function addCommercialSlide(
  pptx: any,
  kp: KPResult,
  parsed: ParsedRequest,
  accentColor: string,
  isInno: boolean,
) {
  const slide = pptx.addSlide()

  // Проверка: БОНДА ФинДир → отдельный шаблон
  if (!isInno && parsed.license_type === 'findir' && parsed.findir_tariff) {
    await addBondaFindirSlide(slide, pptx, kp, parsed)
    return
  }

  // Фон
  slide.background = { fill: 'F3F6FB' }

  // Заголовок «Детализация стоимости»
  slide.addText([
    { text: 'Детализация ', options: { fontSize: 48, bold: true, color: '0B1F3A', fontFace: 'Arial' } },
    { text: 'стоимости', options: { fontSize: 48, bold: true, color: accentColor, fontFace: 'Arial' } },
  ], { x: 1.04, y: 0.55, w: 9, h: 0.8, valign: 'middle' })

  // Клиент (справа)
  slide.addText(kp.clientName, {
    x: 14.5, y: 0.50, w: 4.5, h: 0.4,
    fontSize: 20, bold: true, color: '0B1F3A', fontFace: 'Arial',
    align: 'right',
  })

  // Дата
  slide.addText(kp.date, {
    x: 14.5, y: 0.90, w: 4.5, h: 0.35,
    fontSize: 17, color: '6A7285', fontFace: 'Arial',
    align: 'right',
  })

  // ===== Раскладка карточек =====
  const sections = kp.sections
  const cardTop = 1.84
  const bottomBarTop = 9.24
  const cardAreaH = bottomBarTop - cardTop - 0.2
  const cardGap = 0.23

  if (sections.length === 0) {
    // пустой
  } else if (sections.length === 1) {
    // Одна карточка по центру
    addSectionCard(slide, pptx, 4.5, cardTop, 11, cardAreaH, sections[0], accentColor)
  } else if (sections.length === 2) {
    // Две равных
    const cw = 8.84
    addSectionCard(slide, pptx, 1.04, cardTop, cw, cardAreaH, sections[0], accentColor)
    addSectionCard(slide, pptx, 1.04 + cw + cardGap, cardTop, cw, cardAreaH, sections[1], accentColor)
  } else {
    // 3+ секций: слева — самая большая, справа — стопка
    let leftIdx = 0
    let maxItems = 0
    for (let i = 0; i < sections.length; i++) {
      if (sections[i].items.length > maxItems) {
        maxItems = sections[i].items.length
        leftIdx = i
      }
    }

    const leftSection = sections[leftIdx]
    const rightSections = sections.filter((_, i) => i !== leftIdx)
    const leftW = 8.84
    const rightW = 8.84

    // Левая карточка
    addSectionCard(slide, pptx, 1.04, cardTop, leftW, cardAreaH, leftSection, accentColor)

    // Правые карточки
    const totalRightItems = rightSections.reduce((sum, s) => sum + Math.max(s.items.length, 1), 0)
    let ry = cardTop
    for (let i = 0; i < rightSections.length; i++) {
      const weight = Math.max(rightSections[i].items.length, 1) / totalRightItems
      const rh = i < rightSections.length - 1
        ? (cardAreaH - cardGap * (rightSections.length - 1)) * weight
        : (cardTop + cardAreaH) - ry
      addSectionCard(slide, pptx, 1.04 + leftW + cardGap, ry, rightW, rh, rightSections[i], accentColor)
      ry += rh + cardGap
    }
  }

  // ===== Нижняя плашка ИТОГО =====
  const barH = 1.26
  const barW = 17.92

  // Тёмный фон
  slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x: 1.04, y: bottomBarTop, w: barW, h: barH,
    fill: { color: '0B1F3A' },
    rectRadius: 0.15,
    line: { width: 0 },
  })

  // Оранжевый акцент слева
  slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x: 1.04, y: bottomBarTop, w: 2.5, h: barH,
    fill: { color: accentColor },
    rectRadius: 0.15,
    line: { width: 0 },
  })
  // Скрываем правые углы оранжевого (перекрываем тёмным)
  slide.addShape(pptx.shapes.RECTANGLE, {
    x: 2.54, y: bottomBarTop, w: 1.2, h: barH,
    fill: { color: '0B1F3A' },
    line: { width: 0 },
  })

  // «ИТОГОВАЯ СМЕТА»
  slide.addText('ИТОГОВАЯ СМЕТА', {
    x: 1.38, y: bottomBarTop + 0.25, w: 2, h: 0.2,
    fontSize: 9, bold: true, color: 'FFFFFF', fontFace: 'Arial',
  })

  // «К оплате»
  slide.addText('К оплате', {
    x: 1.38, y: bottomBarTop + 0.5, w: 2, h: 0.5,
    fontSize: 23, bold: true, color: 'FFFFFF', fontFace: 'Arial',
  })

  // Итоговая сумма
  slide.addText([
    { text: fmtNum(kp.grandTotal) + ' ', options: { fontSize: 42, bold: true, color: 'FFFFFF', fontFace: 'Arial' } },
    { text: '\u20BD', options: { fontSize: 42, bold: true, color: accentColor, fontFace: 'Arial' } },
  ], {
    x: 12, y: bottomBarTop + 0.05, w: 6.5, h: 0.8,
    align: 'right', valign: 'middle',
  })

  // Подпись
  slide.addText('Все цены указаны в рублях, с учётом скидок', {
    x: 12, y: bottomBarTop + 0.88, w: 6.5, h: 0.25,
    fontSize: 10, color: 'FFFFFF', fontFace: 'Arial',
    align: 'right',
    transparency: 40,
  })
}

// ================================================================
//  EXPORT: генерация полного КП в .pptx
// ================================================================

export async function generateKPPptx(
  kp: KPResult,
  parsed: ParsedRequest,
  isInno: boolean,
): Promise<void> {
  const PptxGenJS = (await import('pptxgenjs')).default
  const pptx = new PptxGenJS()

  // Размер слайдов как в эталоне: 20×11.25 дюймов (widescreen)
  pptx.defineLayout({ name: 'CUSTOM', width: 20, height: 11.25 })
  pptx.layout = 'CUSTOM'

  const slidesBefore = isInno ? innoSlidesBefore : bondaSlidesBefore
  const slidesAfter = isInno ? innoSlidesAfter : bondaSlidesAfter
  const accentColor = isInno ? 'FF6A1A' : 'E63C14'

  // === Слайды ДО коммерческого (картинки) ===
  for (const slideInfo of slidesBefore) {
    try {
      const imgData = await loadImageBase64(`/slides/${slideInfo.file}`)
      const slide = pptx.addSlide()
      slide.addImage({ data: imgData, x: 0, y: 0, w: 20, h: 11.25 })
    } catch {
      // skip missing slides
    }
  }

  // === Коммерческий слайд «Детализация стоимости» ===
  await addCommercialSlide(pptx, kp, parsed, accentColor, isInno)

  // === Слайды оборудования (для ИННО) ===
  if (isInno) {
    const licType = parsed.license_type || 'kiosk'
    const equipSlides = innoEquipmentSlides[licType] || []
    for (const slideInfo of equipSlides) {
      try {
        const imgData = await loadImageBase64(`/slides/${slideInfo.file}`)
        const slide = pptx.addSlide()
        slide.addImage({ data: imgData, x: 0, y: 0, w: 20, h: 11.25 })
      } catch { /* skip */ }
    }
  }

  // === Слайды ПОСЛЕ (картинки) ===
  for (const slideInfo of slidesAfter) {
    try {
      const imgData = await loadImageBase64(`/slides/${slideInfo.file}`)
      const slide = pptx.addSlide()
      slide.addImage({ data: imgData, x: 0, y: 0, w: 20, h: 11.25 })
    } catch { /* skip */ }
  }

  // Сохранение
  const fileName = `KP_${kp.clientName.replace(/[^a-zA-Zа-яА-Я0-9]/g, '_')}_${new Date().toISOString().slice(0, 10)}`
  await pptx.writeFile({ fileName })
}
