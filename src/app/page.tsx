'use client'

import { useState, useEffect, useMemo, type Dispatch, type SetStateAction } from 'react'
import { KPPreview } from '@/components/KPPreview'
import { calculateKP, type KPResult } from '@/lib/calculator'
import type { ParsedRequest } from '@/lib/prompt'
import {
  findirTariffs,
  periodMultiplier,
  allProducts,
  tablets,
  INNO_LICENSE_PRICES,
  INNO_ADDON_LICENSES,
  getFiscalConfigByGroup,
  getFiscalPackPreview,
  resolveFiscalPrices,
  TABLET_KIOSK_FISCAL_CONFIG,
  mountRole,
  mountFrameIncluded,
  SELECTABLE_MOUNT_ROLES,
  type SubscriptionPeriod,
} from '@/lib/catalog'
import { fetchAllCatalog, type DBProduct } from '@/lib/supabase'
import {
  buildCatalog, familyCards, familyModels, familyAxes, familyOptions,
  defaultSelection, resolveModel, resolveChosenOptions, buildKioskEquipment,
  fiscalLines, clientName,
  type Catalog, type Selection, type CatalogItem,
} from '@/lib/catalog-schema'
import { FALLBACK_NOMENCLATURE, FALLBACK_FAMILIES } from '@/lib/catalog-fallback'

type Step = 'form' | 'preview'

const defaultForm: ParsedRequest = {
  company: 'inno',
  client_name: '',
  locations: 1,
  devices: 1,
  products: [],
  kiosk_type: 'desk',
  license_type: null,
  findir_tariff: null,
  selected_tablet_id: null,
  selected_kiosk_id: null,
  subscription_period: 'year',
  need_implementation: false,
  content_items: 0,
  payment_type: 'prepay100',
  notes: '',
  selected_kiosk_options: [],
  additional_licenses: [],
  fiscal_pack: false,  // авто-выставится при выборе license_type (см. update())
  // Новая схема Kiosk PRO: семейство → комплектация → опции.
  selected_family: null,
  complectation: {},
  selected_options: [],
  selected_mount_id: null,  // планшетный Kiosk — выбор кронштейна
}

// Маппинг старых категорий catalog.ts → новые
const categoryMap: Record<string, string> = {
  equipment: 'pos_terminal',
  tablet: 'tablet',
  mount: 'mount',
  peripheral: 'peripheral',
}

// Fallback: конвертируем catalog.ts в формат DBProduct для работы без Supabase
const fallbackCatalog: DBProduct[] = allProducts.map(p => ({
  id: p.id,
  name: p.name,
  article: p.id,
  category: categoryMap[p.category] || p.category,
  company: p.company,
  description: p.description,
  specs: p.specs || null,
  cost_price: p.costPrice,
  sell_price: p.sellPrice,
  margin: p.margin,
  supplier: null,
  supplier_article: null,
  unit: p.unit || 'шт',
  warranty: p.warranty || null,
  is_active: true,
  created_at: '',
  updated_at: '',
  group: null,
  image_url: null,
  kp_name: p.kpName || null,  // Phase 9 (H7): пробрасываем обезличенное имя
}))

export default function Home() {
  const [step, setStep] = useState<Step>('form')
  const [form, setForm] = useState<ParsedRequest>({ ...defaultForm })
  const [kp, setKP] = useState<KPResult | null>(null)
  const [catalog, setCatalog] = useState<DBProduct[]>(fallbackCatalog)
  // Каталог киосков по новой схеме (семейства + комплектация + обязательность).
  // Инициализируется встроенным фолбэком; перекрывается живыми вкладками
  // «Номенклатура (киоски)» / «Правила семейств», когда они появятся в таблице.
  const [catalog2, setCatalog2] = useState<Catalog>(() => buildCatalog(FALLBACK_NOMENCLATURE, FALLBACK_FAMILIES))
  // Откуда сейчас данные каталога: грузятся / живая таблица / резервный снимок.
  // Резервный снимок = встроенные данные; цены могут быть неактуальны — менеджер
  // должен об этом знать, чтобы не отправить КП по старым ценам.
  const [catalogSource, setCatalogSource] = useState<'loading' | 'live' | 'fallback'>('loading')
  const [draftAvailable, setDraftAvailable] = useState<ParsedRequest | null>(null)  // несохранённый черновик из localStorage
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [dateStr, setDateStr] = useState('')

  // Загружаем каталог: сначала Google Sheets (все листы), потом Supabase как
  // fallback. Источник фиксируем в catalogSource — если живые данные не
  // подъехали, менеджер увидит предупреждение (см. баннер ниже).
  useEffect(() => {
    let done = false
    fetchGoogleSheetProducts()
      .then(({ products, catalog2: c2 }) => {
        if (c2) setCatalog2(c2)
        if (products.length > 0) { setCatalog(products); setCatalogSource('live'); done = true; return }
        if (!c2) throw new Error('Google Sheets пуст')
        setCatalogSource('live')  // есть новые вкладки, но старых листов нет — считаем живым
        done = true
      })
      .catch(() => {
        // Fallback на Supabase (для старой схемы). catalog2 остаётся встроенным.
        fetchAllCatalog()
          .then(data => {
            if (data.length > 0) { setCatalog(data); setCatalogSource('live') }
            else setCatalogSource('fallback')
            done = true
          })
          .catch(() => { setCatalogSource('fallback'); done = true })
      })
    // Страховка: если ни один путь не завершился (висит) — через 20с показываем
    // предупреждение о резервных данных, чтобы UI не остался в «загрузке» навсегда.
    const t = setTimeout(() => { if (!done) setCatalogSource(prev => prev === 'loading' ? 'fallback' : prev) }, 20000)
    return () => clearTimeout(t)
  }, [])

  // Черновик КП: на старте предлагаем восстановить последнюю форму из localStorage.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('kp-draft')
      if (raw) {
        const d = JSON.parse(raw) as ParsedRequest
        if (d && (d.client_name?.trim() || d.license_type)) setDraftAvailable(d)
      }
    } catch { /* noop */ }
  }, [])

  // Автосохранение формы (пустую форму по умолчанию не сохраняем, чтобы не
  // затирать черновик до того, как менеджер что-то ввёл).
  useEffect(() => {
    if (!form.client_name.trim() && !form.license_type) return
    try { localStorage.setItem('kp-draft', JSON.stringify(form)) } catch { /* noop */ }
  }, [form])

  // Подхватываем тему, выставленную no-flash скриптом, + дату КП
  useEffect(() => {
    if (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark') {
      setTheme('dark')
    }
    setDateStr(new Date().toLocaleDateString('ru-RU'))
  }, [])

  const toggleTheme = () => {
    setTheme(prev => {
      const next = prev === 'light' ? 'dark' : 'light'
      if (typeof document !== 'undefined') document.documentElement.dataset.theme = next
      try { localStorage.setItem('kp-theme', next) } catch { /* noop */ }
      return next
    })
  }

  // Живой price-map фискалки из текущего каталога (Google Sheets / Supabase /
  // встроенный fallback). Используется UI-превью «Фискальный пакет» и при
  // расчёте КП — calculator получает map через enrichedForm._fiscal_prices.
  // Пересчитывается только при изменении каталога (sync кнопкой или re-fetch).
  const fiscalPrices = useMemo(
    () => resolveFiscalPrices(catalog.map(p => ({ name: p.name, sell_price: p.sell_price }))),
    [catalog],
  )

  // Планшеты — из живого каталога (лист «Планшеты»). Каталог по умолчанию =
  // встроенный fallback (там тоже есть планшеты), так что список не пустой.
  const tabletList = useMemo(
    () => catalog.filter(p => p.category === 'tablet' && p.sell_price > 0),
    [catalog],
  )
  // Обезличенное имя планшета для КП: «Имя для КП» из таблицы (kp_name) →
  // карта хардкода по имени (для листов без колонки) → generic. Без бренда.
  const tabletKpName = (name: string, kpName?: string | null): string =>
    kpName || tablets.find(t => t.name.toLowerCase() === name.toLowerCase())?.kpName || 'Планшет Android'

  const update = <K extends keyof ParsedRequest>(key: K, value: ParsedRequest[K]) => {
    setForm(prev => {
      const next = { ...prev, [key]: value }

      // Авто-переключения
      if (key === 'company') {
        // Дополнительные лицензии — только ИННО; чистим при любой смене компании.
        next.additional_licenses = []
        if (value === 'bonda') {
          next.products = []
          next.devices = 0
          next.kiosk_type = null
          next.selected_tablet_id = null
          next.license_type = 'findir'
          next.findir_tariff = 'Старт'
          next.need_implementation = false
          next.content_items = 0
        } else {
          next.license_type = null
          next.findir_tariff = null
          next.devices = 1
        }
      }

      if (key === 'license_type') {
        // Смена типа лицензии сбрасывает выбор семейства/комплектации Kiosk PRO.
        next.selected_family = null
        next.complectation = {}
        next.selected_options = []
        if (value === 'findir' || value === 'bonda_bi') {
          next.findir_tariff = value === 'findir' ? 'Старт' : null
        } else {
          next.findir_tariff = null
        }
        // Фискальный пакет (BG-1..5): авто-дефолт по типу лицензии.
        // Kiosk PRO — ВКЛ (у клиента нет своей кассы, нужна фискалка).
        // Планшетный Kiosk — ВЫКЛ (чаще клиент со своей iiko-кассой).
        // Остальные — false (фискалка нерелевантна для QR/Ecomm/БОНДА).
        next.fiscal_pack = value === 'kiosk_pro'
        // QR и Ecomm не требуют устройств
        if (value === 'qr' || value === 'ecomm') {
          next.devices = 0
          next.kiosk_type = null
          next.products = []
          next.selected_tablet_id = null
          next.selected_kiosk_id = null
          next.selected_kiosk_options = []
        }
        // Kiosk — планшетный комплект, дефолт настольный
        if (value === 'kiosk') {
          next.devices = Math.max(1, next.devices)
          next.kiosk_type = 'desk'
          next.selected_kiosk_id = null
          next.selected_kiosk_options = []
        }
        // Kiosk PRO — готовый киоск, дефолт настольный
        if (value === 'kiosk_pro') {
          next.devices = Math.max(1, next.devices)
          next.kiosk_type = 'desk'
          next.selected_kiosk_id = null
          next.selected_kiosk_options = []
        }
      }

      // Сброс опций при смене модели киоска (опции зависят от группы)
      if (key === 'selected_kiosk_id') {
        next.selected_kiosk_options = []
      }

      return next
    })
  }

  const toggleAddon = (key: string) => {
    setForm(prev => {
      const has = prev.additional_licenses.includes(key)
      return {
        ...prev,
        additional_licenses: has
          ? prev.additional_licenses.filter(k => k !== key)
          : [...prev.additional_licenses, key],
      }
    })
  }

  const toggleProduct = (product: string) => {
    setForm(prev => {
      const has = prev.products.includes(product)
      return {
        ...prev,
        products: has
          ? prev.products.filter(p => p !== product)
          : [...prev.products, product],
      }
    })
  }

  const handleGenerate = () => {
    if (!form.client_name.trim()) return

    // Если КП уже было рассчитано — предупреждаем что ручные правки в preview
    // (изменённые цены, скидки, заменённые позиции) пересчитаются заново из
    // формы. Защита H13/C5 из аудита 2026-05-14.
    if (kp !== null) {
      const ok = window.confirm(
        'Пересчитать КП по форме?\n\n' +
        'Все ручные правки в превью (изменённые цены, скидки, замены позиций, ' +
        'удалённые/добавленные строки) будут заменены свежим расчётом.'
      )
      if (!ok) return
    }

    // Enrich form with kiosk data for calculator
    const enrichedForm = { ...form }
    // Живые цены фискалки из текущего каталога — передаём в calculator,
    // чтобы фискальные строки в КП имели актуальную сумму, не хардкод.
    enrichedForm._fiscal_prices = fiscalPrices
    // Kiosk PRO (новая схема): строки комплекта собираются из catalog2 по
    // семейству + комплектации + опциям. buildKioskEquipment сам применяет
    // обязательность, взаимоисключение опций, фискалку по паттерну и
    // обезличивание имён. Хардкода и догадок нет.
    if (form.license_type === 'kiosk_pro' && form.selected_family) {
      enrichedForm._kiosk_equip_lines = buildKioskEquipment(
        catalog2,
        form.selected_family,
        form.complectation || {},
        new Set(form.selected_options || []),
        form.fiscal_pack,
        form.devices,
      )
    }

    // Планшетный Kiosk: планшет из живого каталога (обезличенное имя + цена).
    if (form.license_type === 'kiosk') {
      const t = form.selected_tablet_id
        ? tabletList.find(x => x.id === form.selected_tablet_id) || tabletList[0]
        : tabletList[0]
      if (t) {
        enrichedForm._tablet_kit = { tabletName: tabletKpName(t.name, t.kp_name), tabletPrice: t.sell_price, tabletCost: t.cost_price }
      }

      // Периферия из каталога (лист «Периферия»), × devices. Если каталог без
      // периферии — калькулятор возьмёт хардкод (fallback).
      const periphLines = catalog
        .filter(p => p.category === 'peripheral' && p.sell_price > 0)
        .map(p => ({ name: p.kp_name || p.name, category: 'peripheral', qty: form.devices, unitPrice: p.sell_price, cost: p.cost_price }))
      if (periphLines.length > 0) enrichedForm._periph_lines = periphLines

      // Крепление из каталога «Кронштейны»: выбранный кронштейн (или дефолт —
      // настольный) + рамка-держатель (если не в комплекте) + крепление
      // пинпада. Всё × devices, имена обезличенные. Заменяет хардкод.
      const catMounts = catalog.filter(p => p.category === 'mount' && p.sell_price > 0)
      const mkLine = (m: DBProduct) => ({ name: m.kp_name || m.name, category: 'mount', qty: form.devices, unitPrice: m.sell_price, cost: m.cost_price })
      const selMount = form.selected_mount_id
        ? catMounts.find(m => m.id === form.selected_mount_id)
        : catMounts.find(m => mountRole(m.name, m.mount_type) === 'настольный')
      const lines: NonNullable<ParsedRequest['_mount_lines']> = []
      if (selMount) {
        lines.push(mkLine(selMount))
        if (!mountFrameIncluded(selMount.name, selMount.kp_name, selMount.frame_included)) {
          const ramka = catMounts.find(m => mountRole(m.name, m.mount_type) === 'рамка')
          if (ramka) lines.push(mkLine(ramka))
        }
      }
      const pinpad = catMounts.find(m => mountRole(m.name, m.mount_type) === 'пинпад')
      if (pinpad) lines.push(mkLine(pinpad))
      if (lines.length > 0) enrichedForm._mount_lines = lines
    }

    const result = calculateKP(enrichedForm)
    setKP(result)
    setStep('preview')
  }

  const handleBack = () => {
    setStep('form')
    // Сохраняем данные формы — можно отредактировать и пересоздать
  }

  const handleReset = () => {
    // Защита H14/C4 из аудита: «Новое КП» сбрасывает всю работу — confirm.
    if (kp !== null || form.client_name.trim()) {
      const ok = window.confirm(
        'Создать новое КП?\n\n' +
        'Текущая форма и превью будут очищены.'
      )
      if (!ok) return
    }
    setStep('form')
    setForm({ ...defaultForm })
    setKP(null)
    setDraftAvailable(null)
    try { localStorage.removeItem('kp-draft') } catch { /* noop */ }
  }

  const isInno = form.company === 'inno'

  return (
    <main className="pc-app">
      <div className="pc-shell">
        <div className="pc-bar" />

        {/* Хедер */}
        <header className="pc-head pc-rise">
          <div className="flex items-center gap-3.5">
            <div className="pc-mark">КП</div>
            <div>
              <div className="pc-word">Генератор</div>
              <div className="pc-subw">{isInno ? 'inno clouds' : 'бонда'} · коммерческие предложения</div>
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            {step === 'preview' && (
              <>
                <button className="pc-ghost" onClick={handleBack}>← редактировать</button>
                <button className="pc-ghost" onClick={handleReset}>новое КП</button>
              </>
            )}
            <button
              className="pc-ghost"
              onClick={toggleTheme}
              aria-label="Переключить тему"
            >
              {theme === 'light' ? 'ночь' : 'день'}
            </button>
            <div className="pc-meta hidden sm:block">
              черновик<br />{dateStr}
            </div>
          </div>
        </header>

        {step === 'form' && (
          <>
            {/* Статус каталога: живые данные vs резервный снимок. */}
            {catalogSource !== 'live' && (
              <div className="pc-rise" style={{ padding: '14px 32px 0' }}>
                {catalogSource === 'loading' ? (
                  <div className="pc-hint" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Каталог загружается из Google Sheets…
                  </div>
                ) : (
                  <div className="pc-warn" style={{ margin: 0 }}>
                    ⚠ Работаю на <b>резервных данных</b> — цены могут быть неактуальны. Проверьте связь и нажмите «Обновить каталог из Google Sheets» внизу.
                  </div>
                )}
              </div>
            )}

            {/* Черновик: предложение восстановить последнюю форму. */}
            {draftAvailable && (
              <div className="pc-rise" style={{ padding: '14px 32px 0' }}>
                <div className="pc-hint" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <span>↩ Есть незавершённый черновик{draftAvailable.client_name ? ` — «${draftAvailable.client_name}»` : ''}.</span>
                  <span style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button type="button" className="pc-ghost" onClick={() => { setForm({ ...defaultForm, ...draftAvailable }); setDraftAvailable(null) }}>Восстановить</button>
                    <button type="button" className="pc-ghost" onClick={() => setDraftAvailable(null)}>Скрыть</button>
                  </span>
                </div>
              </div>
            )}

            {/* Компания */}
            <Section title="Компания">
              <div className="grid grid-cols-2 gap-3">
                <RadioCard active={isInno} onClick={() => update('company', 'inno')}
                  title="ИННО" desc="Киоски, терминалы, лицензии" />
                <RadioCard active={!isInno} onClick={() => update('company', 'bonda')}
                  title="БОНДА" desc="ФинДир, аналитика BI" />
              </div>
            </Section>

            {/* Клиент */}
            <Section title="Клиент">
              <div className="grid grid-cols-[1fr_130px] gap-6">
                <div>
                  <label className="pc-flab">Название клиента</label>
                  <input
                    type="text"
                    value={form.client_name}
                    onChange={e => update('client_name', e.target.value)}
                    placeholder="Ресторан / сеть"
                    className="pc-input"
                  />
                </div>
                <div>
                  <label className="pc-flab">Локаций</label>
                  <NumberInput value={form.locations} onChange={v => update('locations', v)} min={1} max={200} />
                </div>
              </div>
            </Section>

            {/* ИННО: Лицензия (определяет тип оборудования) */}
            {isInno && (
              <Section title="Лицензия">
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-3">
                    <RadioCard active={form.license_type === 'qr'} onClick={() => update('license_type', 'qr')}
                      title={INNO_LICENSE_PRICES.qr.name} desc={INNO_LICENSE_PRICES.qr.uiLabel} />
                    <RadioCard active={form.license_type === 'ecomm'} onClick={() => update('license_type', 'ecomm')}
                      title={INNO_LICENSE_PRICES.ecomm.name} desc={INNO_LICENSE_PRICES.ecomm.uiLabel} />
                    <RadioCard active={form.license_type === 'kiosk'} onClick={() => update('license_type', 'kiosk')}
                      title={INNO_LICENSE_PRICES.kiosk.name} desc={INNO_LICENSE_PRICES.kiosk.uiLabel} />
                    <RadioCard active={form.license_type === 'kiosk_pro'} onClick={() => update('license_type', 'kiosk_pro')}
                      title={INNO_LICENSE_PRICES.kiosk_pro.name} desc={INNO_LICENSE_PRICES.kiosk_pro.uiLabel} />
                  </div>

                  {/* Количество устройств — для Kiosk и Kiosk PRO */}
                  {(form.license_type === 'kiosk' || form.license_type === 'kiosk_pro') && (
                    <div>
                      <label className="pc-flab">Количество устройств</label>
                      <NumberInput value={form.devices} onChange={v => update('devices', v)} min={1} max={500} />
                    </div>
                  )}

                  {/* Выбор планшета — для Kiosk */}
                  {form.license_type === 'kiosk' && (
                    <div>
                      <label className="pc-flab">Планшет</label>
                      <select
                        value={form.selected_tablet_id || ''}
                        onChange={e => update('selected_tablet_id', e.target.value || null)}
                        className="pc-input"
                        style={{
                          appearance: 'none', WebkitAppearance: 'none', paddingRight: '24px',
                          backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%239A9389' d='M6 8L1 3h10z'/%3E%3C/svg%3E\")",
                          backgroundRepeat: 'no-repeat', backgroundPosition: 'right 2px center',
                        }}
                      >
                        <option value="">Автоподбор (по умолчанию)</option>
                        {tabletList.map(t => (
                          <option key={t.id} value={t.id}>
                            {t.name} — {t.sell_price.toLocaleString('ru-RU')} ₽
                          </option>
                        ))}
                      </select>
                      <p className="mt-2 text-xs text-[var(--text-3)]">
                        В КП попадёт обезличенное название: «{(() => {
                          const t = tabletList.find(x => x.id === form.selected_tablet_id) || tabletList[0]
                          return t ? tabletKpName(t.name, t.kp_name) : 'Планшет Android'
                        })()}»
                      </p>
                    </div>
                  )}

                  {/* Крепление — для Kiosk: выбор из каталога «Кронштейны»
                      (настенные/настольные/стойки). Рамка и пинпад — авто. */}
                  {form.license_type === 'kiosk' && (() => {
                    const mountsSel = catalog.filter(p =>
                      p.category === 'mount' && p.sell_price > 0 &&
                      SELECTABLE_MOUNT_ROLES.includes(mountRole(p.name, p.mount_type)),
                    )
                    if (mountsSel.length === 0) return null
                    const roleLabel: Record<string, string> = { 'настенный': 'Настенные', 'настольный': 'Настольные', 'стойка': 'Стойки' }
                    return (
                      <div>
                        <label className="pc-flab">Крепление</label>
                        <select
                          value={form.selected_mount_id || ''}
                          onChange={e => update('selected_mount_id', e.target.value || null)}
                          className="pc-input"
                          style={{
                            appearance: 'none', WebkitAppearance: 'none', paddingRight: '24px',
                            backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%239A9389' d='M6 8L1 3h10z'/%3E%3C/svg%3E\")",
                            backgroundRepeat: 'no-repeat', backgroundPosition: 'right 2px center',
                          }}
                        >
                          <option value="">Автоподбор (настольное)</option>
                          {SELECTABLE_MOUNT_ROLES.map(role => {
                            const grp = mountsSel.filter(m => mountRole(m.name, m.mount_type) === role)
                            if (grp.length === 0) return null
                            return (
                              <optgroup key={role} label={roleLabel[role]}>
                                {grp.map(m => {
                                  const model = (m.description || '').match(/\bG\d{2,3}\b/)?.[0]
                                  return (
                                    <option key={m.id} value={m.id}>
                                      {m.name}{model ? ` (${model})` : ''} — {m.sell_price.toLocaleString('ru-RU')} ₽
                                    </option>
                                  )
                                })}
                              </optgroup>
                            )
                          })}
                        </select>
                        <p className="mt-2 text-xs text-[var(--text-3)]">
                          Рамка-держатель и крепление пинпада добавятся в комплект автоматически.
                        </p>
                      </div>
                    )
                  })()}

                  {/* Kiosk PRO — семейство → комплектация → опции (новая схема) */}
                  {form.license_type === 'kiosk_pro' && (
                    <KioskProConfig catalog={catalog2} form={form} setForm={setForm} />
                  )}


                  {/* Kiosk PRO: комплектация, опции по обязательности и фискалка — в KioskProConfig выше */}

                  {/* Подсказки */}
                  {form.license_type === 'kiosk' && (
                    <div className="pc-hint">
                      Комплект: планшет + кронштейн + адаптер + зарядка + кабель + хаб + крепление пинпада. Можно заменить любую позицию в превью.
                    </div>
                  )}
                  {form.license_type === 'kiosk_pro' && (
                    <div className="pc-hint">
                      Готовый киоск — выберите модель и тип крепления из каталога. Периферия не требуется.
                    </div>
                  )}
                  {(form.license_type === 'qr' || form.license_type === 'ecomm') && (
                    <div className="pc-hint">
                      Работает на телефонах клиентов — оборудование не требуется.
                    </div>
                  )}
                </div>
              </Section>
            )}

            {/* Фискальный пакет — только для планшетного Kiosk (внешний ФР рядом).
                Для Kiosk PRO фискалка ведётся внутри KioskProConfig (по паттерну
                семейства). Дефолт ВЫКЛ (чаще у клиента своя iiko-касса). */}
            {isInno && form.license_type === 'kiosk' && (() => {
              const fiscalCfg = TABLET_KIOSK_FISCAL_CONFIG
              if (!fiscalCfg) return null
              const items = getFiscalPackPreview(fiscalCfg, fiscalPrices)
              if (items.length === 0) return null
              const sum = items.reduce((s, i) => s + i.price, 0)
              const label = fiscalCfg.pattern === 'internal'
                ? 'Внутренняя фискализация (Атол 42 ФА внутрь киоска)'
                : 'Внешняя фискализация (POScenter-02Ф рядом с киоском)'
              return (
                <Section title="Фискальный пакет">
                  <label
                    className="pc-opt"
                    data-on={form.fiscal_pack}
                    onClick={() => update('fiscal_pack', !form.fiscal_pack)}
                  >
                    <span className="pc-box">{form.fiscal_pack && <Check />}</span>
                    <span className="flex-1 min-w-0">
                      <span className="text-sm text-[var(--text)]">Фискальный пакет</span>
                      <div className="mt-2 space-y-1 text-xs text-[var(--text-2)]">
                        <div className="font-mono uppercase tracking-wider text-[10px] text-[var(--text-3)]">
                          {label}
                        </div>
                        {items.map((item, idx) => (
                          <div key={idx} className="flex justify-between items-baseline gap-3">
                            <span>{item.name}</span>
                            <span className="font-mono text-[var(--accent)] whitespace-nowrap">
                              {item.price.toLocaleString('ru-RU')} ₽
                            </span>
                          </div>
                        ))}
                        <div className="flex justify-between items-baseline gap-3 pt-2 border-t border-[var(--rule)]">
                          <span>За 1 устройство</span>
                          <span className="font-mono text-[var(--accent)] whitespace-nowrap">
                            {sum.toLocaleString('ru-RU')} ₽
                          </span>
                        </div>
                      </div>
                    </span>
                  </label>
                </Section>
              )
            })()}

            {/* Дополнительные лицензии — только ИННО, поверх любой основной */}
            {isInno && form.license_type && (
              <Section title="Дополнительные лицензии">
                <div className="space-y-1">
                  {Object.entries(INNO_ADDON_LICENSES).map(([key, addon]) => {
                    const isChecked = form.additional_licenses.includes(key)
                    return (
                      <label
                        key={key}
                        className="pc-opt"
                        data-on={isChecked}
                        onClick={() => toggleAddon(key)}
                      >
                        <span className="pc-box">{isChecked && <Check />}</span>
                        <span className="flex-1 flex items-baseline justify-between gap-3">
                          <span className="text-sm text-[var(--text)]">{addon.name}</span>
                          <span className="font-mono text-xs text-[var(--accent)] whitespace-nowrap">
                            {addon.uiLabel}
                          </span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              </Section>
            )}

            {/* Период подписки (для ИННО и БОНДА) */}
            {form.license_type && (
              <Section title="Период подписки">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(Object.entries(periodMultiplier) as [SubscriptionPeriod, typeof periodMultiplier['month']][]).map(([key, val]) => (
                    <button
                      key={key}
                      type="button"
                      className="pc-period"
                      data-on={form.subscription_period === key}
                      onClick={() => update('subscription_period', key)}
                    >
                      {val.label.split(' (')[0]}
                      {val.discount > 0 && (
                        <span className="block text-xs text-[var(--accent)]">-{val.discount}%</span>
                      )}
                    </button>
                  ))}
                </div>
              </Section>
            )}

            {/* Лицензии БОНДА */}
            {!isInno && (
              <Section title="Лицензия / подписка">
                <div className="space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <RadioCard active={form.license_type === 'findir'} onClick={() => update('license_type', 'findir')}
                      title="ФинДир" desc="Финансовый директор" />
                    <RadioCard active={form.license_type === 'bonda_bi'} onClick={() => update('license_type', 'bonda_bi')}
                      title="BONDA BI" desc="Бизнес-аналитика" />
                  </div>

                  {/* ФинДир тариф */}
                  {form.license_type === 'findir' && (
                    <div>
                      <label className="pc-flab">Тариф ФинДир</label>
                      <div className="grid grid-cols-3 gap-2">
                        {findirTariffs.map(t => (
                          <button
                            key={t.name}
                            type="button"
                            className="pc-period"
                            data-on={form.findir_tariff === t.name}
                            onClick={() => update('findir_tariff', t.name)}
                          >
                            {t.name}
                          </button>
                        ))}
                      </div>
                      <div className="mt-3 space-y-1 text-xs text-[var(--text-2)]">
                        {findirTariffs.find(t => t.name === form.findir_tariff)?.features.map((f, i) => (
                          <div key={i} className="flex gap-2">
                            <span className="text-[var(--accent)]">—</span>{f}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </Section>
            )}

            {/* Услуги (только для ИННО) */}
            {isInno && (
              <Section title="Услуги">
                <div className="space-y-4">
                  <label
                    className="pc-opt"
                    data-on={form.need_implementation}
                    onClick={() => update('need_implementation', !form.need_implementation)}
                  >
                    <span className="pc-box">{form.need_implementation && <Check />}</span>
                    <span className="flex-1 flex items-baseline justify-between gap-3">
                      <span className="text-sm text-[var(--text)]">Внедрение и настройка</span>
                      <span className="font-mono text-xs text-[var(--text-2)] whitespace-nowrap">20 000 ₽ / локация</span>
                    </span>
                  </label>

                  <div>
                    <label className="pc-flab">Контент — позиции меню</label>
                    <NumberInput value={form.content_items} onChange={v => update('content_items', v)} min={0} max={1000} />
                    {form.content_items > 0 && (
                      <p className="mt-2 font-mono text-xs text-[var(--text-2)]">1 200 ₽ / позиция</p>
                    )}
                  </div>
                </div>
              </Section>
            )}

            {/* Оплата */}
            <Section title="Условия оплаты">
              <div className="grid grid-cols-2 gap-3">
                <RadioCard active={form.payment_type === 'prepay100'} onClick={() => update('payment_type', 'prepay100')}
                  title="100% предоплата" desc="" />
                <RadioCard active={form.payment_type === 'installment3'} onClick={() => update('payment_type', 'installment3')}
                  title="Рассрочка" desc="60 / 20 / 20" />
              </div>
            </Section>

            {/* Заметки */}
            <Section title="Дополнительно">
              <textarea
                value={form.notes}
                onChange={e => update('notes', e.target.value)}
                placeholder="Особые пожелания, комментарии…"
                rows={2}
                className="pc-input"
              />
            </Section>

            {/* Подвал — синхронизация + кнопка */}
            <div className="pc-rise" style={{ borderTop: '1px solid var(--rule)', padding: '28px 32px' }}>
              <div className="mb-5">
                <GoogleSyncButton onSync={(data, c2) => { if (data.length) setCatalog(data); if (c2) setCatalog2(c2); if (data.length || c2) setCatalogSource('live') }} />
              </div>
              <div className="flex items-center gap-5">
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={!form.client_name.trim() || (form.license_type === 'kiosk_pro' && !form.selected_family)}
                  className="pc-cta"
                >
                  <span className="pc-cta-txt">Рассчитать КП</span>
                  <span className="pc-cta-arr">&rarr;</span>
                </button>
                <span className="pc-step">шаг 1 / 2<br />параметры</span>
              </div>
            </div>
          </>
        )}

        {step === 'preview' && kp && (
          <KPPreview kp={kp} parsed={form} catalog={catalog} />
        )}
      </div>
    </main>
  )
}

// ========== Компоненты формы ==========

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="pc-sec pc-rise">
      <div className="pc-num" aria-hidden="true" />
      <div className="pc-secbody">
        <div className="pc-kick">{title}</div>
        {children}
      </div>
    </section>
  )
}

function Check() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  )
}

function RadioCard({ active, onClick, title, desc }: {
  active: boolean; color?: 'orange' | 'purple'; onClick: () => void; title: string; desc: string; small?: boolean
}) {
  return (
    <button type="button" onClick={onClick} className="pc-block" data-on={active}>
      <div className="flex items-center justify-between gap-2">
        <span className="pc-bname">{title}</span>
        {active && <span className="pc-sq" />}
      </div>
      {desc && <div className="pc-bdesc">{desc}</div>}
    </button>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let xlsxCache: any = null
async function loadXLSX() {
  if (xlsxCache) return xlsxCache
  // Загружаем SheetJS с CDN
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'
    script.onload = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      xlsxCache = (window as any).XLSX
      resolve(xlsxCache)
    }
    script.onerror = () => reject(new Error('Не удалось загрузить библиотеку xlsx'))
    document.head.appendChild(script)
  })
}

// URL Google Sheet для автосинка (CSV export)
const GOOGLE_SHEET_ID = '1GGIOWoQmk7yLZjWSeY0wpFiKgrrYZ62TV2numdL7qXc'
// Загружаем все листы из Google Sheet
// Сначала получаем HTML чтобы узнать gid и названия листов,
// потом скачиваем каждый лист как CSV
async function fetchGoogleSheetProducts(): Promise<{ products: DBProduct[]; catalog2: Catalog | null }> {
  const products: DBProduct[] = []
  const nomRows: Record<string, unknown>[] = []   // вкладка «Номенклатура (киоски)»
  const famRows: Record<string, unknown>[] = []   // вкладка «Правила семейств»
  let idx = 0

  // Принимаем и русские, и английские имена вкладок (менеджер мог импортнуть
  // CSV как есть → лист называется «nomenclature_kiosks» / «families»).
  const isNomSheet = (n: string) => n.includes('номенклатура') || n.includes('nomenclature')
  const isFamSheet = (n: string) => n.includes('правил') || n.includes('семейств') || n.includes('families') || n.includes('family')

  // Способ 1: пробуем загрузить как XLSX (содержит все листы сразу)
  try {
    const xlsxUrl = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/export?format=xlsx`
    const resp = await fetch(xlsxUrl, { signal: AbortSignal.timeout(15000) })
    if (resp.ok) {
      const XLSX = await loadXLSX()
      const buf = await resp.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName]
        const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: '' })
        const sheetLower = sheetName.trim().toLowerCase()
        // Новая схема: вкладки собираются отдельно, в catalog2.
        if (isNomSheet(sheetLower)) { nomRows.push(...rows); continue }
        if (isFamSheet(sheetLower)) { famRows.push(...rows); continue }
        for (const row of rows) {
          const p = parseRowToProduct(row, idx, sheetLower)
          if (p) { products.push(p); idx++ }
        }
      }
      const catalog2 = nomRows.length > 0 ? buildCatalog(nomRows, famRows) : null
      if (products.length > 0 || catalog2) return { products, catalog2 }
    }
  } catch {
    // Fallback на CSV
  }

  // Способ 2: CSV — пробуем gid 0..9
  const sheetNames = ['планшеты', 'кронштейны', 'периферия', '', '', '', '', '', '', '']
  for (let gid = 0; gid < 10; gid++) {
    try {
      const url = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/export?format=csv&gid=${gid}`
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000) })
      if (!resp.ok) break  // gid не существует — дальше не пробуем
      const csvText = await resp.text()
      if (!csvText.trim() || csvText.includes('<!DOCTYPE')) break
      const rows = parseCSV(csvText)
      for (const row of rows) {
        const p = parseRowToProduct(row, idx, sheetNames[gid])
        if (p) { products.push(p); idx++ }
      }
    } catch {
      break
    }
  }

  return { products, catalog2: null }
}

function parseRowToProduct(row: Record<string, unknown>, index: number, sheetCategory?: string): DBProduct | null {
  const name = String(row['Наименование'] || row['Название'] || row['name'] || row['Name'] || '').trim()
  if (!name) return null

  // Категория: из колонки, или из имени листа, или дефолт
  let rawCategory = String(row['Категория'] || row['category'] || row['Category'] || sheetCategory || 'equipment').trim().toLowerCase()
  const company = String(row['Компания'] || row['company'] || row['Company'] || 'inno').trim().toLowerCase()

  // Внутри листа «Киоски» — крепления, принтеры, сканеры, ККТ получают свою категорию.
  //
  // Фикс 2026-05-14: касса/киоск самообслуживания — это ПОЛНОЦЕННЫЕ модели
  // киосков, даже если в их названии упоминается «со сканером» / «без сканера».
  // Раньше подстрочный поиск «сканер» переводил «Касса МС Mini 15 N со сканером»
  // в категорию опций, и она появлялась в «Дополнительно» вместо выбора моделей.
  if (rawCategory === 'киоски' || rawCategory === 'киоск') {
    const nameLower = name.toLowerCase()
    const isKioskModel = nameLower.startsWith('киоск') || nameLower.startsWith('касса')

    if (!isKioskModel) {
      if (nameLower.includes('крепление')) rawCategory = '_kiosk_mount'
      else if (nameLower.includes('принтер')) rawCategory = '_kiosk_option'
      else if (nameLower.includes('сканер')) rawCategory = '_kiosk_option'
      else if (nameLower.includes('ккт') || nameLower.includes('фискальн')) rawCategory = '_kiosk_option'
    }
  }

  // Цены из Google Sheets — целые рубли в русской локали. Запятая, пробел и
  // валютные символы — это разделители тысяч. Точку оставляем как опциональный
  // decimal separator (на случай копеек).
  //
  // Phase 8 (H3): раньше код делал `.replace(',', '.')` — превращал «1,200»
  // (=1200) в «1.200» → Number = 1.2. Если кто-то когда-то ввёл цену с
  // запятой как separator тысяч, товар парсился почти бесплатно.
  const parsePrice = (val: unknown): number => {
    if (typeof val === 'number') return val
    const cleaned = String(val).replace(/[р₽\s,]/gi, '')
    const num = Number(cleaned)
    return isNaN(num) ? 0 : num
  }

  const costPrice = parsePrice(row['Закупочная'] || row['Себестоимость'] || row['cost_price'] || row['Cost'] || 0)
  const sellPrice = parsePrice(row['Продажная'] || row['Цена'] || row['sell_price'] || row['Price'] || 0)

  // Маржа/рентабельность: из колонки или вычисляем
  const rawMargin = String(row['Маржа'] || row['Рентабельность'] || row['margin'] || row['Margin'] || '').replace('%', '')
  const margin = rawMargin
    ? Number(rawMargin)
    : (sellPrice > 0 && costPrice > 0 ? Math.round((1 - costPrice / sellPrice) * 100) : 0)

  return {
    id: String(row['ID'] || row['id'] || row['Артикул'] || `imported-${index}`),
    name,
    article: String(row['Артикул'] || row['article'] || '') || null,
    category: mapCategory(rawCategory),
    company: company as 'inno' | 'bonda',
    description: String(row['Описание'] || row['description'] || '') || null,
    specs: String(row['Характеристики'] || row['specs'] || '') || null,
    cost_price: costPrice,
    sell_price: sellPrice,
    margin,
    supplier: String(row['Поставщик'] || row['supplier'] || '') || null,
    supplier_article: String(row['Артикул поставщика'] || row['supplier_article'] || '') || null,
    unit: String(row['Единица'] || row['unit'] || 'шт'),
    warranty: String(row['Гарантия'] || row['warranty'] || '') || null,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    group: String(row['Группа'] || row['group'] || '').trim() || null,
    image_url: String(row['Фото'] || row['photo'] || row['image'] || '').trim() || null,
    // Phase 9 (H7): обезличенное имя для КП. Если в листе есть колонка
    // «Имя для КП» / «kp_name» — берём оттуда. Иначе null → используется name.
    kp_name: String(row['Имя для КП'] || row['kp_name'] || row['KP Name'] || '').trim() || null,
    // Кронштейны: «Тип» (настенный/настольный/стойка/рамка/пинпад) + «Рамка»
    // = «в комплекте» (держатель уже в стойке). Для других листов пусто.
    mount_type: String(row['Тип'] || row['mount_type'] || '').trim() || null,
    frame_included: /в\s*комплект|включ/i.test(String(row['Рамка'] || row['frame'] || '')),
  }
}

function parseCSV(csvText: string): Record<string, unknown>[] {
  const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return []

  // Парсим заголовки (с учётом кавычек)
  const parseCSVLine = (line: string): string[] => {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = !inQuotes }
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
    result.push(current.trim())
    return result
  }

  const headers = parseCSVLine(lines[0])
  const rows: Record<string, unknown>[] = []
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i])
    const row: Record<string, unknown> = {}
    headers.forEach((h, j) => { row[h] = values[j] || '' })
    rows.push(row)
  }
  return rows
}

// ========== Kiosk PRO: семейство → комплектация → опции (новая схема) ==========

// Фото семейства из каталога (колонка «Фото»); при отсутствии/битой ссылке —
// иконка-заглушка. Фото такое же, как в старой форме (yandexcloud).
function FamilyThumb({ photo, alt }: { photo: string | null; alt: string }) {
  const [err, setErr] = useState(false)
  if (photo && !err) {
    return (
      <img src={photo} alt={alt} loading="lazy"
        className="w-full h-full object-contain p-2"
        onError={() => setErr(true)} />
    )
  }
  return (
    <svg className="w-10 h-10 text-[var(--text-3)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  )
}

function KioskProConfig({
  catalog, form, setForm,
}: {
  catalog: Catalog
  form: ParsedRequest
  setForm: Dispatch<SetStateAction<ParsedRequest>>
}) {
  const cards = familyCards(catalog)
  const familyKey = form.selected_family || null
  const rule = familyKey ? catalog.familyByKey.get(familyKey) : undefined
  const models = familyKey ? familyModels(catalog, familyKey) : []
  const axes = familyAxes(models)
  const opts = familyKey
    ? familyOptions(catalog, familyKey)
    : { included: [], mandatory: [], optional: [] }
  const sel: Selection = form.complectation || {}
  const selectedIds = new Set(form.selected_options || [])

  const money = (n: number) => n.toLocaleString('ru-RU')

  const selectFamily = (key: string) => {
    setForm(prev => {
      const ms = familyModels(catalog, key)
      const r = catalog.familyByKey.get(key)
      return {
        ...prev,
        selected_family: key,
        complectation: defaultSelection(ms, r),
        selected_options: [],
        fiscal_pack: (r?.fiscalPattern ?? 'нет') !== 'нет',  // фискалка нужна — вкл по умолчанию
      }
    })
  }
  const setAxis = (axis: keyof Selection, val: string) =>
    setForm(prev => ({ ...prev, complectation: { ...(prev.complectation || {}), [axis]: val } }))

  // Взаимоисключающие опции (radio-группа) + одиночные чекбоксы.
  const groupItems = [...opts.mandatory, ...opts.optional]
  const exclusiveKeys = Array.from(new Set(groupItems.filter(o => o.exclusiveGroup).map(o => o.exclusiveGroup!)))
  const singlesOptional = opts.optional.filter(o => !o.exclusiveGroup)
  const singlesMandatory = opts.mandatory.filter(o => !o.exclusiveGroup)

  const activeInGroup = (gk: string): CatalogItem => {
    const members = groupItems.filter(o => o.exclusiveGroup === gk)
    return members.find(o => selectedIds.has(o.id))
      ?? members.find(o => o.obligation === 'обязательная')
      ?? members[0]
  }
  const pickInGroup = (gk: string, id: string) =>
    setForm(prev => {
      const memberIds = groupItems.filter(o => o.exclusiveGroup === gk).map(o => o.id)
      const without = (prev.selected_options || []).filter(x => !memberIds.includes(x))
      return { ...prev, selected_options: [...without, id] }
    })
  const toggleSingle = (id: string) =>
    setForm(prev => {
      const cur = prev.selected_options || []
      return { ...prev, selected_options: cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] }
    })

  // Живой итог за устройство.
  const model = resolveModel(models, sel)
  const chosen = resolveChosenOptions(opts, selectedIds)
  const fiscal = form.fiscal_pack ? fiscalLines(rule, catalog) : []
  const unitTotal = (model?.sellPrice ?? 0)
    + chosen.reduce((s, o) => s + o.sellPrice, 0)
    + fiscal.reduce((s, f) => s + f.price, 0)

  const AxisSeg = ({ axis, values }: { axis: keyof Selection; values: string[] }) =>
    values.length > 1 ? (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {values.map(v => (
          <button key={v} type="button" className="pc-period" data-on={sel[axis] === v}
            onClick={() => setAxis(axis, v)}>{v}</button>
        ))}
      </div>
    ) : null

  return (
    <div className="space-y-5">
      {/* Карточки семейств */}
      <div>
        <label className="pc-flab">Модель киоска</label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {cards.map(c => (
            <button key={c.rule.family} type="button" className="pc-kiosk" data-on={familyKey === c.rule.family}
              onClick={() => selectFamily(c.rule.family)}>
              <div className="aspect-square flex items-center justify-center" style={{ background: 'var(--surface-2)' }}>
                <FamilyThumb photo={c.photo} alt={c.rule.familyRaw} />
              </div>
              <div className="px-3 py-2.5 border-t" style={{ borderColor: 'var(--rule)' }}>
                <div className="text-[12.5px] leading-tight font-text text-[var(--text)]">{c.rule.familyRaw}</div>
                <div className="mt-0.5 text-[10.5px] text-[var(--text-3)]">{c.rule.diagonal} · {c.rule.formFactor}</div>
                <div className="mt-1.5 font-mono text-xs text-[var(--accent)]">от {money(c.fromPrice)} ₽</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {familyKey && (
        <>
          {/* Комплектация */}
          {(axes.processor.length > 1 || axes.scanner.length > 1 || axes.variant.length > 1) && (
            <div className="space-y-3">
              {axes.processor.length > 1 && (<div><label className="pc-flab">Процессор</label><AxisSeg axis="processor" values={axes.processor} /></div>)}
              {axes.scanner.length > 1 && (<div><label className="pc-flab">Сканер</label><AxisSeg axis="scanner" values={axes.scanner} /></div>)}
              {axes.variant.length > 1 && (<div><label className="pc-flab">Исполнение</label><AxisSeg axis="variant" values={axes.variant} /></div>)}
            </div>
          )}

          {/* Опции по обязательности */}
          {(opts.included.length > 0 || singlesMandatory.length > 0 || exclusiveKeys.length > 0 || singlesOptional.length > 0) && (
            <div className="space-y-3">
              {/* В комплекте */}
              {opts.included.map(o => (
                <div key={o.id} className="pc-opt" data-on style={{ opacity: 0.75, cursor: 'default' }}>
                  <span className="pc-box" style={{ background: 'var(--accent)' }}><Check /></span>
                  <span className="flex-1 flex items-baseline justify-between gap-3">
                    <span className="text-sm text-[var(--text)]">{o.name}</span>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-3)]">в комплекте</span>
                  </span>
                </div>
              ))}
              {/* Обязательные одиночные */}
              {singlesMandatory.map(o => (
                <div key={o.id} className="pc-opt" data-on style={{ cursor: 'default' }}>
                  <span className="pc-box" style={{ background: 'var(--accent)' }}><Check /></span>
                  <span className="flex-1 flex items-baseline justify-between gap-3">
                    <span className="text-sm text-[var(--text)]">{o.name} <span className="text-[10px] uppercase tracking-wider text-[var(--accent)]">обязательно</span></span>
                    {o.sellPrice > 0 && <span className="font-mono text-xs text-[var(--accent)] whitespace-nowrap">{money(o.sellPrice)} ₽</span>}
                  </span>
                </div>
              ))}
              {/* Взаимоисключающие группы (radio) */}
              {exclusiveKeys.map(gk => {
                const members = groupItems.filter(o => o.exclusiveGroup === gk)
                const active = activeInGroup(gk)
                return (
                  <div key={gk}>
                    <label className="pc-flab" style={{ textTransform: 'capitalize' }}>{gk}</label>
                    <div className="grid grid-cols-2 gap-2">
                      {members.map(m => (
                        <button key={m.id} type="button" className="pc-period" data-on={active?.id === m.id}
                          onClick={() => pickInGroup(gk, m.id)}>
                          <span>{m.name.replace(/чеков /i, '')}</span>
                          <span className="block font-mono text-[11px] text-[var(--text-3)]">{money(m.sellPrice)} ₽</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
              {/* Дополнительные (чекбоксы) */}
              {singlesOptional.length > 0 && (
                <div>
                  <label className="pc-flab">Дополнительно</label>
                  <div className="divide-y" style={{ borderColor: 'var(--rule)' }}>
                    {singlesOptional.map(o => {
                      const on = selectedIds.has(o.id)
                      return (
                        <label key={o.id} className="pc-opt" data-on={on} onClick={() => toggleSingle(o.id)}>
                          <span className="pc-box">{on && <Check />}</span>
                          <span className="flex-1 min-w-0 flex items-baseline justify-between gap-3">
                            <span className="text-sm text-[var(--text)]">{o.name}</span>
                            {o.sellPrice > 0 && <span className="font-mono text-xs text-[var(--accent)] whitespace-nowrap">{money(o.sellPrice)} ₽</span>}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Фискальный пакет (по паттерну семейства) */}
          {rule && rule.fiscalPattern !== 'нет' && fiscal.length >= 0 && (() => {
            const flines = fiscalLines(rule, catalog)
            if (flines.length === 0) return null
            const fsum = flines.reduce((s, f) => s + f.price, 0)
            return (
              <div>
                <label className="pc-flab">Фискализация</label>
                <label className="pc-opt" data-on={form.fiscal_pack}
                  onClick={() => setForm(prev => ({ ...prev, fiscal_pack: !prev.fiscal_pack }))}>
                  <span className="pc-box">{form.fiscal_pack && <Check />}</span>
                  <span className="flex-1 min-w-0">
                    <span className="text-sm text-[var(--text)]">Фискальный пакет</span>
                    <div className="mt-2 space-y-1 text-xs text-[var(--text-2)]">
                      <div className="font-mono uppercase tracking-wider text-[10px] text-[var(--text-3)]">
                        {rule.fiscalPattern === 'внутренний' ? 'внутренняя (внутрь киоска)'
                          : rule.fiscalPattern === 'встроенный' ? 'встроенная (в составе киоска)'
                          : 'внешняя (рядом с киоском)'}
                      </div>
                      {flines.map((f, i) => (
                        <div key={i} className="flex justify-between items-baseline gap-3">
                          <span>{f.name}</span>
                          <span className="font-mono text-[var(--accent)] whitespace-nowrap">{money(f.price)} ₽</span>
                        </div>
                      ))}
                      <div className="flex justify-between items-baseline gap-3 pt-2 border-t border-[var(--rule)]">
                        <span>За 1 устройство</span>
                        <span className="font-mono text-[var(--accent)] whitespace-nowrap">{money(fsum)} ₽</span>
                      </div>
                    </div>
                  </span>
                </label>
              </div>
            )
          })()}

          {/* Живой итог за устройство */}
          <div className="flex items-baseline justify-between pt-3" style={{ borderTop: '1px solid var(--rule)' }}>
            <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-3)]">Итого за устройство</span>
            <span className="font-mono text-lg font-semibold text-[var(--text)]">{money(unitTotal)} ₽</span>
          </div>
        </>
      )}
    </div>
  )
}

function GoogleSyncButton({ onSync }: { onSync: (data: DBProduct[], catalog2: Catalog | null) => void }) {
  const [status, setStatus] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle')
  const [count, setCount] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')

  const handleSync = async () => {
    setStatus('syncing')
    setErrorMsg('')
    try {
      const { products, catalog2 } = await fetchGoogleSheetProducts()
      if (products.length === 0 && !catalog2) {
        setStatus('error')
        setErrorMsg('Таблица пуста или нет доступа по ссылке')
        return
      }
      setCount(products.length)
      setStatus('done')
      onSync(products, catalog2)
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : 'Ошибка синхронизации')
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleSync}
        disabled={status === 'syncing'}
        className="pc-ghost w-full"
        style={{ textTransform: 'none' }}
      >
        <span className="inline-flex items-center justify-center gap-2">
          <svg className={`w-3.5 h-3.5 ${status === 'syncing' ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {status === 'syncing' ? 'Синхронизация…' : 'Обновить каталог из Google Sheets'}
        </span>
      </button>
      {status === 'done' && <p className="mt-2 font-mono text-xs text-[var(--text-2)]">Загружено {count} позиций</p>}
      {status === 'error' && <p className="mt-2 font-mono text-xs text-[var(--danger)]">{errorMsg}</p>}
    </div>
  )
}

function mapCategory(cat: string): string {
  const map: Record<string, string> = {
    'планшет': 'tablet', 'tablet': 'tablet', 'планшеты': 'tablet',
    'крепление': 'mount', 'кронштейн': 'mount', 'кронштейны': 'mount', 'mount': 'mount',
    '_kiosk_mount': 'kiosk_mount', // крепления из листа «Киоски»
    '_kiosk_option': 'kiosk_option', // принтеры/сканеры/ККТ из листа «Киоски»
    'периферия': 'peripheral', 'peripheral': 'peripheral',
    'киоски': 'kiosk', 'киоск': 'kiosk',
    'pos': 'pos_terminal', 'pos_terminal': 'pos_terminal', 'терминал': 'pos_terminal', 'моноблок': 'pos_terminal',
    'оборудование': 'equipment', 'equipment': 'equipment',
  }
  return map[cat] || cat
}

function NumberInput({ value, onChange, min, max }: {
  value: number; onChange: (v: number) => void; min: number; max: number
}) {
  const [draft, setDraft] = useState(String(value))
  const [focused, setFocused] = useState(false)

  // Sync draft with external value when not focused
  if (!focused && draft !== String(value)) {
    setDraft(String(value))
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      value={focused ? draft : String(value)}
      onFocus={e => {
        setFocused(true)
        setDraft(String(value))
        e.target.select()
      }}
      onChange={e => {
        const raw = e.target.value.replace(/[^0-9]/g, '')
        setDraft(raw)
      }}
      onBlur={() => {
        setFocused(false)
        const v = parseInt(draft) || min
        onChange(Math.min(max, Math.max(min, v)))
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          (e.target as HTMLInputElement).blur()
        }
      }}
      className="pc-input pc-num-field"
      style={{ textAlign: 'center', maxWidth: '150px' }}
    />
  )
}
