/**
 * renderSlideImage.ts
 * Рендерит коммерческий слайд через Canvas 2D API → возвращает data URL картинки.
 * Вставляется в PDF вместо jsPDF-рисования.
 *
 * Canvas 2D даёт: градиенты, тени, скруглённые углы, качественные шрифты.
 */
import { formatMoney, type KPResult } from './calculator'
import type { ParsedRequest } from './prompt'
import { baseFeatures, licenseSlideTitle, licenseSlideSubtitle } from './slides'

const W = 1920
const H = 1080
const SCALE = 2  // Retina quality

function fmt(n: number): string {
  return formatMoney(n)
}

// Helper: скруглённый прямоугольник
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

// Helper: скруглённый прямоугольник с заливкой + опциональная тень
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

// Helper: многострочный текст с переносом
function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number): number {
  const words = text.split(' ')
  let line = ''
  let currentY = y
  for (const word of words) {
    const test = line + (line ? ' ' : '') + word
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, currentY)
      line = word
      currentY += lineHeight
    } else {
      line = test
    }
  }
  ctx.fillText(line, x, currentY)
  return currentY + lineHeight
}

// Helper: галочка SVG-path
function drawCheckmark(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = size * 0.22
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(cx - size * 0.35, cy + size * 0.02)
  ctx.lineTo(cx - size * 0.05, cy + size * 0.3)
  ctx.lineTo(cx + size * 0.4, cy - size * 0.25)
  ctx.stroke()
  ctx.restore()
}

// Helper: плюс
function drawPlus(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = size * 0.2
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(cx, cy - size * 0.3)
  ctx.lineTo(cx, cy + size * 0.3)
  ctx.moveTo(cx - size * 0.3, cy)
  ctx.lineTo(cx + size * 0.3, cy)
  ctx.stroke()
  ctx.restore()
}

// Helper: стрелка
function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, color: string) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 3.5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + len - 10, y)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x + len - 16, y - 8)
  ctx.lineTo(x + len, y)
  ctx.lineTo(x + len - 16, y + 8)
  ctx.stroke()
  ctx.restore()
}

// ================================================================
//  INNO slide
// ================================================================
function renderInnoSlide(ctx: CanvasRenderingContext2D, kp: KPResult, parsed: ParsedRequest) {
  const licType = parsed.license_type || 'kiosk'
  const title = licenseSlideTitle[licType] || 'Inno Clouds'
  const subtitle = licenseSlideSubtitle[licType] || ''
  const features = baseFeatures[licType] || baseFeatures.kiosk

  const svcSection = kp.sections.find(s => s.title === 'Услуги')
  const licSection = kp.sections.find(s => s.title === 'Лицензии и подписки')
  const equipSection = kp.sections.find(s => s.title === 'Оборудование')

  // Background
  ctx.fillStyle = '#EDF0F8'
  ctx.fillRect(0, 0, W, H)

  const pad = 56

  // === HEADER ===
  // Title
  ctx.font = '800 52px Inter, -apple-system, BlinkMacSystemFont, sans-serif'
  ctx.fillStyle = '#282D37'
  ctx.textBaseline = 'middle'
  ctx.fillText(title, pad, 72)
  const titleW = ctx.measureText(title).width

  // Arrow
  drawArrow(ctx, pad + titleW + 24, 72, 70, '#FF6B00')

  // Subtitle (right aligned)
  if (subtitle) {
    ctx.font = '400 17px Inter, -apple-system, sans-serif'
    ctx.fillStyle = '#787D87'
    ctx.textAlign = 'right'
    // Wrap subtitle
    const maxSubW = 460
    const words = subtitle.split(' ')
    let line = ''
    let sy = 62
    for (const word of words) {
      const test = line + (line ? ' ' : '') + word
      if (ctx.measureText(test).width > maxSubW && line) {
        ctx.fillText(line, W - pad, sy)
        line = word
        sy += 24
      } else {
        line = test
      }
    }
    ctx.fillText(line, W - pad, sy)
    ctx.textAlign = 'left'
  }

  // === LEFT COLUMN ===
  const leftW = W - pad * 2 - 400 - 32  // total width minus right column minus gap
  const rightX = W - pad - 380

  // --- Orange features box ---
  const featTop = 120
  const hasSvc = svcSection && svcSection.items.length > 0
  const featBottom = hasSvc ? H - 230 : H - 80
  const featH = featBottom - featTop

  const orangeGrad = ctx.createLinearGradient(pad, featTop, pad + leftW, featTop + featH)
  orangeGrad.addColorStop(0, '#FF8C00')
  orangeGrad.addColorStop(1, '#FF5500')

  fillRoundRect(ctx, pad, featTop, leftW, featH, 20, orangeGrad, { color: 'rgba(255,100,0,0.2)', blur: 32, y: 8 })

  // Title icon + text
  const iconSize = 32
  fillRoundRect(ctx, pad + 32, featTop + 28, iconSize, iconSize, 8, 'rgba(255,255,255,0.95)', { color: 'rgba(0,0,0,0.1)', blur: 8, y: 2 })
  drawCheckmark(ctx, pad + 32 + iconSize / 2, featTop + 28 + iconSize / 2, iconSize * 0.5, '#FF7800')

  ctx.font = '800 30px Inter, -apple-system, sans-serif'
  ctx.fillStyle = 'white'
  ctx.textBaseline = 'middle'
  ctx.fillText('Базовый пакет услуг', pad + 32 + iconSize + 14, featTop + 28 + iconSize / 2)

  // Features in 2 columns
  const half = Math.ceil(features.length / 2)
  const col1X = pad + 42
  const col2X = pad + leftW / 2 + 10
  const featStartY = featTop + 88
  const featLineH = hasSvc ? Math.min(48, (featH - 100) / half) : Math.min(52, (featH - 100) / half)

  features.forEach((feat, i) => {
    const isLeft = i < half
    const x = isLeft ? col1X : col2X
    const row = isLeft ? i : i - half
    const y = featStartY + row * featLineH

    // Checkmark box
    const cbSize = 24
    fillRoundRect(ctx, x, y, cbSize, cbSize, 6, 'rgba(255,255,255,0.92)')
    drawCheckmark(ctx, x + cbSize / 2, y + cbSize / 2, cbSize * 0.4, '#FF7800')

    // Feature text
    ctx.font = '400 16px Inter, -apple-system, sans-serif'
    ctx.fillStyle = 'white'
    ctx.textBaseline = 'top'
    const maxFeatW = leftW / 2 - 80
    wrapText(ctx, feat, x + cbSize + 12, y + 3, maxFeatW, 21)
  })

  // --- Gray services box (only if has services) ---
  if (hasSvc) {
    const svcTop = featBottom + 16
    const svcH = H - pad - svcTop
    const grayGrad = ctx.createLinearGradient(pad, svcTop, pad + leftW, svcTop + svcH)
    grayGrad.addColorStop(0, '#A8ADBC')
    grayGrad.addColorStop(1, '#8E93A4')

    fillRoundRect(ctx, pad, svcTop, leftW, svcH, 20, grayGrad, { color: 'rgba(0,0,0,0.08)', blur: 20, y: 4 })

    // Icon + title
    fillRoundRect(ctx, pad + 32, svcTop + 20, iconSize, iconSize, 8, 'rgba(255,255,255,0.95)')
    drawPlus(ctx, pad + 32 + iconSize / 2, svcTop + 20 + iconSize / 2, iconSize * 0.45, '#8E93A4')

    ctx.font = '800 26px Inter, -apple-system, sans-serif'
    ctx.fillStyle = 'white'
    ctx.textBaseline = 'middle'
    ctx.fillText('Услуги внедрения', pad + 32 + iconSize + 14, svcTop + 20 + iconSize / 2)

    // Service items
    let sy = svcTop + 68
    for (const item of svcSection!.items) {
      // Name
      ctx.font = '400 16px Inter, -apple-system, sans-serif'
      ctx.fillStyle = 'rgba(255,255,255,0.9)'
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      ctx.fillText(item.name, pad + 40, sy)

      // Price
      ctx.font = '700 17px Inter, -apple-system, sans-serif'
      ctx.fillStyle = 'white'
      ctx.textAlign = 'right'
      const priceStr = item.qty > 1
        ? `${fmt(item.unitPrice)} \u00D7 ${item.qty}`
        : fmt(item.total)
      ctx.fillText(priceStr, pad + leftW - 40, sy)
      ctx.textAlign = 'left'

      // Separator line
      sy += 16
      ctx.strokeStyle = 'rgba(255,255,255,0.15)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(pad + 40, sy)
      ctx.lineTo(pad + leftW - 40, sy)
      ctx.stroke()
      sy += 16
    }
  }

  // === RIGHT COLUMN — price cards ===
  const cardW = 380
  let cardY = 120

  // Count cards row
  const hasDevices = parsed.devices > 0
  const countW = hasDevices ? (cardW - 14) / 2 : cardW

  // "Кол-во точек"
  fillRoundRect(ctx, rightX, cardY, countW, 110, 16, 'white', { color: 'rgba(0,0,0,0.07)', blur: 24, y: 4 })
  ctx.font = '400 14px Inter, -apple-system, sans-serif'
  ctx.fillStyle = '#9098A8'
  ctx.textBaseline = 'top'
  ctx.fillText('Кол-во', rightX + 24, cardY + 20)
  ctx.fillText('точек', rightX + 24, cardY + 38)
  ctx.font = '800 52px Inter, -apple-system, sans-serif'
  ctx.fillStyle = '#282D37'
  ctx.textAlign = 'center'
  ctx.fillText(String(parsed.locations), rightX + countW / 2, cardY + 65)
  ctx.textAlign = 'left'

  // "Кол-во устройств"
  if (hasDevices) {
    const d2X = rightX + countW + 14
    fillRoundRect(ctx, d2X, cardY, countW, 110, 16, 'white', { color: 'rgba(0,0,0,0.07)', blur: 24, y: 4 })
    ctx.font = '400 14px Inter, -apple-system, sans-serif'
    ctx.fillStyle = '#9098A8'
    ctx.textBaseline = 'top'
    ctx.fillText('Кол-во', d2X + 24, cardY + 20)
    ctx.fillText('устройств', d2X + 24, cardY + 38)
    ctx.font = '800 52px Inter, -apple-system, sans-serif'
    ctx.fillStyle = '#282D37'
    ctx.textAlign = 'center'
    ctx.fillText(String(parsed.devices), d2X + countW / 2, cardY + 65)
    ctx.textAlign = 'left'
  }

  cardY += 126

  // Price cards
  const renderPriceCard = (label: string, amount: number, sub?: string) => {
    const cardH = sub ? 140 : 120
    fillRoundRect(ctx, rightX, cardY, cardW, cardH, 16, 'white', { color: 'rgba(0,0,0,0.07)', blur: 24, y: 4 })
    ctx.font = '400 15px Inter, -apple-system, sans-serif'
    ctx.fillStyle = '#9098A8'
    ctx.textBaseline = 'top'
    ctx.fillText(label, rightX + 28, cardY + 22)
    ctx.font = '800 42px Inter, -apple-system, sans-serif'
    ctx.fillStyle = '#FF6B00'
    ctx.fillText(fmt(amount), rightX + 28, cardY + 48)
    if (sub) {
      ctx.font = '400 15px Inter, -apple-system, sans-serif'
      ctx.fillStyle = '#9098A8'
      ctx.fillText(sub, rightX + 28, cardY + 100)
    }
    cardY += cardH + 16
  }

  if (svcSection && svcSection.subtotal > 0) {
    renderPriceCard('Стоимость внедрения', svcSection.subtotal)
  }

  if (licSection && licSection.subtotal > 0) {
    renderPriceCard(
      'Стоимость лицензии',
      licSection.subtotal,
      kp.monthlyTotal > 0 ? `(${fmt(kp.monthlyTotal)}/мес)` : undefined
    )
  }

  if (equipSection && equipSection.subtotal > 0) {
    renderPriceCard('Стоимость оборудования', equipSection.subtotal)
  }
}

// ================================================================
//  БОНДА slide
// ================================================================
function renderBondaSlide(ctx: CanvasRenderingContext2D, kp: KPResult, parsed: ParsedRequest) {
  const bondaRed = '#E63C14'
  const bondaDark = '#232328'

  // Background
  ctx.fillStyle = '#EDF0F8'
  ctx.fillRect(0, 0, W, H)

  const pad = 56
  const bondaTitle = parsed.license_type === 'findir'
    ? `\u0422\u0430\u0440\u0438\u0444 \u00AB${parsed.findir_tariff || '\u0421\u0442\u0430\u0440\u0442'}\u00BB`
    : 'BONDA BI'

  // === HEADER ===
  ctx.font = '800 52px Inter, -apple-system, sans-serif'
  ctx.fillStyle = bondaDark
  ctx.textBaseline = 'top'
  ctx.fillText(bondaTitle, pad, pad)

  // Subtitle
  const locWord = parsed.locations === 1 ? 'ресторан' : parsed.locations < 5 ? 'ресторана' : 'ресторанов'
  ctx.font = '400 17px Inter, -apple-system, sans-serif'
  ctx.fillStyle = '#787D87'
  ctx.fillText(`стоимость на ${parsed.locations} ${locWord}  \u2022  ${kp.clientName}`, pad, pad + 64)

  // bondabiz logo
  ctx.textAlign = 'right'
  ctx.font = '800 24px Inter, -apple-system, sans-serif'
  ctx.fillStyle = bondaDark
  const bondaTextW = ctx.measureText('bonda').width
  ctx.fillText('bonda', W - pad - ctx.measureText('biz').width, pad + 8)
  ctx.fillStyle = bondaRed
  ctx.fillText('biz', W - pad, pad + 8)
  ctx.textAlign = 'left'

  // Red separator
  const sepY = pad + 100
  ctx.fillStyle = bondaRed
  fillRoundRect(ctx, pad, sepY, W - pad * 2, 4, 2, bondaRed)

  // === SECTION CARDS ===
  const sections = kp.sections
  const cardGap = 24
  const areaW = W - pad * 2
  const totalCards = sections.length
  const cardW = totalCards > 1 ? (areaW - cardGap * (totalCards - 1)) / totalCards : areaW * 0.5
  const cardTop = sepY + 36
  const itogoBarH = 64
  const monthlyH = kp.monthlyTotal > 0 ? 36 : 0
  const maxCardBottom = H - pad - itogoBarH - monthlyH - 24
  // Calculate card height based on content: header(68) + items(36 each) + subtotal(52) + padding(28)
  const maxItems = Math.max(...sections.map(s => s.items.length))
  const contentCardH = 68 + maxItems * 36 + 52 + 28
  const cardH = Math.min(contentCardH, maxCardBottom - cardTop)
  const cardBottom = cardTop + cardH

  sections.forEach((section, idx) => {
    const cx = pad + idx * (cardW + cardGap)

    // Card background
    fillRoundRect(ctx, cx, cardTop, cardW, cardH, 16, 'white', { color: 'rgba(0,0,0,0.06)', blur: 24, y: 4 })

    // Red top accent
    ctx.save()
    roundRect(ctx, cx, cardTop, cardW, 6, 16)
    ctx.clip()
    ctx.fillStyle = bondaRed
    ctx.fillRect(cx, cardTop, cardW, 6)
    ctx.restore()

    // Section title
    ctx.font = '800 21px Inter, -apple-system, sans-serif'
    ctx.fillStyle = bondaDark
    ctx.textBaseline = 'top'
    ctx.fillText(section.title, cx + 28, cardTop + 28)

    // Items
    let iy = cardTop + 68
    const maxItemH = cardH - 120
    for (const item of section.items) {
      if (iy - cardTop - 68 > maxItemH) break

      // Name
      ctx.font = '400 15px Inter, -apple-system, sans-serif'
      ctx.fillStyle = '#5A5D66'
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      const itemText = item.name.length > 40 ? item.name.substring(0, 40) + '...' : item.name
      ctx.fillText(itemText, cx + 28, iy)

      // Price
      ctx.font = '700 16px Inter, -apple-system, sans-serif'
      ctx.fillStyle = bondaDark
      ctx.textAlign = 'right'
      const pStr = item.qty > 1
        ? `${fmt(item.unitPrice)} \u00D7 ${item.qty}`
        : fmt(item.total)
      ctx.fillText(pStr, cx + cardW - 28, iy)
      ctx.textAlign = 'left'

      // Separator
      iy += 18
      ctx.strokeStyle = '#F0F1F3'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(cx + 28, iy)
      ctx.lineTo(cx + cardW - 28, iy)
      ctx.stroke()
      iy += 18
    }

    // Subtotal at bottom
    const subY = cardTop + cardH - 52
    ctx.fillStyle = '#FAFBFC'
    roundRect(ctx, cx, subY, cardW, 52, 0)
    ctx.fill()
    // Fix bottom corners
    ctx.save()
    roundRect(ctx, cx, cardTop + cardH - 16, cardW, 16, 16)
    ctx.clip()
    ctx.fillStyle = '#FAFBFC'
    ctx.fillRect(cx, cardTop + cardH - 16, cardW, 16)
    ctx.restore()

    ctx.font = '800 28px Inter, -apple-system, sans-serif'
    ctx.fillStyle = bondaRed
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${fmt(section.subtotal)}/мес`, cx + cardW / 2, subY + 26)
    ctx.textAlign = 'left'
  })

  // === ИТОГО BAR ===
  const itogoY = cardBottom + 24
  fillRoundRect(ctx, pad, itogoY, areaW, itogoBarH, 14, bondaRed, { color: 'rgba(230,60,20,0.25)', blur: 24, y: 6 })
  ctx.font = '800 32px Inter, -apple-system, sans-serif'
  ctx.fillStyle = 'white'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(`ИТОГО: ${fmt(kp.grandTotal)}`, W / 2, itogoY + itogoBarH / 2)
  ctx.textAlign = 'left'

  // Monthly
  if (kp.monthlyTotal > 0) {
    ctx.font = '400 17px Inter, -apple-system, sans-serif'
    ctx.fillStyle = '#787D87'
    ctx.textAlign = 'center'
    ctx.fillText(`Ежемесячно: ${fmt(kp.monthlyTotal)}`, W / 2, itogoY + itogoBarH + 22)
    ctx.textAlign = 'left'
  }
}

// ================================================================
//  Основная функция
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

  // Включаем сглаживание
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  if (isInno) {
    renderInnoSlide(ctx, kp, parsed)
  } else {
    renderBondaSlide(ctx, kp, parsed)
  }

  return canvas.toDataURL('image/jpeg', 0.92)
}
