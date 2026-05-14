'use client'

import { useState, useEffect } from 'react'
import { KPPreview } from '@/components/KPPreview'
import { calculateKP, type KPResult } from '@/lib/calculator'
import type { ParsedRequest } from '@/lib/prompt'
import {
  findirTariffs,
  periodMultiplier,
  allProducts,
  tablets,
  type SubscriptionPeriod,
} from '@/lib/catalog'
import { fetchAllCatalog, type DBProduct } from '@/lib/supabase'

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
}))

export default function Home() {
  const [step, setStep] = useState<Step>('form')
  const [form, setForm] = useState<ParsedRequest>({ ...defaultForm })
  const [kp, setKP] = useState<KPResult | null>(null)
  const [catalog, setCatalog] = useState<DBProduct[]>(fallbackCatalog)

  // Загружаем каталог: сначала Google Sheets (все листы), потом Supabase как fallback
  useEffect(() => {
    fetchGoogleSheetProducts()
      .then(products => {
        if (products.length > 0) {
          setCatalog(products)
          return
        }
        throw new Error('Google Sheets пуст')
      })
      .catch(() => {
        // Fallback на Supabase
        fetchAllCatalog().then(data => {
          if (data.length > 0) {
            setCatalog(data)
          }
          // иначе остаётся встроенный fallbackCatalog
        })
      })
  }, [])

  const update = <K extends keyof ParsedRequest>(key: K, value: ParsedRequest[K]) => {
    setForm(prev => {
      const next = { ...prev, [key]: value }

      // Авто-переключения
      if (key === 'company') {
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
        if (value === 'findir' || value === 'bonda_bi') {
          next.findir_tariff = value === 'findir' ? 'Старт' : null
        } else {
          next.findir_tariff = null
        }
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
    if (form.license_type === 'kiosk_pro' && form.selected_kiosk_id) {
      const kiosk = catalog.find(p => p.id === form.selected_kiosk_id)
      if (kiosk) {
        enrichedForm._kiosk_name = kiosk.name
        enrichedForm._kiosk_price = kiosk.sell_price

        // Find mount if non-default
        const kioskGroup = kiosk.group
        if (kioskGroup && form.kiosk_type) {
          const mountItems = catalog.filter(p =>
            p.category === 'kiosk_mount' &&
            p.group === kioskGroup
          )

          // Map mount type to find matching mount
          const mountTypeMap: Record<string, string> = {
            'desk': 'настольн',
            'wall': 'настенн',
            'floor': 'напольн',
          }
          const searchTerm = mountTypeMap[form.kiosk_type]

          if (searchTerm) {
            const selectedMount = mountItems.find(m =>
              m.name.toLowerCase().includes(searchTerm.toLowerCase())
            )

            if (selectedMount && isNonDefaultMount(kiosk, form.kiosk_type)) {
              enrichedForm._kiosk_mount_name = selectedMount.name
              enrichedForm._kiosk_mount_price = selectedMount.sell_price
            }
          }
        }
      }

      // Add selected kiosk options (ККТ, ФН, принтеры, сканеры и т.д.)
      if (form.selected_kiosk_options.length > 0) {
        enrichedForm._kiosk_options_data = form.selected_kiosk_options
          .map(optId => {
            const opt = catalog.find(p => p.id === optId)
            return opt ? { name: opt.name, price: opt.sell_price } : null
          })
          .filter((o): o is { name: string; price: number } => o !== null)
      }
    }

    const result = calculateKP(enrichedForm)
    setKP(result)
    setStep('preview')
  }

  // Helper to check if mount is non-default for a kiosk group
  const isNonDefaultMount = (kioskItem: DBProduct, mountType: string): boolean => {
    const group = kioskItem.group || ''
    const name = kioskItem.name.toLowerCase()
    const g = group.toLowerCase()

    // Напольные киоски: «Киоск самообслуживания» (МС 24, МС 32)
    if (name.includes('киоск самообслуживания') || g.includes('мс 24') || g.includes('мс 32') || g.includes('mc 24') || g.includes('mc 32')) {
      return mountType !== 'floor'
    }
    // Настенные: L-240, L-320, Slim
    if (g.includes('l-240') || g.includes('l-320') || g.includes('slim') || name.includes('настенн')) {
      return mountType !== 'wall'
    }
    // Настольные: Sam4s Astra, Mini и т.д.
    return mountType !== 'desk'
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
  }

  const isInno = form.company === 'inno'

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#0f0f1a] to-[#1a1a2e]">
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm ${
              isInno ? 'bg-gradient-to-br from-orange-500 to-orange-600' : 'bg-gradient-to-br from-purple-500 to-purple-600'
            }`}>
              КП
            </div>
            <h1 className="text-lg font-semibold text-white">Генератор КП</h1>
            <span className="text-xs text-white/40 ml-2">{isInno ? 'INNO Clouds' : 'БОНДА'}</span>
          </div>
          {step === 'preview' && (
            <div className="flex items-center gap-4">
              <button onClick={handleBack} className="text-sm text-white/50 hover:text-white transition">
                ← Редактировать
              </button>
              <button onClick={handleReset} className="text-sm text-white/30 hover:text-white/60 transition">
                Новое КП
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-8">
        {step === 'form' && (
          <div className="space-y-6">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-white mb-2">Создать коммерческое предложение</h2>
              <p className="text-white/50">Заполните параметры — система рассчитает стоимость</p>
            </div>

            {/* Компания */}
            <Section title="Компания">
              <div className="grid grid-cols-2 gap-3">
                <RadioCard
                  active={isInno}
                  color="orange"
                  onClick={() => update('company', 'inno')}
                  title="ИННО"
                  desc="Киоски, терминалы, лицензии"
                />
                <RadioCard
                  active={!isInno}
                  color="purple"
                  onClick={() => update('company', 'bonda')}
                  title="БОНДА"
                  desc="ФинДир, аналитика BI"
                />
              </div>
            </Section>

            {/* Клиент */}
            <Section title="Клиент">
              <input
                type="text"
                value={form.client_name}
                onChange={e => update('client_name', e.target.value)}
                placeholder='Название ресторана / сети'
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/25"
              />
              <div className="mt-3">
                <label className="text-sm text-white/40 block mb-1.5">Количество локаций</label>
                <NumberInput value={form.locations} onChange={v => update('locations', v)} min={1} max={200} />
              </div>
            </Section>

            {/* ИННО: Лицензия (определяет тип оборудования) */}
            {isInno && (
              <Section title="Лицензия">
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <RadioCard
                      active={form.license_type === 'qr'}
                      color="orange"
                      onClick={() => update('license_type', 'qr')}
                      title="inno QR"
                      desc="8 000 ₽/мес · Без оборудования"
                      small
                    />
                    <RadioCard
                      active={form.license_type === 'ecomm'}
                      color="orange"
                      onClick={() => update('license_type', 'ecomm')}
                      title="inno Ecomm"
                      desc="15 000 ₽/мес · Без оборудования"
                      small
                    />
                    <RadioCard
                      active={form.license_type === 'kiosk'}
                      color="orange"
                      onClick={() => update('license_type', 'kiosk')}
                      title="inno Kiosk"
                      desc="10 000 ₽/мес · Планшет + периферия"
                      small
                    />
                    <RadioCard
                      active={form.license_type === 'kiosk_pro'}
                      color="orange"
                      onClick={() => update('license_type', 'kiosk_pro')}
                      title="inno Kiosk PRO"
                      desc="16 200 ₽/мес · Готовый киоск"
                      small
                    />
                  </div>

                  {/* Количество устройств — для Kiosk и Kiosk PRO */}
                  {(form.license_type === 'kiosk' || form.license_type === 'kiosk_pro') && (
                    <div>
                      <label className="text-sm text-white/40 block mb-1.5">Количество устройств</label>
                      <NumberInput value={form.devices} onChange={v => update('devices', v)} min={1} max={500} />
                    </div>
                  )}

                  {/* Выбор планшета — для Kiosk */}
                  {form.license_type === 'kiosk' && (
                    <div>
                      <label className="text-sm text-white/40 block mb-1.5">Планшет</label>
                      <select
                        value={form.selected_tablet_id || ''}
                        onChange={e => update('selected_tablet_id', e.target.value || null)}
                        className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-white focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/25 appearance-none"
                        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23ffffff40' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 16px center' }}
                      >
                        <option value="" className="bg-[#1a1a2e]">Автоподбор (по умолчанию)</option>
                        {tablets.map(t => (
                          <option key={t.id} value={t.id} className="bg-[#1a1a2e]">
                            {t.name} — {t.sellPrice.toLocaleString('ru-RU')} ₽ ({t.specs})
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-white/30 mt-1">
                        В КП попадёт обезличенное название: &laquo;{
                          (tablets.find(t => t.id === form.selected_tablet_id) || tablets[0])?.kpName || 'Планшет Android'
                        }&raquo;
                      </p>
                    </div>
                  )}

                  {/* Тип крепления — для Kiosk (настольный/настенный) */}
                  {form.license_type === 'kiosk' && (
                    <div>
                      <label className="text-sm text-white/40 block mb-1.5">Тип крепления</label>
                      <div className="grid grid-cols-2 gap-2">
                        <RadioCard
                          active={form.kiosk_type === 'desk'}
                          color="orange"
                          onClick={() => update('kiosk_type', 'desk')}
                          title="Настольный"
                          desc="Кронштейн на стол"
                          small
                        />
                        <RadioCard
                          active={form.kiosk_type === 'wall'}
                          color="orange"
                          onClick={() => update('kiosk_type', 'wall')}
                          title="Настенный"
                          desc="Крепление на стену"
                          small
                        />
                      </div>
                    </div>
                  )}

                  {/* Выбор киоска — для Kiosk PRO (карточки) */}
                  {form.license_type === 'kiosk_pro' && (
                    <div>
                      <label className="text-sm text-white/40 block mb-2">Модель киоска</label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {catalog
                          .filter(p =>
                            p.category === 'kiosk' &&
                            !p.name.toLowerCase().includes('крепление') &&
                            !p.name.toLowerCase().includes('принтер') &&
                            !p.name.toLowerCase().includes('сканер') &&
                            !p.name.toLowerCase().includes('ккт') &&
                            !p.name.toLowerCase().includes('фискальный') &&
                            p.sell_price > 0
                          )
                          .map(k => (
                            <button
                              key={k.id}
                              onClick={() => update('selected_kiosk_id', k.id)}
                              className={`rounded-xl border text-left transition-all overflow-hidden ${
                                form.selected_kiosk_id === k.id
                                  ? 'border-orange-500/60 bg-orange-500/10 ring-1 ring-orange-500/25'
                                  : 'border-white/10 bg-white/5 hover:bg-white/10'
                              }`}
                            >
                              <div className="w-full aspect-square bg-white/5 flex items-center justify-center overflow-hidden">
                                {k.image_url ? (
                                  <img src={k.image_url} alt={k.name} className="w-full h-full object-contain p-2" />
                                ) : (
                                  <svg className="w-12 h-12 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                  </svg>
                                )}
                              </div>
                              <div className="px-3 py-2">
                                <div className="text-xs font-medium text-white/80 leading-tight">{k.name}</div>
                                <div className="text-xs text-white/40 mt-1">{k.sell_price.toLocaleString('ru-RU')} ₽</div>
                              </div>
                            </button>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Тип крепления — для Kiosk PRO (динамический) */}
                  {form.license_type === 'kiosk_pro' && form.selected_kiosk_id && (
                    <div>
                      <label className="text-sm text-white/40 block mb-1.5">Тип крепления</label>
                      {(() => {
                        const kiosk = catalog.find(p => p.id === form.selected_kiosk_id)
                        if (!kiosk || !kiosk.group) {
                          return <p className="text-xs text-white/30">Для этого киоска опции крепления не предусмотрены</p>
                        }

                        const mountOptions = catalog.filter(p =>
                          p.category === 'kiosk_mount' &&
                          p.group === kiosk.group
                        )

                        // Определяем дефолтный тип крепления по группе и названию
                        const getDefault = (): 'desk' | 'wall' | 'floor' => {
                          if (!kiosk.group) return 'desk'
                          const g = kiosk.group.toLowerCase()
                          const n = kiosk.name.toLowerCase()
                          // Настенные: L-240, L-320, Slim, «настенная» в названии
                          if (g.includes('l-240') || g.includes('l-320') || g.includes('slim') || n.includes('настенн')) return 'wall'
                          // Напольные: «киоск самообслуживания» (МС 24, МС 32 и т.д.)
                          if (n.includes('киоск самообслуживания') || g.includes('мс 24') || g.includes('мс 32') || g.includes('mc 24') || g.includes('mc 32')) return 'floor'
                          return 'desk'
                        }
                        const defaultMount = getDefault()

                        // Доступные опции: дефолтная + те, что есть в каталоге
                        const hasDesk = defaultMount === 'desk' || mountOptions.some(m => m.name.toLowerCase().includes('настольн'))
                        const hasWall = defaultMount === 'wall' || mountOptions.some(m => m.name.toLowerCase().includes('настенн'))
                        const hasFloor = mountOptions.some(m => m.name.toLowerCase().includes('напольн'))

                        // Если только дефолтный тип и нет альтернатив — не показываем селектор
                        const totalOptions = [hasDesk, hasWall, hasFloor].filter(Boolean).length
                        if (totalOptions <= 1) {
                          if (!form.kiosk_type || form.kiosk_type !== defaultMount) {
                            update('kiosk_type', defaultMount)
                          }
                          return <p className="text-xs text-white/30">Крепление: {defaultMount === 'desk' ? 'настольное' : defaultMount === 'wall' ? 'настенное' : 'напольное'} (входит в комплект)</p>
                        }

                        if (!form.kiosk_type) {
                          update('kiosk_type', defaultMount)
                        }

                        return (
                          <div className="grid grid-cols-3 gap-2">
                            {hasDesk && (
                              <RadioCard
                                active={form.kiosk_type === 'desk'}
                                color="orange"
                                onClick={() => update('kiosk_type', 'desk')}
                                title="Настольный"
                                desc={defaultMount === 'desk' ? 'в комплекте' : ''}
                                small
                              />
                            )}
                            {hasWall && (
                              <RadioCard
                                active={form.kiosk_type === 'wall'}
                                color="orange"
                                onClick={() => update('kiosk_type', 'wall')}
                                title="Настенный"
                                desc={defaultMount === 'wall' ? 'в комплекте' : ''}
                                small
                              />
                            )}
                            {hasFloor && (
                              <RadioCard
                                active={form.kiosk_type === 'floor'}
                                color="orange"
                                onClick={() => update('kiosk_type', 'floor')}
                                title="Напольный"
                                desc=""
                                small
                              />
                            )}
                          </div>
                        )
                      })()}
                    </div>
                  )}

                  {/* Дополнительные опции — для Kiosk PRO (динамические из каталога) */}
                  {form.license_type === 'kiosk_pro' && form.selected_kiosk_id && (() => {
                    const kiosk = catalog.find(p => p.id === form.selected_kiosk_id)
                    if (!kiosk) return null

                    // Опции из группы выбранного киоска
                    const groupOptions = kiosk.group
                      ? catalog.filter(p => p.category === 'kiosk_option' && p.group === kiosk.group)
                      : []

                    // Универсальные опции (без группы или с группой, не совпадающей ни с одним киоском)
                    const kioskGroups = new Set(
                      catalog.filter(p => p.category === 'kiosk' && p.group).map(p => p.group)
                    )
                    const universalOptions = catalog.filter(p =>
                      p.category === 'kiosk_option' &&
                      (!p.group || !kioskGroups.has(p.group))
                    )

                    const allOptions = [...groupOptions, ...universalOptions]
                    if (allOptions.length === 0) return null

                    const toggleOption = (optId: string) => {
                      setForm(prev => {
                        const has = prev.selected_kiosk_options.includes(optId)
                        return {
                          ...prev,
                          selected_kiosk_options: has
                            ? prev.selected_kiosk_options.filter(id => id !== optId)
                            : [...prev.selected_kiosk_options, optId],
                        }
                      })
                    }

                    return (
                      <div className="space-y-2">
                        <label className="text-sm text-white/40 block">Дополнительно</label>
                        {allOptions.map(opt => {
                          const isChecked = form.selected_kiosk_options.includes(opt.id)
                          return (
                            <label key={opt.id} className="flex items-center gap-3 cursor-pointer group">
                              <div
                                onClick={() => toggleOption(opt.id)}
                                className={`w-5 h-5 rounded border flex items-center justify-center transition flex-shrink-0 ${
                                  isChecked
                                    ? 'bg-orange-500 border-orange-500'
                                    : 'border-white/20 group-hover:border-white/40'
                                }`}
                              >
                                {isChecked && (
                                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </div>
                              <div onClick={() => toggleOption(opt.id)}>
                                <span className="text-white/80 text-sm">{opt.name}</span>
                                <span className="text-white/30 text-xs ml-2">
                                  {opt.sell_price > 0 ? `${opt.sell_price.toLocaleString('ru-RU')} ₽` : ''}
                                </span>
                              </div>
                            </label>
                          )
                        })}
                      </div>
                    )
                  })()}

                  {/* Подсказки */}
                  {form.license_type === 'kiosk' && (
                    <div className="rounded-lg bg-orange-500/5 border border-orange-500/10 px-4 py-2 text-xs text-orange-300/70">
                      Комплект: планшет + кронштейн + адаптер + зарядка + кабель + хаб + крепление пинпада. Можно заменить любую позицию в превью.
                    </div>
                  )}
                  {form.license_type === 'kiosk_pro' && (
                    <div className="rounded-lg bg-orange-500/5 border border-orange-500/10 px-4 py-2 text-xs text-orange-300/70">
                      Готовый киоск — выберите модель и тип крепления из каталога. Периферия не требуется.
                    </div>
                  )}
                  {(form.license_type === 'qr' || form.license_type === 'ecomm') && (
                    <div className="rounded-lg bg-orange-500/5 border border-orange-500/10 px-4 py-2 text-xs text-orange-300/70">
                      Работает на телефонах клиентов — оборудование не требуется.
                    </div>
                  )}
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
                      onClick={() => update('subscription_period', key)}
                      className={`px-3 py-2 rounded-lg text-sm transition ${
                        form.subscription_period === key
                          ? isInno
                            ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                            : 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                          : 'bg-white/5 text-white/50 border border-white/5 hover:bg-white/10'
                      }`}
                    >
                      {val.label.split(' (')[0]}
                      {val.discount > 0 && (
                        <span className="block text-green-400 text-xs">-{val.discount}%</span>
                      )}
                    </button>
                  ))}
                </div>
              </Section>
            )}

            {/* Лицензии БОНДА */}
            {!isInno && (
              <Section title="Лицензия / подписка">
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <RadioCard
                      active={form.license_type === 'findir'}
                      color="purple"
                      onClick={() => update('license_type', 'findir')}
                      title="ФинДир"
                      desc="Финансовый директор"
                      small
                    />
                    <RadioCard
                      active={form.license_type === 'bonda_bi'}
                      color="purple"
                      onClick={() => update('license_type', 'bonda_bi')}
                      title="BONDA BI"
                      desc="Бизнес-аналитика"
                      small
                    />
                  </div>

                  {/* ФинДир тариф */}
                  {form.license_type === 'findir' && (
                    <div className="rounded-xl bg-white/5 border border-white/5 p-4 space-y-3">
                      <label className="text-sm text-white/40 block">Тариф ФинДир</label>
                      <div className="grid grid-cols-3 gap-2">
                        {findirTariffs.map(t => (
                          <button
                            key={t.name}
                            onClick={() => update('findir_tariff', t.name)}
                            className={`px-3 py-2 rounded-lg text-sm transition ${
                              form.findir_tariff === t.name
                                ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                                : 'bg-white/5 text-white/50 border border-white/5 hover:bg-white/10'
                            }`}
                          >
                            {t.name}
                          </button>
                        ))}
                      </div>
                      <div className="text-xs text-white/30 space-y-0.5">
                        {findirTariffs.find(t => t.name === form.findir_tariff)?.features.map((f, i) => (
                          <div key={i}>• {f}</div>
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
                <div className="space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <div
                      onClick={() => update('need_implementation', !form.need_implementation)}
                      className={`w-5 h-5 rounded border flex items-center justify-center transition ${
                        form.need_implementation
                          ? 'bg-orange-500 border-orange-500'
                          : 'border-white/20 group-hover:border-white/40'
                      }`}
                    >
                      {form.need_implementation && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <div onClick={() => update('need_implementation', !form.need_implementation)}>
                      <span className="text-white/80 text-sm">Внедрение и настройка</span>
                      <span className="text-white/30 text-xs ml-2">20 000 ₽ / локация</span>
                    </div>
                  </label>

                  <div>
                    <label className="text-sm text-white/40 block mb-1.5">Контент (позиции меню)</label>
                    <NumberInput value={form.content_items} onChange={v => update('content_items', v)} min={0} max={1000} />
                    {form.content_items > 0 && (
                      <p className="text-xs text-white/30 mt-1">1 200 ₽ / позиция</p>
                    )}
                  </div>
                </div>
              </Section>
            )}

            {/* Оплата */}
            <Section title="Условия оплаты">
              <div className="grid grid-cols-2 gap-3">
                <RadioCard
                  active={form.payment_type === 'prepay100'}
                  color={isInno ? 'orange' : 'purple'}
                  onClick={() => update('payment_type', 'prepay100')}
                  title="100% предоплата"
                  desc=""
                  small
                />
                <RadioCard
                  active={form.payment_type === 'installment3'}
                  color={isInno ? 'orange' : 'purple'}
                  onClick={() => update('payment_type', 'installment3')}
                  title="Рассрочка"
                  desc="60 / 20 / 20"
                  small
                />
              </div>
            </Section>

            {/* Заметки */}
            <Section title="Дополнительно">
              <textarea
                value={form.notes}
                onChange={e => update('notes', e.target.value)}
                placeholder="Особые пожелания, комментарии..."
                rows={2}
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/25 resize-none text-sm"
              />
            </Section>

            {/* Синхронизация каталога */}
            <GoogleSyncButton onSync={(data) => {
              setCatalog(data)
            }} />

            {/* Кнопка */}
            <button
              onClick={handleGenerate}
              disabled={!form.client_name.trim()}
              className={`w-full py-3.5 rounded-xl text-white font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
                isInno
                  ? 'bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700'
                  : 'bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700'
              }`}
            >
              Рассчитать КП
            </button>
          </div>
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
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-white/60 uppercase tracking-wider">{title}</h3>
      {children}
    </div>
  )
}

function RadioCard({ active, color, onClick, title, desc, small }: {
  active: boolean; color: 'orange' | 'purple'; onClick: () => void; title: string; desc: string; small?: boolean
}) {
  const accent = color === 'orange'
    ? { active: 'bg-orange-500/15 border-orange-500/40 text-orange-400', ring: 'ring-orange-500/25' }
    : { active: 'bg-purple-500/15 border-purple-500/40 text-purple-400', ring: 'ring-purple-500/25' }

  return (
    <button
      onClick={onClick}
      className={`rounded-xl border text-left transition-all ${small ? 'px-3 py-2.5' : 'px-4 py-3'} ${
        active
          ? `${accent.active} ring-1 ${accent.ring}`
          : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
      }`}
    >
      <div className={`font-medium ${small ? 'text-sm' : ''}`}>{title}</div>
      {desc && <div className={`${small ? 'text-xs' : 'text-sm'} opacity-60 mt-0.5`}>{desc}</div>}
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
async function fetchGoogleSheetProducts(): Promise<DBProduct[]> {
  const products: DBProduct[] = []
  let idx = 0

  // Способ 1: пробуем загрузить как XLSX (содержит все листы сразу)
  try {
    const xlsxUrl = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/export?format=xlsx`
    const resp = await fetch(xlsxUrl)
    if (resp.ok) {
      const XLSX = await loadXLSX()
      const buf = await resp.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName]
        const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: '' })
        const sheetCategory = sheetName.trim().toLowerCase()
        for (const row of rows) {
          const p = parseRowToProduct(row, idx, sheetCategory)
          if (p) { products.push(p); idx++ }
        }
      }
      if (products.length > 0) return products
    }
  } catch {
    // Fallback на CSV
  }

  // Способ 2: CSV — пробуем gid 0..9
  const sheetNames = ['планшеты', 'кронштейны', 'периферия', '', '', '', '', '', '', '']
  for (let gid = 0; gid < 10; gid++) {
    try {
      const url = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/export?format=csv&gid=${gid}`
      const resp = await fetch(url)
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

  return products
}

function parseRowToProduct(row: Record<string, unknown>, index: number, sheetCategory?: string): DBProduct | null {
  const name = String(row['Наименование'] || row['Название'] || row['name'] || row['Name'] || '').trim()
  if (!name) return null

  // Категория: из колонки, или из имени листа, или дефолт
  let rawCategory = String(row['Категория'] || row['category'] || row['Category'] || sheetCategory || 'equipment').trim().toLowerCase()
  const company = String(row['Компания'] || row['company'] || row['Company'] || 'inno').trim().toLowerCase()

  // Внутри листа «Киоски» — крепления, принтеры, сканеры, ККТ получают свою категорию
  if (rawCategory === 'киоски' || rawCategory === 'киоск') {
    const nameLower = name.toLowerCase()
    if (nameLower.includes('крепление')) rawCategory = '_kiosk_mount'
    else if (nameLower.includes('принтер')) rawCategory = '_kiosk_option'
    else if (nameLower.includes('сканер')) rawCategory = '_kiosk_option'
    else if (nameLower.includes('ккт') || nameLower.includes('фискальн')) rawCategory = '_kiosk_option'
  }

  // Цены: убираем "р.", пробелы, запятые — чтобы парсить "р.19 300" и "19300"
  const parsePrice = (val: unknown): number => {
    if (typeof val === 'number') return val
    const cleaned = String(val).replace(/[р.₽\s]/g, '').replace(',', '.')
    return Number(cleaned) || 0
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

function GoogleSyncButton({ onSync }: { onSync: (data: DBProduct[]) => void }) {
  const [status, setStatus] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle')
  const [count, setCount] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')

  const handleSync = async () => {
    setStatus('syncing')
    setErrorMsg('')
    try {
      const products = await fetchGoogleSheetProducts()
      if (products.length === 0) {
        setStatus('error')
        setErrorMsg('Таблица пуста или нет доступа по ссылке')
        return
      }
      setCount(products.length)
      setStatus('done')
      onSync(products)
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : 'Ошибка синхронизации')
    }
  }

  return (
    <div className="space-y-1">
      <button
        onClick={handleSync}
        disabled={status === 'syncing'}
        className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-center hover:border-green-500/40 hover:bg-green-500/5 transition disabled:opacity-50 group"
      >
        <span className="text-xs text-white/40 group-hover:text-green-400 flex items-center justify-center gap-2">
          <svg className={`w-3.5 h-3.5 ${status === 'syncing' ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {status === 'syncing' ? 'Синхронизация...' : 'Обновить каталог из Google Sheets'}
        </span>
      </button>
      {status === 'done' && <p className="text-xs text-green-400/70 text-center">Загружено {count} позиций</p>}
      {status === 'error' && <p className="text-xs text-red-400/70 text-center">{errorMsg}</p>}
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
    <div className="flex items-center gap-2">
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
        className="w-24 text-center rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-white focus:outline-none focus:border-orange-500/50"
      />
    </div>
  )
}
