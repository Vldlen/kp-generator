# Аудит kp-generator — Security / Perf / Dependencies / Build

Дата: 2026-05-14
Аудитор: Claude (subagent)
Ветка / коммит: HEAD = `3cdac51` от 06.05.2026
Окружение: Vercel production, Next.js 14.2.5 (App Router), React 18, TypeScript 5.5, Supabase, Google Sheets (public read-link), без API routes.

---

## Summary

kp-generator на сегодня — это **чистая Client-Side SPA на Vercel без единого API route и без аутентификации**. Главная страница `src/app/page.tsx` (1244 LOC) делает три вещи: тянет каталог из публичной Google Sheets (CSV/XLSX export), фоллбэчится на Supabase `catalog`, и собирает PPTX в браузере через `jszip` + готовые шаблоны из `public/templates/`. OpenAI из `package.json` **в код не подключён**: `prompt.ts` содержит только текст системного промпта (артефакт прошлой архитектуры), импортов `openai`, `fetch(api.openai)`, gpt-вызовов в `src/` нет — это значит, что `OPENAI_API_KEY` сейчас бесполезный, но и не утекает.

Главные риски: (1) **RLS на Supabase открыт на запись для `anon`** — любой, у кого есть URL приложения, может перезаписать прайс-лист; (2) **полная публичность Google Sheets с ценами закупки и маржой** — sheet ID захардкожен в клиентском бандле, любой пользователь может его увидеть в DevTools и забрать `cost_price` / `margin`; (3) **Next 14.2.5 содержит как минимум 3 публичных CVE**, включая критический CVE-2025-29927 (middleware auth bypass) и CVE-2024-46982 (cache poisoning); (4) git репозиторий содержит мусор — `.vercel/project.json` (проект/org ID), `kp-generator-deploy.tar.gz` (12 МБ), две (!) 880 КБ ts-файла со встроенными base64-шрифтами, которые **никогда не импортируются**.

Из строн — есть `escapeXml()` для XML-инъекций в PPTX, нет `dangerouslySetInnerHTML`, нет `eval`, `.env.local` в `.gitignore` и не в истории git, секреты читаются только из `NEXT_PUBLIC_*`, серверных секретов нет (потому что нет server-side кода вообще).

---

## Findings

### P0 — критические

#### D1. Supabase RLS полностью открыт — anon ключ может перезаписать каталог

**Файл:** `supabase/001_create_products.sql:62-69`

```sql
ALTER TABLE catalog ENABLE ROW LEVEL SECURITY;
...
CREATE POLICY "Allow all for catalog" ON catalog FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for hints" ON compatibility_hints FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for volume_discounts" ON volume_discounts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for period_discounts" ON period_discounts FOR ALL USING (true) WITH CHECK (true);
```

RLS включён, но политики `FOR ALL USING (true) WITH CHECK (true)` означают: anon ключ может **SELECT, INSERT, UPDATE, DELETE** все четыре таблицы. Anon ключ в `src/lib/supabase.ts:3-6` уезжает в клиентский bundle через `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Любой пользователь, открыв DevTools, читает ключ → может через REST API:
- удалить каталог: `DELETE /rest/v1/catalog`
- занулить цены: `UPDATE /rest/v1/catalog SET sell_price=1`
- прочитать `cost_price`, `margin`, `supplier_article` — всё, что менеджеры внутри используют для планирования маржи.

**Что делать (приоритет 1):**
1. Минимум: `CREATE POLICY "anon_read" ... FOR SELECT USING (true)` и убрать остальные политики — пусть anon только читает.
2. Не возвращать `cost_price`, `margin`, `supplier`, `supplier_article` через anon-views — создать `catalog_public` view только с `name`, `sell_price`, `category`, `image_url` и дать SELECT только на view.
3. Если планируется писать каталог из админки — делать через service_role в API route с авторизацией.

---

#### D2. Google Sheets ID и URL захардкожены в клиенте; sheet публичен; в нём же цены закупки и маржа

**Файл:** `src/app/page.tsx:889`

```ts
const GOOGLE_SHEET_ID = '1GGIOWoQmk7yLZjWSeY0wpFiKgrrYZ62TV2numdL7qXc'
```

И ниже (line 899, 924):
```ts
const xlsxUrl = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/export?format=xlsx`
const url = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/export?format=csv&gid=${gid}`
```

Проблема: ID лежит в клиентском бандле (page.tsx помечен `'use client'`). Через эндпоинт `export?format=xlsx` без авторизации доступны **все листы** — то есть в `parseRowToProduct` (page.tsx:966) парсятся колонки «Закупочная»/«Себестоимость» и «Маржа»/«Рентабельность» — значит они есть в самом sheet. Любой человек, открывший сайт, видит ID, открывает таблицу и забирает себестоимость и маржу.

Доп. риск: sheet с включённым «у кого есть ссылка — Читатель», поэтому даже без appа любой может пройти по ссылке. Если sheet был случайно настроен на «Редактор» — конкурент может править прайс прямо в источнике.

**Что делать:**
1. Выкинуть `cost_price` и `margin` из публичного листа. Калькулятор считает только по `sell_price` — закупка не нужна.
2. Перенести fetch в Next.js API route (`/api/catalog`), который проксирует Google Sheets, фильтруя чувствительные колонки. Это убирает ID из клиента и даёт точку для кеша.
3. Подтвердить вручную права доступа к sheet (читать — да, редактировать — только владелец).
4. Долгосрочно — каталог в Supabase, sheet оставить как админский источник.

---

#### D3. Next.js 14.2.5 с публичными CVE — критический фиксы пропущены

**Файл:** `package.json:11`, `node_modules/next/package.json` (версия `14.2.5`, последний релиз ветки 14 на момент аудита — `14.2.30+`)

Известные CVE для `<14.2.30`:
- **CVE-2025-29927** (CVSS 9.1) — обход authorization middleware через спецзаголовок `x-middleware-subrequest`. Фикс в 14.2.25. У kp-generator middleware нет, **поэтому прямого эксплойта здесь нет**, но если middleware появится — он будет broken by default.
- **CVE-2024-46982** (CVSS 7.5) — cache poisoning. Фикс в 14.2.10. Vercel-deploy кэширует, риск реален.
- **CVE-2024-51479** — auth bypass в Pages Router. Не используется (App Router) — не критично.
- **CVE-2024-34351** — SSRF через Server Actions. Server Actions не используются.

Рекомендация: `npm install next@14.2.30` — это патч-обновление в той же мажорке, breaking changes минимальны (но потребуется тестовая прогонка PPTX-генерации, потому что страница огромная и client-only).

---

### P1 — важные

#### D4. `.vercel/project.json` и `kp-generator-deploy.tar.gz` закоммичены в git

**Файлы:** `.vercel/project.json`, `.vercel/README.txt`, `kp-generator-deploy.tar.gz`

`git ls-files | head` подтверждает, что оба под версионным контролем. `.vercel/project.json` содержит `projectId` и `orgId`:

```json
{"projectId":"prj_6shsLrlDy0g48PRJKZfCDK1oAo6e","orgId":"team_akTlEWbOzItsyAE9L40AAqHA","projectName":"kp-generator"}
```

Сам по себе ID не даёт доступ, но он + утечка vercel-токена в любом месте = таргетированная атака. Vercel явно рекомендует **не коммитить** этот файл (см. `.vercel/README.txt`).

`kp-generator-deploy.tar.gz` — 12 МБ артефакта в репо. Проверил содержимое: **секретов внутри нет** (есть только `.env.local.example`), но это всё равно мёртвый груз, который тормозит `git clone` и операции с историей.

**Что делать:**
1. Добавить в `.gitignore`: `.vercel/`, `*.tar.gz`.
2. `git rm --cached .vercel/project.json .vercel/README.txt kp-generator-deploy.tar.gz` + коммит.
3. Опционально — `git filter-repo` чтобы выкинуть тарбол из истории целиком (репо приватный, поэтому необязательно).

---

#### D5. OpenAI dependency установлена, но не используется — мёртвая поверхность атаки

**Файл:** `package.json:13` (`"openai": "^4.52.0"`), `.env.example:5` (`OPENAI_API_KEY=sk-your-key`), `.env.local.example:2`

`grep -rn "openai\|OpenAI\|gpt-\|completions" src/` → **ноль вхождений**. `prompt.ts` содержит только текст SYSTEM_PROMPT и тип `ParsedRequest`, никаких вызовов API нет. Если `OPENAI_API_KEY` в Vercel env var выставлен — он висит мёртвым грузом, но при этом продолжает съедать audit-surface (вдруг утечёт логами CI, попадёт в `.env`-файл, etc).

**Что делать:**
1. `npm uninstall openai` (-1.5 МБ в `node_modules`, чище dependency tree).
2. Убрать `OPENAI_API_KEY` из `.env.example` и `.env.local.example`.
3. Если ключ был выставлен в Vercel — отозвать его на стороне OpenAI и удалить env var.
4. Удалить или явно пометить `src/lib/prompt.ts` как dead code (он импортирует только тип `ParsedRequest` — этот тип переехал бы в `src/lib/types.ts`).

---

#### D6. Мёртвый код: `font-lato.ts` (864 КБ), `font-lato-bold.ts` (892 КБ), `renderSlideImage.ts` (15 КБ), `slides.ts` (6 КБ)

**Файлы:** `src/lib/font-lato.ts`, `src/lib/font-lato-bold.ts`, `src/lib/renderSlideImage.ts`, `src/lib/slides.ts`

```
src/lib/font-lato.ts:        export const LATO_REGULAR = "AAEAAAARAQAA..." (864 КБ base64)
src/lib/font-lato-bold.ts:   export const LATO_BOLD = "AAEAAAARAQAA..."    (892 КБ base64)
```

`grep` показал ноль вхождений `LATO_REGULAR` / `LATO_BOLD` / `renderSlideImage` / `slides` где-либо в `src/`. Это артефакты архитектуры на jsPDF, которая теперь не используется (PPTX-путь).

Влияние: TypeScript-компилятор парсит эти файлы при каждом `next build`, замедляет инкрементальные пересборки, увеличивает `.next/` (101 МБ) и `tsconfig.tsbuildinfo` (86 КБ). Сами файлы в браузерный bundle не попадают (потому что не импортируются tree-shaker'ом Next).

**Что делать:** `rm src/lib/font-lato.ts src/lib/font-lato-bold.ts src/lib/renderSlideImage.ts src/lib/slides.ts` + проверить `npm run build` зелёный. Это убирает ~1.8 МБ мусора и ускоряет билд.

---

#### D7. Dependency: `jspdf` и `jspdf-autotable` установлены, но не используются

**Файл:** `package.json:9-10`

`grep -rn "jspdf\|jsPDF" src/` → ноль вхождений (после удаления font-lato они тем более не нужны). 600+ КБ в node_modules.

**Что делать:** `npm uninstall jspdf jspdf-autotable`.

---

#### D8. Анонимный пользователь может вызвать неограниченный fetch на Google Sheets через UI

**Файл:** `src/app/page.tsx:893-940` (`fetchGoogleSheetProducts`), вызывается из:
- автоматически в `useEffect` при загрузке страницы (line 76)
- по кнопке «Синхронизировать из Google Sheets» (line 1041, 1119)
- по кнопке «Обновить каталог» (line 1146)

Нет rate limiting, нет debounce, нет кэша. Менеджер может зажать кнопку — каждый клик 1 XLSX (несколько мегабайт) + до 10 CSV-запросов на gid 0..9 (с пустыми ответами в конце). На Vercel это не критично (запросы идут НЕ через Vercel), но Google может рейт-лимитить export endpoint после нескольких сотен запросов с одного IP → пользователь увидит «Таблица пуста» и не поймёт почему.

**Что делать:** добавить в-памяти кэш на 5 минут (`localStorage` с TTL), это решает 90% случаев. И/или дебаунс на 2 секунды на кнопках синка.

---

#### D9. `<img src={k.image_url}>` берёт URL из неконтролируемого источника (Google Sheets)

**Файл:** `src/app/page.tsx:453`

```tsx
<img src={k.image_url} alt={k.name} className="..." />
```

`image_url` парсится из колонки «Фото» Google Sheets (`page.tsx:994`). Любой, у кого есть write-доступ к sheet, может вставить:
- tracking pixel (узнать, кто из менеджеров заходит когда),
- ссылку с `?cookie=` — credentialless, но всё равно утечка Referer,
- gigantic image, чтобы тормозить страницу.

Не XSS (`<img src=>` не исполняет JS), но утечка приватности и доступности.

**Что делать:** валидировать URL (`https://` only, allowlist на доверенные домены типа `imgur.com`, `googleusercontent.com`), или прокачивать через Next/Image proxy с allowlist в `next.config.js` (`images.remotePatterns`).

---

#### D10. Нет CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy

**Файл:** `next.config.js`

```js
const nextConfig = {}
module.exports = nextConfig
```

Конфиг пустой. Нет `headers()`, нет CSP, нет referrer-policy. Загрузка `https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js` (page.tsx:877) без SRI (integrity hash) — если cdn.sheetjs.com скомпрометируют, в страницу залезет malicious JS.

**Что делать:**
1. Добавить `headers()` в `next.config.js`: CSP с `script-src 'self' https://cdn.sheetjs.com`, `img-src 'self' https://*.googleusercontent.com data:`, `frame-ancestors 'none'`.
2. Лучше — установить `xlsx` как npm-пакет и не грузить с CDN вообще. Это даёт детерминированный build и обходит угрозу supply chain через CDN.

---

### P2 — улучшения

#### D11. `tsconfig.tsbuildinfo` (86 КБ) присутствует в репо

**Файл:** `tsconfig.tsbuildinfo` (на диске, размер 86421 байт)

`.gitignore:6` содержит `*.tsbuildinfo` — git его игнорирует, проверил. Но он есть на диске (86 КБ). Это норм для локалки, но если кто-то случайно `git add -f` — попадёт в репо. Файл инкрементальной TS-компиляции, мусор.

**Что делать:** ничего кардинального, `.gitignore` уже корректен. Можно добавить `rm -f tsconfig.tsbuildinfo` в `prebuild` для чистоты.

---

#### D12. Зависимости устаревшие (минор / патч-апдейты доступны)

Установленные версии:
- `@supabase/supabase-js`: 2.104.0 (актуально на конец 2024, текущий ~ 2.45+)
- `jszip`: 3.10.1 (актуально)
- `react`: 18.3.1 (есть React 19, но не обязательно)
- `next`: 14.2.5 (см. D3)
- `typescript`: 5.5.3 (актуальный — 5.6.x)

**Что делать:** запустить `npm outdated`, минимум поднять `next` (D3) и `@supabase/supabase-js`. Прогнать `npm audit` (в этом аудите я не запускал — node_modules заморожен в sandbox; рекомендую сделать это локально).

---

#### D13. `console.log` с количеством товаров и build-tag в проде

**Файл:** `src/components/KPPreview.tsx:240`, `:333`; `src/app/page.tsx:80, 90, 92, 793`

```ts
console.log(`[KP] Module loaded, build: ${BUILD_TAG}`)  // KPPreview.tsx:240
console.log(`Каталог загружен из Google Sheets: ${products.length} товаров`)  // page.tsx:80
```

Не утечка секретов, но лишний шум в консоли менеджеров и потенциально подсказка атакующему («ага, есть Supabase fallback, есть Google Sheets sync»).

**Что делать:** обернуть в `if (process.env.NODE_ENV !== 'production')` или вообще удалить. На прод-сборку Next автоматически их не дропает в Client Components (только в Server).

---

#### D14. Большой клиентский Component на 1244 LOC с 14+ useState

**Файл:** `src/app/page.tsx`

В одном компоненте `Home`:
- 4 useState (`step`, `form`, `kp`, `catalog`)
- + useState в подкомпонентах `CatalogUpload`, `GoogleSyncButton`, `NumberInput`
- Каждое изменение поля формы — полный re-render всего дерева (включая 100+ DOM-узлов кнопок)
- Нет `useMemo`/`useCallback` на колбэках (см. строки 98, 160, 172, 229, 246)
- `fallbackCatalog` (line 46-66) пересчитывается на каждый render, потому что вне memo

Не баг, но 1) тормозит на мобильных, 2) тяжело тестировать (тестов нет, см. D15). Рефакторинг: разнести на `<CompanySelect/>`, `<LicenseSelect/>`, `<KioskOptions/>`, `<TabletPicker/>`, `<KPGenerateButton/>`, использовать `useReducer` для `form`.

---

#### D15. Нулевое покрытие тестами

`find . -name "*.test.*" -o -name "*.spec.*"` → нет ни одного теста. Нет `vitest`, `jest`, `playwright`, `cypress` в devDependencies. Учитывая что `calculator.ts` (342 LOC) — это бизнес-логика для прод-сделок (правильность маржи, скидок), отсутствие тестов опасно.

**Что делать:** минимум — `vitest` + 20-30 тестов на `calculateKP()` для каждой комбинации `license_type` × `kiosk_type` × `subscription_period`. Сегодня каждый коммит в `calculator.ts` — рулетка.

---

#### D16. Нет ESLint, Prettier, lint-staged, husky

`package.json` содержит только `dev / build / start` скрипты. Нет `lint`, нет `format`, нет `typecheck`, нет pre-commit hooks. Next по умолчанию приносит ESLint при `create-next-app`, но конфига я не вижу. Стилистика держится «на честном слове».

**Что делать:** `npm i -D eslint eslint-config-next prettier` + `npx next lint` в CI.

---

#### D17. CI отсутствует

Нет `.github/workflows/`, нет `vercel.json` со scriptами. Single point of failure — локальный билд автора. Vercel сам прогоняет `next build` при push, но без typecheck / lint / тестов в pre-merge никаких гарантий.

**Что делать:** добавить GitHub Actions с `npm run build && tsc --noEmit && next lint`.

---

### P3 — стиль / nice-to-have

#### D18. `_misc/test-artifacts/` — 3 PPTX (2.4 МБ) + HTML preview на диске

`_misc/test-artifacts/` в `.gitignore`? Не вижу его в `.gitignore`. По `git status` он `??` (untracked) — значит ок. Но размер на диске 2.4 МБ — лучше переехать в `_archive/` или удалить.

#### D19. `escapeXml` не экранирует `'`

**Файл:** `src/lib/generatePptx.ts:106-108`

```ts
function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
```

В XML 1.0 `&apos;` нужен только внутри атрибутов с одинарными кавычками. Здесь экранируем содержимое `<a:t>` — `'` внутри текста легален. Не баг, just FYI.

#### D20. `image_url` валидация во время парсинга строки

**Файл:** `src/app/page.tsx:994`

```ts
image_url: String(row['Фото'] || row['photo'] || row['image'] || '').trim() || null,
```

`String(...)` на `undefined` → `'undefined'`. Лучше: `const raw = row['Фото'] ?? row['photo'] ?? ...; image_url: raw ? String(raw).trim() : null`. Не критично — `.trim() || null` спасает, но при `'undefined'` строка пройдёт как URL.

#### D21. `next-env.d.ts` помечен «should not be edited», но он в репо

`next-env.d.ts` коммитится — это норма для Next, но `.next/types/` нужно держать в `.gitignore` (он там есть). OK.

---

## Перечень зависимостей с оценкой

### dependencies

| Пакет | Версия | Реально нужен? | Замечания |
|---|---|---|---|
| `@supabase/supabase-js` | ^2.104.0 | **Да** | Используется как fallback каталога. Версия слегка устарела, можно поднять до 2.45+. |
| `jspdf` | ^2.5.1 | **НЕТ** (D7) | Архитектура с jsPDF выпилена, импортов нет. |
| `jspdf-autotable` | ^3.8.2 | **НЕТ** (D7) | См. выше. |
| `jszip` | ^3.10.1 | **Да** | Сердце PPTX-генерации. Динамический import — хорошо. |
| `next` | 14.2.5 | **Да** | Поднять до 14.2.30+ (D3 — CVE-фиксы). |
| `openai` | ^4.52.0 | **НЕТ** (D5) | Мёртвая зависимость. |
| `react` | ^18.3.1 | **Да** | OK. |
| `react-dom` | ^18.3.1 | **Да** | OK. |

### devDependencies

| Пакет | Версия | Замечания |
|---|---|---|
| `@types/node` | ^20.14.10 | OK |
| `@types/react` | ^18.3.3 | OK |
| `autoprefixer` | ^10.4.19 | OK |
| `postcss` | ^8.4.39 | OK |
| `tailwindcss` | ^3.4.4 | OK |
| `typescript` | ^5.5.3 | Можно до 5.6 |

### Не в `package.json`, но используются

- **`xlsx` (SheetJS)** — грузится **runtime с CDN** (`https://cdn.sheetjs.com/xlsx-0.20.3/...`) в `page.tsx:877`. См. D10 — нужен либо как npm-пакет, либо хотя бы с SRI hash.

### Отсутствуют (но нужны)

- `eslint` / `eslint-config-next` (D16)
- `prettier` (D16)
- `vitest` / `@vitest/ui` (D15)
- ничего из `@types/*` для server-side — но и server-кода нет.

---

## Strengths (что работает хорошо)

1. **`escapeXml` для XML-инъекций.** В отличие от наивных «вставим строку в шаблон», в `generatePptx.ts:106-132` есть нормальное экранирование `& < > "` перед вставкой пользовательского текста в `<a:t>`. `kp.clientName.replace(/[^a-zA-Zа-яА-Я0-9]/g, '_')` (line 539) при формировании имени файла тоже защищает от path traversal.
2. **Нет `dangerouslySetInnerHTML`, нет `eval`.** XSS-поверхность минимальна, потому что React сам экранирует.
3. **`.env.local` в `.gitignore` и не в git-истории.** Проверил `git log --all -- .env.local` — пусто. Только `.env.example` / `.env.local.example` с шаблонными значениями.
4. **Серверных секретов нет в коде.** Только `NEXT_PUBLIC_*` (page.tsx и supabase.ts). Это идеологически правильно — anon ключ можно показывать клиенту. Проблема только в политиках RLS (D1), а не в том, что ключ светится.
5. **Динамический import `jszip`** в `generatePptx.ts:379`. Это правильное code splitting — `jszip` (~100 КБ) грузится только когда менеджер нажимает «Сгенерировать PPTX», а не на каждый просмотр главной.
6. **Шаблоны PPTX лежат в `public/`**, грузятся через `fetch`. Это значит они кешируются на Vercel CDN с правильными headers без участия кода.
7. **Чистый App Router без Pages Router.** Это закрывает целый класс CVE (`CVE-2024-51479` и др.), специфичных для Pages.
8. **Никакого middleware** → атаки на `CVE-2025-29927` (middleware bypass) не работают here-and-now.
9. **TypeScript strict: true** (`tsconfig.json:6`). Хороший baseline.
10. **Tailwind purge правильно настроен** (`content: ['./src/**/*.{js,ts,jsx,tsx,mdx}']`) — CSS-bundle минимален.

---

## Open questions (требуется уточнение от владельца)

1. **Кто реально пользуется анон-доступом к Supabase?** Если только этот сайт (kp-generator на Vercel) — можно убрать `FOR ALL`, оставить только `FOR SELECT`. Если есть другие потребители anon-ключа с write-доступом (например, price-compare или ko-salary админка) — это надо знать перед миграцией.
2. **Цены закупки и маржа в Google Sheets — это намерение или артефакт?** Если намерение, чтобы менеджеры видели маржу на лету — нужно прокси через API route с авторизацией. Если артефакт — просто удалить колонки.
3. **`OPENAI_API_KEY` в Vercel выставлен?** Если да — отозвать (D5).
4. **`auto-cron Telegram` упомянут в CLAUDE.md — он часть kp-generator?** Сейчас в репозитории нет ни одного API route, ни одного cron — но если в Vercel env vars есть ключи к Telegram бот-API, они тоже мёртво лежат.
5. **Планируется ли admin UI с записью каталога из браузера?** Если да — это API route с auth, не прямой Supabase update от anon (D1).
6. **Какие IP пользуются прод-доменом?** Если внутренние менеджеры — можно за Vercel Password Protection или basic auth на edge. Это закрывает D1/D2 одним движением (не пускаем посторонних к anon ключу).
7. **TypeScript strict, но что с `next lint`?** Не вижу ESLint конфига — это сознательно или забыли при `create-next-app`?
8. **Бэкап Google Sheet есть?** Если sheet случайно сотрут (а write-доступ у нескольких людей) — каталог потеряется.

---

## TL;DR — порядок действий

1. **СЕЙЧАС:** закрыть write в RLS (D1), отозвать `OPENAI_API_KEY` (D5), убрать `cost_price`/`margin` из публичного Google Sheets (D2).
2. **На этой неделе:** `npm install next@14.2.30` (D3), `npm uninstall openai jspdf jspdf-autotable` (D5, D7), удалить мёртвые файлы (D6), убрать `.vercel/`, тарбол из git (D4).
3. **В течение месяца:** ESLint + Prettier (D16), vitest + 30 тестов на calculator (D15), CSP в `next.config.js` (D10), API route для каталога вместо прямого Google Sheets (D2, D8, D9).
4. **На горизонте:** разнести page.tsx на компоненты + useReducer (D14), CI на GitHub Actions (D17).
