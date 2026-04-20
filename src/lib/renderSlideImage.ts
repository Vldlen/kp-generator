/**
 * renderSlideImage.ts
 * Рендерит коммерческий слайд через Canvas 2D API → data URL для PDF.
 * Дизайн точно повторяет стиль PPTX-слайдов презентации.
 */
import { formatMoney, type KPResult } from './calculator'
import type { ParsedRequest } from './prompt'
import { baseFeatures, licenseSlideTitle, licenseSlideSubtitle } from './slides'

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

// Декоративные вертикальные полоски (как в БОНДА презентации, справа)
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

// ================================================================
//  БОНДА slide — стиль bonda_tariffs_ref.jpg
// ================================================================
function renderBondaSlide(ctx: CanvasRenderingContext2D, kp: KPResult, parsed: ParsedRequest) {
  const RED = '#E63C14'
  const DARK = '#1A1A1F'
  const GRAY = '#6B6E78'
  const LIGHT_GRAY = '#EAEAEA'

  // === WHITE BACKGROUND ===
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, W, H)

  // Декоративные полоски справа (как в презентации)
  drawStripes(ctx, W * 0.72, W, 0, H)

  const pad = 80

  // === HEADER ===
  // "Тариф «Старт»" — жирный крупный, как в bonda_tariffs_ref
  const bondaTitle = parsed.license_type === 'findir'
    ? `Тариф «${parsed.findir_tariff || 'Старт'}»`
    : 'Коммерческое предложение'

  ctx.font = '900 72px Inter, -apple-system, sans-serif'
  ctx.fillStyle = DARK
  ctx.textBaseline = 'top'
  ctx.fillText(bondaTitle, pad, 48)

  // "стоимость на X ресторан" — обычный, рядом с заголовком
  const titleW = ctx.measureText(bondaTitle).width
  const locWord = parsed.locations === 1 ? 'ресторан' : parsed.locations < 5 ? 'ресторана' : 'ресторанов'
  ctx.font = '400 28px Inter, -apple-system, sans-serif'
  ctx.fillStyle = GRAY
  ctx.fillText(`стоимость на ${parsed.locations} ${locWord}`, pad + titleW + 32, 76)

  // bondabiz logo — top-right, как в презентации
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  ctx.font = '900 40px Inter, -apple-system, sans-serif'
  const bizW = ctx.measureText('biz').width
  ctx.fillStyle = DARK
  ctx.fillText('bonda', W - pad - bizW, 52)
  ctx.fillStyle = RED
  ctx.fillText('biz', W - pad, 52)
  ctx.textAlign = 'left'

  // Для клиента
  ctx.font = '400 20px Inter, -apple-system, sans-serif'
  ctx.fillStyle = GRAY
  ctx.fillText(kp.clientName, pad, 136)

  // === SECTION CARDS ===
  // Стиль: как карточки тарифов — белый фон, скруглённые углы, оранжевый акцент сверху
  const sections = kp.sections
  const cardGap = 24
  const cardTop = 190
  // ИТОГО бар снизу
  const itogoH = 64
  const monthlyH = kp.monthlyTotal > 0 ? 40 : 0
  const cardBottom = H - 40 - itogoH - monthlyH - 16
  const cardH = cardBottom - cardTop

  // Карточки заполняют всю ширину (как тарифы)
  const areaW = W - pad * 2
  const totalCards = sections.length
  // Для 1 секции — карточка на ~65% ширины; для нескольких — равномерно
  const cardW = totalCards === 1
    ? areaW * 0.55
    : (areaW - cardGap * (totalCards - 1)) / totalCards

  sections.forEach((section, idx) => {
    const cx = totalCards === 1
      ? pad  // от левого края
      : pad + idx * (cardW + cardGap)

    // Card bg — светло-серый как в тарифах
    fillRoundRect(ctx, cx, cardTop, cardW, cardH, 20, '#F5F5F5', {
      color: 'rgba(0,0,0,0.05)', blur: 16, y: 4
    })

    // Orange top accent bar — как у "Развитие" в тарифах
    ctx.save()
    roundRect(ctx, cx, cardTop, cardW, 8, 20)
    ctx.clip()
    ctx.fillStyle = RED
    ctx.fillRect(cx, cardTop, cardW, 8)
    ctx.restore()

    // Section title — bold, dark — как "Безопасность" в тарифах
    ctx.font = '900 28px Inter, -apple-system, sans-serif'
    ctx.fillStyle = DARK
    ctx.textBaseline = 'top'
    ctx.fillText(section.title, cx + 36, cardTop + 32)

    // Subtitle (описание секции)
    ctx.font = '400 18px Inter, -apple-system, sans-serif'
    ctx.fillStyle = RED
    ctx.fillText(section.items.length === 1 ? 'Состав пакета' : `${section.items.length} позиций`, cx + 36, cardTop + 68)

    // Items — orange dot bullets, like tariff features
    let iy = cardTop + 110
    const itemSpacing = Math.min(52, (cardH - 200) / Math.max(section.items.length, 1))

    for (const item of section.items) {
      if (iy > cardBottom - 100) break

      // Orange dot bullet
      drawDot(ctx, cx + 44, iy + 10, 6, RED)

      // Item name — может быть длинным, переносим
      ctx.font = '400 20px Inter, -apple-system, sans-serif'
      ctx.fillStyle = DARK
      ctx.textBaseline = 'top'
      const nameMaxW = cardW - 240
      const nextY = wrapText(ctx, item.name, cx + 64, iy, nameMaxW, 28)

      // Price — справа
      ctx.font = '700 20px Inter, -apple-system, sans-serif'
      ctx.fillStyle = DARK
      ctx.textAlign = 'right'
      const pStr = item.qty > 1
        ? `${fmt(item.unitPrice)} × ${item.qty}`
        : fmt(item.total)
      ctx.fillText(pStr, cx + cardW - 36, iy)
      ctx.textAlign = 'left'

      iy = Math.max(nextY, iy + itemSpacing)
    }

    // Price at bottom of card — крупная, как "50 000 ₽/мес" в тарифах
    const priceY = cardTop + cardH - 72
    // Separator line
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

  // === ИТОГО BAR (full width) ===
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
//  INNO slide — стиль inno_product.jpg / inno_multiformat.jpg
// ================================================================
function renderInnoSlide(ctx: CanvasRenderingContext2D, kp: KPResult, parsed: ParsedRequest) {
  const licType = parsed.license_type || 'kiosk'
  const title = licenseSlideTitle[licType] || 'Inno Clouds'
  const subtitle = licenseSlideSubtitle[licType] || ''
  const features = baseFeatures[licType] || baseFeatures.kiosk

  const svcSection = kp.sections.find(s => s.title === 'Услуги')
  const licSection = kp.sections.find(s => s.title === 'Лицензии и подписки')
  const equipSection = kp.sections.find(s => s.title === 'Оборудование')

  const DARK = '#3A3F4B'
  const ORANGE = '#FF6B00'
  const GRAY = '#8A8F9E'
  const BG = '#E8EAF0'
  const CARD_BG = '#F0F1F5'
  const CARD_BORDER = '#C8CCDA'

  // === BACKGROUND ===
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, W, H)

  const pad = 72

  // === HEADER ===
  // INNO. logo
  ctx.font = '900 32px Inter, -apple-system, sans-serif'
  ctx.fillStyle = DARK
  ctx.textBaseline = 'top'
  ctx.fillText('INNO', pad, 36)
  const innoW = ctx.measureText('INNO').width
  ctx.fillStyle = ORANGE
  ctx.fillText('.', pad + innoW, 36)

  // Title
  ctx.font = '900 48px Inter, -apple-system, sans-serif'
  ctx.fillStyle = DARK
  ctx.fillText(title, pad, 84)

  // Subtitle
  if (subtitle) {
    ctx.font = '400 18px Inter, -apple-system, sans-serif'
    ctx.fillStyle = GRAY
    wrapText(ctx, subtitle, pad, 148, W * 0.5, 26)
  }

  // Client info (right)
  ctx.textAlign = 'right'
  ctx.font = '400 20px Inter, -apple-system, sans-serif'
  ctx.fillStyle = GRAY
  ctx.fillText(`${kp.clientName}  •  ${parsed.locations} точ.`, W - pad, 44)
  ctx.textAlign = 'left'

  // === LAYOUT: features left, prices right ===
  const rightColW = 420
  const leftW = W - pad * 2 - rightColW - 40
  const contentTop = 200

  // === LEFT: Features card ===
  const hasSvc = svcSection && svcSection.items.length > 0
  const featCardH = hasSvc ? H - contentTop - 220 : H - contentTop - 60

  fillRoundRect(ctx, pad, contentTop, leftW, featCardH, 20, CARD_BG, {
    color: 'rgba(0,0,0,0.04)', blur: 12, y: 2
  })
  strokeRoundRect(ctx, pad, contentTop, leftW, featCardH, 20, CARD_BORDER, 1.5)

  // Orange top accent
  ctx.save()
  roundRect(ctx, pad, contentTop, leftW, 6, 20)
  ctx.clip()
  ctx.fillStyle = ORANGE
  ctx.fillRect(pad, contentTop, leftW, 6)
  ctx.restore()

  // Card title
  ctx.font = '800 24px Inter, -apple-system, sans-serif'
  ctx.fillStyle = DARK
  ctx.textBaseline = 'top'
  ctx.fillText('Базовый пакет услуг', pad + 32, contentTop + 24)

  // Features in 2 columns
  const half = Math.ceil(features.length / 2)
  const col1X = pad + 32
  const col2X = pad + leftW / 2 + 16
  const featStartY = contentTop + 72
  const featLineH = Math.min(50, (featCardH - 100) / half)

  features.forEach((feat, i) => {
    const isLeft = i < half
    const x = isLeft ? col1X : col2X
    const row = isLeft ? i : i - half
    const y = featStartY + row * featLineH

    drawDot(ctx, x + 6, y + 10, 5, ORANGE)

    ctx.font = '400 16px Inter, -apple-system, sans-serif'
    ctx.fillStyle = DARK
    ctx.textBaseline = 'top'
    wrapText(ctx, feat, x + 22, y + 2, leftW / 2 - 80, 21)
  })

  // === LEFT: Services card (if any) ===
  if (hasSvc) {
    const svcTop = contentTop + featCardH + 16
    const svcH = H - svcTop - 60

    fillRoundRect(ctx, pad, svcTop, leftW, svcH, 20, CARD_BG, {
      color: 'rgba(0,0,0,0.04)', blur: 12, y: 2
    })
    strokeRoundRect(ctx, pad, svcTop, leftW, svcH, 20, CARD_BORDER, 1.5)

    // Gray top accent
    ctx.save()
    roundRect(ctx, pad, svcTop, leftW, 6, 20)
    ctx.clip()
    ctx.fillStyle = GRAY
    ctx.fillRect(pad, svcTop, leftW, 6)
    ctx.restore()

    ctx.font = '800 22px Inter, -apple-system, sans-serif'
    ctx.fillStyle = DARK
    ctx.textBaseline = 'top'
    ctx.fillText('Услуги внедрения', pad + 32, svcTop + 22)

    let sy = svcTop + 62
    for (const item of svcSection.items) {
      if (sy > svcTop + svcH - 20) break
      drawDot(ctx, pad + 38, sy + 8, 4, GRAY)
      ctx.font = '400 16px Inter, -apple-system, sans-serif'
      ctx.fillStyle = DARK
      ctx.textBaseline = 'top'
      ctx.fillText(item.name, pad + 52, sy)
      ctx.font = '700 16px Inter, -apple-system, sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText(item.qty > 1 ? `${fmt(item.unitPrice)} × ${item.qty}` : fmt(item.total), pad + leftW - 32, sy)
      ctx.textAlign = 'left'
      sy += 36
    }
  }

  // === RIGHT: Price cards ===
  const rightX = W - pad - rightColW
  let cardY = contentTop

  // Location count
  const hasDevices = parsed.devices > 0
  const countW = hasDevices ? (rightColW - 16) / 2 : rightColW

  fillRoundRect(ctx, rightX, cardY, countW, 110, 16, CARD_BG)
  strokeRoundRect(ctx, rightX, cardY, countW, 110, 16, CARD_BORDER, 1.5)
  ctx.font = '400 15px Inter, -apple-system, sans-serif'
  ctx.fillStyle = GRAY
  ctx.textBaseline = 'top'
  ctx.fillText('Кол-во точек', rightX + 24, cardY + 18)
  ctx.font = '800 48px Inter, -apple-system, sans-serif'
  ctx.fillStyle = DARK
  ctx.textAlign = 'center'
  ctx.fillText(String(parsed.locations), rightX + countW / 2, cardY + 50)
  ctx.textAlign = 'left'

  if (hasDevices) {
    const d2X = rightX + countW + 16
    fillRoundRect(ctx, d2X, cardY, countW, 110, 16, CARD_BG)
    strokeRoundRect(ctx, d2X, cardY, countW, 110, 16, CARD_BORDER, 1.5)
    ctx.font = '400 15px Inter, -apple-system, sans-serif'
    ctx.fillStyle = GRAY
    ctx.textBaseline = 'top'
    ctx.fillText('Устройств', d2X + 24, cardY + 18)
    ctx.font = '800 48px Inter, -apple-system, sans-serif'
    ctx.fillStyle = DARK
    ctx.textAlign = 'center'
    ctx.fillText(String(parsed.devices), d2X + countW / 2, cardY + 50)
    ctx.textAlign = 'left'
  }

  cardY += 130

  // Price cards
  const renderPriceCard = (label: string, amount: number, accent: boolean, sub?: string) => {
    const ch = sub ? 140 : 120
    fillRoundRect(ctx, rightX, cardY, rightColW, ch, 16, CARD_BG)
    strokeRoundRect(ctx, rightX, cardY, rightColW, ch, 16, CARD_BORDER, 1.5)
    if (accent) {
      ctx.save()
      roundRect(ctx, rightX, cardY, rightColW, 6, 16)
      ctx.clip()
      ctx.fillStyle = ORANGE
      ctx.fillRect(rightX, cardY, rightColW, 6)
      ctx.restore()
    }
    ctx.font = '400 16px Inter, -apple-system, sans-serif'
    ctx.fillStyle = GRAY
    ctx.textBaseline = 'top'
    ctx.fillText(label, rightX + 28, cardY + 22)
    ctx.font = '800 38px Inter, -apple-system, sans-serif'
    ctx.fillStyle = accent ? ORANGE : DARK
    ctx.fillText(fmt(amount), rightX + 28, cardY + 48)
    if (sub) {
      ctx.font = '400 16px Inter, -apple-system, sans-serif'
      ctx.fillStyle = GRAY
      ctx.fillText(sub, rightX + 28, cardY + 100)
    }
    cardY += ch + 16
  }

  if (licSection && licSection.subtotal > 0) {
    renderPriceCard('Стоимость лицензии', licSection.subtotal, true,
      kp.monthlyTotal > 0 ? `(${fmt(kp.monthlyTotal)}/мес)` : undefined)
  }
  if (svcSection && svcSection.subtotal > 0) {
    renderPriceCard('Стоимость внедрения', svcSection.subtotal, false)
  }
  if (equipSection && equipSection.subtotal > 0) {
    renderPriceCard('Стоимость оборудования', equipSection.subtotal, false)
  }

  // TOTAL bar
  const totalY = Math.max(cardY + 8, H - 100)
  fillRoundRect(ctx, rightX, totalY, rightColW, 60, 16, ORANGE, {
    color: 'rgba(255,107,0,0.2)', blur: 16, y: 4
  })
  ctx.font = '800 28px Inter, -apple-system, sans-serif'
  ctx.fillStyle = 'white'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(`ИТОГО: ${fmt(kp.grandTotal)}`, rightX + rightColW / 2, totalY + 30)
  ctx.textAlign = 'left'
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
    renderInnoSlide(ctx, kp, parsed)
  } else {
    renderBondaSlide(ctx, kp, parsed)
  }

  return canvas.toDataURL('image/jpeg', 0.92)
}
