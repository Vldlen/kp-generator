'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { formatMoney, recomputeLineTotal, type KPResult, type LineItem } from '@/lib/calculator'
import type { ParsedRequest } from '@/lib/prompt'
import type { DBProduct } from '@/lib/supabase'
// Количество слайдов в шаблонах (без КП-слайда)
const SLIDE_COUNTS: Record<string, { before: number; after: number }> = {
  qr:        { before: 3, after: 2 },  // inno_qr_template: 5 слайдов, КП после 3-го
  ecomm:     { before: 3, after: 2 },
  kiosk:     { before: 4, after: 2 },  // inno_kiosk_template: 6 слайдов, КП после 4-го
  kiosk_pro: { before: 4, after: 2 },
}
import {
  generateKPPptx,
  PPTX_TEMPLATE_LIMITS,
  checkPptxOverflow,
} from '@/lib/generatePptx'
import { tablets, mounts, peripherals, periodMultiplier } from '@/lib/catalog'

// Маппинг реальных имён → обезличенные для КП. Используется как fallback,
// если у продукта нет своего kp_name (Phase 9, H7).
const kpNameMap: Record<string, string> = {}
for (const arr of [tablets, mounts, peripherals]) {
  for (const p of arr) {
    if (p.kpName) kpNameMap[p.name] = p.kpName
  }
}
/** Возвращает обезличенное имя продукта для КП. Приоритет: явный kp_name
 *  из продукта (Google Sheets / fallback каталог), затем встроенная карта,
 *  затем — реальное имя как есть. */
function getKpName(realName: string, kpNameOverride?: string | null): string {
  if (kpNameOverride) return kpNameOverride
  return kpNameMap[realName] || realName
}

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

// Найти продукт по имени в каталоге. Ищем и по реальному name, и по kp_name —
// потому что в LineItem.name лежит обезличенное имя (Phase 9, H10).
function findProductByName(catalog: DBProduct[], name: string): DBProduct | undefined {
  return catalog.find(p => p.name === name || p.kp_name === name)
}

// Получить товары той же категории для замены. Если продукт не найден —
// возвращаем пустой каталог (раньше показывали ВЕСЬ каталог, что давало
// кашу из 200 SKU без фильтра).
function getAlternatives(catalog: DBProduct[], productName: string): DBProduct[] {
  const product = findProductByName(catalog, productName)
  if (!product) return []
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
  value, onChange, format = 'money', align = 'right', suffix,
}: {
  value: number
  onChange: (v: number) => void
  format?: 'money' | 'plain' | 'percent'
  align?: 'left' | 'right' | 'center'
  suffix?: string  // например '/мес' для подписочных строк
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
        : <>{display}{suffix && <span className="text-white/40 ml-0.5">{suffix}</span>}</>}
    </div>
  )
}

// --- Редактируемое название ---
function EditableName({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false)
          if (draft.trim()) onChange(draft.trim())
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') { setEditing(false); setDraft(value) }
        }}
        className="w-full bg-white/10 border border-orange-500/50 rounded px-2 py-1 text-white text-sm outline-none"
      />
    )
  }

  return (
    <button
      onClick={(e) => { e.stopPropagation(); setEditing(true); setDraft(value) }}
      className="opacity-0 group-hover:opacity-40 hover:!opacity-100 text-white/50 transition p-0.5 flex-shrink-0"
      title="Редактировать название"
    >
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
      </svg>
    </button>
  )
}

// --- Пересчёт ---
// total = unitPrice × qty × months × (1 - discount/100). См. recomputeLineTotal
// в calculator.ts — там же лежит источник истины для формулы.
function recalcItem(item: LineItem): LineItem {
  return { ...item, total: recomputeLineTotal(item) }
}

function recalcSection(section: KPResult['sections'][0]) {
  return { ...section, subtotal: section.items.reduce((sum, i) => sum + i.total, 0) }
}

/** Признак подписочной строки — есть значимый множитель месяцев. */
function isSubscription(item: LineItem): boolean {
  return !!(item.months && item.months > 1)
}

// ====== MAIN COMPONENT ======

const BUILD_TAG = '2026-05-14-pptx'

// Снапшот удаления для undo-toast
type Removal =
  | { kind: 'item'; sectionIndex: number; itemIndex: number; item: LineItem; sectionWasDeleted: false }
  | { kind: 'item'; sectionIndex: number; itemIndex: number; item: LineItem; sectionWasDeleted: true; section: KPResult['sections'][0] }
  | { kind: 'section'; sectionIndex: number; section: KPResult['sections'][0] }

const UNDO_TIMEOUT_MS = 6000

export function KPPreview({ kp, parsed, catalog }: Props) {
  const isInno = kp.company === 'inno'
  const [generating, setGenerating] = useState(false)
  const [sections, setSections] = useState(
    kp.sections.map(s => ({ ...s, items: s.items.map(i => ({ ...i })) }))
  )
  // Какой селектор каталога открыт: [sectionIndex, itemIndex] или null
  const [openSelector, setOpenSelector] = useState<[number, number] | null>(null)
  // Снапшот последнего удаления для undo-toast (null = нет активного toast'а)
  const [lastRemoval, setLastRemoval] = useState<Removal | null>(null)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const grandTotal = sections.reduce((sum, s) => sum + s.subtotal, 0)

  // Реактивный пересчёт ежемесячного платежа — раньше показывался kp.monthlyTotal,
  // который не обновлялся при правках цены/qty/discount лицензии в preview.
  // Теперь делим текущий total строки лицензии на число месяцев подписки.
  // Когда (Phase 3) LineItem получит явное поле months, эта формула упростится.
  const monthlyTotal = (() => {
    const licenseSection = sections.find(s => s.title === 'Лицензии и подписки')
    if (!licenseSection || licenseSection.items.length === 0) return 0
    const months = periodMultiplier[parsed.subscription_period]?.months ?? 1
    if (months <= 0) return 0
    const licenseTotal = licenseSection.items.reduce((sum, i) => sum + i.total, 0)
    return Math.round(licenseTotal / months)
  })()

  // Очистка таймера undo при размонтировании
  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    }
  }, [])

  const scheduleUndoClear = useCallback(() => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    undoTimerRef.current = setTimeout(() => setLastRemoval(null), UNDO_TIMEOUT_MS)
  }, [])

  const dismissUndo = useCallback(() => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    setLastRemoval(null)
  }, [])

  // Замена позиции на продукт из каталога (имя обезличивается автоматически —
  // приоритет kp_name из продукта, иначе fallback на встроенный kpNameMap).
  const replaceWithProduct = useCallback((si: number, ii: number, product: DBProduct) => {
    setSections(prev => {
      const next = prev.map(s => ({ ...s, items: s.items.map(i => ({ ...i })) }))
      const item = next[si].items[ii]
      const oldQty = item.qty
      next[si].items[ii] = recalcItem({
        ...item,
        name: getKpName(product.name, product.kp_name),
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
      const removedItem = next[si].items[ii]
      const sectionSnapshot = { ...next[si], items: next[si].items.map(i => ({ ...i })) }
      next[si].items.splice(ii, 1)
      if (next[si].items.length === 0) {
        // Секция опустошилась — удаляем её и запоминаем для undo
        next.splice(si, 1)
        setLastRemoval({
          kind: 'item',
          sectionIndex: si,
          itemIndex: ii,
          item: removedItem,
          sectionWasDeleted: true,
          section: sectionSnapshot,
        })
      } else {
        next[si] = recalcSection(next[si])
        setLastRemoval({
          kind: 'item',
          sectionIndex: si,
          itemIndex: ii,
          item: removedItem,
          sectionWasDeleted: false,
        })
      }
      scheduleUndoClear()
      return next
    })
  }, [scheduleUndoClear])

  const undoLastRemoval = useCallback(() => {
    if (!lastRemoval) return
    setSections(prev => {
      const next = prev.map(s => ({ ...s, items: s.items.map(i => ({ ...i })) }))
      if (lastRemoval.kind === 'item') {
        if (lastRemoval.sectionWasDeleted) {
          // Восстанавливаем секцию целиком
          next.splice(lastRemoval.sectionIndex, 0, lastRemoval.section)
        } else {
          // Вставляем item на исходное место + пересчёт subtotal
          const si = Math.min(lastRemoval.sectionIndex, next.length - 1)
          next[si].items.splice(lastRemoval.itemIndex, 0, lastRemoval.item)
          next[si] = recalcSection(next[si])
        }
      } else {
        // section
        next.splice(lastRemoval.sectionIndex, 0, lastRemoval.section)
      }
      return next
    })
    dismissUndo()
  }, [lastRemoval, dismissUndo])

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

  // Переименовать позицию (свободный текст — не влияет на расчёт)
  const updateName = useCallback((si: number, ii: number, name: string) => {
    setSections(prev => {
      const next = prev.map(s => ({ ...s, items: s.items.map(i => ({ ...i })) }))
      next[si].items[ii].name = name
      return next
    })
  }, [])

  // addSection раньше создавал секцию с title='Дополнительно', которой не было
  // в списке известных заголовков generatePptx → секция терялась в .pptx, но
  // grandTotal её включал (P0-2 в аудите 2026-05-14). Кнопка удалена, функция
  // тоже. Если в будущем понадобится — нужно сначала поддержать 4-ю карточку
  // в шаблоне .pptx.

  // Собрать актуальный KPResult — sections / grandTotal / monthlyTotal
  // пересчитываются по правкам пользователя в preview.
  const getCurrentKP = (): KPResult => ({ ...kp, sections, grandTotal, monthlyTotal })

  // PPTX — генерация презентации
  const handleDownloadPPTX = async () => {
    const currentKP = getCurrentKP()

    // Watchdog: проверяем лимиты шаблона перед выгрузкой.
    // Без этой проверки лишние строки молча обрежутся (P0-1) и/или секции
    // с неизвестным заголовком потеряются целиком (P0-2). См. аудит 2026-05-14.
    const overflow = checkPptxOverflow(currentKP)
    if (overflow.length > 0) {
      const lines = overflow.map(issue => {
        if (issue.templateLimit === 0) {
          return `• «${issue.sectionTitle}» (${issue.itemCount} поз.) — секция отсутствует в шаблоне .pptx и не будет показана клиенту.`
        }
        return `• «${issue.sectionTitle}»: ${issue.itemCount} позиций, в шаблоне ${issue.templateLimit}. Убрать ${issue.itemCount - issue.templateLimit}.`
      })
      alert(
        'Невозможно выгрузить .pptx — превышены лимиты шаблона:\n\n' +
        lines.join('\n') +
        '\n\nУменьшите количество позиций в указанных секциях и попробуйте снова.'
      )
      return
    }

    setGenerating(true)
    try {
      await generateKPPptx(currentKP, parsed, isInno)
    } catch (err) {
      console.error('PPTX generation error:', err)
      alert('Ошибка при генерации PPTX. Попробуйте ещё раз или сообщите в #помощь-кп.')
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
      {sections.map((section, si) => {
        const sectionLimit = PPTX_TEMPLATE_LIMITS[section.title]
        const atLimit = sectionLimit !== undefined && section.items.length >= sectionLimit
        const knownSection = sectionLimit !== undefined
        return (
        <div key={si} className="rounded-xl bg-white/5 border border-white/10 overflow-visible">
          <div className={`px-4 py-2 text-sm font-medium flex items-center justify-between gap-3 ${
            isInno ? 'bg-orange-500/10 text-orange-400' : 'bg-purple-500/10 text-purple-400'
          }`}>
            <span className="flex items-center gap-2">
              {section.title}
              {knownSection && (
                <span className="text-[10px] text-white/40 font-normal">
                  {section.items.length}/{sectionLimit}
                </span>
              )}
            </span>
            <button
              onClick={() => addItem(si)}
              disabled={atLimit}
              title={atLimit ? `В шаблоне .pptx максимум ${sectionLimit} строк в этой секции` : 'Добавить позицию'}
              className={`text-xs transition px-2 py-0.5 rounded bg-white/5 ${
                atLimit
                  ? 'opacity-30 cursor-not-allowed'
                  : 'opacity-60 hover:opacity-100 hover:bg-white/10'
              }`}
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
                    {/* Название — клик открывает каталог, карандаш — ручная правка */}
                    <td className="px-4 py-2 text-white/80 relative">
                      <div className="flex items-center gap-1">
                        <div
                          onClick={() => {
                            if (selectorOpen) {
                              setOpenSelector(null)
                            } else {
                              setOpenSelector([si, ii])
                            }
                          }}
                          className={`cursor-pointer hover:bg-white/10 rounded px-2 py-1 -mx-2 -my-1 transition flex items-center gap-2 flex-1 min-w-0 ${
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
                        <EditableName value={item.name} onChange={v => updateName(si, ii, v)} />
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
                    {/* Цена. Для подписочных строк (item.months > 1) подпись
                        «/мес» в значении и «× N мес» строкой ниже. */}
                    <td className="px-4 py-2 text-white/60">
                      <EditableNumber
                        value={item.unitPrice}
                        onChange={v => updateField(si, ii, 'unitPrice', v)}
                        format="money"
                        align="right"
                        suffix={isSubscription(item) ? '/мес' : undefined}
                      />
                      {isSubscription(item) && (
                        <div className="text-[10px] text-white/30 text-right -mt-1">
                          × {item.months} мес
                        </div>
                      )}
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
          {!knownSection && (
            <div className="px-4 py-2 text-xs text-amber-300/80 bg-amber-500/5 border-t border-amber-500/20">
              ⚠ Секция «{section.title}» не поддерживается шаблоном .pptx и не будет показана клиенту. Перенесите позиции в Оборудование / Лицензии и подписки / Услуги.
            </div>
          )}
        </div>
        )
      })}

      {/* Кнопка «+ Добавить секцию» удалена (баг P0-2 в аудите 2026-05-14):
          секции с title != 'Оборудование'/'Лицензии и подписки'/'Услуги' молча
          теряются в .pptx, но входят в grandTotal. До поддержки 4-й карточки
          в шаблоне функция намеренно недоступна. */}

      {/* Grand Total */}
      <div className={`rounded-xl p-4 text-center ${
        isInno ? 'bg-gradient-to-r from-orange-500/20 to-orange-600/20 border border-orange-500/30'
               : 'bg-gradient-to-r from-purple-500/20 to-purple-600/20 border border-purple-500/30'
      }`}>
        <div className="text-sm text-white/50 mb-1">Общая стоимость</div>
        <div className="text-3xl font-bold text-white">{formatMoney(grandTotal)}</div>
        {monthlyTotal > 0 && (
          <div className="text-sm text-white/50 mt-1">Ежемесячный платёж: {formatMoney(monthlyTotal)}</div>
        )}
        <div className="text-xs text-white/30 mt-2">{kp.paymentType}</div>
      </div>

      {/* Slides info */}
      <div className="rounded-xl bg-white/5 border border-white/10 p-4">
        <div className="text-sm text-white/50 mb-2">В презентации будет:</div>
        <div className="grid grid-cols-2 gap-2 text-xs text-white/40">
          <div><span className="text-white/60">До КП:</span> {(SLIDE_COUNTS[parsed.license_type || 'kiosk']?.before || 3)} слайдов</div>
          <div><span className="text-white/60">После КП:</span> {(SLIDE_COUNTS[parsed.license_type || 'kiosk']?.after || 2)} слайдов</div>
        </div>
        <div className="text-[10px] text-white/20 mt-2 text-right">build: {BUILD_TAG}</div>
      </div>

      {/* Download PPTX */}
      <div className="flex gap-3">
        <button
          onClick={handleDownloadPPTX}
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
              Генерация PPTX...
            </span>
          ) : 'Скачать PPTX-презентацию'}
        </button>
      </div>

      {/* Undo-toast — показывается 6 секунд после удаления позиции/секции */}
      {lastRemoval && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl bg-[#1e1e30] border border-white/20 shadow-2xl px-4 py-3 animate-fade-in"
        >
          <svg className="w-4 h-4 text-white/50 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
          </svg>
          <span className="text-sm text-white/80">
            {lastRemoval.kind === 'item'
              ? (lastRemoval.sectionWasDeleted
                  ? `Удалена секция: «${lastRemoval.section.title}»`
                  : `Удалено: «${lastRemoval.item.name}»`)
              : `Удалена секция: «${lastRemoval.section.title}»`}
          </span>
          <button
            onClick={undoLastRemoval}
            className="text-sm font-medium text-orange-400 hover:text-orange-300 px-2 py-1 rounded transition"
          >
            Отменить
          </button>
          <button
            onClick={dismissUndo}
            className="text-white/40 hover:text-white/70 px-1 transition"
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
