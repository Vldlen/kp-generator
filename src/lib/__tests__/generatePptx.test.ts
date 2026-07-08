import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import { fillCard, adjustCardGeometry, RIGHT_TOP_CARD } from '../generatePptx'
import type { KPResult } from '../calculator'

// Тест против РЕАЛЬНОГО шаблона commercial_template.pptx: гоняем пайплайн
// карточки «Лицензии и подписки» и проверяем, что несколько лицензий (баг
// 2026-07-08: 2-я лицензия — напр. «Электронная очередь» — молча пропадала
// из .pptx, хотя ИТОГО её включал) корректно рендерятся.

async function loadSlideXml(): Promise<string> {
  const buf = readFileSync(path.resolve(process.cwd(), 'public/templates/commercial_template.pptx'))
  const zip = await JSZip.loadAsync(buf)
  return zip.file('ppt/slides/slide1.xml')!.async('string')
}

const twoLicenses: KPResult['sections'][0] = {
  title: 'Лицензии и подписки',
  items: [
    { name: 'inno clouds Киоск Профи × 1 устр. (3 месяца)', category: 'license_inno', qty: 1, unitPrice: 16200, months: 3, discount: 0, total: 48600 },
    { name: 'inno clouds Электронная очередь × 1 лок. (3 месяца)', category: 'license_inno', qty: 1, unitPrice: 2000, months: 3, discount: 0, total: 6000 },
  ],
  subtotal: 54600,
}

// Высота контейнера карточки лицензий (Shape 83, cy).
const containerCy = (xml: string) =>
  Number(xml.match(/name="Shape 83"[\s\S]*?<a:ext cx="\d+" cy="(\d+)"/)![1])

describe('PPTX: карточка «Лицензии и подписки» — несколько строк', () => {
  it('обе лицензии попадают в .pptx (регрессия: 2-я пропадала)', async () => {
    let xml = await loadSlideXml()
    xml = fillCard(xml, RIGHT_TOP_CARD, twoLicenses)
    xml = adjustCardGeometry(xml, RIGHT_TOP_CARD, twoLicenses.items.length, { noGrow: true })
    expect(xml).toContain('Киоск Профи')
    expect(xml).toContain('Электронная очередь')   // раньше терялась
    expect(xml).toContain('Text Ext')              // клонированная 2-я строка
  })

  it('контейнер лицензий НЕ растёт (иначе наедет на «Услуги»)', async () => {
    const orig = await loadSlideXml()
    const before = containerCy(orig)
    let xml = fillCard(orig, RIGHT_TOP_CARD, twoLicenses)
    xml = adjustCardGeometry(xml, RIGHT_TOP_CARD, twoLicenses.items.length, { noGrow: true })
    expect(containerCy(xml)).toBeLessThanOrEqual(before)
  })

  it('одна лицензия — без клонов, поведение как раньше', async () => {
    const one: KPResult['sections'][0] = { ...twoLicenses, items: [twoLicenses.items[0]], subtotal: 48600 }
    let xml = await loadSlideXml()
    xml = fillCard(xml, RIGHT_TOP_CARD, one)
    xml = adjustCardGeometry(xml, RIGHT_TOP_CARD, 1, { noGrow: true })
    expect(xml).toContain('Киоск Профи')
    expect(xml).not.toContain('Text Ext')          // клонов нет
  })
})
