'use client'

import { useState, useEffect } from 'react'
import { KPPreview } from '@/components/KPPreview'
import { calculateKP, type KPResult } from '@/lib/calculator'
import type { ParsedRequest } from '@/lib/prompt'
import {
  findirTariffs,
  periodMultiplier,
  allProducts,
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

  // Загружаем каталог из Supabase при старте
  useEffect(() => {
    fetchAllCatalog().then(data => {
      if (data.length > 0) {
        setCatalog(data)
        console.log(`Каталог загружен из Supabase: ${data.length} товаров`)
      } else {
        console.log('Supabase пуст, используем fallback каталог')
      }
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
