# Light-аудит kp-generator — 2026-05-26

> Broad-scan по методологии `_shared/methodology/AUDIT-METHODOLOGY.md` (одним subagent'ом, не полным 6-агентным).
> Цель — топ-уровневая карта рисков и состояния, без углубления в каждую находку.

---

## 1. Состояние кодовой базы

- Stack по факту: Next.js 14.2.30, React 18, TS 5.5 strict, Tailwind 3.4, Supabase JS, jszip, vitest. **Никаких `pptxgenjs`, `openai`, `jspdf`, `xlsx` в `package.json`** (xlsx грузится лениво с CDN, см. ниже).
- Размер: 9 файлов, ~3 776 LOC TS/TSX. Структура минималистичная:
  - `src/app/page.tsx` — 1 126 LOC (всё: форма + Google Sheets парсер + xlsx loader)
  - `src/lib/generatePptx.ts` — 749 LOC (генерация PPTX через прямую XML-правку zip)
  - `src/components/KPPreview.tsx` — 684 LOC (preview + редактирование + выгрузка)
  - `src/lib/catalog.ts` — 662, `src/lib/calculator.ts` — 417
  - тестов 719 LOC (только `calculator.test.ts`)
- Активность: ветка `main`, последний коммит `8645613` от **26.05.2026** (не `3cdac51`/06.05 как в CLAUDE.md). После `3cdac51` было ещё ~10 коммитов: P0/P1 фиксы из аудита 14.05, русификация лицензий, add-on «Электронная очередь».
- Современное: TS strict, vitest, RLS-миграция `supabase/004_lock_rls.sql`, watchdog `checkPptxOverflow`, dynamic row expansion в PPTX, undo-toast в превью, 8 аудит-документов в `docs/audits/`. Legacy/долг минимален.

## 2. Топ-5 рисков (P0/P1 кандидаты)

1. **PPTX XML-правка через `String.indexOf`/`lastIndexOf` без парсера** — `generatePptx.ts:187-209, 211-224, 394-427`. `replaceShapeText` ищет `name="<shapeName>"` по подстроке: если в шаблоне появится shape с именем, являющимся префиксом другого (например `Text 6` и `Text 60`), будет править не тот shape. Текущие имена не пересекаются, но это хрупкий контракт между кодом и шаблоном. **P1.**
2. **Имя файла КП с кириллицей через `clientName.replace(/[^a-zA-Zа-яА-Я0-9]/g, '_')`** — `generatePptx.ts:744`. Пустое имя или из одних спецсимволов → имя файла `KP__2026-05-26.pptx`. Не падает, но возможны коллизии. **P2.**
3. **`alert()`/`window.confirm()` как единственная обработка ошибок** — `KPPreview.tsx:419, 432`, `page.tsx:213, 300`. При сбое генерации (404 на шаблон, повреждённый zip, отсутствие shape после правки) пользователь видит общий «Ошибка при генерации PPTX». Никакой telemetry/Sentry. На прод-инструменте 5–10 запусков в день — слепая зона. **P1.**
4. **Google Sheets как точка отказа без таймаута** — `page.tsx:867-913`. `fetch(xlsxUrl)` без `AbortController`/timeout. Если Google положили лист или прокси режет — UI висит на спиннере «загрузка каталога», fallback на Supabase работает только при ошибке/пустоте, не при таймауте. **P1.**
5. **Race condition при ручной правке + «Рассчитать заново»** — `page.tsx:206-219` спрашивает confirm, но `handleGenerate` собирает новый KP синхронно из `form`, теряя любые изменения, сделанные в `KPPreview` (правки цен/имён). Это by design, защищено confirm — но если пользователь случайно нажал «Enter» в форме, ручная работа теряется. **P2.**

Бонус: **`xlsxCache: any` + загрузка скрипта с CDN** (`page.tsx:845-860`) — если cdn.sheetjs.com недоступен, форма всё ещё открывается (есть встроенный fallback), но supply-chain зависимость от стороннего CDN на проде. **P2.**

## 3. Дублирование / отсутствующие абстракции

1. **Шаблон поиска `<p:sp>` в `generatePptx.ts`** — повторяется в 5 функциях (`replaceShapeText`, `removeShape`, `cloneShape`, `shiftShape`, `resizeShape`, `widenCard`), каждая делает один и тот же `lastIndexOf('<p:sp>') / indexOf('</p:sp>')`. Нужен `findShapeBlock(xml, name) → {start, end} | null`.
2. **`item.kpName || item.name`** — повторяется 5+ раз в `calculator.ts:83,97,110,124,137` + `getKpName` в `KPPreview.tsx:33`. Должен быть один хелпер `displayName(product)`.
3. **Построение `LineItem` для оборудования** — 7 почти идентичных блоков в `calculator.ts:82-143`. Просится `pushEquipment(items, product, qty, category)`.
4. **Парсинг русско-английских ключей строки Sheets** — `parseRowToProduct` (`page.tsx:917-988`) делает `row['Наименование'] || row['Название'] || row['name'] || row['Name']` для каждого поля. Просится таблица алиасов `FIELD_ALIASES`.
5. **`subtotal = items.reduce((sum, i) => sum + i.total, 0)`** — повторяется 4 раза в `calculator.ts` + ещё в `KPPreview.tsx:240`. Уже есть `recalcSection` в KPPreview — стоит вынести в `calculator.ts` и переиспользовать.

## 4. Security smells

- **Чисто:** `.env.local` в `.gitignore`, нет хардкоженных секретов в `src/`. Supabase anon ключ — публичный по дизайну, читать защищено через RLS (`supabase/004_lock_rls.sql`), запись только service_role. README и `.env.local.example` это явно объясняют.
- **Серое пятно:** `cost_price`/`margin` доступны на read для anon (см. комментарий в `004_lock_rls.sql:11-14`) — закупочные цены и маржа всех SKU летят на клиент. Команда осознала риск, но конкурент с одной curl получит весь прайс с маржами. Если ужесточать — `VIEW catalog_public` без `cost_price/margin`.
- **Server-side нет:** ни одного API route. Всё работает в браузере. Это устраняет целый класс угроз (auth bypass, key leaks из server), но значит что Google Sheet ID и формула расчёта пакуются в client bundle и реверсятся за минуты — нормально для внутреннего инструмента, но не «продаваемого SaaS».
- **`fetch('/templates/*.pptx')`** — шаблоны лежат в `public/templates/` и публично доступны. Никакой sensitive геометрии в них нет, но клиент знает структуру шаблона. Acceptable.

## 5. Documentation drift

- **CLAUDE.md (раздел kp-generator) сильно устарел** относительно реальности:
  - Указано «pptxgenjs + jszip + Supabase + Google Sheets API» → по факту **только jszip + Supabase**, pptxgenjs выпилен в пользу прямой XML-правки, Google Sheets — публичный export, никакого API.
  - Указано «OpenAI — только в kp-generator» → OpenAI **полностью удалён** из deps (см. `.env.local.example:24-26`).
  - Указано «последний коммит `3cdac51` от 06.05.2026, 47 коммитов 20.04 → 06.05» → по факту последний коммит **`8645613` от 26.05.2026**, после 06.05 ещё ~10 коммитов (P0/P1 фиксы 14.05, русификация лицензий 22.05, add-on Электронная очередь 26.05).
- **README.md (`kp-generator/README.md`)** — обновлён 14.05.2026, **актуален**, прямо помечает старые версии CLAUDE.md как ошибку.
- **changelog_kp_generator.md** — **актуален**, последняя запись 26.05 про Электронную очередь, есть записи 22.05 и 14.05. CLAUDE.md говорит что «changelog требует обновления под коммиты 30.04–06.05» — это уже не так.
- **`docs/audits/AUDIT_FULL_2026_05_14.md` + 8 связанных** — большой аудит проведён 14.05, P0/P1 закрыты (видно по коммитам `d3d5714 P0` и `f322ba3 P1`).

## 6. Highest-value cleanup (1 день)

**Рефакторить `generatePptx.ts` через выделение «PPTX XML utility»-модуля.** Сейчас 749 LOC одного файла с 5 функциями поиска `<p:sp>` через `indexOf` — это самое хрупкое место кода (см. P0/P1 #1), его сложно покрыть тестами, и любая будущая правка шаблона рискует молча сломать поиск shape. Один день: вынести `findShapeBlock`, `withShapeBlock`, `getShapeOff`, `setShapeOff` в `src/lib/pptx/shape.ts`, переписать 5 функций через них, добавить vitest на синтетических XML-фикстурах (3-5 кейсов: shape с preserve, вложенный gradient, дубликат имени-префикса). Это закроет долг по тестам (сейчас тестируется только `calculator`), сократит файл на ~30%, и даст безопасную базу для следующих правок шаблона.

---

**Вердикт.** Здоровый, аккуратно поддерживаемый код с минимальным техдолгом — пройден большой аудит 14.05, документация (README, changelog, ONBOARDING) свежее CLAUDE.md, главный риск изолирован в одном модуле генерации PPTX.
