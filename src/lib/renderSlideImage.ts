/**
 * renderSlideImage.ts
 * Рендерит коммерческий слайд «Детализация стоимости» через Canvas 2D API → data URL для PDF.
 *
 * Дизайн повторяет эталонный слайд из PPTX:
 * — Светлый фон #F3F6FB
 * — Белые карточки с таблицами (НАИМЕНОВАНИЕ / КОЛ. / ЦЕНА / СКИДКА / СУММА)
 * — Тёмная плашка ИТОГО внизу с оранжевым акцентом
 *
 * БОНДА ФинДир: использует bonda_tariffs_ref.jpg как фон-шаблон.
 */
import { formatMoney, type KPResult } from './calculator'
import type { ParsedRequest } from './prompt'

const W = 1920
const H = 1080
const SCALE = 2

// --- Цвета из эталонного слайда ---
const BG = '#F3F6FB'
const DARK = '#0B1F3A'
const ORANGE = '#FF6A1A'
const GRAY_TEXT = '#6A7285'
const DATA_TEXT = '#29334A'
const MUTED = '#B8BEC9'
const WHITE = '#FFFFFF'
const SEPARATOR = '#E2E5EB'

function fmt(n: number): string {
  return formatMoney(n)
}

/** Число без символа валюты */
function fmtNum(n: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n)
}

// --- Canvas helpers ---

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function fillRoundRect(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number,
  fill: string | CanvasGradient, shadow?: { color: string; blur: number; y: number }
) {
  ctx.save()
  if (shadow) {
    ctx.shadowColor = shadow.color
    ctx.shadowBlur = shadow.blur
    ctx.shadowOffsetY = shadow.y
  }
  roundRect(ctx, x, y, w, h, r)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.restore()
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load: ${src}`))
    img.src = src
  })
}

// ================================================================
//  Рендер таблицы внутри карточки
// ================================================================

interface CardSection {
  title: string
  items: { name: string; qty: number; unitPrice: number; discount: number; total: number }[]
  subtotal: number
}

function drawSectionCard(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  section: CardSection,
  accentColor: string,
) {
  // Карточка с тенью
  fillRoundRect(ctx, x, y, w, h, 20, WHITE, {
    color: 'rgba(0,0,0,0.06)', blur: 16, y: 4,
  })

  const pad = 28
  const innerX = x + pad
  const innerW = w - pad * 2
  let cy = y + pad

  // Заголовок секции
  ctx.font = '700 22px Inter, -apple-system, sans-serif'
  ctx.fillStyle = DARK
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillText(section.title, innerX, cy)
  cy += 40

  // Колонки: НАИМЕНОВАНИЕ | КОЛ. | ЦЕНА | СКИДКА | СУММА
  // Пропорции ширин (в % от innerW)
  const colRatios = [0.42, 0.08, 0.17, 0.13, 0.20]
  const colX: number[] = []
  let cx_ = innerX
  for (const r of colRatios) {
    colX.push(cx_)
    cx_ += innerW * r
  }
  const colHeaders = ['НАИМЕНОВАНИЕ', 'КОЛ.', 'ЦЕНА', 'СКИДКА', 'СУММА']

  // Заголовки колонок
  ctx.font = '700 10px Inter, -apple-system, sans-serif'
  ctx.fillStyle = GRAY_TEXT
  for (let i = 0; i < colHeaders.length; i++) {
    const align = i >= 1 ? 'right' : 'left'
    ctx.textAlign = align
    const tx = i >= 1 ? colX[i] + innerW * colRatios[i] - 4 : colX[i]
    ctx.fillText(colHeaders[i], tx, cy)
  }
  ctx.textAlign = 'left'
  cy += 18

  // Линия под заголовком
  ctx.strokeStyle = SEPARATOR
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(innerX, cy)
  ctx.lineTo(innerX + innerW, cy)
  ctx.stroke()
  cy += 6

  // Определяем высоту строки динамически
  const availH = (y + h) - cy - 52 // 52px для ИТОГО внизу
  const rowH = Math.min(42, Math.max(28, availH / Math.max(section.items.length, 1)))

  // Строки данных
  for (const item of section.items) {
    if (cy + rowH > y + h - 48) break

    // Название (может быть длинным — обрезаем)
    ctx.font = '600 13px Inter, -apple-system, sans-serif'
    ctx.fillStyle = DARK
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    const maxNameW = innerW * colRatios[0] - 8
    let displayName = item.name
    while (ctx.measureText(displayName).width > maxNameW && displayName.length > 5) {
      displayName = displayName.slice(0, -2)
    }
    if (displayName !== item.name) displayName += '…'
    ctx.fillText(displayName, colX[0], cy + 4)

    // КОЛ.
    ctx.font = '400 12px Inter, -apple-system, sans-serif'
    ctx.fillStyle = DATA_TEXT
    ctx.textAlign = 'right'
    ctx.fillText(String(item.qty), colX[1] + innerW * colRatios[1] - 4, cy + 4)

    // ЦЕНА
    ctx.fillText(fmtNum(item.unitPrice), colX[2] + innerW * colRatios[2] - 4, cy + 4)

    // СКИДКА
    if (item.discount > 0) {
      ctx.font = '700 12px Inter, -apple-system, sans-serif'
      ctx.fillStyle = accentColor
      ctx.fillText(`-${item.discount}%`, colX[3] + innerW * colRatios[3] - 4, cy + 4)
    } else {
      ctx.font = '400 12px Inter, -apple-system, sans-serif'
      ctx.fillStyle = MUTED
      ctx.fillText('—', colX[3] + innerW * colRatios[3] - 4, cy + 4)
    }

    // СУММА
    ctx.font = '700 13px Inter, -apple-system, sans-serif'
    ctx.fillStyle = DARK
    ctx.fillText(fmtNum(item.total), colX[4] + innerW * colRatios[4] - 4, cy + 4)

    cy += rowH

    // Разделительная линия
    ctx.strokeStyle = SEPARATOR
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(innerX, cy - 4)
    ctx.lineTo(innerX + innerW, cy - 4)
    ctx.stroke()
  }

  // ИТОГО — внизу карточки
  const itogoY = y + h - 40
  ctx.font = '400 14px Inter, -apple-system, sans-serif'
  ctx.fillStyle = GRAY_TEXT
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText('ИТОГО', innerX, itogoY)

  ctx.font = '700 17px Inter, -apple-system, sans-serif'
  ctx.fillStyle = DARK
  ctx.textAlign = 'right'
  ctx.fillText(fmtNum(section.subtotal) + ' \u20BD', innerX + innerW, itogoY)
  ctx.textAlign = 'left'
}

// ================================================================
//  «Детализация стоимости» — универсальный слайд
//  Подходит для INNO (все типы) и БОНДА (не ФинДир)
// ================================================================

function renderDetailSlide(
  ctx: CanvasRenderingContext2D,
  kp: KPResult,
  parsed: ParsedRequest,
  accentColor: string,
) {
  // 1. Фон
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, W, H)

  const PAD = 100

  // 2. Заголовок «Детализация стоимости»
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.font = '900 48px Inter, -apple-system, sans-serif'
  ctx.fillStyle = DARK
  const titlePart1 = 'Детализация '
  ctx.fillText(titlePart1, PAD, 68)
  const t1w = ctx.measureText(titlePart1).width
  ctx.fillStyle = accentColor
  ctx.fillText('стоимости', PAD + t1w, 68)

  // 3. Клиент и дата (справа вверху)
  ctx.font = '700 20px Inter, -apple-system, sans-serif'
  ctx.fillStyle = DARK
  ctx.textAlign = 'right'
  ctx.fillText(kp.clientName, W - PAD, 70)

  ctx.font = '400 17px Inter, -apple-system, sans-serif'
  ctx.fillStyle = GRAY_TEXT
  ctx.fillText(kp.date, W - PAD, 98)
  ctx.textAlign = 'left'

  // 4. Разбиваем секции на layout
  const sections = kp.sections
  const cardTop = 155
  const bottomBarY = 887
  const bottomBarH = 115
  const cardAreaH = bottomBarY - cardTop - 20
  const cardGap = 22
  const totalW = W - PAD * 2

  if (sections.length === 0) {
    // Нет секций — пустой слайд
  } else if (sections.length === 1) {
    // Одна секция — центрированная карточка
    const cardW = totalW * 0.6
    const cardX = PAD + (totalW - cardW) / 2
    drawSectionCard(ctx, cardX, cardTop, cardW, cardAreaH, sections[0], accentColor)
  } else if (sections.length === 2) {
    // Две секции — равные колонки
    const cardW = (totalW - cardGap) / 2
    drawSectionCard(ctx, PAD, cardTop, cardW, cardAreaH, sections[0], accentColor)
    drawSectionCard(ctx, PAD + cardW + cardGap, cardTop, cardW, cardAreaH, sections[1], accentColor)
  } else {
    // 3+ секций: левая большая (самая длинная), справа стопка остальных
    // Находим секцию с наибольшим кол-вом позиций → ставим слева
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

    const leftW = totalW * 0.49
    const rightW = totalW - leftW - cardGap

    // Левая карточка — на всю высоту
    drawSectionCard(ctx, PAD, cardTop, leftW, cardAreaH, leftSection, accentColor)

    // Правые карточки — делим высоту пропорционально количеству позиций
    const totalRightItems = rightSections.reduce((sum, s) => sum + Math.max(s.items.length, 1), 0)
    const rightX = PAD + leftW + cardGap
    let ry = cardTop
    for (let i = 0; i < rightSections.length; i++) {
      const weight = Math.max(rightSections[i].items.length, 1) / totalRightItems
      const rh = i < rightSections.length - 1
        ? Math.round((cardAreaH - cardGap * (rightSections.length - 1)) * weight)
        : (cardTop + cardAreaH) - ry // последняя карточка до конца
      drawSectionCard(ctx, rightX, ry, rightW, rh, rightSections[i], accentColor)
      ry += rh + cardGap
    }
  }

  // 5. Нижняя плашка ИТОГО
  const barX = PAD
  const barW = totalW
  fillRoundRect(ctx, barX, bottomBarY, barW, bottomBarH, 18, DARK, {
    color: 'rgba(0,0,0,0.12)', blur: 12, y: 4,
  })

  // Оранжевый акцент слева (перекрывает левый край тёмной плашки)
  const accentW = 220
  // Рисуем тёмный фон заново чтобы левый угол был с акцентом
  ctx.save()
  roundRect(ctx, barX, bottomBarY, accentW, bottomBarH, 18)
  ctx.clip()
  ctx.fillStyle = accentColor
  ctx.fillRect(barX, bottomBarY, accentW + 20, bottomBarH)
  ctx.restore()

  // Текст «ИТОГОВАЯ СМЕТА / К оплате» на акценте
  ctx.font = '700 10px Inter, -apple-system, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.8)'
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillText('ИТОГОВАЯ СМЕТА', barX + 24, bottomBarY + 28)
  ctx.font = '800 26px Inter, -apple-system, sans-serif'
  ctx.fillStyle = WHITE
  ctx.fillText('К оплате', barX + 24, bottomBarY + 48)

  // Итоговая сумма справа
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  const totalStr = fmtNum(kp.grandTotal) + ' '
  ctx.font = '800 46px Inter, -apple-system, sans-serif'
  ctx.fillStyle = WHITE
  const totalNumW = ctx.measureText(totalStr).width
  const rublSign = '\u20BD'
  ctx.font = '800 46px Inter, -apple-system, sans-serif'
  const rublW = ctx.measureText(rublSign).width
  const totalRight = barX + barW - 32
  const totalCenterY = bottomBarY + bottomBarH / 2

  // Число — белым
  ctx.fillStyle = WHITE
  ctx.fillText(totalStr, totalRight - rublW, totalCenterY)
  // ₽ — оранжевым
  ctx.fillStyle = accentColor
  ctx.fillText(rublSign, totalRight, totalCenterY)

  // Подпись мелким шрифтом
  ctx.font = '400 10px Inter, -apple-system, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  ctx.fillText('Все цены указаны в рублях, с учётом скидок', totalRight, bottomBarY + bottomBarH / 2 + 28)

  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
}

// ================================================================
//  БОНДА ФинДир — шаблон bonda_tariffs_ref.jpg
// ================================================================
async function renderBondaFindirSlide(ctx: CanvasRenderingContext2D, kp: KPResult, parsed: ParsedRequest) {
  const RED = '#E63C14'

  const templateImg = await loadImage('/slides/bonda_tariffs_ref.jpg')
  ctx.drawImage(templateImg, 0, 0, W, H)

  const tariffMap: Record<string, number> = { 'Старт': 0, 'Про': 1, 'Ультра': 2 }
  const selectedIdx = tariffMap[parsed.findir_tariff || 'Старт'] ?? 0

  // Точные координаты получены через PIL-анализ bonda_tariffs_ref.jpg
  const cards = [
    { x: 120, y: 95, w: 470, h: 870 },
    { x: 675, y: 95, w: 460, h: 870 },
    { x: 1219, y: 95, w: 483, h: 870 },
  ]

  const sel = cards[selectedIdx]

  ctx.save()
  ctx.shadowColor = 'rgba(230, 60, 20, 0.3)'
  ctx.shadowBlur = 20
  ctx.strokeStyle = RED
  ctx.lineWidth = 5
  roundRect(ctx, sel.x - 3, sel.y - 3, sel.w + 6, sel.h + 6, 18)
  ctx.stroke()
  ctx.restore()
}

// ================================================================
//  Export
// ================================================================
export async function renderCommercialSlide(
  kp: KPResult,
  parsed: ParsedRequest,
  isInno: boolean,
): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = W * SCALE
  canvas.height = H * SCALE
  const ctx = canvas.getContext('2d')!
  ctx.scale(SCALE, SCALE)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // БОНДА ФинДир → шаблон-картинка
  if (!isInno && parsed.license_type === 'findir' && parsed.findir_tariff) {
    await renderBondaFindirSlide(ctx, kp, parsed)
  } else {
    // Все остальные (INNO + БОНДА не-ФинДир) → детализация стоимости
    const accent = isInno ? ORANGE : '#E63C14'
    renderDetailSlide(ctx, kp, parsed, accent)
  }

  return canvas.toDataURL('image/jpeg', 0.92)
}
