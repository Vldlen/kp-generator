'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { formatMoney, recomputeLineTotal, type KPResult, type LineItem } from '@/lib/calculator'
import type { ParsedRequest } from '@/lib/prompt'
import type { DBProduct } from '@/lib/supabase'
import {
  generateKPPptx,
  PPTX_TEMPLATE_LIMITS,
  checkPptxOverflow,
} from '@/lib/generatePptx'
import { tablets, mounts, peripherals, periodMultiplier } from '@/lib/catalog'

// Количество слайдов в шаблонах (без КП-слайда)
const SLIDE_COUNTS: Record<string, { before: number; after: number }> = {
  qr:        { before: 3, after: 2 },  // inno_qr_template: 5 слайдов, КП после 3-го
  ecomm:     { before: 3, after: 2 },
  kiosk:     { before: 4, after: 2 },  // inno_kiosk_template: 6 слайдов, КП после 4-го
  kiosk_pro: { before: 4, after: 2 },
}

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
  currentName, catalog, onSelect, onClose,
}: {
  currentName: string
  catalog: DBProduct[]
  onSelect: (product: DBProduct) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const alternatives = getAlternatives(catalog, currentName)
  const groups = groupByCategory(alternatives)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div ref={ref} className="pc-popover">
      {groups.map(group => (
        <div key={group.category} className="pc-popover-grp">
          <div className="pc-popover-glab">{group.label}</div>
          {group.items.map(product => (
            <button
              key={product.id}
              type="button"
              className="pc-popover-item"
              data-on={product.name === currentName}
              onClick={() => { onSelect(product); onClose() }}
            >
              <div className="min-w-0">
                <div className="pc-popover-name truncate">{product.name}</div>
                {product.specs && <div className="pc-popover-specs">{product.specs}</div>}
              </div>
              <span className="pc-popover-price">{formatMoney(product.sell_price)}</span>
            </button>
          ))}
        </div>
      ))}
      {groups.length === 0 && (
        <div className="pc-popover-empty">Нет альтернатив в каталоге</div>
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
  const textAlign: 'left' | 'right' | 'center' = align

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
        className="pc-cell-input"
        style={{ textAlign }}
      />
    )
  }

  return (
    <div
      onClick={() => { setEditing(true); setDraft(String(value)) }}
      className="pc-cell"
      style={{ textAlign }}
      title="Кликните для редактирования"
    >
      {format === 'percent' && value > 0
        ? <span style={{ color: 'var(--accent)' }}>{display}</span>
        : <>{display}{suffix && <span style={{ color: 'var(--text-3)', marginLeft: 2 }}>{suffix}</span>}</>}
    </div>
  )
}

// --- Редактируемое название (карандашик) ---
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
        className="pc-cell-input"
      />
    )
  }

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); setEditing(true); setDraft(value) }}
      className="pc-pencil"
      title="Редактировать название"
    >
      <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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

const BUILD_TAG = '2026-05-14-pechatny-tseh'

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
  const [openSelector, setOpenSelector] = useState<[number, number] | null>(null)
  const [lastRemoval, setLastRemoval] = useState<Removal | null>(null)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const grandTotal = sections.reduce((sum, s) => sum + s.subtotal, 0)

  // Реактивный пересчёт ежемесячного платежа.
  const monthlyTotal = (() => {
    const licenseSection = sections.find(s => s.title === 'Лицензии и подписки')
    if (!licenseSection || licenseSection.items.length === 0) return 0
    const months = periodMultiplier[parsed.subscription_period]?.months ?? 1
    if (months <= 0) return 0
    const licenseTotal = licenseSection.items.reduce((sum, i) => sum + i.total, 0)
    return Math.round(licenseTotal / months)
  })()

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
          next.splice(lastRemoval.sectionIndex, 0, lastRemoval.section)
        } else {
          const si = Math.min(lastRemoval.sectionIndex, next.length - 1)
          next[si].items.splice(lastRemoval.itemIndex, 0, lastRemoval.item)
          next[si] = recalcSection(next[si])
        }
      } else {
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

  const updateName = useCallback((si: number, ii: number, name: string) => {
    setSections(prev => {
      const next = prev.map(s => ({ ...s, items: s.items.map(i => ({ ...i })) }))
      next[si].items[ii].name = name
      return next
    })
  }, [])

  // addSection раньше создавал секцию с title='Дополнительно' — теряется в .pptx
  // (P0-2 в аудите 2026-05-14). Кнопка и функция удалены.

  // Собрать актуальный KPResult.
  const getCurrentKP = (): KPResult => ({ ...kp, sections, grandTotal, monthlyTotal })

  const handleDownloadPPTX = async () => {
    const currentKP = getCurrentKP()

    // Watchdog: проверяем лимиты шаблона перед выгрузкой (см. P0-1/P0-2 в аудите).
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

  const isCatalogItem = (name: string) => !!findProductByName(catalog, name)

  const slidesBefore = SLIDE_COUNTS[parsed.license_type || 'kiosk']?.before ?? 3
  const slidesAfter  = SLIDE_COUNTS[parsed.license_type || 'kiosk']?.after  ?? 2

  return (
    <>
      {/* Шапка документа КП */}
      <div className="pc-doc-head pc-rise">
        <div>
          <span className={`pc-tag ${isInno ? 'pc-tag--inno' : 'pc-tag--bonda'}`}>
            {isInno ? 'ИННО' : 'БОНДА'}
          </span>
          <h2 className="pc-doc-title">{kp.clientName}</h2>
        </div>
        <div className="pc-doc-meta">
          {kp.date}
          <br />
          <span style={{ color: 'var(--text-3)' }}>{kp.paymentType}</span>
        </div>
      </div>

      {/* Подсказка */}
      <div className="pc-rise" style={{ padding: '16px 32px 0' }}>
        <div className="pc-hint">
          Кликните на название — выбор из каталога. Кликните на число — ручная правка. Итоги пересчитываются автоматически.
        </div>
      </div>

      {/* Секции — печатные таблицы */}
      {sections.map((section, si) => {
        const sectionLimit = PPTX_TEMPLATE_LIMITS[section.title]
        const atLimit = sectionLimit !== undefined && section.items.length >= sectionLimit
        const knownSection = sectionLimit !== undefined
        return (
          <section key={si} className="pc-prevsec pc-rise">
            <div className="pc-prevsec-head">
              <div>
                <span className="pc-prevsec-title">{section.title}</span>
                {knownSection && (
                  <span className="pc-prevsec-count">{section.items.length} / {sectionLimit}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => addItem(si)}
                disabled={atLimit}
                title={atLimit ? `В шаблоне .pptx максимум ${sectionLimit} строк в этой секции` : 'Добавить позицию'}
                className="pc-add"
              >
                + позиция
              </button>
            </div>

            <table className="pc-table">
              <thead>
                <tr>
                  <th>Наименование</th>
                  <th className="ctr" style={{ width: 70 }}>Кол-во</th>
                  <th className="num" style={{ width: 130 }}>Цена</th>
                  <th className="ctr" style={{ width: 80 }}>Скидка</th>
                  <th className="num" style={{ width: 130 }}>Сумма</th>
                  <th style={{ width: 30 }}></th>
                </tr>
              </thead>
              <tbody>
                {section.items.map((item, ii) => {
                  const hasCatalog = isCatalogItem(item.name) || item.name === 'Новая позиция'
                  const selectorOpen = openSelector?.[0] === si && openSelector?.[1] === ii

                  return (
                    <tr key={ii}>
                      {/* Название */}
                      <td style={{ position: 'relative' }}>
                        <div className="flex items-center gap-1">
                          <div
                            onClick={() => {
                              if (selectorOpen) setOpenSelector(null)
                              else setOpenSelector([si, ii])
                            }}
                            className="pc-cell flex-1 min-w-0 flex items-center gap-2"
                            style={{ textAlign: 'left' }}
                          >
                            <span className="truncate" style={{ color: 'var(--text)' }}>{item.name}</span>
                            {hasCatalog && (
                              <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor"
                                style={{ color: 'var(--text-3)', flexShrink: 0 }}>
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                              </svg>
                            )}
                          </div>
                          <EditableName value={item.name} onChange={v => updateName(si, ii, v)} />
                        </div>
                        {selectorOpen && (
                          <ProductSelector
                            currentName={item.name}
                            catalog={catalog}
                            onSelect={product => replaceWithProduct(si, ii, product)}
                            onClose={() => setOpenSelector(null)}
                          />
                        )}
                      </td>

                      {/* Кол-во */}
                      <td className="ctr">
                        <EditableNumber
                          value={item.qty}
                          onChange={v => updateField(si, ii, 'qty', v)}
                          format="plain"
                          align="center"
                        />
                      </td>

                      {/* Цена. Для подписок — суффикс «/мес» + «× N мес» снизу. */}
                      <td className="num">
                        <EditableNumber
                          value={item.unitPrice}
                          onChange={v => updateField(si, ii, 'unitPrice', v)}
                          format="money"
                          align="right"
                          suffix={isSubscription(item) ? '/мес' : undefined}
                        />
                        {isSubscription(item) && (
                          <div className="pc-cell-sub">× {item.months} мес</div>
                        )}
                      </td>

                      {/* Скидка */}
                      <td className="ctr">
                        <EditableNumber
                          value={item.discount}
                          onChange={v => updateField(si, ii, 'discount', v)}
                          format="percent"
                          align="center"
                        />
                      </td>

                      {/* Сумма */}
                      <td className="num" style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                        {formatMoney(item.total)}
                      </td>

                      {/* Удалить */}
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          onClick={() => removeItem(si, ii)}
                          className="pc-cell-rm"
                          title="Удалить"
                          aria-label="Удалить позицию"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} style={{ textAlign: 'right' }}>Итого</td>
                  <td className="num">{formatMoney(section.subtotal)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>

            {!knownSection && (
              <div className="pc-warn">
                ⚠ Секция «{section.title}» не поддерживается шаблоном .pptx и не попадёт в финальную выгрузку. Перенесите позиции в «Оборудование» / «Лицензии и подписки» / «Услуги».
              </div>
            )}
          </section>
        )
      })}

      {/* К оплате */}
      <div className="pc-totalcard pc-rise">
        <div>
          <div className="pc-totalcard-kick">К оплате</div>
          <div className="pc-totalcard-sum">
            {Math.round(grandTotal).toLocaleString('ru-RU')}&nbsp;<span className="pc-ruble">₽</span>
          </div>
        </div>
        <div className="pc-totalcard-meta">
          {monthlyTotal > 0 && (
            <>в т.ч. ежемесячно <b>{Math.round(monthlyTotal).toLocaleString('ru-RU')}&nbsp;₽</b><br /></>
          )}
          {kp.paymentType}
        </div>
      </div>

      {/* Выгрузка */}
      <div className="pc-rise" style={{ padding: '24px 32px 32px', borderTop: '1px solid var(--rule)' }}>
        <div className="pc-slidesinfo flex items-baseline justify-between mb-4">
          <span>в презентации: {slidesBefore} слайдов до КП · {slidesAfter} после</span>
          <span style={{ color: 'var(--text-3)' }}>build · {BUILD_TAG}</span>
        </div>
        <button
          type="button"
          onClick={handleDownloadPPTX}
          disabled={generating}
          className="pc-cta"
        >
          <span className="pc-cta-txt">
            {generating ? 'Генерация .pptx…' : 'Скачать презентацию'}
          </span>
          <span className="pc-cta-arr">
            {generating ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="animate-spin">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity=".25" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            ) : '↓'}
          </span>
        </button>
      </div>

      {/* Undo-toast — paper card с офсетной тенью */}
      {lastRemoval && (
        <div
          role="status"
          aria-live="polite"
          className="pc-toast animate-fade-in"
        >
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            style={{ color: 'var(--text-2)' }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
          </svg>
          <span className="pc-toast-msg">
            {lastRemoval.kind === 'item'
              ? (lastRemoval.sectionWasDeleted
                  ? <>Удалена секция: <b>{lastRemoval.section.title}</b></>
                  : <>Удалено: <b>{lastRemoval.item.name}</b></>)
              : <>Удалена секция: <b>{lastRemoval.section.title}</b></>}
          </span>
          <button type="button" onClick={undoLastRemoval} className="pc-toast-undo">
            Отменить
          </button>
          <button type="button" onClick={dismissUndo} className="pc-toast-close" aria-label="Закрыть">
            ✕
          </button>
        </div>
      )}
    </>
  )
}
