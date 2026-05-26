import {
  type ParsedRequest,
} from './prompt'
import {
  tablets, mounts, peripherals, kioskKits, posEquipment,
  services, innoLicenses, findirTariffs,
  getLicensePrice, getFindirPrice, periodMultiplier,
  getProductById, INNO_LICENSE_PRICES, INNO_ADDON_LICENSES,
  FISCAL_DEVICES, getFiscalConfigByGroup, TABLET_KIOSK_FISCAL_CONFIG,
  type FiscalConfig,
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

/** Собирает строки оборудования для фискального пакета по конфигу + qty.
 *  Используется в обеих ветках (kiosk / kiosk_pro). Для каждой строки
 *  создаётся отдельный LineItem — менеджер сможет менять qty в превью
 *  (например, поставить 1 ФР на 2 планшета — см. правила фискалки). */
function buildFiscalLineItems(config: FiscalConfig, qty: number): LineItem[] {
  if (qty <= 0) return []
  const out: LineItem[] = []
  const mkItem = (name: string, unitPrice: number): LineItem => ({
    name, category: 'fiscal', qty, unitPrice, discount: 0, total: unitPrice * qty,
  })
  if (config.pattern === 'internal') {
    out.push(mkItem(FISCAL_DEVICES.atol42fa.name, FISCAL_DEVICES.atol42fa.price))
    out.push(mkItem(FISCAL_DEVICES.fn15.name,     FISCAL_DEVICES.fn15.price))
    if (config.includeBuiltinPrinter === 'p80') {
      out.push(mkItem(FISCAL_DEVICES.printer80.name, FISCAL_DEVICES.printer80.price))
    } else if (config.includeBuiltinPrinter === 'p58') {
      out.push(mkItem(FISCAL_DEVICES.printer58.name, FISCAL_DEVICES.printer58.price))
    }
  } else if (config.pattern === 'external') {
    out.push(mkItem(FISCAL_DEVICES.poscenter02f.name, FISCAL_DEVICES.poscenter02f.price))
    out.push(mkItem(FISCAL_DEVICES.fn15.name,         FISCAL_DEVICES.fn15.price))
  }
  return out
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

    // Фискальный пакет (BG-1..5, 2026-05-26). Для планшетного Kiosk — паттерн B
    // (внешний POScenter-02Ф Cover + ФН 15). Дефолт ВЫКЛ — добавляется только
    // если менеджер поставил галку в форме (у клиента нет своей iiko-кассы).
    if (req.fiscal_pack) {
      equipItems.push(...buildFiscalLineItems(TABLET_KIOSK_FISCAL_CONFIG, req.devices))
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

    // Фискальный пакет (BG-1..5, 2026-05-26). Состав определяется группой
    // выбранного киоска через getFiscalConfigByGroup. Если правило не задано
    // (новая модель в Sheets без записи в KIOSK_FISCAL_RULES) — фискалка
    // не добавляется молча. Менеджер увидит что фискального пакета нет и
    // либо добавит модель в правила, либо положит позиции руками в превью.
    if (req.fiscal_pack && req._kiosk_group) {
      const fiscalCfg = getFiscalConfigByGroup(req._kiosk_group)
      if (fiscalCfg) {
        equipItems.push(...buildFiscalLineItems(fiscalCfg, req.devices))
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
  // licItems поднят на уровень выше: основная лицензия и add-on'ы кладутся
  // в одну секцию «Лицензии и подписки» (см. блок дополнительных лицензий ниже).
  const licItems: LineItem[] = []

  if (req.license_type) {
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

  }

  // ===== ДОПОЛНИТЕЛЬНЫЕ ЛИЦЕНЗИИ (add-on'ы, 2026-05-26) =====
  // Кладутся в ту же секцию «Лицензии и подписки» отдельной строкой.
  // Доступны только для ИННО, складываются поверх любой основной лицензии.
  if (req.company === 'inno' && req.additional_licenses && req.additional_licenses.length > 0) {
    const period_ = periodMultiplier[req.subscription_period]
    for (const addonKey of req.additional_licenses) {
      const addon = INNO_ADDON_LICENSES[addonKey]
      if (!addon) continue
      const qty =
        addon.unit === 'location' ? req.locations :
        addon.unit === 'device'   ? req.devices   : 1
      if (qty <= 0) continue
      monthlyTotal += addon.pricePerMonth * qty
      const unitLabel =
        addon.unit === 'location' ? 'лок.' :
        addon.unit === 'device'   ? 'устр.' : 'шт.'
      licItems.push({
        name: `${addon.name} × ${qty} ${unitLabel} (${period_.label})`,
        category: 'license_inno',
        qty,
        unitPrice: addon.pricePerMonth,
        months: period_.months,
        discount: 0,
        total: addon.pricePerMonth * qty * period_.months,
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
        name: 'inno clouds Контент',
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
