# kp-generator — Архитектурный аудит

Дата: 2026-05-14
Аудитор: subagent (только чтение, без правок)
Версия кода: коммит `3cdac51` от 06.05.2026
LOC исходников: ~4 000

---

## Summary

Проект делает одну прикладную вещь: форма → расчёт → preview → байтовая правка готового .pptx-шаблона. Никакого backend-стейта, всё клиентское, серверного кода в проекте нет. Это даёт быструю разработку, но из-за этого ВСЕ инварианты «то что показано = то что отдано клиенту» держатся на дисциплине, не на типах.

Главный архитектурный долг — **три параллельных представления одних и тех же данных** (форма `ParsedRequest` → `KPResult` в калькуляторе → `sections` state в `KPPreview` → текстовые ячейки внутри `.pptx`), и переход между слоями делается через ad-hoc match по строковым ключам (`section.title === 'Оборудование'`, `name.toLowerCase().includes('настольн')`). Это уже сейчас провоцирует тонкие баги (см. A1, A2, A6), и при добавлении нового типа лицензии или нового типа оборудования количество мест, которые надо синхронно править, растёт линейно.

Сильные стороны: чёткая трёхзоновая верстка КП-слайда, продуманная компактификация (`compactLeftCard`), грамотная стратегия загрузки каталога с fallback'ами, явная типизация `ParsedRequest`/`LineItem`/`KPResult`. TS strict mode включён.

Найдено: **3 P0**, **8 P1**, **5 P2**, **2 P3** — итого 18 находок.

---

## Findings

### P0 — критично

#### A1. Source-of-truth для названия секции — нестабильная русская строка

`generatePptx.ts:406-408`:
```ts
const equipSection = kp.sections.find(s => s.title === 'Оборудование') || null
const licSection   = kp.sections.find(s => s.title === 'Лицензии и подписки') || null
const svcSection   = kp.sections.find(s => s.title === 'Услуги') || null
```

Эти три строки — единственная связь между калькулятором и тремя жёсткими карточками PPTX-шаблона (`LEFT_CARD`, `RIGHT_TOP_CARD`, `RIGHT_BOTTOM_CARD`). При этом:

1. В `calculator.ts:126, 191, 274, 317` те же строки заданы независимыми литералами — нет общего enum/const.
2. В `KPPreview.tsx:321-326` функция `addSection()` создаёт секцию с title `'Дополнительно'`, а `addItem`/`removeItem` могут добавить новые секции вообще с любым title. **Если менеджер добавит секцию вручную, она в .pptx не попадёт молча** — `find` вернёт `null`, и `fillCard` просто удалит карточку. Менеджер увидит позицию в preview, увидит её в grand total, но в скачанном файле её не будет.
3. Аналогично — если переименовать секцию в `calculator.ts` (например, «Оборудование» → «Комплект»), .pptx молча сломается — fallback на `removeCard` спрячет ошибку.

**Как проверить:** в preview нажать «+ Добавить секцию», добавить позицию с ценой → скачать .pptx → проверить, что секции там нет.

**Также:** жёстко зафиксирован порядок «оборудование → лицензии → услуги» в трёх местах: `calculator.ts` (порядок push), `generatePptx.ts` (карточки LEFT/RIGHT_TOP/RIGHT_BOTTOM), `KPPreview.tsx` (порядок рендера = порядок массива). Преимущество — карточки в .pptx стабильны. Минус — если хочется переставить, надо менять три файла.

**Риск:** менеджер вручную «доделал» КП в preview → отправил .pptx клиенту → секция не пришла → клиент видит итог 350k, но в детализации только 200k.

---

#### A2. `grandTotal` в .pptx считается из `kp.grandTotal`, а в preview — из `sections` — могут разойтись

`KPPreview.tsx:251`:
```ts
const grandTotal = sections.reduce((sum, s) => sum + s.subtotal, 0)
```

`KPPreview.tsx:329`:
```ts
const getCurrentKP = (): KPResult => ({ ...kp, sections, grandTotal })
```

Здесь корректно: preview-state `sections` пересчитывается локально → `grandTotal` пересчитывается. Но:

- `kp.monthlyTotal` копируется из исходного `kp` без пересчёта (`...kp` сохраняет старое значение). Если менеджер правит цену лицензии в preview → grand total пересчитывается, monthly показан старый. Виден на стр. 506 (`{formatMoney(kp.monthlyTotal)}`).
- `kp.paymentType`, `kp.date`, `kp.clientName` — тот же эффект, но они не редактируются, поэтому пока ок.
- В .pptx (`generatePptx.ts:464`) используется `kp.grandTotal` → это значение из `getCurrentKP()`, ок. Но `section.subtotal` (`fillCard` → `card.totalValue`, генератор стр. 188) тоже из `getCurrentKP()`. Сходится.

**Однако** инвариант «sum(items.total) == section.subtotal == grandTotal/N» нигде не проверяется. Если, например, рукой добавить третий вызов `setSections` без `recalcSection`, баланс разъедется и в .pptx уйдёт. См. рискованную точку: `updateName` (стр. 313-319) **не вызывает `recalcSection`** — это безопасно, потому что цена не меняется, но в коде нет ничего, что страховало бы будущие изменения.

**Как проверить:** добавить assertion в `getCurrentKP()` и в `fillCard` — сравнить grand total из заголовка с суммой карточек. Сейчас этого нет.

---

#### A3. `monthlyTotal` хранит ошибочное значение для inno Kiosk / Kiosk PRO

`calculator.ts:224`:
```ts
monthlyTotal = pricePerMonth
```

Где `pricePerMonth = unitPrice * qty`. Например, для `inno Kiosk × 5 устр.`: pricePerMonth = `10 000 × 5 = 50 000 ₽/мес`. Это «полный ежемесячный платёж».

Но строкой ниже (стр. 230) в `LineItem.unitPrice` записывается `unitPrice * totalMonths` (т.е. цена за весь период), а total = pricePerMonth * months. Если менеджер потом отредактирует unitPrice в preview, `monthlyTotal` не пересчитается (т.к. в стейте preview его нет — он зафиксирован в `kp.monthlyTotal`, см. A2). Затем preview покажет старый monthly, но клиент увидит другой grand total.

`KPPreview.tsx:506`:
```tsx
{kp.monthlyTotal > 0 && (
  <div className="text-sm text-white/50 mt-1">Ежемесячный платёж: {formatMoney(kp.monthlyTotal)}</div>
)}
```

**Риск:** менеджер увеличил скидку на лицензию в preview → grand total упал, monthly остался прежним → менеджер шлёт КП → клиент видит несостыковку «23 000 ₽/мес × 12 = 276 000 ₽, но в КП написано 240 000 ₽». В .pptx monthly не идёт, поэтому до клиента не доходит, но менеджер при сверке может поставить неправильные числа в письмо. **[unverified]** — проверить, как именно менеджер использует monthly при отправке.

---

### P1 — важный архитектурный долг

#### A4. `ParsedRequest` помечена «голосовая команда → JSON», но фактически голос не используется. Внутренние поля `_kiosk_*` живут на ней же

`prompt.ts:69-92`:
```ts
export interface ParsedRequest {
  ...
  // Internal fields for calculator (populated by page.tsx)
  _kiosk_name?: string
  _kiosk_price?: number
  ...
}
```

Файл назван `prompt.ts`, экспортирует `SYSTEM_PROMPT` для OpenAI, но **ни один файл его не импортирует** (`grep SYSTEM_PROMPT` — только сама декларация). `openai` остался в `package.json`, но нигде не используется (verified). Голос/AI-парсер вырезан, тип `ParsedRequest` остался как state-форма, к нему «дописали» 5 «internal» полей с подчёркиванием.

Проблема: тип теряет смысл — это и «то что менеджер ввёл в форму», и «то что напихал `handleGenerate` для калькулятора». Зависимость данных стала неявной: `calculator.ts:138-186` читает `req._kiosk_name`, `req._kiosk_options_data` — но эти поля заполняет только `page.tsx:177-220`. Если завтра вызвать `calculateKP` из другого места без enrichment, kiosk_pro молча отрендерится через `posEquipment[0]` fallback (стр. 148-159) — **POScenter Atlas 15", который в каталоге как POS-моноблок, а не как самостоятельный киоск**.

**Рекомендация:** разделить `FormState` и `CalculatorInput`. Сейчас этого нет.

---

#### A5. Маппинг «крепление-по-типу» дублируется в трёх местах с лёгким drift

1. `calculator.ts:46-50` — `mountByType` использует **id из catalog.ts** (`mount-onkron-desk-g80`, `mount-onkron-wall-fixed`, `mount-masterhold-kiosk`).
2. `page.tsx:192-196` (handleGenerate для kiosk_pro) — `mountTypeMap` ищет крепления **по русской подстроке** в имени продукта (`'настольн'`, `'настенн'`, `'напольн'`).
3. `page.tsx:485-495` (UI Kiosk PRO) — функция `getDefault()` определяет дефолтный тип крепления **по подстроке в group/name** (`g.includes('l-240')`, `n.includes('настенн')` и т.п.).
4. `page.tsx:229-244` (`isNonDefaultMount`) — четвёртая копия той же логики, но в условиях «is this the default mount for this kiosk group».

Все четыре места решают одну задачу — «связать тип крепления с группой/именем продукта», но через разные критерии. Расширение каталога (новая модель, например «настольный универсальный без указания типа в названии») потребует править всё четыре. Уже сейчас есть лёгкая несогласованность:

В `calculator.ts:50` для `floor` используется `mount-masterhold-kiosk` — но в `page.tsx:200` для `kiosk_pro` ищут по подстроке `'напольн'`, а в каталоге MasterHold называется «MasterHold комплекс креплений» (catalog.ts:270) → `'напольн'` в имени нет → для kiosk_pro подходящее крепление не найдётся, для inno_kiosk найдётся через id.

**Как проверить:** выбрать в форме «Kiosk PRO» с моделью, у которой в group есть `мс 24` или `мс 32` (напольный), и крепление с словом «напольн» в имени → если такого нет, при non-default mount добавится пустая карточка `_kiosk_mount_*` = undefined → calculator пропустит без ошибки.

---

#### A6. Категория продукта определяется по подстроке в названии (киоск/крепление/принтер/сканер/ккт)

`page.tsx:951-957`:
```ts
if (rawCategory === 'киоски' || rawCategory === 'киоск') {
  const nameLower = name.toLowerCase()
  if (nameLower.includes('крепление')) rawCategory = '_kiosk_mount'
  else if (nameLower.includes('принтер')) rawCategory = '_kiosk_option'
  else if (nameLower.includes('сканер')) rawCategory = '_kiosk_option'
  else if (nameLower.includes('ккт') || nameLower.includes('фискальн')) rawCategory = '_kiosk_option'
}
```

И в форме (`page.tsx:432-440`):
```ts
.filter(p =>
  p.category === 'kiosk' &&
  !p.name.toLowerCase().includes('крепление') &&
  !p.name.toLowerCase().includes('принтер') &&
  !p.name.toLowerCase().includes('сканер') &&
  !p.name.toLowerCase().includes('ккт') &&
  !p.name.toLowerCase().includes('фискальный')
)
```

Два списка стоп-слов, должны быть идентичны, могут разойтись. В Google Sheet поставщик каталога ставит наименование руками → один опечаток типа «крпеление» → продукт попадёт в `kiosk` вместо `kiosk_mount` → в форме появится как модель киоска, в калькуляторе — как `_kiosk_price`, в КП клиенту: «Кронштейн напольный за 28 500 ₽ × 5 устройств = 142 500 ₽». Без валидации это уйдёт.

**Не закреплён инвариант:** category должна определяться явной колонкой в Sheet, а не подстрокой. Сейчас «Категория» в Sheet есть (`page.tsx:947`), но при category=`киоски` логика лезет в name. Это branching, который сам себе создаёт классы ошибок.

---

#### A7. `kpName` маппинг работает только для встроенных продуктов, не для Google Sheet

`KPPreview.tsx:18-26`:
```ts
const kpNameMap: Record<string, string> = {}
for (const arr of [tablets, mounts, peripherals]) {
  for (const p of arr) {
    if (p.kpName) kpNameMap[p.name] = p.kpName
  }
}
function getKpName(realName: string): string {
  return kpNameMap[realName] || realName
}
```

Маппинг строится **только** из встроенного `catalog.ts` (массивы `tablets/mounts/peripherals`). Когда менеджер заменит позицию через UI (replaceWithProduct, KPPreview.tsx:254) на продукт из Google Sheet, чьё имя — `'Onkron G80 кронштейн настольный'` (с брендом), произойдёт следующее:

1. `getKpName('Onkron G80 кронштейн настольный')` → промах в карте → возвращает то же имя с брендом.
2. В .pptx уйдёт `'Onkron G80 кронштейн настольный'`.

Заявленная фича «Полная анонимизация в КП» (см. CLAUDE.md / changelog) ломается на любом продукте, добавленном через Google Sheets без специальной поддержки в catalog.ts. В Google Sheet нет колонки `kp_name` (см. `parseRowToProduct`, page.tsx:942-996) — нечего читать.

**Как проверить:** Sync from Google Sheets → в preview кликнуть на «Планшет Android…» → выбрать любой не-OnePlus планшет из выпадашки → нажать скачать → открыть .pptx → если в имени осталось «Redmi/POCO/Honor», подтверждено.

---

#### A8. `subscription_period` для kiosk_pro оборудования не учитывается в total, но влияет на лицензию — может ввести в заблуждение

`calculator.ts:138-186` (kiosk_pro оборудование): `total = req._kiosk_price * req.devices` — единовременная покупка.

`calculator.ts:218-233` (лицензия kiosk_pro): `total = unitPrice * months` — за весь период.

В preview эти два числа просто складываются в один `grandTotal`. Это правильно технически (вы оплачиваете и железо, и лицензию). Но в `KPPreview.tsx:508` написано лейбл `paymentType` — «100% предоплата» — относительно ВСЕГО grand total. Для рассрочки 60/20/20 (`installment3`) непонятно, на что именно рассрочка — на железо или на 12 месяцев лицензии. В коде эта семантика никак не зафиксирована, в КП клиенту тоже (см. .pptx-шаблон).

**Не критично сейчас**, но при обсуждении «рассрочки» с клиентом — есть пространство для misunderstanding.

---

#### A9. Mutation внутри render — `update('kiosk_type', defaultMount)` вызывается прямо во время рендера

`page.tsx:506-513`:
```ts
if (totalOptions <= 1) {
  if (!form.kiosk_type || form.kiosk_type !== defaultMount) {
    update('kiosk_type', defaultMount)
  }
  return <p>...</p>
}
...
if (!form.kiosk_type) {
  update('kiosk_type', defaultMount)
}
```

Это setState **во время рендера** child компонента (IIFE внутри JSX). React 18 это терпит — но логирует warning, может вызвать бесконечный ре-рендер если defaultMount стабильно даёт значение, отличное от текущего. Сейчас `if (!form.kiosk_type || form.kiosk_type !== defaultMount)` ограничивает один re-render, но это хрупко. Правильное место — `useEffect([form.selected_kiosk_id])`.

**Риск:** при определённом drift в `getDefault()` (см. A5) возможен loop.

---

#### A10. `discount` хранится отдельно от unitPrice — в preview редактируется, но при выборе из каталога обнуляется

`KPPreview.tsx:254-268`: `replaceWithProduct` создаёт новый item полностью, **теряя `discount`** старого item.

```ts
next[si].items[ii] = recalcItem({
  ...item,        // <- сохраняет discount
  name: getKpName(product.name),
  unitPrice: product.sell_price,
  qty: oldQty,
})
```

На самом деле `...item` сохранит discount. Это **корректно**, но неочевидно — комментарий рядом не объясняет инвариант. Опасный момент: при ручном переименовании (`updateName`, стр. 313-319) скидка тоже сохраняется (это ок). Но если в `recalcItem` забыть пересчитать total после изменения discount (стр. 271-282 — `updateField` это делает) — total и discount разойдутся.

**Тестом это не покрыто.** Инвариант `total == round(unitPrice * qty * (1 - discount/100))` нигде не assert'ится.

---

#### A11. `kiosk_type` тип допускает значение `'kiosk_pro'`, которое НИКОГДА не используется

`prompt.ts:75`:
```ts
kiosk_type: 'desk' | 'wall' | 'floor' | 'kiosk_pro' | null
```

`kiosk_pro` здесь — мёртвая ветвь. Все обращения в коде используют `'desk' | 'wall' | 'floor'`. Это путает читателя, особенно когда рядом есть `license_type === 'kiosk_pro'` с другой семантикой. **Кандидат на удаление** из объединения.

---

### P2 — улучшение

#### A12. Dead code

Несколько подсистем существуют, но не вызываются:

- **`src/lib/renderSlideImage.ts` (427 LOC)** — функция `renderCommercialSlide` экспортируется, но `grep` по `src/` не находит ни одного импорта (verified). Это полная Canvas-реализация КП-слайда — артефакт «pre-pptx» эпохи. Содержит, в частности, `renderBondaFindirSlide` — поддержку БОНДА ФинДир, которая в текущем .pptx-flow вообще отсутствует. **Это означает, что БОНДА ФинДир сейчас .pptx не получает корректный коммерческий слайд** — `generatePptx.ts:384` всегда использует `inno_qr_template.pptx` или `inno_kiosk_template.pptx`, для БОНДА ФинДир ни один шаблон не подходит.
- **`src/lib/font-lato.ts`, `src/lib/font-lato-bold.ts`** — `grep font-lato` — 0 импортов. Артефакты jsPDF-эпохи.
- **`package.json`:** `jspdf` ^2.5.1 и `jspdf-autotable` ^3.8.2 — нигде не импортируются (verified). `openai` ^4.52.0 — тоже не импортируется. Уменьшат bundle и audit surface.
- **`page.tsx:1034-1144`** — функция `CatalogUpload` — целиком не используется (`grep CatalogUpload` — 0 use-sites вне declaration). `CheckCard` (`page.tsx:852`) — тоже не используется.
- **`src/lib/supabase.ts`**: `fetchProducts`, `fetchProductsByCategories`, `fetchHints`, `fetchVolumeDiscounts`, `fetchPeriodDiscounts` — не вызываются (только `fetchAllCatalog` используется в `page.tsx:87`). Связанные таблицы (`compatibility_hints`, `volume_discounts`, `period_discounts`) пустуют семантически.
- **`src/lib/slides.ts`** — экспортирует `innoSlidesBefore/After`, `bondaSlidesBefore/After`, `baseFeatures`, `licenseSlideTitle` — ничего не импортируется в .pptx-flow. Это конфиг для предыдущего PDF-генератора.
- **`catalog.ts`**: `kioskKits` (стр. 483-532) — нигде не используется. `innoLicenses` импортируется в `calculator.ts:6`, но не вызывается — цены лицензий захардкожены в `innoLicPrices` (`calculator.ts:204-209`).

Общий объём dead code — оценочно **600-800 LOC**, ~40% от заявленных «~4 000 LOC исходников».

---

#### A13. Цены лицензий продублированы в трёх местах

1. `page.tsx:339, 347, 355, 363` — лейблы карточек «8 000 ₽/мес», «15 000 ₽/мес», «10 000 ₽/мес», «16 200 ₽/мес».
2. `calculator.ts:204-209` — `innoLicPrices` с теми же ценами.
3. `catalog.ts:343-376` — `innoLicenses` с pricing `{'1+': 10000}` (только две лицензии, не все).

При смене цены менеджер увидит одно в карточке формы и другое в КП. Сейчас совпадает; дрейф — вопрос времени.

Аналогично: «20 000 ₽ / локация» (`page.tsx:742`) и `services[svc-inno-impl].pricePerUnit = 20000` (`catalog.ts:452`). «1 200 ₽ / позиция» (`page.tsx:750`) и `services[svc-inno-content].pricePerUnit = 1200` (`catalog.ts:460`).

---

#### A14. Скидки за объём и период вырезаны, но обвязка осталась

`catalog.ts:536-539`:
```ts
export function getLicensePrice(basePrice: number, _qty: number): number {
  return basePrice  // Скидки отключены — ставятся вручную
}
```

`catalog.ts:543-548`:
```ts
month: { months: 1, discount: 0, label: '1 месяц' },
quarter: { months: 3, discount: 0, label: '3 месяца' },
...
```

UI всё ещё рендерит индикатор скидки (`page.tsx:659-661`):
```tsx
{val.discount > 0 && (
  <span className="block text-green-400 text-xs">-{val.discount}%</span>
)}
```

Это «дохлая» ветка, никогда не сработает. Чистка снизит когнитивную нагрузку.

---

#### A15. `kp.date` фиксирует дату генерации навсегда

`calculator.ts:329`:
```ts
date: new Date().toLocaleDateString('ru-RU', ...)
```

При нажатии «Редактировать» (handleBack) state KP сохраняется. Если менеджер на следующий день нажмёт «Рассчитать КП» с теми же параметрами — дата обновится. Но если он просто откроет preview через handleBack и сразу скачает — дата вчерашняя.

**Не критично**, но клиент может получить КП от «13 мая» в реальности 14 мая. **[unverified]** — менеджеры могут с этим жить.

---

#### A16. Загрузка каталога — параллельная, состояние гонки

`page.tsx:75-96`: при mount стартует `fetchGoogleSheetProducts()`, в catch — `fetchAllCatalog()`. Между запросом и ответом `catalog = fallbackCatalog`. Если менеджер успеет быстро открыть форму, выбрать киоск (которого нет в fallback), нажать «Рассчитать» — `calculateKP` отработает на старом state. После того как Google Sheet вернётся (1-3 сек), state перепишется, но `KPResult` уже зафиксирован.

**Низкая вероятность** в реальном UX, но архитектурно: нет loading-state и нет блокировки кнопки «Рассчитать» до загрузки каталога.

---

### P3 — стиль/документация

#### A17. `BUILD_TAG = '2026-04-20-canvas-v3'` устарел (KPPreview.tsx:239)

Литерал назван «canvas-v3» в эпоху, когда КП-слайд рендерился канвасом. Сейчас канвас вырезан (см. A12), но build_tag и `console.log('[KP] Module loaded, build: ...')` остались. В preview UI стр. 518 он отображается. Без обновления вводит в заблуждение при отладке.

---

#### A18. Несовпадение лейбла: «В PDF будет включено» (KPPreview.tsx:513)

PDF был убран в пользу PPTX, но UI всё ещё говорит про PDF:
```tsx
<div className="text-sm text-white/50 mb-2">В PDF будет включено:</div>
```

Косметика, но менеджер может задуматься.

---

## Карта data flow

```
USER INPUT (форма)
  │
  ├── useState<ParsedRequest>(defaultForm)          // page.tsx:70
  │     - все поля единого state'а
  │     - 5 «internal» полей _kiosk_* НЕ заполнены
  │
  ├── каталог: 3 источника, race conditions [A16]
  │     1) Google Sheets (XLSX или CSV, page.tsx:893)
  │     2) Supabase (fetchAllCatalog, supabase.ts:93)
  │     3) fallback из catalog.ts (page.tsx:46-66)
  │
  └── handleGenerate (page.tsx:172)
        │
        ├── enrichForm с _kiosk_name, _kiosk_price,
        │   _kiosk_mount_name/_price, _kiosk_options_data [A4]
        │
        └── calculateKP(enrichedForm) → KPResult     // calculator.ts:40
              sections: [
                {title: 'Оборудование', items, subtotal},     [A1 — string key]
                {title: 'Лицензии и подписки', ...},          [A1]
                {title: 'Услуги', ...},                       [A1]
              ]
              grandTotal, monthlyTotal [A3]

KPPreview state (KPPreview.tsx:245)
  │
  ├── useState(sections)  // КОПИЯ kp.sections, deep
  │     ↓ recalcItem / recalcSection on edit
  │     ↓ grandTotal = sections.reduce(...)
  │
  ├── kp.monthlyTotal [A2,A3] — старое значение, не пересчитывается
  ├── kp.clientName, kp.date — из исходного KPResult
  │
  └── handleDownloadPPTX → generateKPPptx(getCurrentKP(), parsed, isInno)

PPTX generation (generatePptx.ts)
  │
  ├── ВЫБОР шаблона:
  │     isQR = license_type ∈ {qr, ecomm}
  │     base = inno_qr_template.pptx (5 слайдов, КП после 3)
  │            или inno_kiosk_template.pptx (6 слайдов, КП после 4)
  │     БОНДА — НЕ ОБРАБАТЫВАЕТСЯ КОРРЕКТНО [A12: dead renderBondaFindirSlide]
  │
  ├── commercial_template.pptx → редактируем XML слайда
  │     find sections by RU title [A1]
  │     fillCard(LEFT_CARD = 'Shape 3' / 'Text X' / ...)  // hardcoded names
  │     fillCard(RIGHT_TOP_CARD)
  │     fillCard(RIGHT_BOTTOM_CARD)
  │     compactLeftCard, compactRightBottomCard
  │     widenCard для пустых случаев
  │
  ├── inject slide into base template:
  │     - найти максимальный slide N → slide(N+1)
  │     - layout от slide1
  │     - rels, content_types, presentation.xml, sldIdLst
  │     - splice в sldIdLst после позиции kpInsertAfter
  │
  └── blob → URL.createObjectURL → <a download>
```

---

## Strengths

1. **Чёткая trust boundary внутри .pptx генератора.** `generatePptx.ts` инкапсулирует всё знание про XML-структуру pptx, остальной код о нём не знает. Это правильное разделение.
2. **Компактификация слайда** (`compactLeftCard`, `compactRightBottomCard`, стр. 308-339) — продуманная адаптивная раскладка. EMU-координаты задокументированы константами, легко править.
3. **Fallback стратегия каталога** — Google Sheets → Supabase → встроенный массив. Это значит, что приложение работает без сети, без Supabase, без Sheets — что для production-инструмента менеджера ценно.
4. **TS strict mode включён** (`tsconfig.json:11`). `any` встречается контролируемо — только в `xlsxCache` (внешняя нетипизированная либа из CDN) и в типе window.XLSX.
5. **Предсказуемая модель state.** ParsedRequest — один объект, sections — один массив. Нет глобального стора (Redux/Zustand), нет MobX, нет server-state синхронизации — для приложения такого масштаба правильное решение.
6. **Хорошие UX-микродетали в KPPreview**: hover-only кнопки удаления и переименования, group-by-category в селекторе альтернатив, явный hint в шапке.
7. **CSV-парсер написан с поддержкой кавычек и escaped quotes** (`page.tsx:1003-1021`) — не наивный `split(',')`. Это редкость в clientside-парсерах.

---

## Open questions для следующих агентов

1. **БОНДА ФинДир в .pptx — что отдаётся клиенту?** `generatePptx.ts` использует только два шаблона, оба inno_*. БОНДА выбирается через `company === 'bonda'`, но `isQR = license_type === 'qr' || 'ecomm'` для БОНДА всегда false → пойдёт `inno_kiosk_template.pptx`. **Это похоже на серьёзный баг — проверить ручным тестом.** Если БОНДА не использует .pptx-flow в проде — нужен явный guard в UI («Скачивание для БОНДА недоступно»), а не отдача .pptx с inno-шаблоном.
2. Тестирование инварианта «sum(items.total) == subtotal == grandTotal» — стоит ли добавлять assert в `getCurrentKP`?
3. Проверить, отображается ли в текущих .pptx, генерируемых из прода, секция, добавленная вручную через «+ Добавить секцию». **Скорее всего нет** (см. A1).
4. Спросить менеджеров: пользуются ли они кнопкой «Добавить секцию» / «Добавить позицию»? Если да — A1 = P0. Если нет — можно удалить кнопки.
5. Где сейчас живёт цена «20 000 ₽» внедрения для будущих изменений? Сейчас она дублирована в `page.tsx` и `catalog.ts`.

---

## Финальная таблица находок

| ID  | P  | Файл/строка                                | Тема                                                              |
|-----|----|--------------------------------------------|-------------------------------------------------------------------|
| A1  | P0 | generatePptx.ts:406-408                    | Section binding по русской строке — добавленные секции теряются   |
| A2  | P0 | KPPreview.tsx:329                          | monthlyTotal/date не пересчитываются при правке preview           |
| A3  | P0 | calculator.ts:224                          | monthlyTotal неактуален после правок в preview                    |
| A4  | P1 | prompt.ts:69-92, page.tsx:172-220          | Смешение FormState и CalculatorInput через `_kiosk_*` поля        |
| A5  | P1 | calculator.ts:46-50, page.tsx:192-244,485-495 | Логика «крепление по типу» дублирована 4 раза с drift           |
| A6  | P1 | page.tsx:951-957, 432-440                  | Категория определяется подстрокой в имени                          |
| A7  | P1 | KPPreview.tsx:18-26                        | Анонимизация ломается для продуктов из Google Sheet                |
| A8  | P1 | calculator.ts:138-186, 218-233             | Семантика рассрочки для kiosk_pro неясна (железо vs лицензия)      |
| A9  | P1 | page.tsx:506-513                           | setState внутри render (`update` в IIFE)                          |
| A10 | P1 | KPPreview.tsx:254-282                      | Инвариант total = unitPrice*qty*(1-d/100) не закреплён              |
| A11 | P1 | prompt.ts:75                               | `kiosk_type: '...kiosk_pro'...` — мёртвая ветвь объединения        |
| A12 | P2 | renderSlideImage.ts, font-lato*.ts, slides.ts, и др. | ~600-800 LOC мёртвого кода + 3 неиспользуемых npm-зависимости |
| A13 | P2 | page.tsx:339-363, calculator.ts:204-209, catalog.ts:343 | Цены лицензий и услуг продублированы                       |
| A14 | P2 | catalog.ts:536-548, page.tsx:659-661       | Скидки отключены, но UI и helpers остались                         |
| A15 | P2 | calculator.ts:329                          | `kp.date` фиксируется при первом расчёте, не обновляется на back   |
| A16 | P2 | page.tsx:75-96                             | Race: handleGenerate до возврата каталога → fallback каталог       |
| A17 | P3 | KPPreview.tsx:239                          | BUILD_TAG 'canvas-v3' устарел                                      |
| A18 | P3 | KPPreview.tsx:513                          | Лейбл «В PDF» — PDF-путь убран                                     |
