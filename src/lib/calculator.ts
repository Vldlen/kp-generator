import {
  type ParsedRequest,
} from './prompt'
import {
  tablets, mounts, peripherals, kioskKits, posEquipment,
  services, innoLicenses, findirTariffs,
  getLicensePrice, getFindirPrice, periodMultiplier,
  getProductById,
  type SubscriptionPeriod,
} from './catalog'

// ---------- Типы ----------

export interface LineItem {
  name: string
  category: string
  qty: number
  unitPrice: number
  discount: number    // процент
  total: number
}

export interface KPResult {
  company: 'inno' | 'bonda'
  clientName: string
  date: string
  sections: {
    title: string
    items: LineItem[]
    subtotal: number
  }[]
  grandTotal: number
  monthlyTotal: number   // ежемесячные платежи (лицензии)
  paymentType: string
  notes: string
}

// ---------- Расчёт ----------

export function calculateKP(req: ParsedRequest): KPResult {
  const sections: KPResult['sections'] = []
  let monthlyTotal = 0

  // ===== ОБОРУДОВАНИЕ =====
  // Маппинг kiosk_type → id кронштейна по умолчанию
  const mountByType: Record<string, string> = {
    desk: 'mount-onkron-desk-g80',
    wall: 'mount-onkron-wall-fixed',
    floor: 'mount-masterhold-kiosk',
  }

  // Для inno Kiosk: планшет + кронштейн + адаптер + периферия
  if (req.devices > 0 && req.license_type === 'kiosk') {
    const equipItems: LineItem[] = []

    // Планшет — выбранный менеджером или первый по умолчанию
    const selectedTablet = req.selected_tablet_id
      ? tablets.find(t => t.id === req.selected_tablet_id) || tablets[0]
      : tablets[0]
    if (selectedTablet) {
      equipItems.push({
        name: selectedTablet.kpName || selectedTablet.name,
        category: 'tablet',
        qty: req.devices,
        unitPrice: selectedTablet.sellPrice,
        discount: 0,
        total: selectedTablet.sellPrice * req.devices,
      })
    }

    // Кронштейн — по типу крепления (desk/wall)
    const mountId = mountByType[req.kiosk_type || 'desk']
    const mount = getProductById(mountId)
    if (mount) {
      equipItems.push({
        name: mount.kpName || mount.name,
        category: 'mount',
        qty: req.devices,
        unitPrice: mount.sellPrice,
        discount: 0,
        total: mount.sellPrice * req.devices,
      })
    }

    // Адаптер для планшета
    const adapter = getProductById('mount-onkron-adapter')
    if (adapter) {
      equipItems.push({
        name: adapter.kpName || adapter.name,
        category: 'adapter',
        qty: req.devices,
        unitPrice: adapter.sellPrice,
        discount: 0,
        total: adapter.sellPrice * req.devices,
      })
    }

    // Периферия
    for (const p of peripherals) {
      equipItems.push({
        name: p.kpName || p.name,
        category: 'peripheral',
        qty: req.devices,
        unitPrice: p.sellPrice,
        discount: 0,
        total: p.sellPrice * req.devices,
      })
    }

    // Крепление пинпада
    const pinpad = getProductById('mount-pinpad-bracket')
    if (pinpad) {
      equipItems.push({
        name: pinpad.kpName || pinpad.name,
        category: 'peripheral',
        qty: req.devices,
        unitPrice: pinpad.sellPrice,
        discount: 0,
        total: pinpad.sellPrice * req.devices,
      })
    }

    if (equipItems.length > 0) {
      const subtotal = equipItems.reduce((sum, i) => sum + i.total, 0)
      sections.push({
        title: 'Оборудование',
        items: equipItems,
        subtotal,
      })
    }
  }

  // Для inno Kiosk PRO: готовый POS-киоск, периферия не нужна
  if (req.devices > 0 && req.license_type === 'kiosk_pro') {
    const equipItems: LineItem[] = []

    // POS-терминал (готовый киоск)
    const defaultPOS = posEquipment[0]
    if (defaultPOS) {
      equipItems.push({
        name: defaultPOS.name,
        category: 'pos_terminal',
        qty: req.devices,
        unitPrice: defaultPOS.sellPrice,
        discount: 0,
        total: defaultPOS.sellPrice * req.devices,
      })
    }

    if (equipItems.length > 0) {
      const subtotal = equipItems.reduce((sum, i) => sum + i.total, 0)
      sections.push({
        title: 'Оборудование',
        items: equipItems,
        subtotal,
      })
    }
  }

  // ===== ЛИЦЕНЗИИ =====
  if (req.license_type) {
    const licItems: LineItem[] = []
    const period = periodMultiplier[req.subscription_period]

    // ИННО лицензии: QR, Ecomm, Kiosk, Kiosk PRO
    const innoLicPrices: Record<string, { name: string; price: number }> = {
      qr: { name: 'inno QR', price: 8000 },
      ecomm: { name: 'inno Ecomm', price: 15000 },
      kiosk: { name: 'inno Kiosk', price: 10000 },
      kiosk_pro: { name: 'inno Kiosk PRO', price: 16200 },
    }

    const innoLic = innoLicPrices[req.license_type]
    if (innoLic) {
      // QR и Ecomm — по локациям, Kiosk/Kiosk PRO — по устройствам
      const isPerLocation = req.license_type === 'qr' || req.license_type === 'ecomm'
      const qty = isPerLocation ? req.locations : req.devices
      const unitLabel = isPerLocation ? 'лок.' : 'устр.'

      const basePrice = innoLic.price
      const unitPrice = getLicensePrice(basePrice, qty)
      const totalMonths = period.months
      const pricePerMonth = unitPrice * qty
      const totalPrice = pricePerMonth * totalMonths

      monthlyTotal = pricePerMonth

      licItems.push({
        name: `${innoLic.name} × ${qty} ${unitLabel} (${period.label})`,
        category: 'license_inno',
        qty,
        unitPrice: unitPrice * totalMonths,
        discount: 0,
        total: totalPrice,
      })
    }

    if (req.license_type === 'findir' && req.findir_tariff) {
      const price = getFindirPrice(req.findir_tariff, req.locations)
      const period_ = periodMultiplier[req.subscription_period]
      const totalPrice = price * period_.months

      monthlyTotal = price

      licItems.push({
        name: `ФинДир «${req.findir_tariff}» — ${req.locations} лок. (${period_.label})`,
        category: 'Лицензия',
        qty: 1,
        unitPrice: totalPrice,
        discount: 0,
        total: totalPrice,
      })
    }

    if (req.license_type === 'bonda_bi') {
      const svc = services.find(s => s.id === 'svc-bonda-bi')
      if (svc) {
        const period_ = periodMultiplier[req.subscription_period]
        const totalPrice = svc.pricePerUnit * req.locations * period_.months
        monthlyTotal = svc.pricePerUnit * req.locations

        licItems.push({
          name: `BONDA BI — ${req.locations} лок. (${period_.label})`,
          category: 'Лицензия',
          qty: req.locations,
          unitPrice: svc.pricePerUnit * period_.months,
          discount: 0,
          total: totalPrice,
        })
      }
    }

    if (licItems.length > 0) {
      const subtotal = licItems.reduce((sum, i) => sum + i.total, 0)
      sections.push({
        title: 'Лицензии и подписки',
        items: licItems,
        subtotal,
      })
    }
  }

  // ===== УСЛУГИ =====
  const svcItems: LineItem[] = []

  if (req.need_implementation && req.locations > 0) {
    const impl = services.find(s => s.id === 'svc-inno-impl')
    if (impl) {
      const total = impl.pricePerUnit * req.locations
      svcItems.push({
        name: 'Внедрение и настройка',
        category: 'Услуги',
        qty: req.locations,
        unitPrice: impl.pricePerUnit,
        discount: 0,
        total,
      })
    }
  }

  if (req.content_items > 0) {
    const content = services.find(s => s.id === 'svc-inno-content')
    if (content) {
      const total = content.pricePerUnit * req.content_items
      svcItems.push({
        name: 'Генерация контента (карточки меню)',
        category: 'Услуги',
        qty: req.content_items,
        unitPrice: content.pricePerUnit,
        discount: 0,
        total,
      })
    }
  }

  if (svcItems.length > 0) {
    const subtotal = svcItems.reduce((sum, i) => sum + i.total, 0)
    sections.push({
      title: 'Услуги',
      items: svcItems,
      subtotal,
    })
  }

  // ===== ИТОГО =====
  const grandTotal = sections.reduce((sum, s) => sum + s.subtotal, 0)

  return {
    company: req.company,
    clientName: req.client_name,
    date: new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }),
    sections,
    grandTotal,
    monthlyTotal,
    paymentType: req.payment_type === 'installment3' ? 'Рассрочка 3 мес (60/20/20)' : '100% предоплата',
    notes: req.notes,
  }
}

// ---------- Форматирование ----------

export function formatMoney(n: number): string {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(n)
}
