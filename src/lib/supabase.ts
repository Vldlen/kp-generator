import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// ---------- Типы из Supabase ----------

export interface DBProduct {
  id: string
  name: string
  article: string | null
  category: string
  company: string
  description: string | null
  specs: string | null
  cost_price: number
  sell_price: number
  margin: number
  supplier: string | null
  supplier_article: string | null
  unit: string
  warranty: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  group?: string | null  // Группа (for kiosks)
  image_url?: string | null  // URL to product image
  /** Phase 9 (H7, 2026-05-14): обезличенное имя для КП клиенту.
   *  Если задано — в .pptx уйдёт это значение, а не `name` (с брендом).
   *  Колонка в Google Sheets: «Имя для КП» / «kp_name» / «KP Name».
   *  Для встроенного fallback-каталога заполняется из `Product.kpName`. */
  kp_name?: string | null
}

// ---------- API ----------
//
// Внимание: anon-ключ Supabase летит в клиентский bundle. После применения
// миграции supabase/004_lock_rls.sql на anon доступно только SELECT
// (is_active = true). Запись возможна только под service_role (Supabase
// Studio / админка). cost_price/margin продолжают отдаваться (см.
// комментарий в миграции — это сознательное решение команды).

export async function fetchAllCatalog(): Promise<DBProduct[]> {
  const { data, error } = await supabase
    .from('catalog')
    .select('*')
    .eq('is_active', true)
    .order('category')
    .order('sell_price', { ascending: true })

  if (error) {
    console.error('Error fetching catalog:', error)
    return []
  }
  return data || []
}
