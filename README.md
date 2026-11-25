# Library Management System — курсова робота

**Дисципліна:** Документування програмного забезпечення та шаблони проєктування  
**Варіант:** 20 — Бібліотека (платний бібліотечний абонемент)

> Працівники користуються каталогом, примірниками та профілями читачів через захищений API. У розділі «Прокати» доступні видача, повернення, оформлення втрати та касовий розрахунок.

## Призначення

Вебсистема для бібліотекаря та адміністратора: облік книг і примірників, реєстрація читачів, видача/повернення книг, застави, оплата прокату, штрафи, категорії знижок та фінансові звіти. Читач не входить у систему.

## Структура репозиторію та деплой

Проєкт організований як **монорепозиторій** із двома незалежними застосунками:

- `frontend/` — React-вебінтерфейс бібліотекаря та адміністратора; плануємо розгортати на **Vercel**.
- `backend/` — REST API та бізнес-логіка; плануємо розгортати на **Render**.
- `docs/` — вимоги, бізнес-правила, діаграми та архітектурні рішення.

База даних — PostgreSQL 18. Локальний сервіс БД налаштовано через Docker Compose; хмарного провайдера БД визначимо перед деплоєм. Frontend звертається до backend через налаштовану адресу API. Деплой ще не виконано.

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

Обидва запити мають повернути `1`. Якщо змінили назву БД або користувача в `.env`, підставте відповідні значення. У backend налаштовано Prisma, першу міграцію з дев'ятьма таблицями та окремий seed для локальних довідників і демонстраційного каталогу.

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
| `SESSION_TTL_SECONDS` | Абсолютна тривалість сеансу, типово 28800 секунд (8 годин), від 60 до 604800 |
| `SESSION_COOKIE_SAME_SITE` | `lax` типово, `none` доступне у production для HTTPS-запитів між різними сайтами |
| `DATABASE_URL` | Приватний PostgreSQL connection URL для Prisma; приклад наведено в `backend/.env.example` |

У `.env.example` наведено лише несекретні налаштування локального запуску. `dotenv` читає `.env` із поточної папки; змінні, вже задані в середовищі процесу, мають пріоритет. Некоректна конфігурація зупиняє запуск із повідомленням про відповідне поле. `.env`, залежності та `dist/` виключено з Git.

За параметрів із прикладу перевірте `http://localhost:3000/api/health` у браузері або PowerShell:

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

Відповідь: HTTP `200`, JSON `{"status":"ok"}`. Health перевіряє роботу HTTP API без запиту до БД. CORS дозволяє браузеру читати credentialed-відповіді лише з налаштованого `CORS_ORIGIN` і обробляє preflight.

## Вхід і керування працівниками

### Перший адміністратор

Після запуску PostgreSQL і заповнення `backend/.env` виконайте з `backend/`:

```powershell
npm ci
npm run prisma:migrate:deploy
npm run auth:bootstrap-admin
npm run dev
```

Введіть електронну адресу, пароль і підтвердження. Пароль вводиться приховано в інтерактивному терміналі. Для нових паролів потрібно 12–128 символів, щонайменше одну літеру й одну цифру або спеціальний символ. Якщо активний адміністратор уже існує, команда завершується конфліктом. Seed наповнює каталог і довідники окремою командою.

Запустіть frontend через `npm run dev` у `frontend/` та відкрийте `http://localhost:5173/login`. У шапці відображаються адреса, роль, кнопки зміни пароля й виходу. Адміністратор створює облікові записи, редагує адресу, роль і активність та встановлює нові паролі в розділі «Адміністрування». Після зміни власного пароля потрібно ввійти знову.

| Можливість | ADMIN | LIBRARIAN |
| --- | --- | --- |
| Перегляд книг і примірників | Так | Так |
| Створення, редагування, архівування книг і зміни примірників | Так | |
| Реєстрація, перегляд, редагування читачів і перегляд їхньої історії | Так | Так |
| Керування обліковими записами працівників | Так | |

### Auth і Staff API

| Метод і маршрут | Тіло запиту | Успішна відповідь |
| --- | --- | --- |
| `POST /api/auth/login` | `email, password` | `200`, `id, email, role`, cookie |
| `POST /api/auth/logout` | — | `204`, відкликання поточного сеансу й очищення cookie. Повторний виклик також дає `204` |
| `GET /api/auth/me` | — | `200`, лише `id, email, role` |
| `POST /api/auth/change-password` | `oldPassword, newPassword` | `204`, відкликання всіх сеансів працівника |
| `GET /api/staff` | — | `200`, масив записів `id, email, role, isActive` |
| `POST /api/staff` | `email, role, password` | `201`, створений запис |
| `PATCH /api/staff/:id` | підмножина `email, role, isActive` | `200`, оновлений запис |
| `POST /api/staff/:id/reset-password` | `password` | `204`, відкликання всіх сеансів працівника |

Усі маршрути під `/api` вимагають чинного сеансу, за винятком health, login, logout і CORS preflight. Запити зміни стану потребують точного `Origin` і заголовка `X-Library-Request: 1`. Немає чинного сеансу — `401 AUTH_REQUIRED`. Брак прав — `403 ROLE_FORBIDDEN`. Невдалий вхід повертає `401 INVALID_CREDENTIALS` з однаковим повідомленням для помилкових даних і неактивного запису. Перевищення ліміту спроб повертає `429 LOGIN_RATE_LIMITED`. Дублікат нормалізованої адреси дає `409 STAFF_EMAIL_EXISTS`. Система вимагає зберегти принаймні одного активного адміністратора, інакше зміна дає `409 LAST_ACTIVE_ADMIN`.

### Cookies і HTTPS

У локальних `backend/.env` та `frontend/.env` використовуйте `CORS_ORIGIN=http://localhost:5173` і `VITE_API_URL=http://localhost:3000/api`. Два порти утворюють різні origin одного сайту. `fetch` використовує `credentials: 'include'` і cookie `HttpOnly; SameSite=Lax; Path=/api`. Для послідовної роботи використовуйте ім'я `localhost` на обох адресах.

У production потрібен HTTPS для frontend і backend, а cookie має атрибут `Secure`. Два HTTPS-піддомени одного власного домену можуть використовувати `SameSite=Lax`. Для різних сайтів, як-от стандартні домени Vercel і Render, налаштуйте `SESSION_COOKIE_SAME_SITE=none`. Браузерні правила сторонніх cookies можуть блокувати вхід навіть із цим параметром. [Документація Firefox про SameSite=None](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/131) · [Політика сторонніх cookies](https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/Third-party_cookies).

### Перевірки

- Backend: `npm test`, `npm run typecheck`, `npm run build`. Тести HTTP підміняють repository в пам'яті.
- Backend із локальною БД: `npm run db:check-auth` та `npm run db:check-schema`. Інтеграційні перевірки працюють у транзакціях із відкатом. Для auth порівнюються повні знімки всіх десяти таблиць і перевіряється блокування з окремого підключення.
- Frontend: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:readers-ui`. Браузерний тест використовує Chrome або Chromium (`CHROME_PATH`) і перевіряє вхід, вихід, перезавантаження, ролі, форми працівників і сценарії читачів.

Команди backend:

| Команда | Дія |
| --- | --- |
| `npm run dev` | Запуск TypeScript через `tsx watch` із перезапуском після змін коду |
| `npm run build` | Генерація Prisma Client, перевірка TypeScript і збірка `src/` у `dist/` |
| `npm start` | Запуск зібраного `dist/server.js`; спочатку виконайте збірку |
| `npm test` | Автоматизовані HTTP-тести та перевірки конфігурації без окремого запущеного сервера чи `.env` |
| `npm run typecheck` | Генерація Prisma Client і перевірка типів серверного коду, тестів, скриптів та Prisma-конфігурації без JS-збірки |
| `npm run db:check-books` | HTTP + Prisma інтеграційна перевірка книг на локальній БД; усі записи відкочуються |
| `npm run db:check-book-copies` | HTTP CRUD примірників, історія, UNIQUE/FK і конкурентні блокування; усі записи відкочуються |

Для запуску зібраного застосунку виконайте `npm run build`, потім `npm start`. Після редагування `.env` перезапустіть сервер.

```text
backend/
├── src/
│   ├── config/env.ts              # Перевірка конфігурації через Zod
│   ├── lib/prisma.ts              # Спільний Prisma Client і PostgreSQL adapter
│   ├── generated/prisma/          # Згенерований клієнт, виключено з Git
│   ├── middleware/error-handler.ts # JSON-помилки API
│   ├── middleware/not-found.ts    # JSON-відповідь 404
│   ├── modules/books/             # Routes, Controller → Service → Repository, Zod-схеми
│   ├── modules/book-copies/       # Вкладені API примірників і транзакційні операції
│   ├── middleware/staff-auth.ts   # Сесії, ролі та CSRF
│   ├── lib/api-error.ts           # Безпечні помилки 400/403/404/409
│   ├── routes/index.ts            # /api/health та /api/books
│   ├── app.ts                     # Express, CORS, JSON і middleware
│   └── server.ts                  # Завантаження .env та запуск HTTP-сервера
├── test/                          # HTTP-тести та валідація середовища
├── scripts/check-database.ts       # Безпечна перевірка SELECT 1 через Prisma
├── scripts/check-schema.ts         # Перевірка каталогу БД й обмежень із відкатом
├── scripts/check-seed.ts           # Перевірка ідемпотентності seed з відкатом
├── scripts/check-books.ts          # HTTP CRUD книг із гарантованим відкатом
├── scripts/check-book-copies.ts    # CRUD примірників і конкуренція з відкатом
├── prisma/schema.prisma            # Дев'ять моделей та PostgreSQL enum
├── prisma/seed.ts                  # Запуск seed через наявний Prisma Client
├── prisma/seed-library.ts          # Початкові записи, перевірки безпеки й upsert
├── prisma/migrations/              # SQL-міграції та migration_lock.toml
├── prisma7.config.ts               # Конфігурація Prisma CLI 7.10+
├── .env.example                   # Приклад локальної конфігурації
├── package.json / package-lock.json
└── tsconfig.json / tsconfig.test.json
```

Залежності: `express` — HTTP API та маршрутизація; `cors` — CORS-заголовки й preflight; `dotenv` — читання `.env`; `zod` — перевірка змінних середовища. Для розробки: `typescript` — перевірка типів і компіляція; `tsx` — виконання TypeScript і watch-режим; `@types/node`, `@types/express`, `@types/cors` — декларації типів. Окрема бібліотека тестування не потрібна.

Невідомі маршрути повертають JSON із HTTP `404`; некоректний JSON — `400`, перевищення ліміту тіла 100 КіБ — `413`. Непередбачені помилки повертають `500` без внутрішніх деталей у відповіді та записуються в серверну консоль. Формат помилок: `{"error":{"code":"NOT_FOUND","message":"Route not found"}}`.

Локальний PostgreSQL запускається окремо через кореневий Compose. Початкову схему Prisma застосовано; REST-модулі, бізнес-логіка та налаштування хостингу будуть окремими етапами.

## Prisma ORM у backend

Встановлено стабільну **Prisma ORM 7.10.1**: CLI `prisma` у dev-залежностях, `@prisma/client` і PostgreSQL adapter `@prisma/adapter-pg` тієї самої версії у runtime-залежностях. Драйвер `pg` працює через TCP; `@types/pg` надає декларації типів. Версії Prisma зафіксовано точно, щоб оновлення не переводило проєкт на Prisma 8. Використовується наявний локальний PostgreSQL; нових хмарних сервісів немає.

За [документацією Prisma 7](https://www.prisma.io/docs/v7/prisma-orm/quickstart/postgresql), `backend/prisma7.config.ts` завантажує `backend/.env` через `dotenv` та задає URL datasource. Назва `prisma7.config.ts` підтримується починаючи з 7.10. `prisma/schema.prisma` містить PostgreSQL datasource, генератор `prisma-client` і моделі початкової схеми. Не додавайте другу конфігурацію Prisma поруч із наявною.

У `backend/.env` задайте `DATABASE_URL` у форматі прикладу з `backend/.env.example`: хост `127.0.0.1`, порт `5433`, база `library_db`, користувач `library_user`. Замість `YOUR_URL_ENCODED_PASSWORD` потрібен фактичний пароль із кореневого `.env`, закодований через `encodeURIComponent`: наприклад, `@` → `%40`, `#` → `%23`, `%` → `%25`. Кодується компонент пароля, а не весь URL; не кодуйте вже закодований пароль повторно. За зміни зовнішнього порту PostgreSQL змініть його і в `DATABASE_URL`. Не виводьте повний URL у логи та не додавайте `.env` до Git. Кореневий `.env` не завантажується в backend автоматично.

Команди виконуються в `backend/`, після `npm ci` і налаштування `.env`:

| Команда | Призначення |
| --- | --- |
| `npm run prisma:validate` | Перевірити Prisma-конфігурацію і схему без змін у БД |
| `npm run prisma:generate` | Згенерувати Prisma Client локально, без підключення до БД |
| `npm run prisma:format` | Відформатувати лише `schema.prisma` |
| `npm run db:check` | Згенерувати клієнт, виконати `SELECT 1` через Prisma і закрити пул з'єднань |
| `npm run db:check-readers` | Перевірити Readers API, категорії та історію у rollback-транзакції зі знімками десяти таблиць |
| `npm run db:check-auth` | Перевірити Auth і Staff API та блокування у локальній PostgreSQL |
| `npm run db:check-rentals` | Перевірити Rentals API, конкурентні операції, відкат касових змін і аудит у тимчасовій схемі локальної PostgreSQL |
| `npm run db:migrate-condition-check` | Застосувати міграції до локальної БД і звірити попередні поля в усіх десяти таблицях |
| `npm run db:seed` | Згенерувати клієнт і запустити локальний транзакційний seed через Prisma CLI |
| `npm run db:check-seed` | Перевірити seed, збереження редагованих значень і відкат у разі конфлікту |
| `npm run prisma:migrate:dev -- --name describe_change --create-only` | Підготувати нову міграцію для перегляду, без її застосування до основної БД |
| `npm run prisma:migrate:deploy` | Застосувати наявні непройдені SQL-міграції |
| `npm run prisma:migrate:status` | Перевірити стан міграцій |
| `npm run db:check-schema` | Перевірити початкову схему й обмеження на локальній навчальній БД; усі тестові записи відкочуються |
| `npm run db:preflight` | Лише перед найпершою міграцією: підтвердити, що локальна БД порожня; на вже ініціалізованій БД команда навмисно завершується помилкою |

`dev`, `build` і `typecheck` також генерують Prisma Client, тому чистий checkout не потребує згенерованих файлів у Git. Для генерації потрібен `DATABASE_URL` у конфігурації, проте сама генерація не підключається до PostgreSQL. У `src/lib/prisma.ts` експортується єдиний `prisma` з `PrismaPg` adapter; ESM-кешування забезпечує повторне використання клієнта та пулу в межах процесу. Клієнт підключається під час запитів. HTTP health-маршрут залишається незалежним від доступності БД.

Згенеровані TypeScript-файли потрапляють у `src/generated/prisma/`, виключені через `backend/.gitignore` і компілюються в `dist/generated/prisma/`. Генератор використовує ESM та `.ts`-імпорти для запуску через `tsx`; `rewriteRelativeImportExtensions` у TypeScript переписує їх у `.js` для запуску зібраного коду через Node.js.

## Початкова схема та міграції

Міграція `20261116000000_init_library_schema` створює `StaffUser`, `ReaderCategory`, `Reader`, `Book`, `BookCopy`, `Rental`, `DamageRule`, `CashMovement` та `AuditLog`. Міграція `20261125000000_add_staff_sessions` додає `StaffSession`: SHA-256 хеш токена, FK працівника, час завершення та індекси. Prisma веде службову таблицю `_prisma_migrations`.

Міграція `20261125010000_track_copy_condition` додає `CopyCondition`, `condition` та `conditionNotes` у `BookCopy`. У `Rental` з’являються `conditionAtIssue`, `conditionNotesAtIssue`, `conditionAtReturn`, `conditionNotesAtReturn` і `newDamageNotes`. Наявні примірники отримують `UNKNOWN`, а примірники зі статусом `LOST` — фізичний стан `LOST`. Історичні знімки лишаються `NULL`. Міграція зберігає історичні суми, правила, штрафи й касові рухи. Для наявної локальної БД застосуйте `npm run db:migrate-condition-check` у `backend/`, коли інші процеси не записують у БД.

- Первинні та зовнішні ключі — PostgreSQL UUID. `gen_random_uuid()` генерує PK на рівні БД, без додаткових extensions.
- Гроші — `numeric(12,2)`; відсотки — `numeric(5,2)`; часові мітки — `timestamptz(3)`; `AuditLog.details` — `jsonb`.
- Ролі та стани мають native enum. Окремий `DamageOutcome` містить лише `AVAILABLE`, `MAINTENANCE`, `LOST`, оскільки результат пошкодження не може бути `RENTED`.
- Унікальні: нормалізований email працівника, назва категорії, інвентарний номер та код правила пошкодження. API і bootstrap обрізають пробіли й переводять email у нижній регістр.
- Десять FK початкової міграції використовують `ON DELETE RESTRICT`, включно з необов'язковими `closedById` і `damageRuleId`. FK сеансу використовує `ON DELETE CASCADE`. Книги архівуються через `archivedAt`, працівники деактивуються через `isActive`.
- `AuditLog.entityId` — UUID універсального посилання, не FK. Єдиний FK журналу — `actorId`. `action` і `entityType` залишено рядками відповідно до ERD.

`Rental` зберігає всі узгоджені snapshots: денну ціну, заставу, відсоток знижки, назву категорії (`readerCategorySnapshot`) та застосований під час закриття відсоток штрафу (`damagePercentSnapshot`). Індекси покривають FK, каталог, історію прокатів, прострочення та часові діапазони звітів.

Частковий unique-індекс `Rental_one_active_copy_key` захищає `copyId` лише для `status = ACTIVE`, тому закрита історія не блокує нову видачу. Він описаний у Prisma Schema через `@@unique(..., where: ...)` із підтримуваним Prisma 7.10.1 Preview-прапорцем `partialIndexes`. Версію ORM не змінено.

SQL-міграцію згенеровано Prisma через `migrate diff --from-empty --to-schema prisma/schema.prisma --script`, переглянуто та доповнено 16 CHECK-обмеженнями. Цей спосіб підготовки першої міграції не створює shadow database. Перед застосуванням окремо перевірено `127.0.0.1:5433/library_db`, користувача `library_user` і відсутність прикладних об'єктів та історії міграцій. SQL загорнуто в `BEGIN`/`COMMIT` для атомарного створення схеми.

CHECK-обмеження забезпечують невід'ємність усіх грошових полів (також відхиляють PostgreSQL numeric `NaN`), відсотки 0–100, `dueAt > issuedAt`, `closedAt >= issuedAt`. Для `ACTIVE` поля закриття, штрафу й остаточного розрахунку мають бути `NULL`. Для `RETURNED`/`LOST` обов'язкові `closedAt`, `closedById`, `rentalFee`, `damageFine`, `damagePercentSnapshot`, `refundAmount`, `additionalPayment`; `damageRuleId` може бути `NULL`, зокрема для повернення без пошкодження. Нульові підсумки зберігаються як Decimal 0, а не `NULL`.

Prisma Schema не описує CHECK-обмеження, тому їх потрібно зберігати й переглядати безпосередньо в SQL наступних міграцій. Перевірка `migrate diff` охоплює підтримувані Prisma об'єкти; `npm run db:check-schema` додатково перевіряє типи, FK, unique/CHECK, межі, snapshots та видалення. Тестові записи створюються в одній транзакції із SAVEPOINT і гарантованим `ROLLBACK`; після завершення порівнюється кількість рядків. Це не seed і не CRUD. Скрипт дозволяє роботу лише з локальною `library_db` на порту `5433`; його очікування потрібно оновлювати разом із майбутніми змінами схеми.

Після перегляду SQL-міграцій виконуйте:

```powershell
npm run prisma:migrate:deploy
npm run prisma:generate
npm run prisma:migrate:status
npm run db:check-schema
```

Для додаткової перевірки відмінностей підтримуваних Prisma об'єктів: `npx --no-install prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` (код 0 означає відсутність різниці). Якщо виявлено невідому схему, конфлікт міграцій або запит на reset — зупиніться й з'ясуйте причину. Не використовуйте `db push` чи `migrate reset` для обходу проблем. Застосовані SQL-міграції не редагують: наступні зміни оформлюють новими міграціями.

CRUD книг і примірників описано нижче. [Модуль прокатів](#прокати-видача-й-повернення) атомарно зберігає розрахунок, прокат, стан примірника й касові операції в транзакції PostgreSQL.

## Початкове наповнення БД (seed)

Seed створює довідники й невеликий демонстраційний книжковий фонд для локальної розробки. Після запуску Docker та застосування наявних міграцій виконайте з `backend/`:

```powershell
npm run prisma:migrate:status
npm run db:seed
```

У [Prisma 7](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/seeding) seed запускається явно. `migrations.seed` у `prisma7.config.ts` задає `tsx prisma/seed.ts`; `db:seed` спочатку генерує клієнт, потім виконує `prisma db seed`. Міграції й запуск HTTP-сервера не виконують seed автоматично. Використовується наявний `src/lib/prisma.ts` із PostgreSQL adapter; після завершення клієнт закриває пул.

На порожніх прикладних таблицях буде додано **24 записи**:

| Модель | Записи |
| --- | --- |
| `ReaderCategory` | 3: Стандартна — 0%, Студент — 10%, Пенсіонер — 20% |
| `DamageRule` | 4: NONE — 0% / AVAILABLE; MINOR — 10% / AVAILABLE; MAJOR — 50% / MAINTENANCE; LOST — 100% / LOST |
| `Book` | 5 демонстраційних видань |
| `BookCopy` | 12 примірників: по 2–3 на видання, `INV-0001`–`INV-0012`, при створенні `AVAILABLE` |

Правила пошкоджень мають українські назви: «Без пошкоджень», «Незначне пошкодження», «Серйозне пошкодження», «Втрачено книгу». Відсотки, тарифи та застави задаються через `Prisma.Decimal` зі строкових значень.

| Видання | Автор | Жанр | Тариф за добу, грн | Застава, грн | Примірники |
| --- | --- | --- | --- | --- | --- |
| Тіні забутих предків | Михайло Коцюбинський | Повість | 4,00 | 250,00 | INV-0001–INV-0002 |
| Лісова пісня | Леся Українка | Драма-феєрія | 5,00 | 300,00 | INV-0003–INV-0005 |
| Місто | Валер'ян Підмогильний | Роман | 6,00 | 350,00 | INV-0006–INV-0007 |
| Захар Беркут | Іван Франко | Історична повість | 4,50 | 280,00 | INV-0008–INV-0010 |
| Тигролови | Іван Багряний | Пригодницький роман | 7,00 | 400,00 | INV-0011–INV-0012 |

Це демонстраційні тарифи й застави, а не реальні комерційні пропозиції. `StaffUser`, `Reader`, `Rental`, `CashMovement` та `AuditLog` seed не наповнює; обліковий запис адміністратора не створюється.

Повторний запуск безпечний: використовується `upsert` із порожнім `update`. Категорії зіставляються за унікальною назвою, правила — за кодом, примірники — за інвентарним номером. Книги мають фіксовані UUID у `prisma/seed-library.ts`, тому перейменування видання не створює дубліката; UNIQUE на назву не додавався. Наявні ціни, застави, знижки, правила, назви, архівування та статуси примірників не перезаписуються. Якщо ключовий запис відсутній, seed додає його; це не механізм синхронізації чи скидання налаштувань. Зокрема, перейменування категорії звільняє її стару унікальну назву, і наступний seed може додати початкову категорію з цією назвою.

Перед будь-яким записом перевіряються локальні `127.0.0.1`/`localhost`, порт `5433`, БД `library_db`, користувач `library_user`, схема `public` та фактична ідентичність з'єднання. `NODE_ENV=production`, сторонні query-параметри підключення, непройдені/невдалі міграції або невідповідність SQL-файлів застосованій історії блокують seed. Повний `DATABASE_URL` і паролі в логи не виводяться.

Усі записи виконуються в одній транзакції; advisory lock послідовно виконує паралельні запуски seed. Якщо інвентарний номер уже належить іншій книзі, виникає помилка і вся транзакція відкочується. Наявні записи не видаляються й не переприв'язуються. Виправляти такий конфлікт очищенням БД не потрібно.

Після seed можна виконати `npm run db:check-seed`. Перевірка порівнює повні знімки каталогу до й після повторного наповнення, змінює тарифи, знижки та статуси лише в тестових транзакціях і перевіряє їх збереження. Окрема транзакція перевіряє відкат часткового наповнення при конфлікті інвентарного номера. Усі перевірочні зміни відкочуються; команду призначено для цього початкового набору, коли службові й операційні таблиці ще порожні.

## REST API книг

Після запуску локального PostgreSQL, застосування наявної міграції та налаштування `backend/.env` виконайте `npm run dev` у `backend/`. Seed необов'язковий; `npm run db:seed` додає демонстраційний фонд без перезаписування наявних записів. У прикладах нижче використано адресу з локального `.env.example`; для іншого порту змініть `$api`.

| Метод і endpoint | Результат |
| --- | --- |
| `GET /api/health` | `200`, `{"status":"ok"}`, без звернення до БД |
| `GET /api/books` | `200`, каталог: `data` та `pagination` |
| `GET /api/books/:id` | `200`, `{ "data": book }` зі списком `copies`; `404` для відсутнього UUID |
| `POST /api/books` | `201`, `{ "data": book }` і заголовок `Location`; примірники не створюються |
| `PATCH /api/books/:id` | `200`, `{ "data": book }` після часткового редагування |
| `DELETE /api/books/:id` | `204`, порожнє тіло; встановлює `archivedAt` |

Параметри `GET /api/books`:

| Параметр | Правило |
| --- | --- |
| `search` | Пошук підрядка одночасно в назві, авторі та жанрі (OR), без урахування регістру |
| `title`, `author`, `genre` | Пошук підрядка в окремому полі; передані фільтри й `search` поєднуються через AND |
| `page` | Ціле десяткове число 1–1000000; типово `1` |
| `pageSize` | Ціле десяткове число 1–100; типово `20` |
| `includeArchived` | Лише `true` або `false`; типово `false`. `true` включає активні й архівовані видання |

Сортування фіксоване: назва, потім UUID. Символи `%`, `_` і `\` у пошуку трактуються буквально. Поза останньою сторінкою повертається порожній `data` з актуальною пагінацією; для порожнього результату `totalPages = 0`. `copyCount` враховує всі пов'язані записи `BookCopy` незалежно від статусу, зокрема `LOST`; `availableCopyCount` — лише `AVAILABLE`. Каталог не завантажує повні списки примірників. `GET /api/books/:id` повертає також архівовану книгу з її `archivedAt` і всіма примірниками, відсортованими за інвентарним номером та UUID.

Приклад каталогу (UUID та записи ілюстративні):

```json
{
  "data": [{
    "id": "c7c0e4b4-87c4-4c6a-a841-18fdbed10002",
    "title": "Лісова пісня",
    "author": "Леся Українка",
    "genre": "Драма-феєрія",
    "dailyPrice": "5.00",
    "depositAmount": "300.00",
    "archivedAt": null,
    "copyCount": 3,
    "availableCopyCount": 3
  }],
  "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 }
}
```

У деталях лічильники замінено на `copies`, наприклад:

```json
{
  "data": {
    "id": "c7c0e4b4-87c4-4c6a-a841-18fdbed10002",
    "title": "Лісова пісня",
    "author": "Леся Українка",
    "genre": "Драма-феєрія",
    "dailyPrice": "5.00",
    "depositAmount": "300.00",
    "archivedAt": null,
    "copies": [{
      "id": "9d633d29-b0b8-4caf-9781-8c4deff3cf93",
      "bookId": "c7c0e4b4-87c4-4c6a-a841-18fdbed10002",
      "inventoryCode": "INV-0003",
      "status": "AVAILABLE"
    }]
  }
}
```

У прикладі деталей список скорочено до одного примірника. Створення повертає поля книги без `copies` і лічильників; PATCH повертає книгу з `copies`.

### Валідація та помилки

Zod перевіряє UUID, query та body. POST вимагає `title`, `author`, `genre`, `dailyPrice`, `depositAmount`. PATCH приймає будь-яку непорожню підмножину цих п'яти полів. Текст обрізається з обох країв і має містити 1–1000 символів; це стосується також пошукових рядків. Невідомі поля body/query, повторені параметри query, вкладені JSON-зв'язки, `id`, `archivedAt`, порожній PATCH і `null` відхиляються.

Суми приймаються **лише JSON-рядками** від `"0"` до `"9999999999.99"` із крапкою та максимум двома знаками після неї: `"12"`, `"12.5"`, `"12.50"`. Числа JSON (`12.5`), від'ємні значення, пробіли, коми, експоненційний запис, `NaN`, початкові нулі (`"01.50"`) й надлишкова точність відхиляються без округлення. Repository створює `Prisma.Decimal` без проміжного перетворення на `number`; у відповідях завжди два десяткові знаки, наприклад `"12.50"`.

| HTTP | `error.code` | Умова |
| --- | --- | --- |
| `400` | `VALIDATION_ERROR` | Некоректний UUID, body або query |
| `400` | `INVALID_JSON` | Синтаксична помилка JSON |
| `401` | `AUTH_REQUIRED` | Чинний сеанс відсутній |
| `403` | `ROLE_FORBIDDEN` | Операція запису вимагає ролі ADMIN |
| `403` | `CSRF_REJECTED` | Некоректний Origin або відсутній захисний заголовок |
| `404` | `BOOK_NOT_FOUND` | Книги немає |
| `409` | `BOOK_ARCHIVED` | PATCH або повторний DELETE архівованої книги |
| `413` | `PAYLOAD_TOO_LARGE` | JSON перевищує 100 КіБ |
| `500` | `INTERNAL_SERVER_ERROR` | Непередбачена помилка, зокрема недоступність БД; внутрішні деталі не повертаються |

Формат помилок збережено: `{"error":{"code":"BOOK_NOT_FOUND","message":"Book not found"}}`. Архівування не видаляє книгу, примірники або історію прокатів; повторний DELETE зберігає початкову дату архівування. PATCH архівованої книги заборонений до окремого відновлення; endpoint відновлення в це завдання не входить. Назва/автор/жанр не мають UNIQUE, тож однойменні видання дозволені.

### Перевірка API в PowerShell

```powershell
$api = 'http://localhost:3000/api'
$headers = @{ Origin = 'http://localhost:5173'; 'X-Library-Request' = '1' }
$account = Get-Credential -Message 'Введіть email і пароль адміністратора'
$login = @{ email = $account.UserName; password = $account.GetNetworkCredential().Password } | ConvertTo-Json
Invoke-RestMethod "$api/auth/login" -Method Post -Headers $headers -ContentType 'application/json' -Body $login -SessionVariable librarySession
Remove-Variable account,login
Invoke-RestMethod "$api/health"
Invoke-RestMethod "$api/books?search=Леся&page=1&pageSize=10" -WebSession $librarySession
Invoke-RestMethod "$api/books?includeArchived=true" -WebSession $librarySession

$body = @{ title = 'Приклад'; author = 'Автор'; genre = 'Роман'; dailyPrice = '12.50'; depositAmount = '300.00' } | ConvertTo-Json
$created = Invoke-RestMethod "$api/books" -WebSession $librarySession -Headers $headers -Method Post -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
$bookId = $created.data.id
Invoke-RestMethod "$api/books/$bookId" -WebSession $librarySession
Invoke-RestMethod "$api/books/$bookId" -WebSession $librarySession -Headers $headers -Method Patch -ContentType 'application/json' -Body '{"dailyPrice":"15.00"}'
Invoke-RestMethod "$api/books/$bookId" -WebSession $librarySession -Headers $headers -Method Delete
```

POST/PATCH/DELETE у прикладі змінюють локальну БД: створений запис залишається архівованим. Для автоматизованої перевірки **без збереження тестових записів** виконайте з `backend/`:

```powershell
npm test
npm run typecheck
npm run build
npm run db:check-books
```

`npm test` використовує підмінений repository, не читає `DATABASE_URL` і не підключається до PostgreSQL. Перевіряються каталог, пошук, пагінація, деталі, створення, PATCH, архівування, збереження наявних даних, 400/403/404/409/500 та захист від підроблених заголовків; наявні health/CORS/JSON-тести збережено.

`db:check-books` використовує чинний `backend/.env` і спільний Prisma Client. Перевірка обмежена локальною `library_db:5433`, користувачем `library_user`, схемою `public` і непродуктивним середовищем. Інтеграція виконує HTTP-запити з активним тестовим сеансом і транзакційним repository каталогу. Усі зміни відкочуються, а після перевірки порівнюються знімки десяти таблиць. На час перевірки призупиніть паралельне редагування даних.

## REST API фізичних примірників (BookCopy)

Модуль `backend/src/modules/book-copies/` використовує Controller → Service → Repository, Prisma Client, Zod і `ApiError`. Обидві ролі можуть переглядати примірники, включно з примірниками архівованої книги. Для POST, PATCH і DELETE сервер перевіряє роль ADMIN до розбору тіла.

| Метод і endpoint | Результат |
| --- | --- |
| `GET /api/books/:bookId/copies` | `200`, `{ "data": [copy, ...] }` усіх примірників книги |
| `GET /api/books/:bookId/copies?status=AVAILABLE` | Фільтр за одним із `AVAILABLE`, `RENTED`, `MAINTENANCE`, `LOST` |
| `GET /api/books/:bookId/copies/:copyId` | `200`, `{ "data": copy }`; перевіряє належність книзі |
| `POST /api/books/:bookId/copies` | `201` та `Location`. Початковий стан `GOOD` за замовчуванням. Для `MAJOR_DAMAGE` початкова доступність — `MAINTENANCE` |
| `PATCH /api/books/:bookId/copies/:copyId` | `200`, часткове редагування `inventoryCode`, `status`, `condition`, `conditionNotes` |
| `DELETE /api/books/:bookId/copies/:copyId` | `204` без тіла; фізичне видалення лише `AVAILABLE` без жодного Rental |

Список сортується за `inventoryCode`, потім UUID; пагінації цього endpoint поки немає. Для існуючої книги без примірників повертається порожній масив. `bookId` та `copyId` мають бути UUID. Відсутня книга дає `404 BOOK_NOT_FOUND`; відсутній примірник або примірник іншої книги — `404 COPY_NOT_FOUND`.

Приклад об'єкта у відповідях (UUID і запис ілюстративні):

```json
{
  "data": {
    "id": "9d633d29-b0b8-4caf-9781-8c4deff3cf93",
    "bookId": "c7c0e4b4-87c4-4c6a-a841-18fdbed10002",
    "inventoryCode": "INV-NEW-001",
    "status": "AVAILABLE",
    "condition": "GOOD",
    "conditionNotes": null
  }
}
```

POST приймає `inventoryCode` і необов'язкові `condition` та `conditionNotes`. Код має містити 1–100 символів без NUL після обрізання пробілів і бути глобально унікальним з урахуванням регістру. Системний ID, книгу та початкову доступність визначає сервер. PATCH приймає непорожню підмножину полів із таблиці. Для пошкодженого стану потрібен опис. Щоб позначити завершений ремонт, передайте `{ "condition": "GOOD", "conditionNotes": null, "status": "AVAILABLE" }`. Некоректний запит повертає 400, а несумісний стан і доступність — 409.

Правила запису:

- Для архівованої книги POST/PATCH/DELETE повертають `409 BOOK_ARCHIVED`.
- Інвентарний номер можна редагувати у будь-якому статусі, також за наявності активного Rental; це не змінює статус, посилання або історію прокатів.
- Статус можна змінювати лише між `AVAILABLE` і `MAINTENANCE`, за відсутності активного Rental. Повторне встановлення поточного дозволеного статусу допустиме за тих самих умов.
- Встановлення `RENTED`/`LOST` або зміна поточного `RENTED`/`LOST` через PATCH дають `409 COPY_STATUS_CONFLICT`. Такими переходами керує `RentalsService` у транзакціях.
- Навіть якщо поточний статус помилково `AVAILABLE`, активний Rental блокує адміністративну зміну статусу: `409 COPY_ACTIVE_RENTAL`.
- DELETE можливий тільки для `AVAILABLE` без жодного Rental, включно із закритими прокатами. Інший статус дає `409 COPY_STATUS_CONFLICT`, історія — `409 COPY_HAS_RENTALS`; повторне видалення — `404`.
- Дублікат `inventoryCode` на POST/PATCH дає `409 INVENTORY_CODE_EXISTS`. Якщо PATCH одночасно змінює код і статус, конфлікт відкочує обидві зміни.
- FK-конфлікт дає `409 COPY_RELATION_CONFLICT`; конкурентне блокування, deadlock або конфлікт запису — `409 COPY_WRITE_CONFLICT`. Потрібно перечитати дані перед повтором. Непередбачені помилки дають безпечний `500 INTERNAL_SERVER_ERROR`.

Усі зміни транзакційні. Перед записом repository бере `FOR SHARE NOWAIT` на книгу й `FOR UPDATE NOWAIT` на примірник; для створення потрібне лише блокування книги. Це узгоджує операції з архівуванням Books і FK-блокуваннями Rental. Перевірки статусу й історії додатково входять до умов UPDATE/DELETE. Історія прокатів і пов'язані грошові записи CRUD не змінює. Формат помилок: `{"error":{"code":"COPY_HAS_RENTALS","message":"A copy with rental history cannot be deleted"}}`.

Для запитів PowerShell використайте `$api`, `$headers` і `$librarySession` із прикладу входу вище. Укажіть UUID наявної неархівованої книги.

```powershell
$bookId = 'c7c0e4b4-87c4-4c6a-a841-18fdbed10002'
$copiesUrl = "$api/books/$bookId/copies"
Invoke-RestMethod $copiesUrl -WebSession $librarySession
Invoke-RestMethod "${copiesUrl}?status=AVAILABLE" -WebSession $librarySession
$created = Invoke-RestMethod $copiesUrl -WebSession $librarySession -Headers $headers -Method Post -ContentType 'application/json' -Body '{"inventoryCode":"INV-NEW-001"}'
$copyId = $created.data.id
Invoke-RestMethod "$copiesUrl/$copyId" -WebSession $librarySession
Invoke-RestMethod "$copiesUrl/$copyId" -WebSession $librarySession -Headers $headers -Method Patch -ContentType 'application/json' -Body '{"inventoryCode":"INV-NEW-002","status":"MAINTENANCE"}'
Invoke-RestMethod "$copiesUrl/$copyId" -WebSession $librarySession -Headers $headers -Method Patch -ContentType 'application/json' -Body '{"status":"AVAILABLE"}'
Invoke-RestMethod "$copiesUrl/$copyId" -WebSession $librarySession -Headers $headers -Method Delete
Invoke-RestMethod "$api/auth/logout" -WebSession $librarySession -Headers $headers -Method Post
```

У `backend/` запустіть `npm test`, `npm run typecheck`, `npm run build`. Автоматизовані тести використовують підмінений repository й не підключаються до БД. Окрема команда `npm run db:check-book-copies` працює лише з локальною `library_db:5433`/`library_user`/`public`, перевіряє SQL-ідентичність з'єднання та потребує хоча б одного наявного примірника неархівованої книги без активного прокату для конкурентних сценаріїв.

Інтеграційна перевірка створює тестові книги, примірники та мінімальні Rental-фікстури тільки всередині транзакцій. Кожен успішний і невдалий сценарій, включно з конкурентними запитами, відкочується; SQL-помилки ізолюються SAVEPOINT. Окремі з'єднання перевіряють конкуренцію з редагуванням/видаленням примірника, архівуванням книги та вставкою Rental в обох напрямках блокування. Навіть несподівано успішний конкурентний DELETE відкочується. Після завершення порівнюються повні знімки всіх десяти таблиць; тестових записів не залишається. Seed/міграції не запускаються, наявні дані не видаляються. Перевірку слід запускати без стороннього паралельного редагування БД.

## Локальний запуск frontend

Потрібні **Node.js 24.x** та npm. Frontend — незалежний React + Vite + TypeScript застосунок із власними залежностями й lock-файлом. Виконайте з кореня репозиторію:

```powershell
cd frontend
npm ci
Copy-Item .env.example .env
npm run dev
```

У Linux/macOS використовуйте `cp .env.example .env`; наявний `.env` не перезаписуйте. Якщо PowerShell блокує `npm.ps1`, запускайте `npm.cmd`. Відкрийте `http://localhost:5173`. Порт розробки зафіксовано: якщо він зайнятий, Vite повідомить про помилку замість автоматичного переходу на інший порт.

Для каталогу потрібні запущений backend, PostgreSQL з усіма міграціями й налаштований `frontend/.env`. У другому терміналі виконайте `cd backend`, потім `npm run dev`. Значення `CORS_ORIGIN` у `backend/.env` має точно збігатися з origin відкритого frontend, наприклад `http://localhost:5173`. Порядок міграцій і створення акаунта наведено в розділі [Вхід і керування працівниками](#вхід-і-керування-працівниками).

Каталог і Readers виконують запити до захищеного backend API. «Адміністрування» доступне адміністраторам і містить керування працівниками. «Прокати», «Звіти» та інші адміністративні налаштування позначено як заплановані.

| Адреса | Сторінка |
| --- | --- |
| `/` | Перенаправлення на `/dashboard` |
| `/dashboard` | Головна (Dashboard) |
| `/books` | Каталог із пошуком і пагінацією |
| `/books/:id` | Деталі книги та фізичні примірники |
| `/readers` | Список читачів, пошук, фільтр категорії, пагінація та реєстрація |
| `/readers/:id` | Профіль, редагування та історія прокатів |
| `/rentals` | Список прокатів, пошук, фільтри та видача |
| `/rentals/:id` | Деталі прокату, касові рухи, повернення та оформлення втрати |
| `/reports` | Звіти |
| `/administration` | Адміністрування |
| Інші адреси | Сторінка 404 із посиланням на головну |

У `frontend/.env.example` наведено `VITE_API_URL=http://localhost:3000/api`. Це публічна базова адреса API **з префіксом `/api`**, обов'язкова для каталогу. `src/api/config.ts` читає її через `import.meta.env`, перевіряє HTTP(S)-формат і прибирає завершальний `/`. API-клієнт через `fetch` звертається до `GET /api/books`, `GET /api/books/:id` та `GET /api/books/:bookId/copies`; перевіряє HTTP-статус, JSON і структуру відповіді. Якщо адресу не задано, каталог пояснює, як її налаштувати. Не додавайте `DATABASE_URL`, токени чи інші секрети до `VITE_*`: Vite включає ці змінні в клієнтську збірку. Після зміни `.env` перезапустіть Vite; для зміни адреси у зібраному застосунку потрібна повторна збірка.

Пошук передає `search` на backend після 300 мс без змін; зміна пошуку скидає сторінку. `search`, `page` та вибраний `pageSize` зберігаються в URL (типово 12 книг, також можна вибрати 4 або 24). Посилання назад із деталей зберігає ці параметри. Пагінація використовує метадані backend; для сторінки поза межами каталогу є перехід на першу. Передбачено завантаження, порожній каталог/пошук/список примірників, 404 книги, HTTP- і мережеві помилки, некоректні відповіді та повторну спробу. Неактуальні запити скасовуються через `AbortController`, їхні відповіді не замінюють поточні дані, включно з React StrictMode.

Ціни й застава залишаються decimal-рядками: форматування `4.50` → `4,50 грн` виконується без `parseFloat`, обчислень із float або округлення. Статуси примірників: `AVAILABLE` — «Доступний», `RENTED` — «Виданий», `MAINTENANCE` — «На обслуговуванні», `LOST` — «Втрачений».

### Керування книгами та примірниками у frontend

- У каталозі кнопка «Додати книгу» відкриває форму назви, автора, жанру, добової ціни й застави. Обов'язкові поля перевіряються після обрізання пробілів. Суми вводяться текстом із комою або крапкою, від 0 до `9999999999.99`, максимум два знаки після роздільника. На API надсилаються decimal-рядки з крапкою і двома знаками, без float-перетворень. Після створення каталог оновлюється та фільтрується за назвою нової книги; є пряме посилання на її деталі.
- На деталях доступні заповнена форма «Редагувати» та «Архівувати» з окремим підтвердженням. Використовуються `POST /api/books`, `PATCH /api/books/:id`, `DELETE /api/books/:id`. Архівування прибирає книгу зі звичайного каталогу, зберігає історію та примірники. Архівна книга доступна за прямим посиланням лише для перегляду; відновлення не реалізовано.
- «Додати примірник» передає тільки `inventoryCode`; сервер призначає `AVAILABLE`. Інвентарний номер можна змінити для будь-якого статусу. Перемикання статусу пропонує лише `AVAILABLE` ↔ `MAINTENANCE`; для `RENTED`/`LOST` поле статусу та видалення відсутні. Якщо статус не змінено, PATCH не надсилає його, тому редагування самого номера не змінює стан примірника.
- Використовуються вкладені `POST/PATCH/DELETE /api/books/:bookId/copies[/:copyId]`. Видалення пропонується лише для `AVAILABLE` і потребує підтвердження. Історію прокатів та активний прокат перевіряє сервер; `409` пояснює причину українською. Унікальність номера у всьому фонді гарантує backend; frontend також перевіряє дублікати серед завантажених примірників.
- Під час мутації форма й повторне надсилання блокуються синхронним захистом та станом збереження. Запити запису не запускаються з ефектів і не повторюються автоматично. Після успіху дані й лічильники перечитуються. Після мережевої помилки або некоректної успішної відповіді результат запису може бути невідомим: повторне надсилання блокується до закриття форми або «Оновити дані», щоб спочатку перевірити фактичний стан.

Форми керування книгами й примірниками доступні з роллю ADMIN. Права, історію прокатів, унікальність і конкурентні зміни перевіряє backend. У разі `404` або `409` у формі можна перечитати дані кнопкою «Оновити дані».

### Readers API та інтерфейс

Для Readers API, включно з довідником категорій і деталями, потрібен чинний сеанс працівника. Обидві ролі можуть працювати з читачами. Відповіді мають `Cache-Control: no-store`. Вхід доступний лише працівникам.

| Метод і маршрут | Результат |
| --- | --- |
| `GET /api/readers` | `{ data: Reader[], pagination }`, пошук `search` за ПІБ/телефоном, фільтр `categoryId` |
| `GET /api/readers/:id` | `{ data: Reader }` або `404 READER_NOT_FOUND` |
| `POST /api/readers` | `201`, `{ data: Reader }`, заголовок `Location` |
| `PATCH /api/readers/:id` | Часткове редагування, `{ data: Reader }` |
| `GET /api/reader-categories` | `{ data: [{ id, name, discountPercent }] }` з БД |
| `GET /api/readers/:id/rentals` | Пагінована історія або порожній `data: []`; для невідомого читача — 404 |

`Reader` містить `id`, `fullName`, `address`, `phone`, `categoryId`, `category: { id, name, discountPercent }`. Поточна знижка серіалізується точним decimal-рядком із двома знаками, наприклад `"12.50"`. Сортування читачів: `fullName ASC, id ASC`; історії: `issuedAt DESC, id DESC`. Історія повертає лише `id`, `readerId`, `status` (`ACTIVE`/`RETURNED`/`LOST`), `issuedAt`, `dueAt`, `closedAt`, `bookTitle`, `inventoryCode`. Дати — ISO UTC, UI показує локальний час; для LOST `closedAt` відображається як дата закриття через втрату.

Приклади (UUID категорії й читача беруться з відповідей API; усі наведені контактні дані вигадані):

```http
GET /api/reader-categories
GET /api/readers?search=Тестовий&page=1&pageSize=20
GET /api/readers?categoryId=<category-uuid>&page=2&pageSize=10
GET /api/readers/<reader-uuid>/rentals?page=1&pageSize=10
```

```http
POST /api/readers
Content-Type: application/json

{
  "fullName": "Тестовий Читач",
  "address": "Умовна адреса, будинок 1",
  "phone": "+380 (00) 000-00-00",
  "categoryId": "<category-uuid>"
}
```

```http
PATCH /api/readers/<reader-uuid>
Content-Type: application/json

{ "categoryId": "<other-category-uuid>" }
```

Zod обрізає крайні пробіли. ПІБ — 2–200 символів, адреса — 3–500, без керувальних символів. Телефон зберігається рядком: 7–30 символів загалом, 7–15 цифр; дозволені пробіли, дужки, дефіс, крапка й `+` на початку. Номер не має бути унікальним. UUID перевіряються й нормалізуються до нижнього регістру. `categoryId` обов’язковий для реєстрації та має існувати; помилка — `400 READER_CATEGORY_NOT_FOUND`, конкурентне порушення FK — `409 READER_CATEGORY_CONFLICT`.

`page` — ціле 1–1 000 000, `pageSize` — 1–100, типові значення 1 і 20. `search` — непорожній після trim рядок до 200 символів; пошук без урахування регістру, `%`, `_` та `\` шукаються буквально. Пошук і категорія поєднуються через AND. Невідомі/повторні query-поля та невідомі поля body повертають 400 у чинному форматі `{ error: { code, message } }`. PATCH потребує хоча б одного редагованого поля; `id`, вкладені зв’язки, системні й фінансові поля заборонені. Деталі, POST/PATCH і довідник категорій не приймають query-параметрів.

PATCH змінює лише передані поля одним UPDATE; незалежні зміни адреси й телефону не перезаписують одна одну. Для одного поля діє останній успішний запис; version/ETag у моделі немає. Зміна категорії не змінює історичні знімки `Rental`. Історія в профілі веде до деталей записів, створених у розділі «Прокати». Помилки Prisma з аргументами, що можуть містити персональні дані, не передаються технічному журналу.

На `/readers` доступні пошук за ПІБ/телефоном, категорії з API, пагінація й модальна реєстрація. `search`, `categoryId`, `page`, `pageSize` зберігаються в URL; пошук затримує запит на 300 мс. На `/readers/:id` — контакти, поточна знижка, форма редагування та окремий блок історії з `rentalsPage` у URL. Повернення з деталей зберігає фільтри списку. Є стани завантаження, порожнього списку/історії, недоступного backend, помилок категорій і успішного збереження. Форми використовують спільні Modal, feedback, `useApiResource`, `useMutation`; синхронне блокування запобігає подвійному надсиланню. Після невідомого результату запису спершу перечитайте дані.

Додаткові перевірки Readers:

```powershell
# Із backend/: потрібні наявні локальна PostgreSQL і категорії; seed повторно не запускається.
npm run db:check-readers

# Із frontend/: потрібні встановлені залежності обох застосунків і Chrome/Chromium.
# За потреби задайте CHROME_PATH до браузера.
npm run test:readers-ui
```

`db:check-readers` виконує HTTP-перевірки у rollback-транзакції, створює лише вигадані тимчасові fixtures, перевіряє збереження всіх полів Rental, CashMovement і BookCopy після зміни категорії/контактів, FK-конфлікт та повні знімки **всіх десяти таблиць** після відкату, включно з помилками тестів. Накладені HTTP PATCH у цьому сценарії використовують одну транзакційну connection; окремі вкладки не мають optimistic concurrency control. `db:check-seed` розрахований на початкову БД без операційних записів і після реєстрації читачів може не підходити: не очищайте БД заради цієї перевірки.

Браузерна перевірка запускає справжні React/Express з тестовим repository у пам’яті; PostgreSQL не відкривається. Вона перевіряє список, пошук/фільтр/пагінацію, категорії, валідацію, створення/редагування, порожню історію, помилки й повторне завантаження категорій, 403, недоступний сервер, навігацію, мобільний інтерфейс та одиничні POST/PATCH при подвійному submit. Тимчасовий профіль браузера зберігається в ігнорованому `frontend/node_modules/.cache/`.

### Перевірки та локальне тестування

У `frontend/` виконайте `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`. У `backend/` — `npm test`, `npm run typecheck`, `npm run build` (окремого ESLint-скрипту backend не має). Frontend використовує наявні Node.js test runner і Vite для завантаження TS-модулів: перевіряються валідація форм, Decimal-межі, дозволені статуси, контракти, усі шість запитів запису, HTTP-помилки, скасування та відсутність автоматичних повторів. Усі `fetch` у тестах мутацій підмінені; backend-тести використовують repositories у пам'яті. Ці `npm test` не відкривають PostgreSQL і не залишають тестових записів.

Для ручної перевірки запустіть PostgreSQL, backend та frontend за інструкціями вище. Пройдіть створення й редагування книги, додавання примірника, зміну номера та `AVAILABLE` ↔ `MAINTENANCE`, скасування й підтвердження видалення/архівування, перевірте повернення до каталогу та мобільні форми. Дубль інвентарного номера має залишати форму відкритою з помилкою; швидке подвійне натискання — створювати один запит. Для `RENTED`/`LOST` перевірте лише редагування номера. Не змінюйте статуси seed-записів у БД заради UI-тесту. Складні сценарії історії/конфліктів і `403` перевіряються ізольованими backend-тестами; браузерні мутації для автоматизованих перевірок запускайте проти `createApp` з підміненими repositories або в тестовій rollback-транзакції.

**Ручні дії через звичайний локальний backend зберігаються в БД.** Архівування не видаляє тестову книгу фізично. Якщо потрібна перевірка реального PostgreSQL без залишкових записів, використовуйте вже наявні `npm run db:check-books` та `npm run db:check-book-copies` у backend: вони відкочують зміни та порівнюють знімки даних. Не використовуйте seed, reset або видалення volumes для очищення результатів тестування.

| Команда в `frontend/` | Призначення |
| --- | --- |
| `npm run dev` | Vite dev server із гарячим оновленням |
| `npm run typecheck` | Строга перевірка типів React-коду та конфігурації Vite |
| `npm run lint` | ESLint: TypeScript, правила React Hooks і Fast Refresh; попередження спричиняють помилку |
| `npm run check` | TypeScript та ESLint разом |
| `npm test` | Контракти, форми, статуси, HTTP-клієнт і точне форматування гривні; без PostgreSQL |
| `npm run build` | Перевірка типів і production-збірка в `frontend/dist/` |
| `npm run preview` | Локальний перегляд готової збірки після `npm run build` |

```text
frontend/
├── public/favicon.svg          # Локальна піктограма застосунку
├── src/
│   ├── api/                    # Конфігурація, fetch CRUD-клієнт, контракти й українські помилки
│   ├── components/             # Layout, піктограми, Modal і forms/ для CRUD
│   ├── hooks/                  # useApiResource та захист мутацій useMutation
│   ├── pages/                  # BooksPage, BookDetailsPage, Dashboard, заплановані розділи, 404
│   │   └── sections.ts         # Назви, адреси й описи розділів
│   ├── types/navigation.ts     # Типи описів розділів і піктограм
│   ├── utils/money.ts          # Форматування decimal-рядків у гривні
│   ├── utils/book-forms.ts     # Валідація форм і нормалізація сум без float
│   ├── App.tsx                # Дерево клієнтських маршрутів
│   ├── main.tsx               # React root, StrictMode, BrowserRouter
│   ├── styles.css             # Tailwind, кольори, типографіка, фокус клавіатури
│   └── vite-env.d.ts          # Типи змінних середовища Vite
├── index.html                 # HTML із lang="uk" і viewport для мобільних
├── test/                      # Контракти, форми, граничні суми й API-клієнт; без БД
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

Реалізовані Strategy для знижок і Observer для подій прокату. Factory Method і Template Method заплановані для модуля звітів.

## Прокати, видача й повернення

Увійдіть як ADMIN або LIBRARIAN і відкрийте «Прокати». У полях вибору читача й книги шукайте записи одразу в полі. Читачів можна знайти за ПІБ або телефоном, книги — за назвою, автором або жанром. Виберіть доступний примірник і майбутній час повернення. Для стану «Не зафіксовано» огляньте примірник і вкажіть стан та опис. Перевірте умови й підтвердьте отримання застави. Сервер зберігає історичний стан і опис разом із тарифом, категорією, активним прокатом, `DEPOSIT_IN` та статусом `RENTED`.

У деталях активного прокату оберіть «Оформити повернення». Форма показує стан і опис при видачі. Якщо нових пошкоджень немає, попередній опис зберігається й штраф становить 0%. Для нових пошкоджень введіть опис, оцініть їхню тяжкість і вкажіть загальний фізичний стан після повернення. Загальний стан визначає доступність. Примірник із незначними загальними пошкодженнями може лишитися доступним або перейти на обслуговування. Серйозні загальні пошкодження вимагають обслуговування. Втрату оформлюють окремою дією.

Для старих активних прокатів з невідомим станом зафіксуйте стан під час повернення. Враховуйте у штрафі тільки підтверджені нові пошкодження. Старі завершені прокати показують суми й історичне правило, а відсутні оцінки стану відображаються як «Не зафіксовано». ADMIN може в картці книги відредагувати поточний стан та доступність після ремонту. Видача й ремонт використовують одні блокування, а зміни поточного стану після ремонту зберігають історію.

| API | Параметри й результат |
| --- | --- |
| `GET /api/rentals` | `page`, `pageSize`, `search` за ПІБ, назвою, автором чи інвентарним номером, `status`, `overdue=true\|false`, `readerId`, `bookId`. Новіші видачі першими, при однаковому часі — за ID у спадному порядку |
| `GET /api/rentals/:id` | Примірник, книга, читач, працівники, історичні умови, нарахування й касові рухи. Невідомий ID повертає 404 |
| `POST /api/rentals` | `readerId`, `copyId`, `dueAt` у ISO 8601 із часовим поясом. `inspection: { condition, conditionNotes? }` потрібен для `UNKNOWN`. Успішна видача повертає 201 і `Location` |
| `GET /api/damage-rules` | `id`, `code`, `label`, `penaltyPercent`, `outcome` із PostgreSQL |
| `POST /api/rentals/:id/return-preview` | `assessment` і необов’язковий `copyStatus` для загального `MINOR_DAMAGE`. Повертає оплачувані дні, суми, кінцевий стан, описи й `previewVersion` |
| `POST /api/rentals/:id/close` | Поля preview та обов’язковий `previewVersion`. Змінений розрахунок або повторне закриття повертають 409 |

`assessment` приймає `{ "type": "UNCHANGED" }`, `{ "type": "LOST" }` або `{ "type": "DAMAGED", "severity": "MINOR", "condition": "MAJOR_DAMAGE", "newDamageNotes": "Додатковий надрив обкладинки" }`. Для старого прокату без знімка `UNCHANGED` потребує `inspection`; у `DAMAGED` можна додати `existingDamageNotes` для інших пошкоджень невідомого походження. `damageRuleId` сервер визначає за кодом правила. `DamageRule.outcome` лишається в API довідника для сумісності.

Доступ перевіряють чинні серверні сесії й RBAC. POST використовує чинний CSRF-захист. Грошові поля відповіді передаються десятковими рядками з двома знаками. Час зберігається в UTC, інтерфейс показує локальний час.

`RentalCalculator` використовує `DiscountStrategy` для історичної знижки. Плата за прокат рахується за фактичними 24-годинними періодами, із мінімумом в один день. Штраф визначається від історичної застави за ставкою з PostgreSQL. Кожне нарахування округлюється до копійок через `ROUND_HALF_UP`. Застава покриває їхню суму. Залишок застави повертається, а нестача оформлюється як доплата. Отримана застава обліковується окремо від нарахувань доходу. Повний опис є в [бізнес-правилах](docs/business-rules.md).

Видача й закриття блокують спочатку книгу, потім примірник. Після коміту `RentalEventPublisher` передає подію `RentalIssued` або `RentalClosed` підписнику `AuditLogSubscriber`. Аудит працює best-effort. Збій після коміту може залишити прогалину в журналі, а підтверджені дані залишаються в `Rental` і `CashMovement`. При мережевій помилці UI пропонує оновити дані перед новою операцією.

UI перевіряє підтверджені умови видачі через `X-Rental-Terms`. Значення заголовка — SHA-256 у hex від UTF-8 JSON-масиву `[readerId, copyId, dailyPrice, depositAmount, categoryName, discountPercent, condition, conditionNotes]`. UUID подаються в нижньому регістрі, числові значення є рядками з двома десятковими знаками. Стан та опис відповідають запису, завантаженому до огляду. Сервер звіряє відбиток під блокуванням і повертає 409 при розбіжності. Браузер використовує Web Crypto через HTTPS або локальний origin.

### Перевірка прокатів

- У `backend/` виконайте `npm test`, `npm run typecheck`, `npm run build` та `npm run db:check-rentals`.
- У `frontend/` виконайте `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` та `npm run test:readers-ui`. Остання команда перевіряє сценарії обох розділів у Chrome або Chromium.

Інтеграційна перевірка приймає локальну `library_db:5433` із чинними міграціями. Вона застосовує ті самі міграції в окремій схемі з випадковим ім'ям, перевіряє справжні коміти й відкат навмисно спричинених помилок, видаляє тимчасову схему та звіряє повні знімки десяти робочих таблиць у `public`. Для порівняння знімків запускайте її, коли інші процеси не записують у робочу схему.

Для ручного тесту в навчальній БД створіть окремий примірник із незначним пошкодженням. Видайте його й поверніть без нових пошкоджень, перевіривши збереження опису та нульовий штраф. Видайте повторно й під час повернення виберіть нові незначні пошкодження, а загальний стан — «Серйозні пошкодження». Очікуваний результат за початковими ставками — 10% і статус обслуговування. Після цього під ADMIN встановіть `GOOD` і `AVAILABLE` та перевірте, що історія прокату збережена. Перейдіть із прокату до книги й читача та назад, зокрема після перезавантаження. Ручні операції через звичайний backend зберігаються в БД.

## Стан проєкту

1. [x] Попередній аналіз і бізнес-правила
2. [x] Початкові діаграми для обговорення
3. [x] Початкова ініціалізація backend
   - [x] Початкова ініціалізація frontend
4. [ ] База даних та CRUD
   - [x] Локальний PostgreSQL 18 через Docker Compose
   - [x] Початкове налаштування Prisma ORM 7 без бізнес-моделей і міграцій
   - [x] Дев'ять моделей, початкова міграція та SQL-обмеження цілісності
   - [x] Ідемпотентний локальний seed довідників і демонстраційного фонду
   - [x] Backend CRUD книг: пошук, пагінація, Decimal, архівування та тести
   - [x] Backend CRUD примірників: інвентарні номери, адміністративні статуси, захист історії та конкурентних операцій
   - [x] Frontend: реальний каталог Books API, пошук, пагінація та перегляд примірників
   - [x] Frontend CRUD книг і примірників із формами, підтвердженнями та обробкою конфліктів
   - [x] Реєстрація, редагування та історія читачів
   - [x] Сеанси працівників, перевірка ролей і керування обліковими записами
5. [x] Видача, повернення, фінансові розрахунки
6. [ ] Звіти, панель адміністратора
7. [ ] Тести й остаточна документація

Ці діаграми — проєктні, не схема вже реалізованого коду. Їх потрібно уточнювати в міру розробки.
