# Library Management System — курсова робота

**Дисципліна:** Документування програмного забезпечення та шаблони проєктування  
**Варіант:** 20 — Бібліотека (платний бібліотечний абонемент)

> Backend і frontend ініціалізовано. Доступні Express health API та адаптивний інтерфейс із навігацією і явно позначеними сторінками запланованих модулів. Бізнес-логіку й інтеграцію frontend з API ще не реалізовано.

## Призначення

Вебсистема для бібліотекаря та адміністратора: облік книг і примірників, реєстрація читачів, видача/повернення книг, застави, оплата прокату, штрафи, категорії знижок та фінансові звіти. Читач не входить у систему.

## Структура репозиторію та деплой

Проєкт організований як **монорепозиторій** із двома незалежними застосунками:

- `frontend/` — React-вебінтерфейс бібліотекаря та адміністратора; плануємо розгортати на **Vercel**.
- `backend/` — REST API та бізнес-логіка; плануємо розгортати на **Render**.
- `docs/` — вимоги, бізнес-правила, діаграми та архітектурні рішення.

База даних — PostgreSQL 18. Локальний сервіс БД налаштовано через Docker Compose; хмарного провайдера БД визначимо перед деплоєм. Frontend звертатиметься до backend через налаштовану адресу API. Деплой ще не виконано.

## Майбутній стек

- Frontend: React, TypeScript, Vite, Tailwind CSS
- Backend: Node.js, TypeScript, Express, Zod
- Database: PostgreSQL, Prisma
- Backend tests: вбудований `node:test` та HTTP-запити через `fetch`; Vitest/Supertest поки не підключені
- Dev environment: Docker Compose
- UML: PlantUML

## Локальний запуск PostgreSQL

Потрібні Docker Engine та Docker Compose (наприклад, Docker Desktop у режимі Linux containers). У корені репозиторію є `compose.yaml` з одним сервісом `db` на офіційному образі `postgres:18`. Frontend і backend запускаються окремо на хості.

Виконайте **з кореня репозиторію**:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

У Linux/macOS: `test -f .env || cp .env.example .env`. Відредагуйте кореневий `.env`, задавши власний непорожній `POSTGRES_PASSWORD`. Для пароля із `$` або `#` використовуйте одинарні лапки навколо значення, щоб Compose прочитав його буквально. Пароль не має бути у Git; кореневий `.env` уже виключено правилами `.gitignore`. Кореневий `.env` налаштовує Compose, а `backend/.env` і `frontend/.env` налаштовують відповідні застосунки незалежно.

| Параметр | Локальне значення |
| --- | --- |
| `POSTGRES_DB` | `library_db` |
| `POSTGRES_USER` | `library_user` |
| `POSTGRES_PASSWORD` | Власний пароль лише в кореневому `.env` |
| `POSTGRES_HOST_PORT` | `5433` |
| Host для клієнта на комп'ютері | `localhost` (прив'язка Docker лише до `127.0.0.1`) |
| Порт PostgreSQL у контейнері | `5432` |

Порожній або відсутній пароль спричинить помилку Compose ще до запуску. Значення змінних у середовищі shell мають пріоритет над `.env`. Перевірка конфігурації без виведення пароля та запуск з очікуванням healthcheck:

```powershell
docker compose config --quiet
docker compose up -d --wait --wait-timeout 120 db
docker compose ps db
```

Очікуваний стан — `healthy`. Healthcheck виконує `pg_isready` через TCP на внутрішньому порту `5432`; він перевіряє готовність сервера приймати з'єднання, а не правильність пароля. Якщо порт `5433` зайнятий, спочатку перевірте, який процес його використовує, або змініть `POSTGRES_HOST_PORT` у `.env`. У командах зовнішнього клієнта тоді використовуйте новий порт.

Простий SQL-запит через `psql`, який уже є в контейнері; `-W` запитує пароль інтерактивно, без його запису в історію команд:

```powershell
docker compose exec db psql -h db -p 5432 -U library_user -d library_db -W -c "SELECT 1;"
```

Ім'я `db` тут доступне всередині Compose-мережі. Для перевірки підключення **з хоста**, якщо локально встановлено `psql`:

```powershell
psql -h localhost -p 5433 -U library_user -d library_db -W -c "SELECT 1;"
```

Обидва запити мають повернути `1`. Якщо змінили назву БД або користувача в `.env`, підставте відповідні значення. Prisma налаштовано в backend для наявної БД; бізнес-моделей, прикладних таблиць, міграцій і тестових даних на цьому етапі немає.

Перегляд логів і зупинка:

```powershell
docker compose logs --tail=100 -f db
docker compose stop db
```

`Ctrl+C` завершує лише перегляд логів. Для повторного запуску використовуйте ту саму команду `docker compose up -d --wait --wait-timeout 120 db`. `docker compose down` також можна використовувати для видалення контейнера та Compose-мережі: без прапорця `-v` named volume зберігається.

Named volume `postgres_data` змонтовано в `/var/lib/postgresql` — правильний шлях для [офіційного образу PostgreSQL 18](https://hub.docker.com/_/postgres). Фактичний каталог даних за замовчуванням — `/var/lib/postgresql/18/docker`. Docker Compose додає до імені volume префікс проєкту, наприклад `coursework_patterns_postgres_data`. Цей volume зберігає дані після зупинки та повторного створення контейнера; це сховище даних, а не резервна копія. Для повторного використання того самого volume запускайте Compose з тим самим ім'ям проєкту.

**Не виконуйте `docker compose down -v`, `docker volume rm` або очищення volumes:** вони можуть видалити дані. Змінні `POSTGRES_DB`, `POSTGRES_USER` та `POSTGRES_PASSWORD` ініціалізують лише порожній каталог: зміна `.env` не перейменує вже створену БД і не змінить її пароль. Для наявного volume використовуйте його чинні облікові дані; не видаляйте volume для скидання налаштувань.

## Локальний запуск backend

Потрібні **Node.js 24.x** та npm. Команди виконуються в `backend/`, який має власні `package.json` і `package-lock.json`.

```powershell
cd backend
npm ci
Copy-Item .env.example .env
npm run dev
```

У Linux/macOS для копіювання використовуйте `cp .env.example .env`. Якщо `.env` уже існує, редагуйте його, не перезаписуючи власні налаштування. У Windows PowerShell, якщо запуск `npm.ps1` заблокований політикою виконання, використовуйте `npm.cmd` замість `npm`.

Змінні середовища:

| Змінна | Призначення |
| --- | --- |
| `NODE_ENV` | `development`, `test` або `production`; типово `development` |
| `PORT` | Порт HTTP-сервера від 1 до 65535; типово `3000` |
| `CORS_ORIGIN` | Обов'язковий точний origin frontend: протокол, хост і за потреби порт; без шляху та завершального `/` |
| `DATABASE_URL` | Приватний PostgreSQL connection URL для Prisma; приклад наведено в `backend/.env.example` |

У `.env.example` наведено лише несекретні налаштування локального запуску. `dotenv` читає `.env` із поточної папки; змінні, вже задані в середовищі процесу, мають пріоритет. Некоректна конфігурація зупиняє запуск із повідомленням про відповідне поле. `.env`, залежності та `dist/` виключено з Git.

За параметрів із прикладу перевірте `http://localhost:3000/api/health` у браузері або PowerShell:

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

Відповідь: HTTP `200`, JSON `{"status":"ok"}`. Це перевірка роботи HTTP API; з'єднання з БД ще немає. CORS дозволяє браузерне читання відповіді лише для `CORS_ORIGIN` та обробляє preflight. Запити без `Origin` працюють; CORS не замінює майбутню автентифікацію. Передавання cookies через CORS поки не ввімкнено.

Команди backend:

| Команда | Дія |
| --- | --- |
| `npm run dev` | Запуск TypeScript через `tsx watch` із перезапуском після змін коду |
| `npm run build` | Генерація Prisma Client, перевірка TypeScript і збірка `src/` у `dist/` |
| `npm start` | Запуск зібраного `dist/server.js`; спочатку виконайте збірку |
| `npm test` | Автоматизовані HTTP-тести та перевірки конфігурації без окремого запущеного сервера чи `.env` |
| `npm run typecheck` | Генерація Prisma Client і перевірка типів серверного коду, тестів, скриптів та Prisma-конфігурації без JS-збірки |

Для запуску зібраного застосунку виконайте `npm run build`, потім `npm start`. Після редагування `.env` перезапустіть сервер.

```text
backend/
├── src/
│   ├── config/env.ts              # Перевірка конфігурації через Zod
│   ├── lib/prisma.ts              # Спільний Prisma Client і PostgreSQL adapter
│   ├── generated/prisma/          # Згенерований клієнт, виключено з Git
│   ├── middleware/error-handler.ts # JSON-помилки API
│   ├── middleware/not-found.ts    # JSON-відповідь 404
│   ├── routes/index.ts            # Маршрути /api, наразі GET /health
│   ├── app.ts                     # Express, CORS, JSON і middleware
│   └── server.ts                  # Завантаження .env та запуск HTTP-сервера
├── test/                          # HTTP-тести та валідація середовища
├── scripts/check-database.ts       # Безпечна перевірка SELECT 1 через Prisma
├── prisma/schema.prisma            # Datasource і generator без бізнес-моделей
├── prisma7.config.ts               # Конфігурація Prisma CLI 7.10+
├── .env.example                   # Приклад локальної конфігурації
├── package.json / package-lock.json
└── tsconfig.json / tsconfig.test.json
```

Залежності: `express` — HTTP API та маршрутизація; `cors` — CORS-заголовки й preflight; `dotenv` — читання `.env`; `zod` — перевірка змінних середовища. Для розробки: `typescript` — перевірка типів і компіляція; `tsx` — виконання TypeScript і watch-режим; `@types/node`, `@types/express`, `@types/cors` — декларації типів. Окрема бібліотека тестування не потрібна.

Невідомі маршрути повертають JSON із HTTP `404`; некоректний JSON — `400`, перевищення ліміту тіла 100 КіБ — `413`. Непередбачені помилки повертають `500` без внутрішніх деталей у відповіді та записуються в серверну консоль. Формат помилок: `{"error":{"code":"NOT_FOUND","message":"Route not found"}}`.

Локальний PostgreSQL запускається окремо через кореневий Compose. Prisma налаштовано для цього PostgreSQL; бізнес-моделі та налаштування хостингу будуть окремими етапами.

## Prisma ORM у backend

Встановлено стабільну **Prisma ORM 7.10.1**: CLI `prisma` у dev-залежностях, `@prisma/client` і PostgreSQL adapter `@prisma/adapter-pg` тієї самої версії у runtime-залежностях. Драйвер `pg` працює через TCP; `@types/pg` надає декларації типів. Версії Prisma зафіксовано точно, щоб оновлення не переводило проєкт на Prisma 8. Використовується наявний локальний PostgreSQL; нових хмарних сервісів немає.

За [документацією Prisma 7](https://www.prisma.io/docs/v7/prisma-orm/quickstart/postgresql), `backend/prisma7.config.ts` завантажує `backend/.env` через `dotenv` та задає URL datasource. Назва `prisma7.config.ts` підтримується починаючи з 7.10. У `prisma/schema.prisma` є лише PostgreSQL datasource та генератор `prisma-client`, без моделей. Не додавайте другу конфігурацію Prisma поруч із наявною.

У `backend/.env` задайте `DATABASE_URL` у форматі прикладу з `backend/.env.example`: хост `127.0.0.1`, порт `5433`, база `library_db`, користувач `library_user`. Замість `YOUR_URL_ENCODED_PASSWORD` потрібен фактичний пароль із кореневого `.env`, закодований через `encodeURIComponent`: наприклад, `@` → `%40`, `#` → `%23`, `%` → `%25`. Кодується компонент пароля, а не весь URL; не кодуйте вже закодований пароль повторно. За зміни зовнішнього порту PostgreSQL змініть його і в `DATABASE_URL`. Не виводьте повний URL у логи та не додавайте `.env` до Git. Кореневий `.env` не завантажується в backend автоматично.

Команди виконуються в `backend/`, після `npm ci` і налаштування `.env`:

| Команда | Призначення |
| --- | --- |
| `npm run prisma:validate` | Перевірити Prisma-конфігурацію і схему без змін у БД |
| `npm run prisma:generate` | Згенерувати Prisma Client локально, без підключення до БД |
| `npm run prisma:format` | Відформатувати лише `schema.prisma` |
| `npm run db:check` | Згенерувати клієнт, виконати `SELECT 1` через Prisma і закрити пул з'єднань |

`dev`, `build` і `typecheck` також генерують Prisma Client, тому чистий checkout не потребує згенерованих файлів у Git. Для генерації потрібен `DATABASE_URL` у конфігурації, проте сама генерація не підключається до PostgreSQL. У `src/lib/prisma.ts` експортується єдиний `prisma` з `PrismaPg` adapter; ESM-кешування забезпечує повторне використання клієнта та пулу в межах процесу. Клієнт підключається під час запитів. HTTP health-маршрут залишається незалежним від доступності БД.

Згенеровані TypeScript-файли потрапляють у `src/generated/prisma/`, виключені через `backend/.gitignore` і компілюються в `dist/generated/prisma/`. Генератор використовує ESM та `.ts`-імпорти для запуску через `tsx`; `rewriteRelativeImportExtensions` у TypeScript переписує їх у `.js` для запуску зібраного коду через Node.js.

Початкова схема дозволяє виконувати сирий параметризований SQL, зокрема перевірку `SELECT 1`, навіть без моделей. Команди міграцій, `db push`, seed та створення таблиць на цьому етапі не використовуються. Бізнес-моделі й перші міграції потребують окремого завдання.

## Локальний запуск frontend

Потрібні **Node.js 24.x** та npm. Frontend — незалежний React + Vite + TypeScript застосунок із власними залежностями й lock-файлом. Виконайте з кореня репозиторію:

```powershell
cd frontend
npm ci
Copy-Item .env.example .env
npm run dev
```

У Linux/macOS використовуйте `cp .env.example .env`; наявний `.env` не перезаписуйте. Якщо PowerShell блокує `npm.ps1`, запускайте `npm.cmd`. Відкрийте `http://localhost:5173`. Порт розробки зафіксовано: якщо він зайнятий, Vite повідомить про помилку замість автоматичного переходу на інший порт.

Frontend на цьому етапі працює без запущеного backend: реальних HTTP-запитів, авторизації, фіктивних книг, читачів, прокатів або фінансових показників немає. На головній є робочі посилання на розділи; інші сторінки явно повідомляють, що їхній функціонал запланований.

| Адреса | Сторінка |
| --- | --- |
| `/` | Перенаправлення на `/dashboard` |
| `/dashboard` | Головна (Dashboard) |
| `/books` | Книги |
| `/readers` | Читачі |
| `/rentals` | Прокати |
| `/reports` | Звіти |
| `/administration` | Адміністрування |
| Інші адреси | Сторінка 404 із посиланням на головну |

У `frontend/.env.example` наведено `VITE_API_URL=http://localhost:3000/api`. Це публічна базова адреса API **з префіксом `/api`**. `src/api/config.ts` читає її через `import.meta.env`, перевіряє HTTP(S)-формат і прибирає завершальний `/`; самих запитів поки немає. Значення необов'язкове для поточних сторінок. Не додавайте `DATABASE_URL`, токени чи інші секрети до `VITE_*`: Vite включає ці змінні в клієнтську збірку. Після зміни `.env` перезапустіть Vite; для зміни адреси у зібраному застосунку потрібна повторна збірка.

| Команда в `frontend/` | Призначення |
| --- | --- |
| `npm run dev` | Vite dev server із гарячим оновленням |
| `npm run typecheck` | Строга перевірка типів React-коду та конфігурації Vite |
| `npm run lint` | ESLint: TypeScript, правила React Hooks і Fast Refresh; попередження спричиняють помилку |
| `npm run check` | TypeScript та ESLint разом |
| `npm run build` | Перевірка типів і production-збірка в `frontend/dist/` |
| `npm run preview` | Локальний перегляд готової збірки після `npm run build` |

```text
frontend/
├── public/favicon.svg          # Локальна піктограма застосунку
├── src/
│   ├── api/config.ts           # Конфігурація для майбутніх API-запитів
│   ├── components/             # Спільний layout, навігація та SVG-піктограми
│   ├── pages/                  # Dashboard, сторінки запланованих розділів, 404
│   │   └── sections.ts         # Назви, адреси й описи розділів
│   ├── types/navigation.ts     # Типи описів розділів і піктограм
│   ├── App.tsx                # Дерево клієнтських маршрутів
│   ├── main.tsx               # React root, StrictMode, BrowserRouter
│   ├── styles.css             # Tailwind, кольори, типографіка, фокус клавіатури
│   └── vite-env.d.ts          # Типи змінних середовища Vite
├── index.html                 # HTML із lang="uk" і viewport для мобільних
├── .env.example
├── package.json / package-lock.json
├── vite.config.ts
├── eslint.config.js
└── tsconfig*.json
```

Використано `react` і `react-dom` для компонентів та рендерингу, `react-router` для клієнтської маршрутизації, `vite` і `@vitejs/plugin-react` для розробки та збірки. Tailwind підключений через `@tailwindcss/vite` та CSS `@import 'tailwindcss'`; окремі PostCSS/Autoprefixer-конфігурації не потрібні. `typescript`, декларації типів і ESLint із плагінами забезпечують перевірки якості. UI-бібліотек, зовнішніх шрифтів та сервісів немає.

TypeScript frontend обмежено стабільною гілкою `6.0.x`: поточний `typescript-eslint` підтримує TypeScript нижче `6.1`. Версії двох незалежних застосунків можуть відрізнятися.

Стан аудиту на 10.11.2026: `npm audit` повідомляє про 10 помірних попереджень, пов'язаних з одним транзитивним `minimatch@10.2.6` у dev-залежностях ESLint/typescript-eslint ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)). У production-дереві `minimatch` відсутній. Виправлена гілка `11.0.1+` виходить за діапазони цих інструментів; примусові overrides та `npm audit fix --force` не застосовувалися. Потрібно відстежити сумісне оновлення інструментів.

На десктопі використовується бічна навігація; на вузьких екранах — меню, яке розгортається, та одна колонка контенту. Передбачено активний розділ, видимий фокус клавіатури й посилання «Перейти до вмісту». У майбутньому хостинг має повертати `index.html` для прямих переходів на клієнтські маршрути; конфігурацію хостингу додамо окремою задачею.

## Документація

- [Функціональні вимоги](docs/requirements.md)
- [Бізнес-правила](docs/business-rules.md)
- [Архітектурні рішення](docs/architecture.md)
- [План деплою](docs/deployment.md)
- [Use Case Diagram](docs/diagrams/use-case.puml)
- [ERD](docs/diagrams/erd.puml)
- [Початкова UML Class Diagram](docs/diagrams/class-diagram.puml)

## Патерни GoF

Factory Method (генератори звітів), Template Method (процес формування звіту), Strategy (механізм знижок), Observer (події прокату).

## Стан проєкту

1. [x] Попередній аналіз і бізнес-правила
2. [x] Початкові діаграми для обговорення
3. [x] Початкова ініціалізація backend
   - [x] Початкова ініціалізація frontend
4. [ ] База даних та CRUD
   - [x] Локальний PostgreSQL 18 через Docker Compose
   - [x] Початкове налаштування Prisma ORM 7 без бізнес-моделей і міграцій
5. [ ] Видача, повернення, фінансові розрахунки
6. [ ] Звіти, панель адміністратора
7. [ ] Тести й остаточна документація

Ці діаграми — проєктні, не схема вже реалізованого коду. Їх потрібно уточнювати в міру розробки.
