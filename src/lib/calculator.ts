import {
  type ParsedRequest,
} from './prompt'
import {
  tablets, mounts, peripherals, kioskKits, posEquipment,
  services, innoLicenses, findirTariffs,
  getLicensePrice, getFindirPrice, periodMultiplier,
  getProductById, INNO_LICENSE_PRICES,
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
  // Период подписки в месяцах. Используется для лицензий и подписок:
  // total = unitPrice × qty × months × (1 - discount/100).
  // Для оборудования и разовых услуг — undefined (трактуется как 1, ничего
  // не меняется). Введено в Phase 3 фикса P0-3/P0-4 (2026-05-14):
  // раньше для лицензий хранили `unitPrice = price × months` целиком, что
  // ввело менеджеров в заблуждение (видели «120 000» вместо «10 000/мес»).
  months?: number
}

/** Эффективный множитель месяцев для строки. */
export function lineMonths(item: LineItem): number {
  return item.months && item.months > 0 ? item.months : 1
}

/** Перерасчёт total из qty/unitPrice/discount/months. Источник истины для preview. */
export function recomputeLineTotal(item: LineItem): number {
  return Math.round(item.unitPrice * item.qty * lineMonths(item) * (1 - item.discount / 100))
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

  // Для inno Kiosk: каждый планшет = самостоятельная киоск-станция со своим
  // полным комплектом (хаб LAN, крепление эквайринга и пр.). Все позиции
  // масштабируются по devices. История: 14.05.2026 на короткое время хаб
  // и крепление пинпада считались по locations — это было неверным толкованием
  // аудита, откатили на тот же день.
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

    // Периферия (дефолт) — все позиции из catalog.peripherals, × devices.
    // С Phase 5 dynamic row expansion шаблон .pptx умеет принимать до 11
    // позиций в «Оборудовании».
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

    // Крепление пинпада — × devices (на каждый планшет свой эквайринг).
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
    if (req._kiosk_name && req._kiosk_price) {
      equipItems.push({
        name: req._kiosk_name,
        category: 'kiosk',
        qty: req.devices,
        unitPrice: req._kiosk_price,
        discount: 0,
        total: req._kiosk_price * req.devices,
      })
    } else {
      // Fallback to old posEquipment[0] if no selected kiosk
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
    }

    // Add mount if non-default
    if (req._kiosk_mount_name && req._kiosk_mount_price && req._kiosk_mount_price > 0) {
      equipItems.push({
        name: req._kiosk_mount_name,
        category: 'mount',
        qty: req.devices,
        unitPrice: req._kiosk_mount_price,
        discount: 0,
        total: req._kiosk_mount_price * req.devices,
      })
    }

    // Add selected kiosk options (ККТ, ФН, принтеры, сканеры и т.д.)
    if (req._kiosk_options_data && req._kiosk_options_data.length > 0) {
      for (const opt of req._kiosk_options_data) {
        equipItems.push({
          name: opt.name,
          category: 'kiosk_option',
          qty: req.devices,
          unitPrice: opt.price,
          discount: 0,
          total: opt.price * req.devices,
        })
      }
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

    // ИННО лицензии: QR, Ecomm, Kiosk, Kiosk PRO.
    // Phase 9 (H22): цены берутся из catalog.INNO_LICENSE_PRICES, не дублируются здесь.
    const innoLic = INNO_LICENSE_PRICES[req.license_type]
    if (innoLic) {
      const isPerLocation = innoLic.unit === 'location'
      const qty = isPerLocation ? req.locations : req.devices
      const unitLabel = isPerLocation ? 'лок.' : 'устр.'

      const basePrice = innoLic.pricePerMonth
      const unitPrice = getLicensePrice(basePrice, qty)
      const totalMonths = period.months
      const pricePerMonth = unitPrice * qty
      const totalPrice = pricePerMonth * totalMonths

      monthlyTotal = pricePerMonth

      // Phase 3 (P0-3): unitPrice = цена за единицу в МЕСЯЦ (10 000),
      // months = период подписки в месяцах. total пересчитывается через
      // recomputeLineTotal. Раньше unitPrice = price × months, что приводило
      // к «120 000» в столбце Цена и провоцировало ручную «правку» обратно
      // к 10 000 (теряя множитель месяцев).
      licItems.push({
        name: `${innoLic.name} × ${qty} ${unitLabel} (${period.label})`,
        category: 'license_inno',
        qty,
        unitPrice,
        months: totalMonths,
        discount: 0,
        total: totalPrice,
      })
    }

    if (req.license_type === 'findir' && req.findir_tariff) {
      const price = getFindirPrice(req.findir_tariff, req.locations)
      const period_ = periodMultiplier[req.subscription_period]

      // Phase 8 (H2): если locations > 20, getFindirPrice вернёт null —
      // тарифной сетки нет, нужна индивидуальная цена. Создаём строку-
      // плейсхолдер с unitPrice=0 и подписью «цена по запросу» — менеджер
      // увидит и проставит руками в превью после согласования.
      if (price === null) {
        licItems.push({
          name: `ФинДир «${req.findir_tariff}» — ${req.locations} лок. (цена по запросу, ${period_.label})`,
          category: 'license_inno',
          qty: 1,
          unitPrice: 0,
          months: period_.months,
          discount: 0,
          total: 0,
        })
        monthlyTotal = 0
      } else {
        monthlyTotal = price

        // Phase 3 (P0-3): unitPrice = price (за месяц), months = период.
        licItems.push({
          name: `ФинДир «${req.findir_tariff}» — ${req.locations} лок. (${period_.label})`,
          category: 'license_inno',
          qty: 1,
          unitPrice: price,
          months: period_.months,
          discount: 0,
          total: price * period_.months,
        })
      }
    }

    if (req.license_type === 'bonda_bi') {
      const svc = services.find(s => s.id === 'svc-bonda-bi')
      if (svc) {
        const period_ = periodMultiplier[req.subscription_period]
        const totalPrice = svc.pricePerUnit * req.locations * period_.months
        monthlyTotal = svc.pricePerUnit * req.locations

        // Phase 3 (P0-3): BONDA BI — qty=locations,
        // unitPrice = pricePerUnit (за локацию в месяц), months = период.
        licItems.push({
          name: `BONDA BI — ${req.locations} лок. (${period_.label})`,
          category: 'license_inno',
          qty: req.locations,
          unitPrice: svc.pricePerUnit,
          months: period_.months,
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
