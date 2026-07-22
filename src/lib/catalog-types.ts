// Тип строки каталога. Исторически жил в lib/supabase.ts — Supabase-клиент
// вычищен 22.07.2026: его проект давно удалён, реальный источник каталога —
// Google-таблица, резерв — встроенный снимок (см. catalog-fallback.ts).

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
  /** «Тип» кронштейна из листа «Кронштейны»: настенный/настольный/стойка/
   *  рамка/пинпад. Определяет, что попадает в выбор крепления, а что —
   *  авто-компонент. Если пусто — код выводит роль из названия (fallback). */
  mount_type?: string | null
  /** «Рамка» = «в комплекте» — держатель планшета уже в составе крепления
   *  (напр. стойка-столбик MasterHold), отдельной рамкой не добавляем. */
  frame_included?: boolean
}
