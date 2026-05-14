# AUDIT_FULL_2026_05_14 — Глобальный аудит kp-generator

**Дата:** 2026-05-14
**Метод:** 4 параллельных subagent'а (Architecture, Logic/Bugs, UX/Workflow, Security/Perf/Build) + ручная верификация critical findings.
**Скоуп:** боевой `kp-generator/` (~4 000 LOC исходников, без тестов), коммит `3cdac51` от 06.05.2026.
**Цель:** найти баги/риски в инструменте генерации КП до того, как они дойдут до клиентов; проверить, ловит ли методология аудита тот же класс багов, что менеджеры замечают вручную.

Полные подотчёты по веткам — рядом в `docs/audits/`:

- `ARCHITECTURE_AUDIT_2026-05-14.md` (A1–A18)
- `LOGIC_BUGS_AUDIT_2026-05-14.md` (B1–B32)
- `UX_WORKFLOW_AUDIT_2026-05-14.md` (C1–C34)
- `SECURITY_PERF_BUILD_AUDIT_2026-05-14.md` (D1–D21)

---

## Executive summary

Архитектурно проект простой: один клиентский SPA на Next.js без API routes, без аутентификации, без тестов. Менеджер заполняет форму → калькулятор строит `KPResult` → `KPPreview` показывает и даёт редактировать → `generatePptx` берёт `KPResult` и встраивает данные в готовый XML-шаблон `.pptx`.

Главная системная боль — **три параллельных представления одних и тех же данных** (форма / KPResult / DOM preview / XML ячейки .pptx), а переход между слоями держится на match по русским строкам и захардкоженных лимитах. Это создаёт целый класс P0-багов вида «preview показывает X, клиент получает Y» — и один из них прямо сейчас в проде.

**Найдено: 11 P0, 23 P1, 18 P2, 9 P3.** После дедупликации (одно и то же ловили несколько агентов) — **~52 уникальных находки**.

**Производственный статус сегодня:** 🔴 **в проде минимум один баг, при котором клиент уже получает КП, где сумма строк ≠ итогу.** Менеджеры это заметили (B2 = манагерский тикет о пропавшем «Креплении для терминала оплаты»), но он живёт в проде с момента, когда дефолтный набор оборудования вырос до 8 позиций (после добавления крепления пинпада).

**После закрытия P0-блока (C1+C2+B1+B3+D1+D2 — оценка ~1-2 рабочих дня) — сервис снова можно считать production-ready без оговорок.**

---

## Методологическая проверка (отдельно — это часть запроса)

Перед запуском агентам было умышленно НЕ сказано про реальную манагерскую жалобу: «в превью видно 8 позиций оборудования и итог 88 200 ₽, в финальном слайде только 7 позиций (нет «Крепление для терминала оплаты» 2 500 ₽), но итог тот же 88 200 ₽».

Результат: баг словили **два независимых агента из четырёх**, плюс ещё один зашёл с боку через близкий класс:

- **B (Logic/Bugs) — B2:** точный диагноз. «`LEFT_CARD` в `generatePptx.ts:48-60` имеет ровно 7 `rows`-слотов. Калькулятор для inno Kiosk выдаёт 8 позиций (tablet + mount + adapter + 4 peripherals + pinpad). 8-я строка (pinpad = крепление пинпада = крепление для терминала оплаты, 2 500 ₽) молча обрезается; subtotal посчитан по 8, FOOTER.grandTotal — по 8. **−2 500 ₽ visible items vs total.**» Включил воспроизводимый numerical example.
- **C (UX) — C1:** ту же находку описал с менеджерской стороны: «жёсткие потолки 7/1/2 строки шаблона невидимы менеджеру, в preview можно добавить безлимитно, в .pptx обрежется».
- **A (Architecture) — A1:** зашёл по соседству — указал на section binding по русской строке. Это другой класс того же бага (полная секция теряется через `addSection`), но непосредственно лимит строк не отметил.
- **D (Security/Build):** не подошёл к этой ветке — закономерно, у него другой scope.

Вывод: **методология ловит этот класс багов**, даже когда агент не знает, что искать. Слабое место — архитектурный agent (A) видит структурную причину (одна точка истины — русский string), но не делает численного прогона типового кейса. Если в следующий раз хочется надёжнее ловить «overflow templates / clipping» — стоит в брифинг архитектурного агента добавить пункт «выполни в уме типовой кейс и сравни видимое vs скрытое».

Бонусом методология нашла **второй такого же класса P0-баг**, который менеджеры ещё не замечают: B26/A1/C2 — добавление новой секции через «+ Добавить секцию» в preview даёт секцию с title='Дополнительно', которой в `generatePptx.ts:406-408` нет в списке известных заголовков → секция не рендерится в .pptx, но входит в `kp.grandTotal` → footer КП показывает завышенный итог.

---

## VERIFIED CRITICAL findings (must fix — пользователь уже страдает или вот-вот)

### 🔴 P0-1. .pptx молча обрезает позиции оборудования сверх 7-й → итог не сходится со строками

(Это та самая жалоба от менеджеров про «Крепление для терминала оплаты».)

- **Файлы:** `src/lib/generatePptx.ts:48-60` (LEFT_CARD имеет ровно 7 rows), `:172-185` (fillCard цикл).
- **Цитата:**
  ```ts
  for (let i = 0; i < card.rows.length; i++) {
    const row = card.rows[i]
    if (i < section.items.length) {
      // заполняем
    } else {
      // удаляем пустой row
    }
  }
  ```
  При `section.items.length > card.rows.length` цикл просто не дойдёт до лишних items.

- **Что менеджер видит в форме:** 8 строк, ИТОГО 88 200 ₽.
- **Что клиент получает в .pptx:** 7 строк (без 8-й = крепление пинпада 2 500 ₽), карточка «Оборудование» с подытогом 88 200 ₽, FOOTER 88 200 ₽. То есть **сумма видимых строк = 85 700 ₽, а подытог карточки = 88 200 ₽**.

- **Воспроизведение:**
  1. inno Kiosk, 1 устройство, настольный (desk), любая лицензия.
  2. Сразу скачать .pptx (без правок в preview).
  3. В preview видно 8 строк. В .pptx — 7. Подытог карточки расходится.

- **Аналогичная проблема для других карточек:**
  - RIGHT_TOP_CARD (`Лицензии и подписки`) — **1 row**. Если в preview добавить вторую лицензию (`+ Добавить`) — потеряется.
  - RIGHT_BOTTOM_CARD (`Услуги`) — **2 rows**. Добавить третью услугу — потеряется.

- **Fix-варианты:**
  - быстрый: ограничить «+ Добавить» в preview до `LEFT_CARD.rows.length` (надо тащить лимиты из generatePptx в KPPreview как const);
  - правильный: динамически генерировать строки в карточке .pptx через клонирование row-шаблона (это структурно более сложная правка XML);
  - временный watchdog: при выгрузке считать `section.items.length > rows.length` и показывать blocking-confirm менеджеру.

---

### 🔴 P0-2. «+ Добавить секцию» в preview полностью теряется в .pptx, но входит в grandTotal

- **Файлы:** `src/components/KPPreview.tsx:321-326` (`addSection` создаёт секцию с title='Дополнительно'), `src/lib/generatePptx.ts:406-408` (find по трём фиксированным заголовкам).
- **Цитата:**
  ```ts
  // generatePptx.ts:406-408
  const equipSection = kp.sections.find(s => s.title === 'Оборудование') || null
  const licSection   = kp.sections.find(s => s.title === 'Лицензии и подписки') || null
  const svcSection   = kp.sections.find(s => s.title === 'Услуги') || null
  ```
  Секции с title='Дополнительно' нет в этом списке → секция не отрисуется, но `kp.grandTotal` (KPPreview.tsx:251) её включает → `FOOTER.grandTotal` (generatePptx.ts:464) тоже включает.

- **Воспроизведение:**
  1. Создать КП любого типа.
  2. В preview: «+ Добавить секцию» → внутри «+ Добавить» → name=Test, qty=1, unitPrice=99 999.
  3. Скачать .pptx. Клиент видит 3 карточки на 200 000 ₽, FOOTER «К оплате 299 999 ₽».

- **Fix:** либо рендерить 4-ю карточку, либо запрещать «+ Добавить секцию» в UI вообще (если она по бизнесу не нужна), либо при выгрузке предупреждать менеджера.

---

### 🔴 P0-3. unitPrice лицензии Kiosk/Kiosk PRO = «цена × месяцев» → менеджер видит 120 000 ₽ за устройство и хочет «исправить»

- **Файлы:** `src/lib/calculator.ts:226-233`.
- **Цитата:**
  ```ts
  licItems.push({
    name: `${innoLic.name} × ${qty} ${unitLabel} (${period.label})`,
    qty,                                  // qty = devices
    unitPrice: unitPrice * totalMonths,   // ⚠ цена за весь период, не за месяц
    discount: 0,
    total: totalPrice,                    // = unitPrice × qty × months
  })
  ```

- **Что видит менеджер:** форма обещала «10 000 ₽/мес», preview показывает «Цена 120 000 ₽» (это unitPrice × 12 месяцев). Расхождение с формой выглядит как баг и провоцирует ручную «правку» обратно на 10 000 → total пересчитывается как 10 000 × 1 = 10 000 ₽ за год вместо 120 000. **Прямой денежный риск**.

- **Аналогичная семантика в ФинДир (B10) и BONDA BI (B11)** — тот же класс ловушки.

- **Fix-варианты:**
  - в LineItem завести разделение `unitPrice` (за единицу за период подписки) и `months`, либо
  - в preview-таблице добавить колонку «× мес» (показывать множитель явно), либо
  - переименовать строку «inno Kiosk (12 мес × 1 устр.)» и сделать unitPrice = total/qty с явным комментарием.

---

### 🔴 P0-4. qty лицензии в названии строки не обновляется при правке qty в preview

- **Файлы:** `src/lib/calculator.ts:227` (имя), `src/components/KPPreview.tsx:271-282` (`updateField` пересчитывает total, но не name).
- **Поведение:** name = `inno Kiosk × 5 устр. (12 месяцев)` — это строковый литерал. Менеджер правит «5» → «10» в столбце «Кол-во», total пересчитывается на 10. В .pptx уйдёт «inno Kiosk × 5 устр.», qty=10, total = total за 10. Несостыковка очевидна клиенту.

- **Fix:** перестроить name из qty/period перед рендером, либо вообще не хранить qty внутри name (выделить отдельные текстовые подписи).

---

### 🔴 P0-5. Удаление позиции / секции без подтверждения и без undo

- **Файлы:** `src/components/KPPreview.tsx:467-473` (крестик с `opacity-0 group-hover:opacity-40`), `:286-291` (секция исчезает если все items удалены).
- **Поведение:** случайный клик при просмотре — позиция исчезла. Если это была последняя позиция в секции — секция тоже исчезла. Откатить нельзя. Если потом нажать «← Редактировать» и «Рассчитать КП» — `handleGenerate` (page.tsx:223-225) пересоздаст KPResult из формы, **все ручные правки в preview потеряются**.

- **Связано:** C4 («Новое КП» в шапке без confirm), C5 (Edit→Back→Recalculate стирает preview), C6 (нет localStorage draft / beforeunload).

- **Fix:**
  - confirm-диалог на удаление позиции/секции (или undo-toast «Позиция удалена. Отменить?»);
  - on `handleGenerate` после первой генерации — предупреждать что preview будет пересоздан;
  - draft preview в localStorage с TTL.

---

### 🔴 P0-6. Supabase RLS открыт на полную запись для anon

- **Файлы:** `supabase/001_create_products.sql:62-69`.
- **Цитата:**
  ```sql
  CREATE POLICY "Allow all for catalog" ON catalog FOR ALL USING (true) WITH CHECK (true);
  CREATE POLICY "Allow all for hints" ...
  CREATE POLICY "Allow all for volume_discounts" ...
  CREATE POLICY "Allow all for period_discounts" ...
  ```
- **Риск:** anon-ключ в клиентском бандле (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) даёт любому посетителю сайта SELECT/INSERT/UPDATE/DELETE по всем четырём таблицам, плюс read на `cost_price`, `margin`, `supplier_article`. Одна curl-команда — и каталог фолбэка обнулён.
- **Fix:** оставить только `FOR SELECT USING (true)`, создать view `catalog_public` без чувствительных колонок, дать SELECT только на view.

---

### 🔴 P0-7. Google Sheets ID в клиентском бандле + закупочные цены и маржа в самом sheet

- **Файлы:** `src/app/page.tsx:889` (`GOOGLE_SHEET_ID = '1GGIOWoQmk7yLZjWSeY0wpFiKgrrYZ62TV2numdL7qXc'`), `:894-940` (запросы export?format=...).
- **Риск:** ID лежит в публичном bundle, любой пользователь сайта → DevTools → ID → таблица → `cost_price` и `margin`. Если sheet когда-то был расшарен на «Редактор» — конкурент правит прайс прямо в источнике.
- **Fix:** проксировать каталог через API route `/api/catalog`, фильтровать колонки `cost_price`/`margin`, или (быстрый путь) — выкинуть эти колонки из публичного листа.

---

### 🔴 P0-8. Next.js 14.2.5 — публичные CVE

- **Файл:** `package.json:11`. Версия `14.2.5`, последняя в ветке 14 — 14.2.30+.
- **CVE:**
  - CVE-2025-29927 (CVSS 9.1) — middleware bypass. Эксплойта прямо сейчас нет (middleware не используется), но при добавлении middleware будет broken-by-default.
  - CVE-2024-46982 (CVSS 7.5) — cache poisoning. Реален для CDN-кеша Vercel.
- **Fix:** `npm install next@14.2.30` — патч-обновление, breaking changes минимальны. Прогнать `next build` + ручной тест выгрузки .pptx после апдейта.

---

### 🔴 P0-9. monthlyTotal не пересчитывается при правках в preview

- **Файлы:** `src/components/KPPreview.tsx:329` (`getCurrentKP` сохраняет старый `kp.monthlyTotal` через `...kp`), `:506` (показ).
- **Поведение:** менеджер правит цену лицензии или discount в preview → `grandTotal` пересчитывается, но `kp.monthlyTotal` остаётся со старым значением. На экране показано «Ежемесячный платёж: X», в реальности должно быть Y. В .pptx monthlyTotal не идёт (значит до клиента доходит только если менеджер скопирует его в письмо).
- **Fix:** пересчитывать monthlyTotal в `getCurrentKP` синхронно с grandTotal или вычислять его в момент рендера из текущих sections.

---

### 🔴 P0-10. Терминология «PDF» в preview, на выходе .pptx

- **Файл:** `src/components/KPPreview.tsx:513` (`<div>В PDF будет включено:</div>`), кнопка ниже — «Скачать PPTX-презентацию».
- **Риск:** клиенты ждут PDF («пришлите КП в PDF»), менеджер видит «В PDF будет включено», жмёт «Скачать PPTX». Может неосознанно отправить .pptx ожидая что это PDF. В Telegram/Mac preview .pptx рендерится плохо → клиент видит сломанный документ → негативный сигнал.
- **Fix:** заменить «В PDF» на «В презентации», «В КП», «В .pptx». 1-строчный fix.

---

### 🔴 P0-11. БОНДА ФинДир получает .pptx с шаблоном inno_kiosk_template

- **Файлы:** `src/lib/generatePptx.ts:384-387` (выбор шаблона), отдельно `renderSlideImage.ts` содержит `renderBondaFindirSlide`, но **никем не импортируется** (см. A12, D6).
- **Поведение:** `isQR = req.license_type === 'qr' || 'ecomm'`. Для БОНДА (license_type='findir' или 'bonda_bi') это false → `inno_kiosk_template.pptx`. То есть БОНДА-клиент получает шаблон с inno-брендингом, inno-обложкой, inno-условиями. **[unverified, нужен ручной прогон]** — но архитектурный агент специально это отмечает как открытый вопрос. Если БОНДА .pptx сейчас отправляются — это серьёзная репутационная проблема.
- **Fix:** проверить вручную; если подтвердится — либо завести `bonda_findir_template.pptx`, либо временно скрыть кнопку «Скачать PPTX» для БОНДА с заглушкой «свяжитесь с менеджером».

---

## HIGH findings (закрыть в следующий-два спринта, не блокер)

### 🟠 H1. Дефолтный комплект периферии для inno Kiosk использует qty=devices даже для тех позиций, которые нужны 1 на локацию

- **Файл:** `src/lib/calculator.ts:60-121`. Все equipItems получают `qty: req.devices`.
- **Что задевает:** хаб с LAN, угловой переходник, крепление пинпада. При 3 устройствах на 1 локации хаб × 3 = 11 700 ₽ вместо 3 900 ₽, крепление пинпада × 3 = 7 500 ₽ вместо 2 500 ₽. Менеджер должен править руками; не заметит — клиенту +13 000 ₽.
- **Fix:** разнести items по qty-источникам: tablet/mount/adapter — по devices, hub/angle/pinpad — по locations или просто 1. Это уже бизнес-решение, а не код.

### 🟠 H2. ФинДир для locations > 20 возвращает цену тарифа «16-20»

- **Файл:** `src/lib/catalog.ts:552-561`.
- **Поведение:** `getFindirPrice` для locations=50 даёт ту же цену, что для 20. Для крупной сети это занижение почти в 3 раза.
- **Fix:** либо upper-clamp до 20 с явным предупреждением, либо добавить ступени, либо при locations>20 показывать менеджеру «по запросу».

### 🟠 H3. parsePrice делает replace(',', '.') → строка «1,200» из Google Sheet превратится в 1.2 рубля

- **Файл:** `src/app/page.tsx:960-964`.
- **Поведение:** в русской локали запятая — разделитель тысяч. «1,200» (=1200) после replace станет «1.200» → `Number('1.200') = 1.2`. Если в Google Sheet кто-то ввёл цену с запятой — товар в каталоге будет почти бесплатно.
- **Fix:** убрать replace(',', '.'); если нужен десятичный разделитель — поддерживать только точку.

### 🟠 H4. ParsedRequest — гибрид «формы» и «входа калькулятора», 5 internal-полей с `_`

- **Файл:** `src/lib/prompt.ts:69-92`, `src/app/page.tsx:177-220` (handleGenerate enrich-логика).
- **Риск:** `calculator.ts` молча использует posEquipment[0] (POScenter Atlas 15") если _kiosk_* не заполнены. Любая будущая точка вызова `calculateKP` без enrichment отдаст не тот киоск.
- **Fix:** разнести FormState и CalculatorInput на разные типы.

### 🟠 H5. Маппинг «крепление по типу» дублирован в 4 местах с разными критериями

- **Файлы:** `calculator.ts:46-50` (id из catalog), `page.tsx:192-196` (подстроки в name), `:229-244` (isNonDefaultMount), `:485-495` (getDefault для UI). При добавлении новой модели в Google Sheets надо синхронно править все четыре. Уже есть лёгкая несогласованность.
- **Fix:** одно место определения «type → mountId», все остальные через него.

### 🟠 H6. Категория продукта в каталоге определяется подстрокой в названии

- **Файлы:** `page.tsx:951-957` (если category='киоски' → подстроки 'крепление'/'принтер'/'сканер'/'ккт'/'фискальн' переключают на _kiosk_mount или _kiosk_option), `page.tsx:432-440` (фильтр киосков исключает те же стоп-слова).
- **Риск:** менеджер каталога делает опечатку в Google Sheet «крпеление» → товар попадёт в список киосков → клиент получит КП «Кронштейн напольный × 5 устройств = 142 500 ₽».
- **Fix:** обязательная отдельная колонка «Подкатегория» в Sheet вместо парсинга имени.

### 🟠 H7. Анонимизация имён работает только для встроенного catalog, не для Google Sheet

- **Файл:** `src/components/KPPreview.tsx:18-26`. kpNameMap строится только из `tablets/mounts/peripherals` массивов из `catalog.ts`. Любой продукт, выбранный через replaceWithProduct из Google Sheet, попадёт в КП с реальным брендом.
- **Fix:** колонка `kp_name` в Google Sheet, в `parseRowToProduct` (page.tsx:942-996) её читать.

### 🟠 H8. setState внутри render (update в IIFE для kiosk_type)

- **Файл:** `src/app/page.tsx:506-513`. Анти-паттерн React, при определённом drift в getDefault → infinite loop.
- **Fix:** перенести в `useEffect([form.selected_kiosk_id])`.

### 🟠 H9. NumberInput синхронизирует draft через setState прямо в теле компонента

- **Файл:** `src/app/page.tsx:1211-1213`. Тот же класс анти-паттернов что H8. Иногда поле «дёргается» при наборе.
- **Fix:** useEffect на пропс value.

### 🟠 H10. ProductSelector: getAlternatives → findProductByName ищет по item.name (kpName), но catalog хранит реальное имя → всегда возвращает весь каталог

- **Файл:** `src/components/KPPreview.tsx:48-57`. При клике на «Планшет Android…» в preview менеджер видит выпадашку из ВСЕХ товаров (планшеты + крепления + периферия + POS), без фильтра по категории.
- **Fix:** хранить product.id или product.name (real) в LineItem отдельно от displayName.

### 🟠 H11. Lookup киосков работает только если лист в Google Sheets назван «Киоски» — иначе fallback на posEquipment[0]

- **Файлы:** `src/app/page.tsx:431-441`, `src/lib/calculator.ts:148-159`. При переименовании листа на форме Kiosk PRO нет ни одной модели для выбора → calculator падает на «POScenter Atlas 15"» 39 400 ₽.
- **Fix:** контракт по category в Sheet, не зависящий от имени листа.

### 🟠 H12. addSection / addItem без верхних ограничений в preview

- **Файл:** `src/components/KPPreview.tsx:297, 321-326`. Связано с P0-1: менеджер может добавить безлимитно, .pptx обрежет.
- **Fix:** связан с P0-1; если ограничивать на стороне UI, оба бага закрываются вместе.

### 🟠 H13. handleBack сохраняет форму, но при «Рассчитать» теряет preview-правки без warning

- **Файлы:** `src/app/page.tsx:246-249, 223-225`. Менеджер пошёл в форму «поправить количество устройств», вернулся — все ручные правки скидок/замен из preview ушли.
- **Fix:** confirm-диалог «Пересчёт удалит ручные правки. Продолжить?».

### 🟠 H14. «Новое КП» в шапке — без confirm

- **Файлы:** `src/app/page.tsx:251-255, 278-280`. Кнопка слабоконтрастная, рядом с «Редактировать». Полминуты работы → один клик → пустая форма.
- **Fix:** confirm-диалог.

### 🟠 H15. Нет CSP, X-Frame, X-Content-Type, Referrer-Policy

- **Файл:** `next.config.js` пустой. Также `xlsx` грузится с `cdn.sheetjs.com` runtime без SRI.
- **Fix:** добавить `headers()` в next.config.js + поставить xlsx как npm-пакет.

### 🟠 H16. .vercel/ и kp-generator-deploy.tar.gz (12 МБ) закоммичены в git

- **Файлы:** `.vercel/project.json`, `.vercel/README.txt`, `kp-generator-deploy.tar.gz`. `.vercel/` Vercel явно рекомендует не коммитить (orgId+projectId). Тарбол — 12 МБ мусора, тормозит clone.
- **Fix:** в `.gitignore` `.vercel/`, `*.tar.gz`; `git rm --cached`.

### 🟠 H17. openai / jspdf / jspdf-autotable в deps, ноль импортов в src/

- **Файлы:** `package.json:9,10,13`. `grep -rn "openai\|jspdf"` — ноль вхождений. OpenAI integration упомянута в CLAUDE.md, но в коде её нет (`prompt.ts` содержит только SYSTEM_PROMPT, никем не используется).
- **Fix:** `npm uninstall openai jspdf jspdf-autotable`, отозвать `OPENAI_API_KEY` в Vercel env.

### 🟠 H18. ~600-800 LOC dead code в src

- **Файлы:** `src/lib/renderSlideImage.ts` (427 LOC, никем не импортируется — артефакт canvas-PDF эпохи), `src/lib/font-lato.ts` + `font-lato-bold.ts` (~880 КБ base64 каждый, артефакт jsPDF), `src/lib/slides.ts`, `src/lib/prompt.ts` (импортируется только тип ParsedRequest), большинство функций в `src/lib/supabase.ts` (только `fetchAllCatalog` используется), `CatalogUpload` и `CheckCard` в page.tsx.
- **Fix:** удалить. Снимает ~1.8 МБ с диска, ускоряет инкрементальную сборку.

### 🟠 H19. Нет rate-limit / debounce / кэша на Google Sheets sync

- **Файл:** `src/app/page.tsx:893-940`. При клике на «Синхронизировать» каждый раз XLSX + до 10 CSV запросов. Google может рейт-лимитить.
- **Fix:** in-memory cache с TTL=5 мин + debounce 2 сек на кнопках.

### 🟠 H20. `<img src={k.image_url}>` без валидации (URL из Google Sheets)

- **Файл:** `src/app/page.tsx:453`. Tracking pixels, утечки Referer, тяжёлые картинки. Не XSS, но утечка приватности.
- **Fix:** allowlist доменов в next.config.js images.remotePatterns или ручная валидация при парсинге.

### 🟠 H21. monthlyTotal mental model для kiosk_pro: единовременное железо + длительная лицензия

- **Файл:** `src/lib/calculator.ts:138-186 + 218-233`. grandTotal суммирует и железо (single), и лицензию (×months) — корректно технически, но `paymentType` («100% предоплата» / «Рассрочка 3 мес 60/20/20») лейбл относится ко всему grandTotal. На что именно рассрочка — на железо или на 12 мес лицензии? Не закреплено в коде, не показано в КП.
- **Fix:** в KP-SPEC.md закрепить семантику, в .pptx добавить расшифровку.

### 🟠 H22. Цены лицензий и услуг продублированы в трёх местах

- **Файлы:** UI карточки формы (`page.tsx:339, 347, 355, 363`), `calculator.ts:204-209` (`innoLicPrices`), `catalog.ts:343-376` (`innoLicenses`). Сегодня совпадают, дрейф — вопрос времени.
- **Fix:** один source-of-truth в catalog.ts, UI и calculator читают через геттер.

### 🟠 H23. Тестов нет вообще

- `find . -name "*.test.*"` пусто. `calculator.ts` (342 LOC бизнес-логики) без покрытия.
- **Fix:** vitest + 20-30 тестов на каждую комбинацию license_type × kiosk_type × subscription_period. Без них любой коммит в calculator — рулетка.

---

## MEDIUM findings (полезно поправить, не срочно)

| ID | Файл/строка | Что |
|----|-------------|-----|
| M1 (A14/B8) | `catalog.ts:536-548, page.tsx:659-661` | Скидки за объём и период отключены, но обвязка осталась (`getLicensePrice` возвращает basePrice, UI рисует `-{discount}%`). |
| M2 (A15) | `calculator.ts:329` | `kp.date` фиксируется при первом расчёте, не обновляется при back. Менеджер может отправить КП с вчерашней датой. |
| M3 (A16) | `page.tsx:75-96` | Загрузка каталога параллельно, race: handleGenerate до возврата Google Sheets → fallback каталог. |
| M4 (B14, C17, C18) | `KPPreview.tsx:90-133, 254-268` | ProductSelector показывает весь каталог без поиска и фильтра, можно случайно выбрать «Крепление эквара» вместо «Хаб LAN». |
| M5 (B17, B18) | `KPPreview.tsx:230, calculator.ts:340-342, generatePptx.ts:18-20` | Возможные копеечные округления + разные форматтеры в preview и pptx. |
| M6 (B19) | `page.tsx:431-441, calculator.ts:148-159` | Lookup киосков по category и наличию стоп-слов в name. Переименование листа в Sheet ломает выбор kiosk PRO. |
| M7 (B23) | `calculator.ts:333` | Рассрочка installment3 описана только лейблом, без разбивки на 3 транша в КП. |
| M8 (B24) | `KPPreview.tsx:506` | «Ежемесячный платёж» показывается при period=year/100% prepay — вводит в заблуждение. |
| M9 (C8, C9) | `KPPreview.tsx:382-391, page.tsx:275-277` | Расхождение форматирования preview vs pptx (₽ символ); кнопка «← Редактировать» не намекает на разрушительность пересчёта. |
| M10 (C11, C18) | `KPPreview.tsx:90-96, 98-133` | Каталог-поповер без Escape, стрелочной навигации, focus trap, поиска. |
| M11 (C19) | `page.tsx:431-465` | Нет skeleton при загрузке каталога — пустая сетка карточек kiosk PRO 3-5 секунд. |
| M12 (C20) | `page.tsx:594-616` | `<label>` снаружи без `<input>` внутри — клик по пустому пространству чекбокса не работает. |
| M13 (C12) | `page.tsx:1232-1233` | `parseInt('') || min` — backspace всего поля прыгает к min. |
| M14 (C14) | `page.tsx:589-617` | Нет summary «выбрано N опций на M ₽» при выборе опций kiosk PRO. |
| M15 (C16) | `generatePptx.ts:387, page.tsx:521` | `kpInsertAfter = 3 или 4` хардкодом, без проверки что в шаблоне столько слайдов. Если шаблон когда-то обновится — слайд вставится не туда. |
| M16 (C21–C26) | `globals.css`, преобладающее `text-white/30..40` | Доступность: только тёмная тема, низкий контраст подписей, ARIA отсутствует, table без `<button>`, mobile/iPad preview-таблица 6 колонок жмётся. |
| M17 (C27) | `KPPreview.tsx:360` | Дата КП не редактируется. |
| M18 (D11–D13, D16, D17) | `tsconfig.tsbuildinfo, console.log в проде, нет ESLint/Prettier/CI` | Гигиена сборки. |

---

## LOW findings (стиль, мелочи)

- **L1 (A17, B29, C32):** `BUILD_TAG = '2026-04-20-canvas-v3'` устарел (KPPreview.tsx:239), показывается в DevTools и в Slides info на превью.
- **L2 (A18, C7 уже в P0):** Лейбл «В PDF» уже учтён в P0-10. Здесь — для индекса.
- **L3 (A11, B7):** `kiosk_type: '...kiosk_pro'...` — мёртвая ветвь в типе.
- **L4 (B15):** `ParsedRequest.products: string[]` — поле не используется.
- **L5 (B22):** `subscription_period = 'year'` по умолчанию — менеджер может забыть переключить на month.
- **L6 (B28, C13):** `console.log` оставлены в проде.
- **L7 (C28):** Кириллица в имени файла .pptx может ломаться через Outlook SMTP.
- **L8 (C30):** AI/OpenAI генерация упомянута в CLAUDE.md, но в коде нет (D5 связан).
- **L9 (D19, D20):** `escapeXml` не экранирует `'` (не баг); `image_url: String(undefined) → 'undefined'`.

---

## False alarms / overlap-проверки

- **B6 (mountByType для kiosk='floor'):** в UI сейчас невозможно выбрать `floor` для license=kiosk (форма даёт только desk/wall). Не баг, но защита 0 — отметили как P1 в B6.
- **B12 (categoryMap теряет service/license):** проверил — allProducts вообще не содержит services/licenses, map покрывает все категории. OK.
- **A10 (replaceWithProduct теряет discount):** проверил — `...item` сохраняет discount. Не баг.
- **D21 (next-env.d.ts):** норма для Next.

---

## Strengths (что хорошо)

1. **Единая структура `KPResult`** (sections → items → subtotal → grandTotal) во всех трёх слоях — корректное архитектурное решение, одна точка истины.
2. **Чёткая trust boundary `generatePptx`** — XML-знание о .pptx инкапсулировано, остальной код о нём не знает.
3. **Адаптивная раскладка КП-слайда** (compactLeftCard / compactRightBottomCard, generatePptx.ts:308-339) — продуманные EMU-координаты, легко править.
4. **Тройной fallback каталога:** Google Sheets → Supabase → встроенный массив. Приложение работает без сети, без Supabase, без Sheets.
5. **kpName mapping** — обезличивание имён производителей (Onkron G80 → Кронштейн настольный) до клиента. Хорошее бизнес-решение.
6. **escapeXml** в `generatePptx.ts` — `& < > "` корректно экранированы перед вставкой в `<a:t>`.
7. **Нет `dangerouslySetInnerHTML`, нет `eval`** — XSS-поверхность минимальна.
8. **TypeScript strict mode** включён.
9. **App Router без Pages Router** — закрывает целый класс Next.js-CVE.
10. **Динамический import `jszip`** — code splitting, ~100 КБ грузятся только при «Скачать .pptx».
11. **Math.round в `recalcItem`** + суммирование уже округлённых totals — нет копеечного дрейфа внутри секции.
12. **Math.max(0, value) / Math.max(1, qty) в updateField** — защита от негативных и нулевых.
13. **OpenAI prompt НЕ работает с ценами** — cost-injection через AI невозможен (правда, OpenAI вообще не подключён сейчас).
14. **CSV-парсер с поддержкой кавычек и escaped quotes** (page.tsx:1003-1021) — не наивный `split(',')`.
15. **Условная логика формы** (page.tsx:98-158) корректно сбрасывает зависимые поля при смене company/license_type.
16. **Disabled-state кнопки «Рассчитать» при пустом client_name** — простая, но важная защита.
17. **Шаблоны PPTX в `public/`** — кешируются Vercel CDN с правильными headers без участия кода.
18. **`.env.local` в `.gitignore`** и не в git-истории.

---

## Recommended roadmap

**Сегодня-завтра (срочно, 1-2 дня работы):**

1. P0-1 + P0-2 (overflow в .pptx и потеря секции «Дополнительно») — связаны. Решение: одной правкой ограничить UI preview до лимитов шаблона и/или показать blocking-confirm менеджеру при overflow. **Самый важный fix.**
2. P0-3 + P0-4 (unitPrice = price×months + name с qty не обновляется) — связаны. Либо разделить семантику unitPrice/months в LineItem, либо переименовать колонку preview-таблицы.
3. P0-10 (лейбл «В PDF» → «В .pptx») — 1-строчный fix.
4. P0-11 (БОНДА ФинДир .pptx) — сначала ручная проверка: реально ли БОНДА сейчас отдаются с inno-шаблоном? Если да — временно скрыть кнопку для БОНДА.

**На этой неделе:**

5. P0-5 + H13 + H14 (защита от случайной потери работы): confirm-диалоги на «Удалить позицию», «Удалить секцию», «Новое КП», «Рассчитать» поверх preview.
6. P0-6 (Supabase RLS) — миграция, оставить только `FOR SELECT`, выкинуть cost_price/margin из публичного view.
7. P0-7 (Google Sheets ID + cost_price/margin в публичном sheet) — выкинуть колонки cost_price/margin из листа, добавить API route для прокси.
8. P0-8 (next@14.2.30) — `npm install`, тест-прогон.
9. P0-9 (monthlyTotal в preview) — пересчёт в getCurrentKP.

**В течение спринта (1-2 недели):**

10. H1 (qty оборудования по locations/devices) — бизнес-решение + код.
11. H2 (ФинДир > 20 локаций) — clamp + warning.
12. H3 (parsePrice replace ',') — убрать replace.
13. H4-H7 (refactor: разнести FormState/CalculatorInput, унифицировать mount-mapping, ввести явную категорию в Sheet, kp_name в Sheet).
14. H15-H20 (security/hygiene: CSP, чистка git от .vercel/тарбола, npm uninstall openai/jspdf, dead code, rate-limit Sheets, валидация image_url).
15. H23 (тесты на calculator).

**Долгий хвост:**

- M1-M18 — по мере касания соответствующих файлов.
- Рефакторинг page.tsx на компоненты + useReducer.
- ESLint + Prettier + CI на GitHub Actions.

---

## Связь с kp-generator-v2

Когда дойдут руки до v2 (см. `KP-SPEC.md`, `TZ-KP-PLATFORM.md`):

1. **Структурно убрать «три параллельных представления»** — design model должен идти от единого источника (KPResult) ко всем слоям через явный layout-движок, а не через find-by-russian-string.
2. **Динамические row-карточки в .pptx** вместо фиксированных слотов — снимает P0-1 / H12 целиком.
3. **`kp_name` как обязательная колонка** в каталоге, не маппинг в коде — снимает H7.
4. **Категории как enum в БД**, не «киоски + парсинг подстроки» — снимает H6.
5. **API route для каталога**, не прямой Google Sheets из клиента — снимает P0-7, H19, H20.
6. **Тесты на калькулятор как условие merge в main**.
7. **Confirm-диалоги / undo / draft в localStorage** как часть базового UX-фундамента.

---

## Index (сводная таблица)

| ID | Лента | P | Файл/строка | Что |
|----|-------|---|-------------|-----|
| P0-1 | B2/C1 | P0 | generatePptx.ts:48-60, 172-185 | LEFT_CARD 7 rows, 8 items → 1 dropped (баг от менеджеров) |
| P0-2 | B26/A1/C2 | P0 | KPPreview.tsx:321-326, generatePptx.ts:406-408 | «+ Добавить секцию» теряется в .pptx, в grandTotal входит |
| P0-3 | B3 | P0 | calculator.ts:226-233 | unitPrice лицензии = цена × месяцев — провоцирует ручную «правку» |
| P0-4 | B1 | P0 | calculator.ts:227, KPPreview.tsx:271-282 | qty в name лицензии не пересчитывается |
| P0-5 | C3/C4/C5/C6 | P0 | KPPreview.tsx:467-473, page.tsx:251-255, 246-249 | Удаление без confirm/undo, потеря preview при back+recalc, нет draft |
| P0-6 | D1 | P0 | supabase/001_create_products.sql:62-69 | Supabase RLS открыт на запись для anon |
| P0-7 | D2 | P0 | page.tsx:889 | Google Sheets ID + cost_price/margin в публичном sheet |
| P0-8 | D3 | P0 | package.json:11 | Next.js 14.2.5 — CVE-2025-29927 / CVE-2024-46982 |
| P0-9 | A2/A3 | P0 | KPPreview.tsx:329, calculator.ts:224 | monthlyTotal не пересчитывается при правке preview |
| P0-10 | C7 | P0 | KPPreview.tsx:513 | Лейбл «В PDF» при выходе .pptx |
| P0-11 | A12/D6 | P0 | generatePptx.ts:384-387 | БОНДА ФинДир получает inno-шаблон [unverified] |
| H1 | B5 | P1 | calculator.ts:60-121 | Хаб/переходник/крепление пинпада × devices вместо × locations |
| H2 | B9 | P1 | catalog.ts:552-561 | ФинДир для locations>20 = цена 16-20 |
| H3 | B16 | P1 | page.tsx:960-964 | parsePrice replace(',','.') ломает «1,200» в 1.2 ₽ |
| H4 | A4 | P1 | prompt.ts:69-92 | FormState/CalculatorInput гибрид |
| H5 | A5 | P1 | calculator.ts:46-50, page.tsx:192-244, 485-495 | mount-mapping в 4 местах |
| H6 | A6 | P1 | page.tsx:951-957, 432-440 | Категория по подстроке имени |
| H7 | A7 | P1 | KPPreview.tsx:18-26 | kpName маппинг только для встроенного catalog |
| H8 | A9 | P1 | page.tsx:506-513 | setState в render |
| H9 | C13 | P1 | page.tsx:1211-1213 | setDraft в теле компонента |
| H10 | B13 | P1 | KPPreview.tsx:48-57 | findProductByName по kpName, не находит → весь каталог |
| H11 | B19 | P1 | page.tsx:431-441, calculator.ts:148-159 | Lookup киосков fragile |
| H12 | C1 cont. | P1 | KPPreview.tsx:297, 321-326 | addSection/addItem без лимитов (связан с P0-1) |
| H13 | C5 | P1 | page.tsx:246-249, 223-225 | Back→Recalc теряет preview |
| H14 | C4 | P1 | page.tsx:251-255 | «Новое КП» без confirm |
| H15 | D10 | P1 | next.config.js | Нет CSP/X-Frame/Referrer, xlsx с CDN без SRI |
| H16 | D4 | P1 | .vercel/, kp-generator-deploy.tar.gz | В git |
| H17 | D5/D7 | P1 | package.json:9-10,13 | openai/jspdf/jspdf-autotable мёртвые deps |
| H18 | A12/D6 | P1 | renderSlideImage.ts, font-lato*.ts, slides.ts | ~600-800 LOC dead code |
| H19 | D8 | P1 | page.tsx:893-940 | Нет rate-limit/кэша Google Sheets |
| H20 | D9 | P1 | page.tsx:453 | image_url из Sheets без валидации |
| H21 | A8 | P1 | calculator.ts:138-186, 218-233 | Семантика рассрочки kiosk_pro неясна |
| H22 | A13 | P1 | page.tsx:339-363, calculator.ts:204-209, catalog.ts:343 | Цены продублированы |
| H23 | D15 | P1 | (нет тестов) | Нет покрытия calculator |
| M1–M18 | разное | P2 | (см. таблицу выше) | — |
| L1–L9 | разное | P3 | — | — |

---

*Аудит проводили 4 параллельных subagent'а (Architecture, Logic, UX, Security/Build) + ручная сверка. Полные подотчёты по веткам — рядом в `docs/audits/`.*
