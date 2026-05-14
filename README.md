# kp-generator

Боевой генератор коммерческих предложений (КП) для брендов **inno** и **bonda**. Менеджер заполняет короткую форму → видит интерактивное превью → правит позиции/цены руками → выгружает `.pptx` и отправляет клиенту.

Развёрнут на Vercel. Используется командой продаж ~5–10 раз в день.

---

## Быстрый старт

```bash
# 1. Клонировать репо
git clone <ssh-url-from-github>
cd kp-generator

# 2. Установить зависимости
npm install

# 3. Скопировать пример env-файла и заполнить (см. ниже)
cp .env.local.example .env.local
# отредактировать .env.local — нужны 2 переменные от Supabase

# 4. Запустить dev-сервер
npm run dev
# открыть http://localhost:3000

# 5. Сгенерировать тестовое КП
# Компания: ИННО → Лицензия: inno Kiosk → 1 устройство, настольный
# → Рассчитать → Скачать PPTX
```

Если форма открылась и каталог моделей подгрузился — окружение настроено.

### Production / preview deploys

- **prod:** `kp-generator.vercel.app` (или твоё имя проекта на Vercel)
- каждый push в `main` → автодеплой на prod
- каждый PR → preview URL

---

## ENV-переменные

Всего две, обе публичные (`NEXT_PUBLIC_*` → летят в клиентский бандл, **это нормально, anon-ключ Supabase публичный по дизайну**):

| Переменная | Обязательно | Где взять |
|------------|-------------|-----------|
| `NEXT_PUBLIC_SUPABASE_URL` | **Да** | Supabase Dashboard → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Да** | Supabase Dashboard → Settings → API → Project API keys → `anon public` |

Подробности и комментарии — в `.env.local.example`.

**Чего здесь больше нет:**
- `OPENAI_API_KEY` — голосовой ввод был выпилен; пакет `openai` удалён из deps в чистке 14.05.2026.
- Google Sheets API key — каталог тянется через публичный `export?format=xlsx`-эндпоинт без авторизации (sheet расшарен «у кого есть ссылка»). ID листа захардкожен в `src/app/page.tsx`.

---

## Тех-стек

| Слой | Технология | Заметки |
|------|------------|---------|
| Фреймворк | Next.js 14.2.30 (App Router) | Без middleware, без API routes — чистый client-only SPA |
| UI | React 18 + TypeScript 5.5 (strict) | Tailwind CSS 3.4 |
| Стейт | `useState`/`useReducer` локально | Без Redux/Zustand |
| БД | Supabase Postgres | Используется только как fallback каталога; RLS закрыта на чтение для anon |
| Каталог | Google Sheets (публичный export) | Авто-загрузка при mount + кнопка ручной синхронизации |
| `.pptx` генерация | `jszip` + прямое редактирование XML | **Никаких `pptxgenjs`/`jspdf`** — устаревшие версии CLAUDE.md ошибаются. Берём готовый шаблон из `public/templates/`, точечно правим shape-XML, перепаковываем zip. |
| Excel-импорт | `xlsx` (SheetJS, lazy-loaded с CDN) | Только для парсинга Google Sheets export'а |
| Деплой | Vercel | App Router → fully static + client-side |

---

## Архитектура

### Поток данных

```
[Форма на page.tsx]
        │
        ▼  handleGenerate → calculateKP(ParsedRequest)
[KPResult: sections → items → subtotal + grandTotal + monthlyTotal]
        │
        ▼  setStep('preview')
[KPPreview.tsx]
        │  - Редактирует sections локально (recalcItem, recalcSection)
        │  - getCurrentKP() даёт актуальный KPResult с пересчётами
        ▼
[generateKPPptx(kp, parsed, isInno)]
        │  1. Загружает базовый шаблон (qr или kiosk)
        │  2. Загружает commercial_template.pptx (слайд с детализацией)
        │  3. Заполняет shape-тексты КП-слайда через regex
        │  4. Динамически клонирует row-shapes если items > потолка шаблона
        │  5. Подгоняет геометрию (ИТОГО подтягивается/пушится по высоте)
        │  6. Вшивает КП-слайд в нужное место базового шаблона
        ▼
[Blob → URL.createObjectURL → <a download>]
```

### Раздельные шаблоны .pptx

Лежат в `public/templates/`. Выбор зависит от типа лицензии:

- `inno_qr_template.pptx` (5 слайдов) — для **inno QR / inno Ecomm**. КП-слайд вставляется после 3-го.
- `inno_kiosk_template.pptx` (6 слайдов) — для **inno Kiosk / inno Kiosk PRO**. КП после 4-го.
- `commercial_template.pptx` — сам КП-слайд («Детализация стоимости»). 138 shapes с фиксированными именами (`Text 16`, `Shape 5` и т.д.) и точными EMU-координатами.

**Для БОНДА (ФинДир / BONDA BI) сейчас отдельного шаблона нет** — выбор шаблона смотрит только на `license_type`, поэтому БОНДА выгрузит `inno_kiosk_template.pptx` с inno-обложкой. Это известный issue (P0-11 в `docs/audits/AUDIT_FULL_2026_05_14.md`), пока БОНДА .pptx-flow не используется в проде.

### Адаптивная раскладка КП-слайда

В `generatePptx.ts`:

- **Лимиты строк в шаблоне:** Оборудование 7, Лицензии и подписки 1, Услуги 2 (это физическая структура XML).
- **Динамическое расширение:** если в секции больше позиций, `expandCardRows()` клонирует XML row-shape (тексты + сепараторы) с уникальными `<p:cNvPr id>`, сдвигая Y. Текущие потолки после клонирования: **11 / 3 / 6**.
- **Подгонка геометрии:** `adjustCardGeometry()` сжимает ИТОГО вверх при `items < N` и пушит вниз вместе с container'ом при `items > N`.
- **`compactLeftCard` / `widenCard` / `shiftCard`** — точные EMU-координаты для центрирования и масштабирования карточек при отсутствии секций.
- **Шрифт Arial** для кириллицы в shape-текстах (не `-apple-system`, т.к. macOS-only).

### Watchdog «итог ≠ сумма строк»

`checkPptxOverflow(kp)` в `generatePptx.ts` сверяет каждую секцию с потолком и блокирует выгрузку, если найдено превышение или присутствует секция с неизвестным заголовком. Триггерится в `KPPreview.handleDownloadPPTX` перед самой генерацией. Это был фикс манагерского бага 14.05.2026 про пропавшее «Крепление для терминала оплаты» — см. `docs/audits/AUDIT_FULL_2026_05_14.md`.

### Каталог

`src/app/page.tsx` при mount:

1. Сначала пробует Google Sheets через `export?format=xlsx` (ID листа в константе `GOOGLE_SHEET_ID` строка 889).
2. Если Google недоступен — fallback на Supabase `catalog`-таблицу (`src/lib/supabase.ts → fetchAllCatalog`).
3. Если и Supabase недоступен — использует встроенный массив `fallbackCatalog` из `src/lib/catalog.ts`.

Кнопка «Синхронизировать из Google Sheets» в форме (`GoogleSyncButton`) — ручная пересинхронизация.

### Анонимизация в КП

Реальные названия товаров (`OnePlus Pad 3`, `Onkron G80`) выводятся только в админских селекторах. В .pptx уходит обезличенное имя через поле `kpName` в каталоге (`Планшет Android 13.2'', 12/256Гб`, `Кронштейн настольный`).

Маппинг строится в `KPPreview.tsx:18-26` из встроенного `catalog.ts`. **Для продуктов, добавленных только в Google Sheets, `kpName` не работает** — поле в листе пока не предусмотрено (известный issue H7 в аудите).

### Семантика лицензий (важно)

С 14.05.2026 для подписочных строк в `LineItem` есть поле `months`. `unitPrice` — это цена за **месяц** (например `10 000` для inno Kiosk), `total = unitPrice × qty × months × (1 - discount/100)`. В превью столбец «Цена» показывает «10 000 ₽/мес», ниже — «× 12 мес». В .pptx — «10 000/мес».

Раньше `unitPrice` хранил `цена × месяцев` целиком, что путало менеджеров и провоцировало ручную «правку». См. `recomputeLineTotal()` в `src/lib/calculator.ts`.

---

## Ключевые файлы

| Файл | LOC | Что делает |
|------|-----|-----------|
| `src/app/page.tsx` | ~1150 | Главная страница: форма + загрузка каталога + переключение шагов form/preview |
| `src/components/KPPreview.tsx` | ~600 | Превью КП на втором шаге: редактирование позиций, undo-toast, watchdog, выгрузка |
| `src/lib/calculator.ts` | ~360 | `calculateKP(req)` — собирает `KPResult` из формы. `recomputeLineTotal` — источник истины формулы строки |
| `src/lib/catalog.ts` | ~580 | Встроенный каталог (`tablets`, `mounts`, `peripherals`, `kioskKits`, `posEquipment`), цены лицензий, `findirTariffs`, `periodMultiplier` |
| `src/lib/generatePptx.ts` | ~700 | Сборка `.pptx`: загрузка шаблонов, заполнение XML, dynamic row expansion, geometry adjust, вставка КП-слайда в base template |
| `src/lib/supabase.ts` | ~50 | Клиент Supabase + `fetchAllCatalog()` (fallback каталога) |
| `src/lib/prompt.ts` | ~25 | Только тип `ParsedRequest` — раньше содержал SYSTEM_PROMPT для голосового ввода, голос выпилен |
| `supabase/*.sql` | — | Миграции схемы. `004_lock_rls.sql` — последняя, закрывает запись в catalog для anon |
| `public/templates/*.pptx` | — | Шаблоны презентаций (бинарные, правятся в PowerPoint) |

Файлы-заглушки помечены `// DEAD CODE` в первой строке (font-lato*, renderSlideImage, slides) — артефакты PDF-эпохи, можно удалить через `git rm`.

---

## Связь с другими проектами

| Проект | Папка в `Claude (code)/` | Как связан |
|--------|--------------------------|------------|
| **inno-sklad** | `inno-sklad/` | Учёт оборудования под клиентов. В будущем будет питать реальные цены и остатки в КП-генератор. Сейчас цены живут в Google Sheets отдельно. |
| **kp-generator-v2** | `kp-generator-v2/` | Следующая версия — объединение `kp-generator` и `price-compare` в одну платформу с общим каталогом, админкой прайсов поставщиков и авторасчётом маржи. Спецификация — `kp-generator-v2/KP-SPEC.md`. Статус: заготовка по спеке, git нет. |
| **price-compare** | `price-compare/` | Drag-n-drop сравнение прайсов поставщиков. Вольётся в kp-generator-v2. |
| **ko-salary** | `ko-salary/` | «Пульс КО» — расчёт ЗП менеджеров. Прямой связи с КП-генератором сейчас нет; в будущем через `kp-generator-v2` можно будет считать комиссию менеджера по сделке. |

---

## Полезные ссылки

- `changelog_kp_generator.md` — журнал релизов **для менеджеров** (последняя запись 28.04.2026, требует обновления до текущего состояния).
- `docs/audits/AUDIT_FULL_2026_05_14.md` — полный аудит проекта от 14.05.2026 (11 P0, 23 P1, 18 P2 — список того, что сломано/долг).
- `docs/audits/{ARCHITECTURE,LOGIC_BUGS,UX_WORKFLOW,SECURITY_PERF_BUILD}_AUDIT_2026-05-14.md` — детальные подаудиты по веткам.
- `docs/ONBOARDING.md` — пошаговая «первый день» инструкция (для тебя как новичка).
- `KP-SPEC.md` — старая спецификация. **Цены в ней устарели** (`15 000 ₽` за внедрение и `800 ₽` за контент), реальные — в `src/lib/catalog.ts` (20 000 и 1 200).

---

## Правила работы с Claude

В этом проекте два режима:

### Режим A — auto-apply (без подтверждения)

Claude может делать без отдельного «поехали»:

- Чтение любых файлов
- Поиск по коду
- Создание/правка документов (`*.md`)
- Аудиты, research-задачи
- Smoke-тесты в sandbox

### Режим B — pause-and-confirm (для прод-кода и БД)

Claude **обязан** показать план/diff и дождаться твоего «поехали» прежде чем:

- Менять код в `src/` (особенно `calculator.ts`, `generatePptx.ts`, `catalog.ts`)
- Создавать/менять SQL-миграции в `supabase/`
- Менять `package.json`, `.env*`, `next.config.js`, `tsconfig.json`
- Удалять файлы (даже мёртвые — git history is forever)

Если задача неоднозначная — Claude использует `AskUserQuestion` для уточнения **перед** запуском работы.

### Архитектурные правила

1. **Single source of truth для формул:** любая арифметика по `LineItem` идёт через `recomputeLineTotal()` в `src/lib/calculator.ts`. Не дублировать `total = unitPrice × qty × ...` в превью или генераторе.
2. **`LineItem.months` для подписок:** для лицензий/подписок ВСЕГДА `unitPrice` хранит цену за месяц, `months` — период. Не возвращайся к старой семантике «`unitPrice = price × months`» — это закрытый баг (P0-3 в аудите 14.05.2026).
3. **Лимиты `.pptx` шаблона:** добавление позиций сверх `PPTX_TEMPLATE_LIMITS` не должно молча уходить в обрезание. Если расширяешь карточку — расширяй симметрично: и `expandCardRows` (XML-клонирование), и `adjustCardGeometry` (футер), и лимит в `PPTX_TEMPLATE_LIMITS`.
4. **Не возвращай мёртвый код:** OpenAI, jsPDF, font-lato, renderSlideImage — это PDF-эпоха. Если нужна AI-фича — обсуждаем заново, чтобы не плодить тонны base64 в bundle.
5. **Перед изменением — прочитать:** `docs/audits/AUDIT_FULL_2026_05_14.md` (что уже известно сломанным), `changelog_kp_generator.md` (история фич), CLAUDE.md в корне `Claude (code)/` (workspace-правила).
6. **Не ломать прошлую логику:** правки идут как extension, не replacement. Если хочешь убрать ветку кода — убедись, что она реально не используется (`grep -r` сначала).

### Когда использовать subagent

Для **глобальных аудитов**, ресёрчей через 4+ файла одновременно, длинных независимых задач (например «проверь все edge cases в calculator») — Claude должен запускать `Agent` (subagent), а не делать сам. Это экономит контекст и даёт более глубокий проход.

---

## Команды

```bash
npm run dev          # Dev-сервер на :3000
npm run build        # Production build
npm run start        # Запуск production-сборки локально
npx tsc --noEmit     # TypeScript-check без эмита
```

ESLint и тесты пока не настроены — это P2-долг (см. аудит, D15/D16).

---

## Известные ограничения

- **БОНДА .pptx-flow не работает корректно** — выгружается inno-шаблон. Кнопку лучше не нажимать для БОНДА-сделок до фикса.
- **Google Sheets ID в клиентском бандле + закупочные цены/маржа в самом sheet** — это сознательно принятый риск (P0-7 в аудите). Не публиковать ссылку на sheet вне команды.
- **Нет CI** — `npm run build` нужно прогонять руками перед push в `main`.
- **page.tsx — 1100+ LOC client component с 14+ `useState`** — рефакторинг на компоненты + `useReducer` в бэклоге (H8/H9/A4).

Подробности по каждому пункту — в `docs/audits/AUDIT_FULL_2026_05_14.md`.
