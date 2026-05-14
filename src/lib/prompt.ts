// Типы запроса/состояния формы для калькулятора КП.
//
// История: файл когда-то содержал SYSTEM_PROMPT для голосового парсинга через
// OpenAI. Голосовой ввод выпилен, OpenAI integration отключена — оставлен
// только тип. По-хорошему файл стоит переименовать в `types.ts` при следующей
// крупной правке.

export interface ParsedRequest {
  company: 'inno' | 'bonda'
  client_name: string
  locations: number
  devices: number
  products: string[]
  kiosk_type: 'desk' | 'wall' | 'floor' | null
  license_type: 'qr' | 'ecomm' | 'kiosk' | 'kiosk_pro' | 'findir' | 'bonda_bi' | null
  findir_tariff: string | null
  selected_tablet_id: string | null  // ID планшета из каталога
  selected_kiosk_id: string | null  // ID киоска из каталога (для kiosk_pro)
  subscription_period: 'month' | 'quarter' | 'half_year' | 'year'
  need_implementation: boolean
  content_items: number
  payment_type: 'prepay100' | 'installment3'
  notes: string
  selected_kiosk_options: string[]  // IDs опций из каталога (ККТ, ФН, принтеры, сканеры и т.д.)
  // Internal fields for calculator (populated by page.tsx)
  _kiosk_name?: string
  _kiosk_price?: number
  _kiosk_mount_name?: string
  _kiosk_mount_price?: number
  _kiosk_options_data?: Array<{ name: string; price: number }>
}
