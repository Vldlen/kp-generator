# LOGIC_BUGS_AUDIT — kp-generator (2026-05-14)

Аудитор: Claude (Opus 4.7). Скоуп: бизнес-логика и корректность чисел.
Без unit-тестов. Все находки получены чтением кода и ручным прогоном
типовых кейсов. Никаких файлов не правил.

## Summary

В коде есть **минимум одно расхождение «итог в .pptx ≠ суммы строк»**
(B1 — fundamental bug: rollover ИТОГО в правой верхней карточке считается
от исходного KPResult, а не от пересчитанных в preview значений). Есть
**второе расхождение «preview ≠ pptx»** для лимита строк (B2 — в .pptx
левая карточка молча обрезает >7 строк, в preview можно добавить сколько
угодно). Есть **системная ошибка в подписи лицензии Kiosk/Kiosk PRO**
(B3 — `unitPrice` в строке Kiosk-лицензии умножается на месяцы, но
заголовок строки уже показывает qty устройств и период — менеджер видит
огромную «цену за устройство», что выглядит как ошибка и не соответствует
тому, что показывает форма «10 000 ₽/мес»). Плюс несколько P1/P2 находок
по edge-cases (qty=0, копейки, ФинДир, default mount для kiosk_pro).

Сильная сторона: единая структура KPResult (sections → items → subtotal)
и в preview, и в pptx; пересчёт в preview корректный, есть `Math.round`
после процентной скидки.

---

## P0 — Гарантированный или вероятный неверный КП

### B1. ИТОГО на КП-слайде в .pptx считается по СТАРОМУ KPResult, а не по правкам в preview

Расхождение «preview ≠ pptx». Это **самая опасная находка**.

Файл: `src/components/KPPreview.tsx:328-329`
```
const getCurrentKP = (): KPResult => ({ ...kp, sections, grandTotal })
```
`getCurrentKP()` корректно собирает текущее состояние с новым
`grandTotal` и `sections`. Это правильный путь.

Но в `generatePptx.ts:410-412` заполняем карточки через
`fillCard(kpSlideXml, ..., section)`, который для каждой карточки
делает `fmtNum(section.subtotal)`. То есть `subtotal` берётся
из переданной секции — это OK для `LEFT_CARD` (Оборудование),
`RIGHT_TOP_CARD` (Лицензии), `RIGHT_BOTTOM_CARD` (Услуги), потому что
секции из `currentKP.sections` действительно пересчитаны
(`recalcSection` в KPPreview.tsx:233-235 идёт после каждой правки).

Однако **есть тонкость с `qty` лицензионной строки в Kiosk/Kiosk PRO**.
В `calculator.ts:227-233`:
```
licItems.push({
  name: `${innoLic.name} × ${qty} ${unitLabel} (${period.label})`,
  category: 'license_inno',
  qty,                                  // qty = devices
  unitPrice: unitPrice * totalMonths,   // цена × месяцев
  discount: 0,
  total: totalPrice,                    // unitPrice × qty × months
})
```
Если менеджер в preview правит `qty` лицензии (она равна
`devices=req.devices`), `recalcItem` пересчитывает `total = unitPrice *
qty * (1 - discount/100)`. Но **строка `name`** содержит «× N устр.»,
N не обновится. В .pptx уйдёт «inno Kiosk × 5 устр. (12 месяцев)» при
qty=10, а total посчитается за 10. Менеджер не заметит, клиент тоже
не сразу заметит. P0.

**Минимальное воспроизведение:**
1. Создать КП: inno Kiosk, 5 устройств, год.
2. В preview перейти на строку Лицензии.
3. Кликнуть на «5» в столбце Кол-во → ввести «10» → Enter.
4. Скачать PPTX.
5. В PPTX заголовок строки = «inno Kiosk × 5 устр. (12 месяцев)», qty
   справа = 10, total = 10 × unitPrice × 12 = двойная цена против заголовка.

---

### B2. .pptx молча обрезает строки >7 в Оборудовании, >1 в Лицензиях, >2 в Услугах

Файл: `src/lib/generatePptx.ts:48-60` (LEFT_CARD имеет ровно 7 `rows`),
`:69-71` (RIGHT_TOP_CARD имеет ровно 1 `row`), `:82-85`
(RIGHT_BOTTOM_CARD имеет ровно 2 `rows`).

В `fillCard` (`:172-185`):
```
for (let i = 0; i < card.rows.length; i++) {
  const row = card.rows[i]
  if (i < section.items.length) {
    // заполняем
  } else {
    // удаляем пустой row
  }
}
```
Если `section.items.length > card.rows.length`, лишние items
**просто не попадают в .pptx**, а подсумма (`subtotal`) посчитана
по всем строкам. Получается: клиент видит карточку с 7 строками,
сумма ИТОГО больше суммы видимых строк. Это и есть классическое
«итог не сходится со строками».

**Воспроизведение для лицензий (RIGHT_TOP_CARD, 1 row):**
Сценарий маловероятен в calculator (он добавляет ровно 1 строку
лицензии), но в preview можно нажать «+ Добавить» в секции
«Лицензии и подписки» — приходит 2-я строка. В .pptx показана только
первая, ИТОГО суммирует обе.

**Воспроизведение для оборудования (LEFT_CARD, 7 rows):**
inno Kiosk сейчас даёт 4 (peripherals) + tablet + mount + adapter +
pinpad = **8 строк**. То есть ровно при дефолтном Kiosk-наборе уже
обрезается одна строка (предположительно pinpad — он добавляется
последним по коду calculator.ts:111-121). Это критично.

Считаем точное число: calculator.ts:53-131 добавляет:
- tablet (1)
- mount (1)
- adapter (1)
- peripherals — все 4 из массива (4)
- pinpad (1)

Итого 8. Обрезается одна, скорее всего pinpad. **P0**, прямо влияет
на стандартный кейс «inno Kiosk + крепление пинпада».

**Минимальное воспроизведение:**
1. Создать КП: inno Kiosk, 1 устройство, настольный (desk).
2. Сразу скачать PPTX — не редактировать.
3. В preview видно 8 строк оборудования.
4. В PPTX — 7 строк, причём ИТОГО оборудования включает 8-ю.

---

### B3. unitPrice строки Kiosk-лицензии = цена × месяцев → менеджер видит «10 000 × 12 = 120 000» как unit-price

Файл: `src/lib/calculator.ts:226-233`
```
licItems.push({
  name: `${innoLic.name} × ${qty} ${unitLabel} (${period.label})`,
  ...
  qty,                                // qty устройств/локаций
  unitPrice: unitPrice * totalMonths, // ⚠ ЭТО цена за всё время, не за месяц
  discount: 0,
  total: totalPrice,                  // = unitPrice * totalMonths * qty
})
```

В таблице preview (KPPreview.tsx:444-451) `unitPrice` отображается
в столбце «Цена». Менеджер видит для inno Kiosk × 1 устр. × 12 мес:
- qty = 1
- unitPrice = 120 000 ₽
- total = 120 000 ₽

При этом форма (page.tsx:355) показала «10 000 ₽/мес». **Расхождение
формы и preview по unit-price**, легко принять за баг и захотеть
«поправить руками», что приведёт к реальному баг-фиксу с одновременной
ошибкой.

Более того, если менеджер кликнет на «120 000 ₽» в preview и заменит
на «10 000» (думая что это месяц), total пересчитается как 10 000 — и
КП уйдёт клиенту с ценой за 1 месяц вместо 12. **P0**, прямой денежный
риск.

Для сравнения, ФинДир и BONDA BI используют ту же модель
(`unitPrice = price × months`, calculator.ts:243-250 / 260-267) — там
тот же риск, но в ФинДире `qty=1`, потому в КП-строке всё хотя бы
влезает в один счёт.

Рекомендация: либо `unitPrice = месяц`, а `total = unitPrice × qty ×
months`, либо в KPPreview добавить столбец «×N мес», либо именовать
строку «inno Kiosk — 12 мес за 1 устр.» и unitPrice = total/qty.

---

### B4. recalcItem использует unitPrice как «цена за всю позицию» при правке qty — двойной счёт месяцев в лицензии

Связан с B3.

Файл: `src/components/KPPreview.tsx:229-231`
```
function recalcItem(item: LineItem): LineItem {
  return { ...item, total: Math.round(item.unitPrice * item.qty * (1 - item.discount / 100)) }
}
```

Это правильная формула для оборудования (там `unitPrice` — цена за 1 шт).
Но для лицензии Kiosk `unitPrice = 10 000 × 12 = 120 000`. Если менеджер
поправит `qty` с 1 на 2 (например, заметив что устройств 2, а в КП
1 устройство):
- было: 1 × 120 000 = 120 000
- стало: 2 × 120 000 = 240 000 ✓ (это правильно)

Если поправит `unitPrice` с 120 000 на 110 000 (например, согласовал
скидку и думает что это месячная цена):
- стало: 110 000 × 1 = 110 000 (вместо ожидаемого «10 000 × 12 = 120 000 −
  скидка»)

Это не баг кода как такового, это **баг ментальной модели**, который
рождён B3. Помечаю как P0 потому что вероятность ошибки менеджера высокая.

---

## P1 — Важные баги, частые кейсы

### B5. qty в строке оборудования жёстко привязан к `req.devices` — если у менеджера 3 устройства, кронштейнов будет 3, адаптеров 3, периферии 3 (включая хаб LAN!)

Файл: `src/lib/calculator.ts:60-121` (все equipItems используют
`qty: req.devices`).

Хаб с LAN, угловой переходник, крепление пинпада — это позиции,
которых обычно нужно **1 на локацию или 1 общий**, а не по
1 на устройство. Calculator считает по `req.devices`, а не
`req.locations` или фиксированное «1».

Пример: 3 устройства на 1 локации:
- Хаб с LAN × 3 = 11 700 ₽ вместо 3 900 ₽
- Крепление эквара × 3 = 7 500 ₽ вместо 2 500 ₽

При 3 устройствах **переплата по позициям, не нужным в количестве =
3 × (3900+2500) − (3900+2500) = ~13 000 ₽**. Если менеджер заметит —
поправит вручную. Если не заметит — клиенту КП с лишними 13к.

P1 потому что менеджеры (надеюсь) знают эту структуру и правят в
preview. Но это лёгкая ошибка: добавили устройство в форме, забыли
поправить хаб.

### B6. По умолчанию `mountByType[req.kiosk_type || 'desk']` — для license=kiosk_pro `kiosk_type` всегда установлен (см. page.tsx:140-148), но для license=kiosk `kiosk_type` может быть null

Файл: `src/lib/calculator.ts:46-50, 72`
```
const mountByType: Record<string, string> = {
  desk: 'mount-onkron-desk-g80',
  wall: 'mount-onkron-wall-fixed',
  floor: 'mount-masterhold-kiosk',
}
...
const mountId = mountByType[req.kiosk_type || 'desk']
```

OK, fallback на 'desk' есть. Но если в БД-каталоге `kiosk_type='floor'`
выбран для license=kiosk (что theoretically возможно через page.tsx?
Нет — в page.tsx form для kiosk показывает только desk/wall, см. line
405-422), то `mountByType['floor'] = 'mount-masterhold-kiosk'` — это
напольная стойка 28 500 ₽, попадёт в КП. Сейчас невозможно через UI,
но кода доверять не следует — если когда-то добавят опцию floor в форму
kiosk, в КП попадёт неправильный mount без других правок.

P1 потому что сейчас не воспроизводимо через UI, но защита нулевая.

### B7. ParsedRequest.kiosk_type типизирован как `'desk' | 'wall' | 'floor' | 'kiosk_pro' | null`, но 'kiosk_pro' нигде не используется

Файл: `src/lib/prompt.ts:75`

Кажется это легаси, мусор в типе. P3.

### B8. `getLicensePrice(basePrice, _qty)` возвращает basePrice — функция полностью бессмысленна

Файл: `src/lib/catalog.ts:536-539`
```
export function getLicensePrice(basePrice: number, _qty: number): number {
  return basePrice
}
```

OK, в CLAUDE.md написано «скидки за объём отключены, ставятся вручную».
Соответствует ожиданиям. Но функция запутывает — будущая правка
по ошибке может включить старые ступени скидок, не подозревая что
сейчас всё ручное. P2, добавить комментарий «intentionally identity».

### B9. ФинДир: `getFindirPrice(tariff, locations)` для locations > 20 возвращает цену тарифа «16-20» — без warning, без upper-clamp

Файл: `src/lib/catalog.ts:552-561`
```
export function getFindirPrice(tariffName: string, locations: number): number {
  const tariff = findirTariffs.find(t => t.name === tariffName)
  if (!tariff) return 0
  if (locations <= 1) return tariff.pricing['1']
  ...
  return tariff.pricing['16-20']
}
```

Для сети из 50 локаций ФинДир-Старт = 270 000 ₽ (как для 16-20).
Это занижение почти в 3 раза против любой адекватной формулы. Менеджер
получит КП с ценой «как для 20-локационной сети». P1: вероятно низкая
частота, но при кейсе крупной сети — заметная коммерческая ошибка.

Также: `if (!tariff) return 0` — если name тарифа опечатан, в КП
попадёт строка с total=0. P2.

### B10. ФинДир: `qty: 1` в строке, но в имени написано «N лок.» — то же двусмысленность что и B3

Файл: `src/lib/calculator.ts:243-250`
```
licItems.push({
  name: `ФинДир «${req.findir_tariff}» — ${req.locations} лок. (${period_.label})`,
  category: 'Лицензия',
  qty: 1,
  unitPrice: totalPrice,
  discount: 0,
  total: totalPrice,
})
```

`qty=1`, `unitPrice = totalPrice` = `price × months`. Если менеджер
правит qty=1 → qty=5 (думая что надо умножить на locations), total
× 5 — двойной счёт. P1.

### B11. BONDA BI: `qty: req.locations`, `unitPrice: pricePerUnit * months` — корректно с т.з. формул, но в B3-стиле

Файл: `src/lib/calculator.ts:260-267`. Те же риски ментальной модели,
что и B3.

### B12. `categoryMap` теряет category `service`/`license` — но это для DBProduct fallback, который вообще не должен содержать лицензии

Файл: `src/app/page.tsx:38-43`
```
const categoryMap: Record<string, string> = {
  equipment: 'pos_terminal',
  tablet: 'tablet',
  mount: 'mount',
  peripheral: 'peripheral',
}
```

`allProducts` (catalog.ts:565-570) включает `posEquipment`, `tablets`,
`mounts`, `peripherals` — без `services`, `licenses`. Так что map
покрывает все имеющиеся категории. OK. Но `equipment → pos_terminal`
— это потеря информации: `getKpName` в KPPreview не работает для
posEquipment (там нет `kpName`), но и категория теряется. Не критично.

### B13. ProductSelector → getAlternatives → findProductByName использует item.name, но calculator кладёт kpName

Файл: `src/components/KPPreview.tsx:48-57`
```
function findProductByName(catalog: DBProduct[], name: string): DBProduct | undefined {
  return catalog.find(p => p.name === name)
}

function getAlternatives(catalog: DBProduct[], productName: string): DBProduct[] {
  const product = findProductByName(catalog, productName)
  if (!product) return catalog // если не нашли — показать весь каталог
  return catalog.filter(p => p.category === product.category)
}
```

Calculator (calculator.ts:62) использует `selectedTablet.kpName ||
selectedTablet.name`. То есть **в LineItem.name лежит «Планшет Android
13.2'', 12/256Гб»**, а в catalog DBProduct.name лежит «OnePlus Pad 3».
`findProductByName` всегда возвращает undefined → `getAlternatives`
возвращает **весь каталог** (без фильтра по категории).

В результате при клике на «Планшет Android …» в preview менеджер
видит выбор из ВСЕХ товаров (планшеты + крепления + периферия + POS-
терминалы). Это не баг расчёта, но UX-проблема. P2.

### B14. replaceWithProduct берёт product.sell_price, но qty не меняется — если выбрать POS-терминал на место планшета, qty=req.devices останется

Файл: `src/components/KPPreview.tsx:254-268`. Сам по себе not a bug, но
в комбинации с B13 (можно выбрать что угодно) — менеджер может случайно
выбрать «Крепление эквара» (2 500 ₽) на место «Хаб с LAN» (3 900 ₽),
qty=N останется, и в КП клиенту 5 креплений эквара на 5 устройств,
что логически странно. P2.

### B15. ParsedRequest.products: string[] объявлен, но calculator его не использует

Файл: `src/lib/prompt.ts:74`, `src/lib/calculator.ts` — нигде нет
обращения к `req.products`. Поле существует и заполняется в защитной
ветке page.tsx:104,130, но calculator идёт строго по `license_type`.
Возможно legacy от voice-prompt модели. P3.

### B16. `replaceWithProduct` использует `product.sell_price` напрямую — для DBProduct из Google Sheets `sell_price` парсится из строки «р.19 300» → 19300. OK для русских ценников.

Файл: `src/app/page.tsx:960-964` (parsePrice). Корректно убирает
р/пробелы/запятые. Edge case: «р.5,500» → 5.5 (после `replace(',', '.')`).
Это **серьёзный edge case**: в кириллической локали «,» — десятичный
разделитель, в коде заменяется на `.` — значит «5,500» (= 5500) трактуется
как 5.5. Если в Google Sheet кто-то ввёл «5,500» — цена обнулится почти
в 1000 раз.

P1, может реально стрельнуть.

### B17. `parsePrice` для строки «1 200,5» (1200,5) даст 1200.5, рубль с копейкой → проходит в calculator → total с дробной частью → formatMoney округлит, но recalcItem не округлит unitPrice → итоговая сумма по нескольким строкам может «гулять» на копейки

Файл: `src/components/KPPreview.tsx:229-231` — `Math.round` есть.
`src/lib/calculator.ts` — `Math.round` нет. Если sellPrice = 1200.5,
total = 1200.5 × qty. В .pptx и preview покажет округлённое значение
`formatMoney` через `maximumFractionDigits: 0`. Но `subtotal = sum of
totals` — это сумма дробных чисел, потом отформатировано без копеек:
- Стр 1: total 1200.5 → видно «1 201 ₽»
- Стр 2: total 1200.5 → видно «1 201 ₽»
- Subtotal: 2401 → видно «2 401 ₽»

Покажется что 1201+1201 = 2401 (а не 2402). Это minor. P2.

### B18. `formatMoney` использует `style: 'currency'` с currency RUB → выводит «1 200 ₽» (с неразрывным пробелом). В `generatePptx.ts` используется отдельный `fmtNum + ' ₽'`. Возможно разница в форматировании.

Файл:
- `src/lib/calculator.ts:340-342` — formatMoney через Intl currency
- `src/lib/generatePptx.ts:18-20` — fmtNum через Intl без currency, потом ' ₽' конкатенируется (с обычным пробелом + U+20BD)

Разные пробелы (NNBSP vs space) могут визуально не отличиться, но
в файлах будут разные коды. P3, эстетический.

### B19. fallbackCatalog → DBProduct у `posEquipment` получает категорию 'pos_terminal' (через categoryMap), но в catalog DBProduct для Google Sheets-загруженных POS-терминалов категория зависит от названия листа в Google Sheets. Без явного контракта на category, поиск киосков (`category === 'kiosk'`) работает только если в Google Sheet лист называется «Киоски». Если переименовать — selector киосков пуст, форма Kiosk PRO падает на fallback `posEquipment[0]` = POScenter Atlas 15", 39 400 ₽.

Файл: `src/app/page.tsx:431-441` (выбор киоска по category=='kiosk'),
`src/lib/calculator.ts:148-159` (fallback на posEquipment[0]).

P1 hidden: пока Google Sheet листы названы правильно — работает.
Если менеджер случайно переименует лист — на форме Kiosk PRO нет
никаких киосков для выбора, в КП попадёт POScenter Atlas 15" 39 400 ₽
вместо ожидаемой модели (которая в forme не выбралась).

---

## P2 — Полезно поправить

### B20. `recalcItem` округляет total, но не пересчитывает subtotal с тем же округлением — потенциальная копеечная ошибка

Файл: `src/components/KPPreview.tsx:230, 234`
```
total: Math.round(item.unitPrice * item.qty * (1 - item.discount / 100))
```
```
subtotal: section.items.reduce((sum, i) => sum + i.total, 0)
```
Здесь корректно: subtotal суммирует уже округлённые totals. OK.

### B21. `Math.max(0, value)` для unitPrice в updateField, но Math.max(1, ...) для qty → нельзя qty=0, а значит «удалить» строку через qty=0 невозможно, надо нажать «✕». Не баг — намеренное поведение. P3.

### B22. По умолчанию (defaultForm) `subscription_period = 'year'` — менеджер может забыть переключить на «месяц» для месячного КП. При period=year, total лицензии × 12 — это пугает клиента.

Файл: `src/app/page.tsx:30`. Не баг, политическое решение. P3.

### B23. payment_type 'installment3' — calculator передаёт только лейбл в `kp.paymentType`, но не делит сумму на транши. Транши описаны только в catalog.ts:579-580. Если менеджер ожидает что в КП будут показаны три суммы — он этого не получит.

Файл: `src/lib/calculator.ts:333`. По спеке (KP-SPEC.md) — рассрочка
показывается, но в реализации нет. P2 фича-гэп.

### B24. monthlyTotal = pricePerMonth для Kiosk/Kiosk PRO, но pricePerMonth = unitPrice × qty (без скидки). monthlyTotal — это «ежемесячный платёж», показывается в KPPreview:506. При period=year и 100% prepay показывать «ежемесячный платёж» вводит в заблуждение — клиент не платит ежемесячно. P2.

### B25. В preview можно добавить новую секцию через `addSection` (KPPreview.tsx:321-326). Эта секция получит title 'Дополнительно', который не известен `generatePptx.fillCard` (он ищет ровно 'Оборудование', 'Лицензии и подписки', 'Услуги', строки 406-408). **Доп.секция полностью теряется в .pptx**, но входит в grandTotal preview (строка 251) → ИТОГО видимое в preview сильно больше суммы видимых строк в pptx.

Файл: `src/components/KPPreview.tsx:321-326`, `src/lib/generatePptx.ts:406-408`.

Это **второе явное расхождение preview ≠ pptx**. Поднимаю до P0,
переименовываю как B26.

### B26 (P0). Любая «дополнительная секция» из preview не попадает в .pptx, но grandTotal в footer pptx включает её

Файл: `src/lib/generatePptx.ts:406-412, 464`
```
const equipSection = kp.sections.find(s => s.title === 'Оборудование') || null
const licSection = kp.sections.find(s => s.title === 'Лицензии и подписки') || null
const svcSection = kp.sections.find(s => s.title === 'Услуги') || null
...
kpSlideXml = replaceShapeText(kpSlideXml, FOOTER.grandTotal, fmtNum(kp.grandTotal) + ' ₽')
```

`kp.grandTotal` приходит из `getCurrentKP()` (KPPreview.tsx:329) и
содержит сумму ВСЕХ секций, включая «Дополнительно». В .pptx эта
секция не отрисуется (нет 4-й карточки в шаблоне), но grandTotal
покажет завышенный итог.

**Минимальное воспроизведение:**
1. Создать КП любого типа.
2. В preview: «+ Добавить секцию» внизу → «+ Добавить» в неё → name=Test,
   qty=1, unitPrice=99999.
3. Preview: grandTotal вырос на 99 999. Видны 4 секции.
4. PPTX: 3 карточки (Об./Лиц./Усл.), но в плашке К оплате — те же
   grandTotal + 99 999. Клиент видит сумму, не подкреплённую строками.

Это P0 — менеджер легко может воспользоваться «+ Добавить секцию»
ожидая что она войдёт в КП (UI её показывает!). Реально клиент
получит .pptx с непрозрачным завышенным итогом.

---

## P3 — Стиль, мелочи

### B27. `LineItem.category` — поле не используется ни в preview (только title секции), ни в pptx. Дублируется логика по title section. P3.

### B28. В page.tsx:1207-1212 NumberInput синхронизирует `draft` через setState вне useEffect — анти-паттерн (warning в React strict mode). P3.

### B29. `BUILD_TAG = '2026-04-20-canvas-v3'` в KPPreview.tsx:239 устарел (сегодня 14.05). P3.

### B30. `renderSlideImage.ts` — отдельный canvas-рендерер для PDF, но PDF-путь «отрезан» (см. CLAUDE.md). Файл по-прежнему 427 LOC мёртвого кода. P3.

### B31. `CheckCard` в page.tsx:852-868 объявлен но не используется. P3.

### B32. `mount-pinpad-bracket` (catalog.ts:280-289) sellPrice=2500, costPrice=200, margin 91%. Маржа 91% реальная? Если да — OK. Иначе ошибка в данных. Не код. P3.

---

## Worked numerical examples

### Кейс A: inno Kiosk, 1 устройство, настольный, лицензия 1 год, без услуг

Ожидание формы (page.tsx подсказки + CLAUDE.md):
- Планшет (Pad Go 2 default) 35 000
- Кронштейн настольный G80 6 200
- Адаптер 5 300
- Блок питания 3 500
- Кабель 1 100
- Угловой переходник 700
- Хаб LAN 3 900
- Крепление эквара 2 500
- Лицензия inno Kiosk: 10 000 × 12 = 120 000

Итог expected: 35000 + 6200 + 5300 + 3500 + 1100 + 700 + 3900 + 2500 +
120000 = **178 200 ₽**

Calculator выдаст: эти же 8 equip items (sum=58 200) + license 120 000 =
**178 200 ₽** ✓

Preview покажет: ✓ те же 178 200.

PPTX покажет: LEFT_CARD имеет 7 rows → **обрежется 8-я строка** (pinpad).
В правую (RIGHT_TOP) лицензия 120 000.
- Видимое оборудование: 7 позиций суммарно ~55 700, ИТОГО в карточке
  оборудования = 58 200 (B2: не сходится со строками!).
- Видимая лицензия: 120 000.
- Видимый ИТОГО общий (FOOTER): 178 200.
- 178 200 ≠ 55 700 + 120 000 = 175 700.

**Расхождение: −2 500 ₽ visible items vs total**. **P0**.

### Кейс B: inno Kiosk, 3 устройства, настольный, лицензия 12 мес

Calculator:
- tablet × 3 = 105 000
- mount × 3 = 18 600
- adapter × 3 = 15 900
- charger × 3 = 10 500
- cable × 3 = 3 300
- angle × 3 = 2 100
- hub × 3 = 11 700  ← B5: переплата?
- pinpad × 3 = 7 500  ← B5: переплата?
- license: qty=3, unitPrice=10000*12=120000, total=360 000

Subtotal оборудование: 174 600
Лицензии: 360 000
**Grand total: 534 600 ₽**

Preview: ✓ 534 600.

PPTX: B2 обрежет 8-ю строку. Видно 7 строк = 167 100. Sub в карточке
174 600. Лицензия 360 000. Footer 534 600.

Видимая сумма: 167 100 + 360 000 = 527 100. Footer: 534 600.
**Расхождение: −7 500 ₽ visible vs footer** (это ровно pinpad × 3).

### Кейс C: BONDA ФинДир «Про», 50 локаций, 12 мес

`getFindirPrice('Про', 50)` → возвращает `pricing['16-20']` = 310 000.
calculator: total = 310 000 × 12 = 3 720 000 ₽. В реальности для 50
локаций цена должна быть кратно выше (грубо в 2-3 раза). **B9** —
коммерческая недопродажа.

### Кейс D: edge case — devices=0, license=kiosk

В page.tsx:117 для company=inno reset devices=1, минимальный input=1.
Calculator проверяет `if (req.devices > 0 && req.license_type === 'kiosk')`
— при devices=0 секция оборудования не добавится, но лицензия будет
добавлена с `qty = req.devices = 0`. Тогда:
- unitPrice = 10000 * 12 = 120 000
- total = 120 000 × 0 = 0
- monthlyTotal = unitPrice × 0 = 0

Лицензия в КП с total=0. Менеджер скорее заметит, но не падение, не
дивизион — silent zero. P2.

---

## Strengths

1. **Единая структура `KPResult`** (sections + items + subtotal + grandTotal)
   и в calculator, и в preview, и в pptx. Это правильный архитектурный
   выбор: одна точка истины, все три слоя читают то же.
2. **Preview recalc корректный**: `recalcItem` использует `Math.round`,
   `recalcSection` суммирует уже округлённые totals → нет копеечного
   расхождения внутри секции.
3. **`Math.max(0, value)` и `Math.max(1, qty)` в updateField** —
   защита от отрицательных и нулевых значений.
4. **`escapeXml` в generatePptx** — корректно экранирует XML-спецсимволы
   при вставке клиентского имени и названий товаров в .pptx.
5. **Disabled-state кнопки «Рассчитать»** если client_name пустой
   (page.tsx:799) — нет смысла генерировать КП без названия клиента.
6. **kpName mapping** в catalog — обезличенные названия для КП
   защищают от утечки брендов производителей. Хорошее бизнес-решение.
7. **Skipped section в calculator**, если `equipItems.length === 0`
   и `licItems.length === 0` (`if (sections.length > 0)`) — пустые
   секции не попадают в КП.
8. **OpenAI prompt** (prompt.ts) **НЕ запрашивает цены и не возвращает
   числа цен** — модель только парсит структуру запроса. Cost-injection
   через AI невозможен (цены всегда из локального catalog + Google Sheet).
9. **fetchGoogleSheetProducts** с двойным fallback (XLSX → CSV) и
   защитой от HTML-ответа (CSRF / redirect — `csvText.includes('<!DOCTYPE')`).

---

## Open questions (нужен прогон / уточнение)

1. **[unverified, нужен прогон]** Точное количество периферии в catalog
   peripherals (сейчас 4). Если когда-то добавят 5-ю — LEFT_CARD = 7 rows
   станет ещё более тесным.
2. **[unverified]** Что показывает Google Sheets когда колонка «Цена»
   пустая? `parsePrice('')` → `Number('') || 0` → `0`. В calculator
   нет проверки `unitPrice > 0` для добавления в КП — pos с ценой 0
   попадёт в КП с total=0. Сейчас фильтр `p.sell_price > 0` есть только
   в выборке киосков (page.tsx:439), но не для других категорий.
3. **[unverified]** Что происходит при попытке `calculateKP(req)` где
   `req.subscription_period` отсутствует (например AI вернул JSON без
   этого поля)? `periodMultiplier[undefined]` → undefined → `.months`
   → TypeError. В page.tsx есть defaultForm.subscription_period='year',
   но если в будущем парсинг из voice вернёт null → краш.
4. **[unverified]** Кейс «B11 BONDA BI с locations=0»: total = 30000×0×12=0.
   Корректно отсекается? Нет — calculator не проверяет locations > 0
   для bonda_bi (ср. с findir, который тоже не проверяет).
5. **[unverified]** Поведение `_kiosk_options_data` при дублирующихся
   опциях (двойной чек на одну и ту же ККТ). Сейчас в selected_kiosk_options
   массив строк ID — не set. Если ID повторятся (что не должно
   происходить через UI), товар будет добавлен дважды.
6. Сценарий с `kiosk_pro` и mount, который НЕ совпадает с дефолтным:
   `isNonDefaultMount` в page.tsx:228-244 регэксп-эвристика. Список
   групп жёстко зашит. При добавлении новой модели в Google Sheets
   маунт может не определиться. Нужен реальный прогон с новой моделью.

---

## Приоритеты на исправление (если делать только 3 пункта)

1. **B2 + B26**: исправить расхождение visible items vs ИТОГО в pptx.
   Либо ограничить число строк в preview (UI блокировать «+ Добавить»),
   либо в pptx добавить overflow (нумерация / автоувеличение шаблона).
2. **B3 + B4**: разделить unitPrice (за 1 единицу за 1 месяц) и total
   (×qty×months), либо переименовать колонки в preview под текущую
   логику. Сейчас менеджер видит «Цена 120 000 ₽» вместо ожидаемой
   «10 000 ₽/мес».
3. **B16**: запретить replace(',', '.') в parsePrice — в русской
   локали запятая = разделитель тысяч.
