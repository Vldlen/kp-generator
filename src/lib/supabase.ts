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
}

export interface DBCompatibilityHint {
  id: string
  trigger_category: string
  trigger_product: string | null
  condition: string | null
  hint_text: string
  hint_type: string
  is_active: boolean
}

export interface DBVolumeDiscount {
  id: string
  product_category: string
  min_qty: number
  discount_percent: number
}

export interface DBPeriodDiscount {
  id: string
  period_key: string
  period_months: number
  discount_percent: number
  label: string
}

// ---------- API-функции ----------

export async function fetchProducts(category?: string, company?: string): Promise<DBProduct[]> {
  let query = supabase
    .from('catalog')
    .select('*')
    .eq('is_active', true)
    .order('sell_price', { ascending: true })

  if (category) query = query.eq('category', category)
  if (company) query = query.or(`company.eq.${company},company.eq.both`)

  const { data, error } = await query
  if (error) {
    console.error('Error fetching products:', error)
    return []
  }
  return data || []
}

export async function fetchProductsByCategories(categories: string[]): Promise<DBProduct[]> {
  const { data, error } = await supabase
    .from('catalog')
    .select('*')
    .eq('is_active', true)
    .in('category', categories)
    .order('category')
    .order('sell_price', { ascending: true })

  if (error) {
    console.error('Error fetching products:', error)
    return []
  }
  return data || []
}

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

export async function fetchHints(category: string): Promise<DBCompatibilityHint[]> {
  const { data, error } = await supabase
    .from('compatibility_hints')
    .select('*')
    .eq('trigger_category', category)
    .eq('is_active', true)

  if (error) return []
  return data || []
}

export async function fetchVolumeDiscounts(): Promise<DBVolumeDiscount[]> {
  const { data, error } = await supabase
    .from('volume_discounts')
    .select('*')
    .order('min_qty')

  if (error) return []
  return data || []
}

export async function fetchPeriodDiscounts(): Promise<DBPeriodDiscount[]> {
  const { data, error } = await supabase
    .from('period_discounts')
    .select('*')
    .order('period_months')

  if (error) return []
  return data || []
}
