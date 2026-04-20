/**
 * renderSlideImage.ts
 * Рендерит коммерческий слайд через Canvas 2D API → data URL для PDF.
 *
 * БОНДА ФинДир: использует bonda_tariffs_ref.jpg как фон-шаблон,
 * подсвечивает выбранный тариф и накладывает динамические данные.
 * INNO: рисует слайд в стиле inno_product.jpg.
 */
import { formatMoney, type KPResult } from './calculator'
import type { ParsedRequest } from './prompt'
import { baseFeatures, licenseSlideTitle, licenseSlideSubtitle } from './slides'
import { getFindirPrice } from './catalog'

const W = 1920
const H = 1080
const SCALE = 2

function fmt(n: number): string {
  return formatMoney(n)
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

function strokeRoundRect(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number,
  color: string, lw: number
) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = lw
  roundRect(ctx, x, y, w, h, r)
  ctx.stroke()
  ctx.restore()
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number): number {
  const words = text.split(' ')
  let line = ''
  let cy = y
  for (const word of words) {
    const test = line + (line ? ' ' : '') + word
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, cy)
      line = word
      cy += lineHeight
    } else {
      line = test
    }
  }
  ctx.fillText(line, x, cy)
  return cy + lineHeight
}

function drawDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

// Декоративные вертикальные полоски
function drawStripes(ctx: CanvasRenderingContext2D, startX: number, endX: number, topY: number, bottomY: number) {
  ctx.save()
  ctx.globalAlpha = 0.06
  const stripeW = 4
  const gap = 12
  for (let x = startX; x < endX; x += stripeW + gap) {
    ctx.fillStyle = '#888'
    ctx.fillRect(x, topY, stripeW, bottomY - topY)
  }
  ctx.globalAlpha = 1
  ctx.restore()
}

// Загрузка изображения
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
//  БОНДА ФинДир — шаблон bonda_tariffs_ref.jpg
//  Рисует реальный слайд из презентации с подсветкой выбранного тарифа
// ================================================================
async function renderBondaFindirSlide(ctx: CanvasRenderingContext2D, kp: KPResult, parsed: ParsedRequest) {
  const RED = '#E63C14'

  // 1. Рисуем эталонный слайд из PPTX без изменений
  const templateImg = await loadImage('/slides/bonda_tariffs_ref.jpg')
  ctx.drawImage(templateImg, 0, 0, W, H)

  // 2. Определяем выбранный тариф
  const tariffMap: Record<string, number> = { 'Старт': 0, 'Про': 1, 'Ультра': 2 }
  const selectedIdx = tariffMap[parsed.findir_tariff || 'Старт'] ?? 0

  // Позиции карточек (canvas 1920×1080, масштаб из 2000×1126)
  const cards = [
    { x: 46, y: 136, w: 556, h: 870 },
    { x: 618, y: 136, w: 570, h: 870 },
    { x: 1204, y: 136, w: 570, h: 870 },
  ]

  const sel = cards[selectedIdx]

  // 3. Только рамка вокруг выбранного тарифа — минимальное вмешательство
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
//  БОНДА generic (для bonda_bi и прочих не-ФинДир КП)
// ================================================================
function renderBondaGenericSlide(ctx: CanvasRenderingContext2D, kp: KPResult, parsed: ParsedRequest) {
  const RED = '#E63C14'
  const DARK = '#1A1A1F'
  const GRAY = '#6B6E78'

  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, W, H)
  drawStripes(ctx, W * 0.72, W, 0, H)

  const pad = 80

  // Header
  ctx.font = '900 72px Inter, -apple-system, sans-serif'
  ctx.fillStyle = DARK
  ctx.textBaseline = 'top'
  ctx.fillText('Коммерческое предложение', pad, 48)

  // bondabiz logo — top-right
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  ctx.font = '900 40px Inter, -apple-system, sans-serif'
  const bizW = ctx.measureText('biz').width
  ctx.fillStyle = DARK
  ctx.fillText('bonda', W - pad - bizW, 52)
  ctx.fillStyle = RED
  ctx.fillText('biz', W - pad, 52)
  ctx.textAlign = 'left'

  ctx.font = '400 20px Inter, -apple-system, sans-serif'
  ctx.fillStyle = GRAY
  ctx.fillText(kp.clientName, pad, 136)

  // Section cards
  const sections = kp.sections
  const cardGap = 24
  const cardTop = 190
  const itogoH = 64
  const monthlyH = kp.monthlyTotal > 0 ? 40 : 0
  const cardBottom = H - 40 - itogoH - monthlyH - 16
  const cardH = cardBottom - cardTop
  const areaW = W - pad * 2
  const totalCards = sections.length
  const cardW = totalCards === 1
    ? areaW * 0.55
    : (areaW - cardGap * (totalCards - 1)) / totalCards

  sections.forEach((section, idx) => {
    const cx = totalCards === 1 ? pad : pad + idx * (cardW + cardGap)

    fillRoundRect(ctx, cx, cardTop, cardW, cardH, 20, '#F5F5F5', {
      color: 'rgba(0,0,0,0.05)', blur: 16, y: 4
    })

    ctx.save()
    roundRect(ctx, cx, cardTop, cardW, 8, 20)
    ctx.clip()
    ctx.fillStyle = RED
    ctx.fillRect(cx, cardTop, cardW, 8)
    ctx.restore()

    ctx.font = '900 28px Inter, -apple-system, sans-serif'
    ctx.fillStyle = DARK
    ctx.textBaseline = 'top'
    ctx.fillText(section.title, cx + 36, cardTop + 32)

    ctx.font = '400 18px Inter, -apple-system, sans-serif'
    ctx.fillStyle = RED
    ctx.fillText(section.items.length === 1 ? 'Состав пакета' : `${section.items.length} позиций`, cx + 36, cardTop + 68)

    let iy = cardTop + 110
    const itemSpacing = Math.min(52, (cardH - 200) / Math.max(section.items.length, 1))

    for (const item of section.items) {
      if (iy > cardBottom - 100) break
      drawDot(ctx, cx + 44, iy + 10, 6, RED)
      ctx.font = '400 20px Inter, -apple-system, sans-serif'
      ctx.fillStyle = DARK
      ctx.textBaseline = 'top'
      const nameMaxW = cardW - 240
      const nextY = wrapText(ctx, item.name, cx + 64, iy, nameMaxW, 28)
      ctx.font = '700 20px Inter, -apple-system, sans-serif'
      ctx.fillStyle = DARK
      ctx.textAlign = 'right'
      const pStr = item.qty > 1 ? `${fmt(item.unitPrice)} × ${item.qty}` : fmt(item.total)
      ctx.fillText(pStr, cx + cardW - 36, iy)
      ctx.textAlign = 'left'
      iy = Math.max(nextY, iy + itemSpacing)
    }

    const priceY = cardTop + cardH - 72
    ctx.strokeStyle = '#DCDEE2'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx + 32, priceY - 8)
    ctx.lineTo(cx + cardW - 32, priceY - 8)
    ctx.stroke()

    ctx.font = '900 40px Inter, -apple-system, sans-serif'
    ctx.fillStyle = DARK
    ctx.textBaseline = 'top'
    ctx.fillText(fmt(section.subtotal), cx + 36, priceY)
  })

  // ИТОГО bar
  const itogoY = cardBottom + 16
  fillRoundRect(ctx, pad, itogoY, areaW, itogoH, 14, RED, {
    color: 'rgba(230,60,20,0.15)', blur: 16, y: 4
  })
  ctx.font = '900 32px Inter, -apple-system, sans-serif'
  ctx.fillStyle = 'white'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(`ИТОГО: ${fmt(kp.grandTotal)}`, pad + areaW / 2, itogoY + itogoH / 2)
  ctx.textAlign = 'left'

  if (kp.monthlyTotal > 0) {
    ctx.font = '400 20px Inter, -apple-system, sans-serif'
    ctx.fillStyle = GRAY
    ctx.textAlign = 'center'
    ctx.fillText(`Ежемесячно: ${fmt(kp.monthlyTotal)}`, pad + areaW / 2, itogoY + itogoH + 20)
    ctx.textAlign = 'left'
  }
}

// ================================================================
//  БОНДА router
// ================================================================
async function renderBondaSlide(ctx: CanvasRenderingContext2D, kp: KPResult, parsed: ParsedRequest) {
  const isFindir = parsed.license_type === 'findir' && parsed.findir_tariff
  if (isFindir) {
    await renderBondaFindirSlide(ctx, kp, parsed)
  } else {
    renderBondaGenericSlide(ctx, kp, parsed)
  }
}

// ================================================================
//  INNO slide — фон inno_product.jpg + прозрачная панель с ценами
// ================================================================
async function renderInnoSlide(ctx: CanvasRenderingContext2D, kp: KPResult, parsed: ParsedRequest) {
  const licType = parsed.license_type || 'kiosk'
  const title = licenseSlideTitle[licType] || 'Inno Clouds'
  const features = baseFeatures[licType] || baseFeatures.kiosk

  const svcSection = kp.sections.find(s => s.title === 'Услуги')
  const licSection = kp.sections.find(s => s.title === 'Лицензии и подписки')
  const equipSection = kp.sections.find(s => s.title === 'Оборудование')

  const DARK = '#3A3F4B'
  const ORANGE = '#FF6B00'
  const GRAY = '#8A8F9E'

  // 1. Рисуем inno_product.jpg как фон
  const templateImg = await loadImage('/slides/inno_product.jpg')
  ctx.drawImage(templateImg, 0, 0, W, H)

  // 2. Полупрозрачная панель на левой половине для контента
  const panelW = W * 0.52
  const panelH = H - 40
  fillRoundRect(ctx, 20, 20, panelW, panelH, 24, 'rgba(255, 255, 255, 0.88)', {
    color: 'rgba(0,0,0,0.08)', blur: 20, y: 4
  })

  const pad = 52
  const contentTop = 44

  // 3. Заголовок
  ctx.font = '900 42px Inter, -apple-system, sans-serif'
  ctx.fillStyle = DARK
  ctx.textBaseline = 'top'
  ctx.fillText(title, pad, contentTop)

  // Клиент и локации
  ctx.font = '400 18px Inter, -apple-system, sans-serif'
  ctx.fillStyle = GRAY
  const locWord = parsed.locations === 1 ? 'точка' : parsed.locations < 5 ? 'точки' : 'точек'
  ctx.fillText(`${kp.clientName}  •  ${parsed.locations} ${locWord}`, pad, contentTop + 52)

  // 4. Фичи — компактный список
  let fy = contentTop + 96
  ctx.font = '700 16px Inter, -apple-system, sans-serif'
  ctx.fillStyle = DARK
  ctx.fillText('Базовый пакет:', pad, fy)
  fy += 30

  const maxFeats = Math.min(features.length, 8)
  for (let i = 0; i < maxFeats; i++) {
    drawDot(ctx, pad + 8, fy + 8, 4, ORANGE)
    ctx.font = '400 14px Inter, -apple-system, sans-serif'
    ctx.fillStyle = DARK
    ctx.textBaseline = 'top'
    const nextY = wrapText(ctx, features[i], pad + 22, fy, panelW - 100, 19)
    fy = Math.max(nextY, fy + 24)
  }

  // 5. Разделитель
  fy += 8
  ctx.strokeStyle = '#D8DBE3'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(pad, fy)
  ctx.lineTo(pad + panelW - 80, fy)
  ctx.stroke()
  fy += 20

  // 6. Стоимость — блоки
  const renderPriceLine = (label: string, amount: number, accent: boolean, sub?: string) => {
    ctx.font = '400 15px Inter, -apple-system, sans-serif'
    ctx.fillStyle = GRAY
    ctx.textBaseline = 'top'
    ctx.fillText(label, pad, fy)
    fy += 22
    ctx.font = '800 32px Inter, -apple-system, sans-serif'
    ctx.fillStyle = accent ? ORANGE : DARK
    ctx.fillText(fmt(amount), pad, fy)
    if (sub) {
      const priceW = ctx.measureText(fmt(amount)).width
      ctx.font = '400 16px Inter, -apple-system, sans-serif'
      ctx.fillStyle = GRAY
      ctx.fillText(sub, pad + priceW + 12, fy + 10)
    }
    fy += 46
  }

  if (licSection && licSection.subtotal > 0) {
    renderPriceLine('Стоимость лицензии', licSection.subtotal, true,
      kp.monthlyTotal > 0 ? `(${fmt(kp.monthlyTotal)}/мес)` : undefined)
  }
  if (svcSection && svcSection.subtotal > 0) {
    renderPriceLine('Стоимость внедрения', svcSection.subtotal, false)
  }
  if (equipSection && equipSection.subtotal > 0) {
    renderPriceLine('Стоимость оборудования', equipSection.subtotal, false)
  }

  // 7. ИТОГО
  fy += 4
  const itogoW = panelW - 64
  const itogoH = 52
  fillRoundRect(ctx, pad, fy, itogoW, itogoH, 14, ORANGE, {
    color: 'rgba(255,107,0,0.2)', blur: 12, y: 4
  })
  ctx.font = '800 24px Inter, -apple-system, sans-serif'
  ctx.fillStyle = 'white'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(`ИТОГО: ${fmt(kp.grandTotal)}`, pad + itogoW / 2, fy + itogoH / 2)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
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

  if (isInno) {
    await renderInnoSlide(ctx, kp, parsed)
  } else {
    await renderBondaSlide(ctx, kp, parsed)
  }

  return canvas.toDataURL('image/jpeg', 0.92)
}
