/**
 * renderSlideImage.ts
 * Рендерит коммерческий слайд через Canvas 2D API → возвращает data URL картинки.
 * Дизайн повторяет стиль основных PPTX-слайдов презентации каждого бренда.
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
  strokeColor: string, lineWidth: number
) {
  ctx.save()
  ctx.strokeStyle = strokeColor
  ctx.lineWidth = lineWidth
  roundRect(ctx, x, y, w, h, r)
  ctx.stroke()
  ctx.restore()
}

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

// Orange dot bullet (как в БОНДА слайдах)
function drawDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.save()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

// ================================================================
//  БОНДА slide — стиль как bonda_tariffs_ref.jpg / bonda_howwework.jpg
// ================================================================
function renderBondaSlide(ctx: CanvasRenderingContext2D, kp: KPResult, parsed: ParsedRequest) {
  const bondaRed = '#E63C14'
  const bondaDark = '#1A1A1F'
  const textGray = '#5A5D66'
  const bgColor = '#F5F6F8'
  const cardBg = '#EFEFEF'

  // === BACKGROUND — светлый, как в презентации ===
  ctx.fillStyle = bgColor
  ctx.fillRect(0, 0, W, H)

  const pad = 80

  // === HEADER — как bonda_tariffs_ref.jpg ===
  const bondaTitle = parsed.license_type === 'findir'
    ? `Тариф «${parsed.findir_tariff || 'Старт'}»`
    : 'Коммерческое предложение'

  // Большой жирный заголовок
  ctx.font = '900 64px Inter, -apple-system, sans-serif'
  ctx.fillStyle = bondaDark
  ctx.textBaseline = 'top'
  ctx.fillText(bondaTitle, pad, 56)

  // Подзаголовок — как "стоимость на 1 ресторан"
  const locWord = parsed.locations === 1 ? 'ресторан' : parsed.locations < 5 ? 'ресторана' : 'ресторанов'
  ctx.font = '400 24px Inter, -apple-system, sans-serif'
  ctx.fillStyle = textGray
  ctx.fillText(`стоимость на ${parsed.locations} ${locWord}  •  ${kp.clientName}`, pad, 132)

  // bondabiz logo (top-right) — как в презентации
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  ctx.font = '800 36px Inter, -apple-system, sans-serif'
  const bizW = ctx.measureText('biz').width
  ctx.fillStyle = bondaDark
  ctx.fillText('bonda', W - pad - bizW, 60)
  ctx.fillStyle = bondaRed
  ctx.fillText('biz', W - pad, 60)
  ctx.textAlign = 'left'

  // === SECTION CARDS — стиль карточек из bonda_tariffs_ref.jpg ===
  const sections = kp.sections
  const cardGap = 28
  const areaW = W - pad * 2
  const totalCards = sections.length
  const cardW = totalCards > 1
    ? (areaW - cardGap * (totalCards - 1)) / totalCards
    : areaW * 0.48

  const cardTop = 200
  const itogoBarH = 72
  const monthlyH = kp.monthlyTotal > 0 ? 44 : 0
  const maxCardBottom = H - 40 - itogoBarH - monthlyH - 20

  // Адаптивная высота карточки
  const maxItems = Math.max(...sections.map(s => s.items.length))
  const itemH = 44
  const headerH = 80
  const subtotalH = 64
  const contentCardH = headerH + maxItems * itemH + subtotalH + 20
  const cardH = Math.min(contentCardH, maxCardBottom - cardTop)

  sections.forEach((section, idx) => {
    const cx = pad + idx * (cardW + cardGap)

    // Card background — скруглённые углы, лёгкая тень
    fillRoundRect(ctx, cx, cardTop, cardW, cardH, 20, cardBg, {
      color: 'rgba(0,0,0,0.06)', blur: 20, y: 4
    })

    // Section title (bold, dark) — как "Безопасность" в тарифах
    ctx.font = '800 24px Inter, -apple-system, sans-serif'
    ctx.fillStyle = bondaDark
    ctx.textBaseline = 'top'
    ctx.fillText(section.title, cx + 32, cardTop + 28)

    // Orange underline accent
    ctx.fillStyle = bondaRed
    ctx.fillRect(cx + 32, cardTop + 62, 48, 3)

    // Items with orange dot bullets — как в howwework/reports слайдах
    let iy = cardTop + headerH + 8
    const maxY = cardTop + cardH - subtotalH - 8
    for (const item of section.items) {
      if (iy > maxY) break

      // Orange dot
      drawDot(ctx, cx + 40, iy + 8, 5, bondaRed)

      // Item name
      ctx.font = '400 17px Inter, -apple-system, sans-serif'
      ctx.fillStyle = textGray
      ctx.textBaseline = 'top'
      const nameMaxW = cardW - 200
      const displayName = item.name.length > 45 ? item.name.substring(0, 45) + '...' : item.name
      ctx.fillText(displayName, cx + 56, iy)

      // Price (right-aligned)
      ctx.font = '700 17px Inter, -apple-system, sans-serif'
      ctx.fillStyle = bondaDark
      ctx.textAlign = 'right'
      const pStr = item.qty > 1
        ? `${fmt(item.unitPrice)} × ${item.qty}`
        : fmt(item.total)
      ctx.fillText(pStr, cx + cardW - 32, iy)
      ctx.textAlign = 'left'

      iy += itemH
    }

    // Subtotal at bottom — крупная цена как в тарифах ("50 000 ₽/мес")
    const subY = cardTop + cardH - subtotalH
    // Separator line
    ctx.strokeStyle = '#DCDEE2'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx + 28, subY)
    ctx.lineTo(cx + cardW - 28, subY)
    ctx.stroke()

    ctx.font = '800 32px Inter, -apple-system, sans-serif'
    ctx.fillStyle = bondaRed
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(fmt(section.subtotal), cx + cardW / 2, subY + subtotalH / 2)
    ctx.textAlign = 'left'
  })

  // === ИТОГО BAR — красная полоса как акцент ===
  const itogoY = Math.min(cardTop + cardH + 20, maxCardBottom + 4)
  fillRoundRect(ctx, pad, itogoY, areaW, itogoBarH, 16, bondaRed, {
    color: 'rgba(230,60,20,0.2)', blur: 20, y: 4
  })
  ctx.font = '800 36px Inter, -apple-system, sans-serif'
  ctx.fillStyle = 'white'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(`ИТОГО: ${fmt(kp.grandTotal)}`, W / 2, itogoY + itogoBarH / 2)
  ctx.textAlign = 'left'

  // Monthly
  if (kp.monthlyTotal > 0) {
    ctx.font = '400 20px Inter, -apple-system, sans-serif'
    ctx.fillStyle = textGray
    ctx.textAlign = 'center'
    ctx.fillText(`Ежемесячно: ${fmt(kp.monthlyTotal)}`, W / 2, itogoY + itogoBarH + 28)
    ctx.textAlign = 'left'
  }
}

// ================================================================
//  INNO slide — стиль как inno_product.jpg / inno_multiformat.jpg
// ================================================================
function renderInnoSlide(ctx: CanvasRenderingContext2D, kp: KPResult, parsed: ParsedRequest) {
  const licType = parsed.license_type || 'kiosk'
  const title = licenseSlideTitle[licType] || 'Inno Clouds'
  const subtitle = licenseSlideSubtitle[licType] || ''
  const features = baseFeatures[licType] || baseFeatures.kiosk

  const svcSection = kp.sections.find(s => s.title === 'Услуги')
  const licSection = kp.sections.find(s => s.title === 'Лицензии и подписки')
  const equipSection = kp.sections.find(s => s.title === 'Оборудование')

  const innoDark = '#3A3F4B'
  const innoOrange = '#FF6B00'
  const innoGray = '#8A8F9E'
  const bgColor = '#E8EAF0'
  const cardBg = '#F2F3F6'
  const cardBorder = '#C8CCDA'

  // === BACKGROUND — серый, как в INNO слайдах ===
  ctx.fillStyle = bgColor
  ctx.fillRect(0, 0, W, H)

  const pad = 72

  // === HEADER ===
  // Лого "INNO." (упрощённый текстовый вариант)
  ctx.font = '900 28px Inter, -apple-system, sans-serif'
  ctx.fillStyle = innoDark
  ctx.textBaseline = 'top'
  ctx.fillText('INNO.', pad, 40)
  // Оранжевая точка у логотипа
  const dotX = pad + ctx.measureText('INNO').width + 6
  drawDot(ctx, dotX, 58, 6, innoOrange)

  // Title — крупный
  ctx.font = '900 52px Inter, -apple-system, sans-serif'
  ctx.fillStyle = innoDark
  ctx.fillText(title, pad, 88)

  // Subtitle
  if (subtitle) {
    ctx.font = '400 20px Inter, -apple-system, sans-serif'
    ctx.fillStyle = innoGray
    const maxSubW = W - pad * 2
    wrapText(ctx, subtitle, pad, 155, maxSubW, 28)
  }

  // Для клиента (right)
  ctx.textAlign = 'right'
  ctx.font = '400 20px Inter, -apple-system, sans-serif'
  ctx.fillStyle = innoGray
  ctx.fillText(`${kp.clientName}  •  ${parsed.locations} точ.`, W - pad, 48)
  ctx.textAlign = 'left'

  // === LEFT — Карточки фич (стиль inno_product.jpg) ===
  const rightColW = 400
  const leftW = W - pad * 2 - rightColW - 40
  const featTop = 210

  // Карточка "Базовый пакет"
  const featCardH = svcSection && svcSection.items.length > 0
    ? H - featTop - 240
    : H - featTop - 60

  fillRoundRect(ctx, pad, featTop, leftW, featCardH, 20, cardBg, {
    color: 'rgba(0,0,0,0.04)', blur: 16, y: 2
  })
  strokeRoundRect(ctx, pad, featTop, leftW, featCardH, 20, cardBorder, 1.5)

  // Orange top accent line
  ctx.save()
  roundRect(ctx, pad, featTop, leftW, 5, 20)
  ctx.clip()
  ctx.fillStyle = innoOrange
  ctx.fillRect(pad, featTop, leftW, 5)
  ctx.restore()

  // Title inside card
  ctx.font = '800 24px Inter, -apple-system, sans-serif'
  ctx.fillStyle = innoDark
  ctx.textBaseline = 'top'
  ctx.fillText('Базовый пакет услуг', pad + 32, featTop + 24)

  // Features in 2 columns with orange dots
  const half = Math.ceil(features.length / 2)
  const col1X = pad + 32
  const col2X = pad + leftW / 2 + 16
  const featStartY = featTop + 72
  const featLineH = Math.min(48, (featCardH - 100) / half)

  features.forEach((feat, i) => {
    const isLeft = i < half
    const x = isLeft ? col1X : col2X
    const row = isLeft ? i : i - half
    const y = featStartY + row * featLineH

    // Orange dot
    drawDot(ctx, x + 6, y + 10, 5, innoOrange)

    // Feature text
    ctx.font = '400 16px Inter, -apple-system, sans-serif'
    ctx.fillStyle = innoDark
    ctx.textBaseline = 'top'
    const maxFeatW = leftW / 2 - 80
    wrapText(ctx, feat, x + 22, y + 2, maxFeatW, 21)
  })

  // === Services box (if any) ===
  if (svcSection && svcSection.items.length > 0) {
    const svcTop = featTop + featCardH + 16
    const svcH = H - svcTop - 60

    fillRoundRect(ctx, pad, svcTop, leftW, svcH, 20, cardBg, {
      color: 'rgba(0,0,0,0.04)', blur: 16, y: 2
    })
    strokeRoundRect(ctx, pad, svcTop, leftW, svcH, 20, cardBorder, 1.5)

    // Gray top accent
    ctx.save()
    roundRect(ctx, pad, svcTop, leftW, 5, 20)
    ctx.clip()
    ctx.fillStyle = innoGray
    ctx.fillRect(pad, svcTop, leftW, 5)
    ctx.restore()

    // Title
    ctx.font = '800 22px Inter, -apple-system, sans-serif'
    ctx.fillStyle = innoDark
    ctx.textBaseline = 'top'
    ctx.fillText('Услуги внедрения', pad + 32, svcTop + 22)

    // Service items
    let sy = svcTop + 62
    for (const item of svcSection.items) {
      if (sy > svcTop + svcH - 20) break

      drawDot(ctx, pad + 38, sy + 8, 4, innoGray)

      ctx.font = '400 16px Inter, -apple-system, sans-serif'
      ctx.fillStyle = innoDark
      ctx.textBaseline = 'top'
      ctx.fillText(item.name, pad + 52, sy)

      ctx.font = '700 16px Inter, -apple-system, sans-serif'
      ctx.fillStyle = innoDark
      ctx.textAlign = 'right'
      const priceStr = item.qty > 1
        ? `${fmt(item.unitPrice)} × ${item.qty}`
        : fmt(item.total)
      ctx.fillText(priceStr, pad + leftW - 32, sy)
      ctx.textAlign = 'left'

      sy += 36
    }
  }

  // === RIGHT COLUMN — ценовые карточки ===
  const rightX = W - pad - rightColW
  let cardY = 210

  // Кол-во точек
  const hasDevices = parsed.devices > 0
  const countW = hasDevices ? (rightColW - 16) / 2 : rightColW

  fillRoundRect(ctx, rightX, cardY, countW, 110, 16, cardBg, {
    color: 'rgba(0,0,0,0.04)', blur: 16, y: 2
  })
  strokeRoundRect(ctx, rightX, cardY, countW, 110, 16, cardBorder, 1.5)
  ctx.font = '400 15px Inter, -apple-system, sans-serif'
  ctx.fillStyle = innoGray
  ctx.textBaseline = 'top'
  ctx.fillText('Кол-во точек', rightX + 24, cardY + 18)
  ctx.font = '800 48px Inter, -apple-system, sans-serif'
  ctx.fillStyle = innoDark
  ctx.textAlign = 'center'
  ctx.fillText(String(parsed.locations), rightX + countW / 2, cardY + 50)
  ctx.textAlign = 'left'

  if (hasDevices) {
    const d2X = rightX + countW + 16
    fillRoundRect(ctx, d2X, cardY, countW, 110, 16, cardBg, {
      color: 'rgba(0,0,0,0.04)', blur: 16, y: 2
    })
    strokeRoundRect(ctx, d2X, cardY, countW, 110, 16, cardBorder, 1.5)
    ctx.font = '400 15px Inter, -apple-system, sans-serif'
    ctx.fillStyle = innoGray
    ctx.textBaseline = 'top'
    ctx.fillText('Устройств', d2X + 24, cardY + 18)
    ctx.font = '800 48px Inter, -apple-system, sans-serif'
    ctx.fillStyle = innoDark
    ctx.textAlign = 'center'
    ctx.fillText(String(parsed.devices), d2X + countW / 2, cardY + 50)
    ctx.textAlign = 'left'
  }

  cardY += 130

  // Price cards
  const renderPriceCard = (label: string, amount: number, accent: boolean, sub?: string) => {
    const cardH = sub ? 140 : 120
    fillRoundRect(ctx, rightX, cardY, rightColW, cardH, 16, cardBg, {
      color: 'rgba(0,0,0,0.04)', blur: 16, y: 2
    })
    strokeRoundRect(ctx, rightX, cardY, rightColW, cardH, 16, cardBorder, 1.5)

    // Orange top accent for primary card
    if (accent) {
      ctx.save()
      roundRect(ctx, rightX, cardY, rightColW, 5, 16)
      ctx.clip()
      ctx.fillStyle = innoOrange
      ctx.fillRect(rightX, cardY, rightColW, 5)
      ctx.restore()
    }

    ctx.font = '400 16px Inter, -apple-system, sans-serif'
    ctx.fillStyle = innoGray
    ctx.textBaseline = 'top'
    ctx.fillText(label, rightX + 28, cardY + 22)
    ctx.font = '800 38px Inter, -apple-system, sans-serif'
    ctx.fillStyle = accent ? innoOrange : innoDark
    ctx.fillText(fmt(amount), rightX + 28, cardY + 48)
    if (sub) {
      ctx.font = '400 16px Inter, -apple-system, sans-serif'
      ctx.fillStyle = innoGray
      ctx.fillText(sub, rightX + 28, cardY + 100)
    }
    cardY += cardH + 16
  }

  if (licSection && licSection.subtotal > 0) {
    renderPriceCard(
      'Стоимость лицензии',
      licSection.subtotal,
      true,
      kp.monthlyTotal > 0 ? `(${fmt(kp.monthlyTotal)}/мес)` : undefined
    )
  }

  if (svcSection && svcSection.subtotal > 0) {
    renderPriceCard('Стоимость внедрения', svcSection.subtotal, false)
  }

  if (equipSection && equipSection.subtotal > 0) {
    renderPriceCard('Стоимость оборудования', equipSection.subtotal, false)
  }

  // === TOTAL BAR ===
  const totalBarY = Math.max(cardY + 8, H - 100)
  fillRoundRect(ctx, rightX, totalBarY, rightColW, 60, 16, innoOrange, {
    color: 'rgba(255,107,0,0.2)', blur: 16, y: 4
  })
  ctx.font = '800 28px Inter, -apple-system, sans-serif'
  ctx.fillStyle = 'white'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(`ИТОГО: ${fmt(kp.grandTotal)}`, rightX + rightColW / 2, totalBarY + 30)
  ctx.textAlign = 'left'
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

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  if (isInno) {
    renderInnoSlide(ctx, kp, parsed)
  } else {
    renderBondaSlide(ctx, kp, parsed)
  }

  return canvas.toDataURL('image/jpeg', 0.92)
}
