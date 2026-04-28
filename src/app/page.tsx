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
  subscription_period: 'year',
  need_implementation: false,
  content_items: 0,
  payment_type: 'prepay100',
  notes: '',
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
          console.log(`Каталог загружен из Google Sheets: ${products.length} товаров`)
          return
        }
        throw new Error('Google Sheets пуст')
      })
      .catch(() => {
        // Fallback на Supabase
        fetchAllCatalog().then(data => {
          if (data.length > 0) {
            setCatalog(data)
            console.log(`Каталог загружен из Supabase: ${data.length} товаров`)
          } else {
            console.log('Используем встроенный каталог')
          }
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
        }
        // Kiosk — планшетный комплект, дефолт настольный
        if (value === 'kiosk') {
          next.devices = Math.max(1, next.devices)
          next.kiosk_type = 'desk'
        }
        // Kiosk PRO — готовый киоск, дефолт настольный
        if (value === 'kiosk_pro') {
          next.devices = Math.max(1, next.devices)
          next.kiosk_type = 'desk'
        }
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
    const result = calculateKP(form)
    setKP(result)
    setStep('preview')
  }

  const handleBack = () => {
    setStep('form')
    // Сохраняем данные формы — можно отредактировать и пересоздать
  }

  const handleReset = () => {
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

                  {/* Тип крепления — для Kiosk PRO (настольный/настенный/напольный) */}
                  {form.license_type === 'kiosk_pro' && (
                    <div>
                      <label className="text-sm text-white/40 block mb-1.5">Тип крепления</label>
                      <div className="grid grid-cols-3 gap-2">
                        <RadioCard
                          active={form.kiosk_type === 'desk'}
                          color="orange"
                          onClick={() => update('kiosk_type', 'desk')}
                          title="Настольный"
                          desc=""
                          small
                        />
                        <RadioCard
                          active={form.kiosk_type === 'wall'}
                          color="orange"
                          onClick={() => update('kiosk_type', 'wall')}
                          title="Настенный"
                          desc=""
                          small
                        />
                        <RadioCard
                          active={form.kiosk_type === 'floor'}
                          color="orange"
                          onClick={() => update('kiosk_type', 'floor')}
                          title="Напольный"
                          desc=""
                          small
                        />
                      </div>
                    </div>
                  )}

                  {/* Подсказки */}
                  {form.license_type === 'kiosk' && (
                    <div className="rounded-lg bg-orange-500/5 border border-orange-500/10 px-4 py-2 text-xs text-orange-300/70">
                      Комплект: планшет + кронштейн + адаптер + зарядка + кабель + хаб + крепление пинпада. Можно заменить любую позицию в превью.
                    </div>
                  )}
                  {form.license_type === 'kiosk_pro' && (
                    <div className="rounded-lg bg-orange-500/5 border border-orange-500/10 px-4 py-2 text-xs text-orange-300/70">
                      Готовый киоск — периферия не нужна. Модель можно заменить в превью КП.
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

            {/* Загрузка номенклатуры */}
            <Section title="Номенклатура">
              <CatalogUpload onUpload={(data) => {
                setCatalog(data)
                console.log(`Каталог обновлён из Excel: ${data.length} товаров`)
              }} />
            </Section>

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

function CheckCard({ active, onClick, title, desc }: {
  active: boolean; onClick: () => void; title: string; desc: string
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border px-3 py-2.5 text-left transition-all ${
        active
          ? 'bg-orange-500/15 border-orange-500/40 text-orange-400 ring-1 ring-orange-500/25'
          : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
      }`}
    >
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs opacity-60 mt-0.5">{desc}</div>
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
  const rawCategory = String(row['Категория'] || row['category'] || row['Category'] || sheetCategory || 'equipment').trim().toLowerCase()
  const company = String(row['Компания'] || row['company'] || row['Company'] || 'inno').trim().toLowerCase()

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

function CatalogUpload({ onUpload }: { onUpload: (data: DBProduct[]) => void }) {
  const [status, setStatus] = useState<'idle' | 'parsing' | 'syncing' | 'done' | 'error'>('idle')
  const [count, setCount] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [lastSync, setLastSync] = useState<string | null>(null)

  // Синхронизация из Google Sheets (все листы)
  const handleGoogleSync = async () => {
    setStatus('syncing')
    setErrorMsg('')

    try {
      const products = await fetchGoogleSheetProducts()

      if (products.length === 0) {
        setStatus('error')
        setErrorMsg('Таблица пуста, заголовки не распознаны, или нет доступа. Проверьте: Настройки доступа → Все, у кого есть ссылка → Читатель')
        return
      }

      setCount(products.length)
      setLastSync(new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }))
      setStatus('done')
      onUpload(products)
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : 'Ошибка синхронизации')
    }
  }

  // Загрузка из Excel файла
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setStatus('parsing')
    setErrorMsg('')

    try {
      const XLSX = await loadXLSX()
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })

      const products: DBProduct[] = []
      let idx = 0
      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName]
        const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: '' })
        // Имя листа = категория (Планшеты, Кронштейны, Периферия)
        const sheetCategory = sheetName.trim().toLowerCase()
        for (const row of rows) {
          const p = parseRowToProduct(row, idx, sheetCategory)
          if (p) { products.push(p); idx++ }
        }
      }

      if (products.length === 0) {
        setStatus('error')
        setErrorMsg('Не найдено ни одной строки с данными.')
        return
      }

      setCount(products.length)
      setLastSync(null)
      setStatus('done')
      onUpload(products)
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : 'Ошибка парсинга файла')
    }
    e.target.value = ''
  }

  return (
    <div className="space-y-3">
      {/* Google Sheets sync */}
      <button
        onClick={handleGoogleSync}
        disabled={status === 'syncing'}
        className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-center hover:border-green-500/40 hover:bg-green-500/5 transition disabled:opacity-50 group"
      >
        <span className="text-sm text-white/60 group-hover:text-green-400 flex items-center justify-center gap-2">
          <svg className={`w-4 h-4 ${status === 'syncing' ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {status === 'syncing' ? 'Синхронизация...' : 'Синхронизировать из Google Sheets'}
        </span>
      </button>

      {/* Или загрузка файлом */}
      <label className="flex items-center gap-3 cursor-pointer group">
        <input type="file" accept=".xlsx,.xls" onChange={handleFile} className="hidden" />
        <div className="flex-1 rounded-xl bg-white/5 border border-dashed border-white/20 px-4 py-2.5 text-center group-hover:border-orange-500/40 group-hover:bg-white/10 transition">
          <span className="text-xs text-white/40 group-hover:text-white/60">
            {status === 'parsing' ? 'Обработка...' : 'или загрузить .xlsx файлом'}
          </span>
        </div>
      </label>

      {/* Статус */}
      {status === 'done' && (
        <p className="text-xs text-green-400/70">
          Загружено {count} позиций{lastSync ? ` (синхронизация в ${lastSync})` : ''}
        </p>
      )}
      {status === 'error' && (
        <p className="text-xs text-red-400/70">{errorMsg}</p>
      )}
    </div>
  )
}

function mapCategory(cat: string): string {
  const map: Record<string, string> = {
    'планшет': 'tablet', 'tablet': 'tablet', 'планшеты': 'tablet',
    'крепление': 'mount', 'кронштейн': 'mount', 'кронштейны': 'mount', 'mount': 'mount',
    'периферия': 'peripheral', 'peripheral': 'peripheral',
    'pos': 'pos_terminal', 'pos_terminal': 'pos_terminal', 'терминал': 'pos_terminal', 'моноблок': 'pos_terminal', 'киоски': 'pos_terminal', 'киоск': 'pos_terminal',
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
