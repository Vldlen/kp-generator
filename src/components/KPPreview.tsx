'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { formatMoney, type KPResult, type LineItem } from '@/lib/calculator'
import type { ParsedRequest } from '@/lib/prompt'
import type { DBProduct } from '@/lib/supabase'
import {
  innoSlidesBefore, innoSlidesAfter, innoEquipmentSlides,
  bondaSlidesBefore, bondaSlidesAfter,
  baseFeatures, licenseSlideTitle, licenseSlideSubtitle,
} from '@/lib/slides'

// Маппинг категорий на русские названия
const CATEGORY_LABELS: Record<string, string> = {
  tablet: 'Планшеты',
  pos_terminal: 'POS-терминалы',
  mount: 'Кронштейны и крепления',
  adapter: 'Адаптеры',
  peripheral: 'Периферия',
  fiscal: 'Фискальные регистраторы',
  service: 'Услуги',
  license_inno: 'Лицензии',
  subscription_bonda: 'Подписки',
}

interface Props {
  kp: KPResult
  parsed: ParsedRequest
  catalog: DBProduct[]  // каталог из Supabase
}

// Найти продукт по имени в каталоге
function findProductByName(catalog: DBProduct[], name: string): DBProduct | undefined {
  return catalog.find(p => p.name === name)
}

// Получить товары той же категории для замены
function getAlternatives(catalog: DBProduct[], productName: string): DBProduct[] {
  const product = findProductByName(catalog, productName)
  if (!product) return catalog // если не нашли — показать весь каталог
  return catalog.filter(p => p.category === product.category)
}

// Сгруппировать массив товаров по категориям
function groupByCategory(products: DBProduct[]): { label: string; category: string; items: DBProduct[] }[] {
  const groups: Record<string, DBProduct[]> = {}
  for (const p of products) {
    if (!groups[p.category]) groups[p.category] = []
    groups[p.category].push(p)
  }
  return Object.entries(groups).map(([cat, items]) => ({
    label: CATEGORY_LABELS[cat] || cat,
    category: cat,
    items,
  }))
}

// --- Селектор продукта из каталога ---
function ProductSelector({
  currentName, catalog, onSelect, onClose, isInno,
}: {
  currentName: string
  catalog: DBProduct[]
  onSelect: (product: DBProduct) => void
  onClose: () => void
  isInno: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)

  // Получаем альтернативы из той же категории
  const alternatives = getAlternatives(catalog, currentName)
  const groups = groupByCategory(alternatives)

  // Закрытие по клику снаружи
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div ref={ref} className="absolute z-50 left-0 top-full mt-1 min-w-[360px] w-max max-w-[480px] max-h-[50vh] overflow-y-auto rounded-xl bg-[#1e1e30] border border-white/20 shadow-2xl">
      {groups.map(group => (
        <div key={group.category}>
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-white/30 bg-[#1e1e30] bg-white/5 sticky top-0 z-10">
            {group.label}
          </div>
          {group.items.map(product => {
            const isActive = product.name === currentName
            return (
              <button
                key={product.id}
                onClick={() => { onSelect(product); onClose() }}
                className={`w-full text-left px-3 py-2.5 flex items-center justify-between hover:bg-white/10 transition text-sm ${
                  isActive
                    ? (isInno ? 'bg-orange-500/20 text-orange-300' : 'bg-purple-500/20 text-purple-300')
                    : 'text-white/80'
                }`}
              >
                <div className="mr-3">
                  <div>{product.name}</div>
                  {product.specs && (
                    <div className="text-[10px] text-white/30 mt-0.5">{product.specs}</div>
                  )}
                </div>
                <span className="text-xs text-white/40 whitespace-nowrap">{formatMoney(product.sell_price)}</span>
              </button>
            )
          })}
        </div>
      ))}
      {groups.length === 0 && (
        <div className="px-3 py-4 text-sm text-white/30 text-center">Нет альтернатив в каталоге</div>
      )}
    </div>
  )
}

// --- Редактируемая числовая ячейка ---
function EditableNumber({
  value, onChange, format = 'money', align = 'right',
}: {
  value: number
  onChange: (v: number) => void
  format?: 'money' | 'plain' | 'percent'
  align?: 'left' | 'right' | 'center'
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const textAlign = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'

  const display = format === 'money'
    ? formatMoney(value)
    : format === 'percent'
      ? (value > 0 ? `-${value}%` : '—')
      : String(value)

  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        inputMode="numeric"
        value={draft}
        onChange={e => setDraft(e.target.value.replace(/[^0-9.,]/g, ''))}
        onBlur={() => {
          setEditing(false)
          const parsed = parseFloat(draft.replace(',', '.'))
          if (!isNaN(parsed)) onChange(format === 'percent' ? Math.min(100, Math.max(0, parsed)) : Math.max(0, parsed))
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') setEditing(false)
        }}
        className={`w-full bg-white/10 border border-orange-500/50 rounded px-2 py-1 text-white text-sm outline-none ${textAlign}`}
      />
    )
  }

  return (
    <div
      onClick={() => { setEditing(true); setDraft(String(value)) }}
      className={`cursor-pointer hover:bg-white/10 rounded px-2 py-1 -mx-2 -my-1 transition ${textAlign}`}
      title="Кликните для редактирования"
    >
      {format === 'percent' && value > 0
        ? <span className="text-green-400">{display}</span>
        : display}
    </div>
  )
}

// --- Пересчёт ---
function recalcItem(item: LineItem): LineItem {
  return { ...item, total: Math.round(item.unitPrice * item.qty * (1 - item.discount / 100)) }
}

function recalcSection(section: KPResult['sections'][0]) {
  return { ...section, subtotal: section.items.reduce((sum, i) => sum + i.total, 0) }
}

// ====== MAIN COMPONENT ======

export function KPPreview({ kp, parsed, catalog }: Props) {
  const isInno = kp.company === 'inno'
  const [generating, setGenerating] = useState(false)
  const [sections, setSections] = useState(
    kp.sections.map(s => ({ ...s, items: s.items.map(i => ({ ...i })) }))
  )
  // Какой селектор каталога открыт: [sectionIndex, itemIndex] или null
  const [openSelector, setOpenSelector] = useState<[number, number] | null>(null)

  const grandTotal = sections.reduce((sum, s) => sum + s.subtotal, 0)

  // Замена позиции на продукт из каталога
  const replaceWithProduct = useCallback((si: number, ii: number, product: DBProduct) => {
    setSections(prev => {
      const next = prev.map(s => ({ ...s, items: s.items.map(i => ({ ...i })) }))
      const item = next[si].items[ii]
      const oldQty = item.qty
      next[si].items[ii] = recalcItem({
        ...item,
        name: product.name,
        unitPrice: product.sell_price,
        qty: oldQty,
      })
      next[si] = recalcSection(next[si])
      return next
    })
  }, [])

  // Обновить числовое поле
  const updateField = useCallback((si: number, ii: number, field: 'qty' | 'unitPrice' | 'discount', value: number) => {
    setSections(prev => {
      const next = prev.map(s => ({ ...s, items: s.items.map(i => ({ ...i })) }))
      const item = next[si].items[ii]
      if (field === 'qty') item.qty = Math.max(1, Math.round(value))
      else if (field === 'unitPrice') item.unitPrice = Math.max(0, value)
      else if (field === 'discount') item.discount = value
      next[si].items[ii] = recalcItem(item)
      next[si] = recalcSection(next[si])
      return next
    })
  }, [])

  const removeItem = useCallback((si: number, ii: number) => {
    setSections(prev => {
      const next = prev.map(s => ({ ...s, items: s.items.map(i => ({ ...i })) }))
      next[si].items.splice(ii, 1)
      if (next[si].items.length === 0) {
        next.splice(si, 1)
      } else {
        next[si] = recalcSection(next[si])
      }
      return next
    })
  }, [])

  const addItem = useCallback((si: number) => {
    setSections(prev => {
      const next = prev.map(s => ({ ...s, items: s.items.map(i => ({ ...i })) }))
      next[si].items.push({
        name: 'Новая позиция',
        category: next[si].title,
        qty: 1,
        unitPrice: 0,
        discount: 0,
        total: 0,
      })
      return next
    })
  }, [])

  const addSection = useCallback(() => {
    setSections(prev => [
      ...prev,
      { title: 'Дополнительно', items: [{ name: 'Новая позиция', category: 'Дополнительно', qty: 1, unitPrice: 0, discount: 0, total: 0 }], subtotal: 0 },
    ])
  }, [])

  // Собрать KPResult для PDF
  const getCurrentKP = (): KPResult => ({ ...kp, sections, grandTotal })

  // Загрузка картинок
  const loadImage = async (src: string): Promise<string> => {
    const res = await fetch(src)
    const blob = await res.blob()
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  }

  // PDF — генерация в стиле актуальных КП менеджеров
  const handleDownloadPDF = async () => {
    setGenerating(true)
    const currentKP = getCurrentKP()

    try {
      const { default: jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      const { LATO_REGULAR } = await import('@/lib/font-lato')
      const { LATO_BOLD } = await import('@/lib/font-lato-bold')

      const slideW = 338, slideH = 190
      const doc = new jsPDF('l', 'mm', [slideW, slideH])

      doc.addFileToVFS('Lato-Regular.ttf', LATO_REGULAR)
      doc.addFont('Lato-Regular.ttf', 'Lato', 'normal')
      doc.addFileToVFS('Lato-Bold.ttf', LATO_BOLD)
      doc.addFont('Lato-Bold.ttf', 'Lato', 'bold')
      doc.setFont('Lato')

      const slidesBefore = isInno ? innoSlidesBefore : bondaSlidesBefore
      const slidesAfter = isInno ? innoSlidesAfter : bondaSlidesAfter

      // === Слайды ДО коммерческого ===
      for (let i = 0; i < slidesBefore.length; i++) {
        if (i > 0) doc.addPage([slideW, slideH], 'l')
        try {
          const imgData = await loadImage(`/slides/${slidesBefore[i].file}`)
          doc.addImage(imgData, 'JPEG', 0, 0, slideW, slideH)
        } catch { /* skip missing slides */ }
      }

      // === КОММЕРЧЕСКИЙ СЛАЙД ===
      doc.addPage([slideW, slideH], 'l')
      const licType = parsed.license_type || 'kiosk'
      const brandOrange: [number, number, number] = [255, 107, 0]
      const darkText: [number, number, number] = [40, 45, 55]
      const grayText: [number, number, number] = [120, 125, 135]
      const bgLight: [number, number, number] = [237, 240, 248]

      // Фон слайда
      doc.setFillColor(...bgLight)
      doc.rect(0, 0, slideW, slideH, 'F')

      if (!isInno) {
        // === БОНДА: коммерческий слайд в стиле реальных КП ===
        const bondaRed: [number, number, number] = [230, 60, 20]
        const bondaDark: [number, number, number] = [35, 35, 40]

        // Лого bondabiz (текст)
        doc.setFont('Lato', 'bold')
        doc.setFontSize(14)
        doc.setTextColor(...bondaDark)
        doc.text('bonda', slideW - 60, 14)
        doc.setTextColor(...bondaRed)
        doc.text('biz', slideW - 60 + doc.getTextWidth('bonda'), 14)

        // Заголовок
        doc.setFont('Lato', 'bold')
        doc.setFontSize(26)
        doc.setTextColor(...bondaDark)
        const bondaTitle = parsed.license_type === 'findir'
          ? `Тариф «${parsed.findir_tariff || 'Старт'}»`
          : 'BONDA BI'
        doc.text(bondaTitle, 18, 26)

        // Подзаголовок
        doc.setFont('Lato', 'normal')
        doc.setFontSize(9)
        doc.setTextColor(...grayText)
        doc.text(`стоимость на ${parsed.locations} ${parsed.locations === 1 ? 'ресторан' : 'ресторана'}  \u2022  ${currentKP.clientName}`, 18, 35)

        // Оранжевая линия-разделитель
        doc.setDrawColor(...bondaRed)
        doc.setLineWidth(1)
        doc.line(18, 40, slideW - 18, 40)

        // === Основная часть: карточки с деталями ===
        const sections = currentKP.sections
        const totalSections = sections.length
        const cardGap = 8
        const areaW = slideW - 36
        const cardW = totalSections > 1 ? (areaW - cardGap * (totalSections - 1)) / totalSections : areaW * 0.6
        const cardTop = 48
        const cardH = 100

        sections.forEach((section, idx) => {
          const cx = 18 + idx * (cardW + cardGap)

          // Фон карточки
          doc.setFillColor(255, 255, 255)
          doc.roundedRect(cx, cardTop, cardW, cardH, 4, 4, 'F')
          doc.setDrawColor(220, 222, 230)
          doc.setLineWidth(0.3)
          doc.roundedRect(cx, cardTop, cardW, cardH, 4, 4, 'S')

          // Оранжевая полоска сверху карточки
          doc.setFillColor(...bondaRed)
          doc.roundedRect(cx, cardTop, cardW, 3, 4, 4, 'F')
          doc.setFillColor(255, 255, 255)
          doc.rect(cx, cardTop + 2, cardW, 2, 'F')

          // Название секции
          doc.setFont('Lato', 'bold')
          doc.setFontSize(10)
          doc.setTextColor(...bondaDark)
          doc.text(section.title, cx + 10, cardTop + 14)

          // Позиции
          let iy = cardTop + 24
          for (const item of section.items) {
            if (iy > cardTop + cardH - 20) break
            doc.setFont('Lato', 'normal')
            doc.setFontSize(7.5)
            doc.setTextColor(100, 105, 115)
            const itemText = item.name.length > 45 ? item.name.substring(0, 45) + '...' : item.name
            doc.text(itemText, cx + 10, iy, { maxWidth: cardW - 50 })

            doc.setFont('Lato', 'bold')
            doc.setFontSize(8)
            doc.setTextColor(...bondaDark)
            const pStr = item.qty > 1
              ? `${formatMoney(item.unitPrice)} \u00D7 ${item.qty}`
              : formatMoney(item.total)
            doc.text(pStr, cx + cardW - 10, iy, { align: 'right' })
            iy += 10
          }

          // Subtotal внизу карточки
          doc.setFillColor(245, 246, 248)
          doc.roundedRect(cx, cardTop + cardH - 18, cardW, 18, 0, 0, 'F')
          // Скругляем только низ
          doc.setFillColor(245, 246, 248)
          doc.roundedRect(cx, cardTop + cardH - 4, cardW, 4, 4, 4, 'F')

          doc.setFont('Lato', 'bold')
          doc.setFontSize(14)
          doc.setTextColor(...bondaRed)
          doc.text(formatMoney(section.subtotal) + ' \u20BD/мес', cx + cardW / 2, cardTop + cardH - 5, { align: 'center' })
        })

        // === ИТОГО бар ===
        const totalY = cardTop + cardH + 10
        doc.setFillColor(...bondaRed)
        doc.roundedRect(18, totalY, areaW, 16, 4, 4, 'F')
        doc.setFont('Lato', 'bold')
        doc.setTextColor(255, 255, 255)
        doc.setFontSize(14)
        doc.text(`ИТОГО: ${formatMoney(currentKP.grandTotal)}`, slideW / 2, totalY + 11, { align: 'center' })

        if (currentKP.monthlyTotal > 0) {
          doc.setFont('Lato', 'normal')
          doc.setFontSize(9)
          doc.setTextColor(...grayText)
          doc.text(`Ежемесячно: ${formatMoney(currentKP.monthlyTotal)} \u20BD`, slideW / 2, totalY + 24, { align: 'center' })
        }
      } else {
      // === ИННО: коммерческий слайд (стиль реальных КП менеджеров) ===
      const title = licenseSlideTitle[licType] || 'Inno Clouds'
      const subtitle = licenseSlideSubtitle[licType] || ''

      // --- Заголовок ---
      doc.setFont('Lato', 'bold')
      doc.setTextColor(...darkText)
      doc.setFontSize(24)
      doc.text(title, 16, 22)

      // Стрелка
      const titleW = doc.getTextWidth(title)
      doc.setDrawColor(...brandOrange)
      doc.setLineWidth(0.7)
      const arrowX = 16 + titleW + 8
      doc.line(arrowX, 19, arrowX + 30, 19)
      doc.line(arrowX + 27, 16.5, arrowX + 30, 19)
      doc.line(arrowX + 27, 21.5, arrowX + 30, 19)

      // Подзаголовок справа
      if (subtitle) {
        doc.setFont('Lato', 'normal')
        doc.setFontSize(7.5)
        doc.setTextColor(...grayText)
        doc.text(subtitle, slideW - 16, 16, { align: 'right', maxWidth: 110 })
      }

      // === ЛЕВАЯ ЧАСТЬ ===
      const boxL = 14, boxW = 200

      // --- Базовый пакет услуг (ОРАНЖЕВЫЙ фон) ---
      const featTop = 32, featH = 90
      doc.setFillColor(255, 120, 0)
      doc.roundedRect(boxL, featTop, boxW, featH, 4, 4, 'F')

      // Иконка-галочка в квадрате + заголовок
      doc.setFillColor(255, 255, 255)
      doc.roundedRect(boxL + 8, featTop + 6, 5, 5, 1, 1, 'F')
      doc.setFont('Lato', 'bold')
      doc.setFontSize(7)
      doc.setTextColor(255, 120, 0)
      doc.text('\u2713', boxL + 9.2, featTop + 10)
      doc.setFont('Lato', 'bold')
      doc.setFontSize(12)
      doc.setTextColor(255, 255, 255)
      doc.text('Базовый пакет услуг', boxL + 17, featTop + 11)

      // Фичи в 2 колонки (белый текст на оранжевом)
      const features = baseFeatures[licType] || baseFeatures.kiosk
      const half = Math.ceil(features.length / 2)
      const col1X = boxL + 12, col2X = boxL + 108
      const featStartY = featTop + 22

      features.forEach((feat, i) => {
        const isLeft = i < half
        const x = isLeft ? col1X : col2X
        const row = isLeft ? i : i - half
        const y = featStartY + row * 11

        // Белая галочка-квадрат
        doc.setFillColor(255, 255, 255)
        doc.roundedRect(x - 5, y - 3.5, 4, 4, 0.8, 0.8, 'F')
        doc.setFont('Lato', 'bold')
        doc.setFontSize(6)
        doc.setTextColor(255, 120, 0)
        doc.text('\u2713', x - 4, y - 0.5)

        doc.setFont('Lato', 'normal')
        doc.setFontSize(7)
        doc.setTextColor(255, 255, 255)
        doc.text(feat, x + 2, y, { maxWidth: 85 })
      })

      // --- Услуги внедрения (СЕРЫЙ фон) ---
      const svcTop = featTop + featH + 4
      const svcSection = currentKP.sections.find(s => s.title === 'Услуги')
      const svcItems = svcSection ? svcSection.items : []
      const svcH = 18 + svcItems.length * 10

      doc.setFillColor(160, 165, 180)
      doc.roundedRect(boxL, svcTop, boxW, svcH, 4, 4, 'F')

      // Иконка + заголовок
      doc.setFillColor(255, 255, 255)
      doc.roundedRect(boxL + 8, svcTop + 6, 5, 5, 1, 1, 'F')
      doc.setFont('Lato', 'bold')
      doc.setFontSize(7)
      doc.setTextColor(160, 165, 180)
      doc.text('+', boxL + 9.5, svcTop + 10)
      doc.setFont('Lato', 'bold')
      doc.setFontSize(11)
      doc.setTextColor(255, 255, 255)
      doc.text('Услуги внедрения', boxL + 17, svcTop + 11)

      // Строки услуг
      let svcY = svcTop + 20
      if (svcSection) {
        for (const item of svcSection.items) {
          doc.setFont('Lato', 'normal')
          doc.setFontSize(8)
          doc.setTextColor(240, 240, 245)
          doc.text(item.name, boxL + 12, svcY)
          doc.setFont('Lato', 'bold')
          doc.setFontSize(9)
          doc.setTextColor(255, 255, 255)
          const priceStr = formatMoney(item.unitPrice) + (item.qty > 1 ? ` \u00D7 ${item.qty}` : '')
          doc.text(priceStr, boxL + boxW - 12, svcY, { align: 'right' })
          svcY += 10
        }
      }

      // === ПРАВАЯ ЧАСТЬ: карточки с ценами ===
      const cardX = 222, cardW = 104

      // --- Кол-во точек / устройств ---
      const cntY = featTop
      const cntW = 48
      // Точки
      doc.setFillColor(255, 255, 255)
      doc.roundedRect(cardX, cntY, cntW, 22, 3, 3, 'F')
      doc.setDrawColor(220, 222, 230)
      doc.setLineWidth(0.2)
      doc.roundedRect(cardX, cntY, cntW, 22, 3, 3, 'S')
      doc.setFont('Lato', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...grayText)
      doc.text('Кол-во', cardX + 6, cntY + 7)
      doc.text('точек', cardX + 6, cntY + 12)
      doc.setFont('Lato', 'bold')
      doc.setFontSize(22)
      doc.setTextColor(...darkText)
      doc.text(String(parsed.locations), cardX + 32, cntY + 16)

      // Устройства
      if (parsed.devices > 0) {
        const d2X = cardX + cntW + 4
        doc.setFillColor(255, 255, 255)
        doc.roundedRect(d2X, cntY, cntW + 4, 22, 3, 3, 'F')
        doc.setDrawColor(220, 222, 230)
        doc.roundedRect(d2X, cntY, cntW + 4, 22, 3, 3, 'S')
        doc.setFont('Lato', 'normal')
        doc.setFontSize(7)
        doc.setTextColor(...grayText)
        doc.text('Кол-во', d2X + 6, cntY + 7)
        doc.text('устройств', d2X + 6, cntY + 12)
        doc.setFont('Lato', 'bold')
        doc.setFontSize(22)
        doc.setTextColor(...darkText)
        doc.text(String(parsed.devices), d2X + 36, cntY + 16)
      }

      // --- Стоимость внедрения ---
      let priceY = cntY + 28
      const implSection = currentKP.sections.find(s => s.title === 'Услуги')
      const implTotal = implSection ? implSection.subtotal : 0
      if (implTotal > 0) {
        doc.setFillColor(255, 255, 255)
        doc.roundedRect(cardX, priceY, cardW, 26, 3, 3, 'F')
        doc.setDrawColor(220, 222, 230)
        doc.roundedRect(cardX, priceY, cardW, 26, 3, 3, 'S')
        doc.setFont('Lato', 'normal')
        doc.setFontSize(7)
        doc.setTextColor(...grayText)
        doc.text('Стоимость внедрения', cardX + 8, priceY + 8)
        doc.setFont('Lato', 'bold')
        doc.setFontSize(18)
        doc.setTextColor(...brandOrange)
        doc.text(formatMoney(implTotal), cardX + 8, priceY + 20)
        priceY += 32
      }

      // --- Стоимость лицензии ---
      const licSection = currentKP.sections.find(s => s.title === 'Лицензии и подписки')
      if (licSection && licSection.subtotal > 0) {
        const licH = currentKP.monthlyTotal > 0 ? 30 : 26
        doc.setFillColor(255, 255, 255)
        doc.roundedRect(cardX, priceY, cardW, licH, 3, 3, 'F')
        doc.setDrawColor(220, 222, 230)
        doc.roundedRect(cardX, priceY, cardW, licH, 3, 3, 'S')
        doc.setFont('Lato', 'normal')
        doc.setFontSize(7)
        doc.setTextColor(...grayText)
        doc.text('Стоимость лицензии', cardX + 8, priceY + 8)
        doc.setFont('Lato', 'bold')
        doc.setFontSize(18)
        doc.setTextColor(...brandOrange)
        doc.text(formatMoney(licSection.subtotal), cardX + 8, priceY + 20)
        if (currentKP.monthlyTotal > 0) {
          doc.setFont('Lato', 'normal')
          doc.setFontSize(7)
          doc.setTextColor(...grayText)
          doc.text(`(${formatMoney(currentKP.monthlyTotal)} \u20BD/мес)`, cardX + 8, priceY + 26)
        }
        priceY += licH + 6
      }

      // --- Стоимость оборудования ---
      const equipSection = currentKP.sections.find(s => s.title === 'Оборудование')
      if (equipSection && equipSection.subtotal > 0) {
        doc.setFillColor(255, 255, 255)
        doc.roundedRect(cardX, priceY, cardW, 26, 3, 3, 'F')
        doc.setDrawColor(220, 222, 230)
        doc.roundedRect(cardX, priceY, cardW, 26, 3, 3, 'S')
        doc.setFont('Lato', 'normal')
        doc.setFontSize(7)
        doc.setTextColor(...grayText)
        doc.text('Стоимость оборудования', cardX + 8, priceY + 8)
        doc.setFont('Lato', 'bold')
        doc.setFontSize(18)
        doc.setTextColor(...brandOrange)
        doc.text(formatMoney(equipSection.subtotal), cardX + 8, priceY + 20)
      }

      } // end if (!isInno) / else

      // === Слайды оборудования (для ИННО) ===
      if (isInno && licType) {
        const equipSlides = innoEquipmentSlides[licType] || []
        for (const slide of equipSlides) {
          doc.addPage([slideW, slideH], 'l')
          try {
            const imgData = await loadImage(`/slides/${slide.file}`)
            doc.addImage(imgData, 'JPEG', 0, 0, slideW, slideH)
          } catch { /* skip missing */ }
        }
      }

      // === Детальная таблица (доп. страница для бухгалтерии) ===
      doc.addPage([slideW, slideH], 'l')
      doc.setFillColor(245, 247, 250)
      doc.rect(0, 0, slideW, slideH, 'F')
      doc.setFillColor(...brandOrange)
      doc.rect(0, 0, slideW, 2, 'F')

      doc.setFont('Lato', 'bold')
      doc.setTextColor(...darkText)
      doc.setFontSize(16)
      doc.text('Детализация стоимости', 20, 16)
      doc.setFont('Lato', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(...grayText)
      doc.text(`${currentKP.clientName} \u2022 ${currentKP.date}`, 20, 23)

      let yPos = 30

      for (const section of currentKP.sections) {
        if (yPos > slideH - 30) {
          doc.addPage([slideW, slideH], 'l')
          doc.setFillColor(245, 247, 250)
          doc.rect(0, 0, slideW, slideH, 'F')
          doc.setFillColor(...brandOrange)
          doc.rect(0, 0, slideW, 2, 'F')
          yPos = 16
        }

        doc.setFont('Lato', 'bold')
        doc.setFontSize(10)
        doc.setTextColor(...brandOrange)
        doc.text(section.title, 20, yPos)
        yPos += 2

        autoTable(doc, {
          startY: yPos,
          head: [['Наименование', 'Кол-во', 'Цена', 'Скидка', 'Сумма']],
          body: section.items.map(item => [
            item.name,
            String(item.qty),
            formatMoney(item.unitPrice),
            item.discount > 0 ? `-${item.discount}%` : '\u2014',
            formatMoney(item.total),
          ]),
          foot: [['', '', '', 'Итого:', formatMoney(section.subtotal)]],
          theme: 'grid',
          styles: { fontSize: 8, cellPadding: 2, font: 'Lato', fontStyle: 'normal', textColor: [50, 55, 70], lineColor: [210, 215, 225], lineWidth: 0.2 },
          headStyles: { fillColor: [brandOrange[0], brandOrange[1], brandOrange[2]], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
          bodyStyles: { fillColor: [255, 255, 255] },
          alternateRowStyles: { fillColor: [248, 249, 252] },
          footStyles: { fillColor: [235, 237, 242], textColor: [30, 35, 50], fontStyle: 'bold' },
          columnStyles: { 0: { cellWidth: 'auto' }, 1: { halign: 'center', cellWidth: 18 }, 2: { halign: 'right', cellWidth: 35 }, 3: { halign: 'center', cellWidth: 20 }, 4: { halign: 'right', cellWidth: 35 } },
          margin: { left: 20, right: 20 },
        })

        yPos = (doc as any).lastAutoTable.finalY + 6
      }

      // Итого бар
      if (yPos > slideH - 20) {
        doc.addPage([slideW, slideH], 'l')
        doc.setFillColor(245, 247, 250)
        doc.rect(0, 0, slideW, slideH, 'F')
        yPos = 20
      }

      doc.setFillColor(...brandOrange)
      doc.roundedRect(20, yPos, slideW - 40, 12, 3, 3, 'F')
      doc.setFont('Lato', 'bold')
      doc.setTextColor(255, 255, 255)
      doc.setFontSize(12)
      doc.text(`ИТОГО: ${formatMoney(currentKP.grandTotal)}`, slideW / 2, yPos + 8, { align: 'center' })

      // === Слайды ПОСЛЕ ===
      for (const slide of slidesAfter) {
        doc.addPage([slideW, slideH], 'l')
        try {
          const imgData = await loadImage(`/slides/${slide.file}`)
          doc.addImage(imgData, 'JPEG', 0, 0, slideW, slideH)
        } catch { /* skip missing */ }
      }

      doc.save(`KP_${currentKP.clientName.replace(/[^a-zA-Zа-яА-Я0-9]/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`)
    } catch (err) {
      console.error('PDF generation error:', err)
      alert('Ошибка при генерации PDF.')
    } finally {
      setGenerating(false)
    }
  }

  // --- Определяем: это позиция из каталога или свободная ---
  const isCatalogItem = (name: string) => !!findProductByName(catalog, name)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className={`px-3 py-1 rounded-full text-xs font-medium ${
          isInno ? 'bg-orange-500/20 text-orange-400' : 'bg-purple-500/20 text-purple-400'
        }`}>
          {isInno ? 'ИННО' : 'БОНДА'}
        </div>
        <h2 className="text-xl font-bold text-white">{kp.clientName}</h2>
        <span className="text-sm text-white/40">{kp.date}</span>
      </div>

      {/* Hint */}
      <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 px-4 py-2 text-xs text-blue-300">
        Кликните на название — выбор из каталога с ценой. Кликните на число — ручная правка. Итоги пересчитываются автоматически.
      </div>

      {/* Sections */}
      {sections.map((section, si) => (
        <div key={si} className="rounded-xl bg-white/5 border border-white/10 overflow-visible">
          <div className={`px-4 py-2 text-sm font-medium flex items-center justify-between ${
            isInno ? 'bg-orange-500/10 text-orange-400' : 'bg-purple-500/10 text-purple-400'
          }`}>
            <span>{section.title}</span>
            <button
              onClick={() => addItem(si)}
              className="text-xs opacity-60 hover:opacity-100 transition px-2 py-0.5 rounded bg-white/5 hover:bg-white/10"
            >
              + Добавить
            </button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-white/40 border-b border-white/5">
                <th className="text-left px-4 py-2">Наименование</th>
                <th className="text-center px-4 py-2 w-16">Кол-во</th>
                <th className="text-right px-4 py-2 w-28">Цена</th>
                <th className="text-center px-4 py-2 w-20">Скидка</th>
                <th className="text-right px-4 py-2 w-28">Сумма</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {section.items.map((item, ii) => {
                const hasCatalog = isCatalogItem(item.name) || item.name === 'Новая позиция'
                const selectorOpen = openSelector?.[0] === si && openSelector?.[1] === ii

                return (
                  <tr key={ii} className="border-b border-white/5 group">
                    {/* Название — клик открывает каталог или редактирование */}
                    <td className="px-4 py-2 text-white/80 relative">
                      <div
                        onClick={() => {
                          if (selectorOpen) {
                            setOpenSelector(null)
                          } else {
                            setOpenSelector([si, ii])
                          }
                        }}
                        className={`cursor-pointer hover:bg-white/10 rounded px-2 py-1 -mx-2 -my-1 transition flex items-center gap-2 ${
                          selectorOpen ? 'bg-white/10' : ''
                        }`}
                      >
                        <span className="truncate">{item.name}</span>
                        {hasCatalog && (
                          <svg className="w-3 h-3 text-white/30 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        )}
                      </div>
                      {selectorOpen && (
                        <ProductSelector
                          currentName={item.name}
                          catalog={catalog}
                          isInno={isInno}
                          onSelect={product => replaceWithProduct(si, ii, product)}
                          onClose={() => setOpenSelector(null)}
                        />
                      )}
                    </td>
                    {/* Кол-во */}
                    <td className="px-4 py-2 text-white/60">
                      <EditableNumber
                        value={item.qty}
                        onChange={v => updateField(si, ii, 'qty', v)}
                        format="plain"
                        align="center"
                      />
                    </td>
                    {/* Цена */}
                    <td className="px-4 py-2 text-white/60">
                      <EditableNumber
                        value={item.unitPrice}
                        onChange={v => updateField(si, ii, 'unitPrice', v)}
                        format="money"
                        align="right"
                      />
                    </td>
                    {/* Скидка */}
                    <td className="px-4 py-2 text-white/60">
                      <EditableNumber
                        value={item.discount}
                        onChange={v => updateField(si, ii, 'discount', v)}
                        format="percent"
                        align="center"
                      />
                    </td>
                    {/* Сумма (auto) */}
                    <td className="px-4 py-2 text-right text-white font-medium">
                      {formatMoney(item.total)}
                    </td>
                    {/* Удалить */}
                    <td className="px-1 py-2">
                      <button
                        onClick={() => removeItem(si, ii)}
                        className="opacity-0 group-hover:opacity-40 hover:!opacity-100 text-red-400 transition text-xs p-1"
                        title="Удалить"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-white/5">
                <td colSpan={4} className="px-4 py-2 text-right text-white/60 font-medium">Итого:</td>
                <td className="px-4 py-2 text-right text-white font-bold">{formatMoney(section.subtotal)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      ))}

      {/* Add section */}
      <button
        onClick={addSection}
        className="w-full py-2 rounded-xl border border-dashed border-white/10 text-sm text-white/30 hover:text-white/60 hover:border-white/20 transition"
      >
        + Добавить секцию
      </button>

      {/* Grand Total */}
      <div className={`rounded-xl p-4 text-center ${
        isInno ? 'bg-gradient-to-r from-orange-500/20 to-orange-600/20 border border-orange-500/30'
               : 'bg-gradient-to-r from-purple-500/20 to-purple-600/20 border border-purple-500/30'
      }`}>
        <div className="text-sm text-white/50 mb-1">Общая стоимость</div>
        <div className="text-3xl font-bold text-white">{formatMoney(grandTotal)}</div>
        {kp.monthlyTotal > 0 && (
          <div className="text-sm text-white/50 mt-1">Ежемесячный платёж: {formatMoney(kp.monthlyTotal)}</div>
        )}
        <div className="text-xs text-white/30 mt-2">{kp.paymentType}</div>
      </div>

      {/* Slides info */}
      <div className="rounded-xl bg-white/5 border border-white/10 p-4">
        <div className="text-sm text-white/50 mb-2">В PDF будет включено:</div>
        <div className="grid grid-cols-2 gap-2 text-xs text-white/40">
          <div><span className="text-white/60">До КП:</span> {(isInno ? innoSlidesBefore : bondaSlidesBefore).length} слайдов</div>
          <div><span className="text-white/60">После КП:</span> {(isInno ? innoSlidesAfter : bondaSlidesAfter).length} слайдов</div>
        </div>
      </div>

      {/* Download PDF */}
      <div className="flex gap-3">
        <button
          onClick={handleDownloadPDF}
          disabled={generating}
          className={`flex-1 py-3 rounded-xl font-medium text-white transition-all ${
            generating ? 'opacity-60 cursor-wait' : ''
          } ${isInno ? 'bg-orange-500 hover:bg-orange-600' : 'bg-purple-500 hover:bg-purple-600'}`}
        >
          {generating ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Генерация PDF...
            </span>
          ) : 'Скачать PDF-презентацию'}
        </button>
      </div>
    </div>
  )
}
