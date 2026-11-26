# Підготовка до розгортання

Один GitHub-репозиторій містить два незалежні застосунки. Vercel збирає `frontend/`, Render запускає `backend/`, Neon зберігає дані у PostgreSQL 18. Браузер використовує HTTPS і звертається до `/api/*` на домені Vercel. Vercel пересилає ці запити до Render. Хмарні сервіси потрібно створити й перевірити за інструкцією нижче.

## 1. Створіть PostgreSQL 18 у Neon

У Neon Console створіть проєкт із PostgreSQL **18**. Виберіть регіон поблизу майбутнього Render Web Service. Для демонстрації створіть окрему порожню базу або використайте порожню базу нового проєкту. Починайте з чистої `public` і вводьте вигадані облікові та читацькі дані в хмарному застосунку. [Neon і PostgreSQL 18](https://neon.com/blog/postgres-18)

## 2. Підготуйте захищений DATABASE_URL

У **Connect** виберіть потрібну гілку, базу й роль. Вимкніть **Connection pooling**. У прямого імені хоста перша DNS-мітка не має суфікса `-pooler`. Збережіть URI у менеджері паролів. Для цього невеликого сервісу можна використати пряме підключення і на Render. [Підключення до Neon](https://neon.com/docs/connect/connect-from-any-app), [Пул і пряме підключення](https://neon.com/docs/connect/connection-pooling)

У новому вікні Windows PowerShell перейдіть у корінь репозиторію. Наступна команда читає URI прихованим введенням і задає його для дочірніх процесів цього термінала. Під час перенесення в Render використайте той самий URI з параметрами `sslmode=verify-full&channel_binding=require&schema=public`. Пароль у URI має вже бути URL-encoded, як у рядку з Neon Console.

```powershell
node --version
$env:NODE_ENV = 'production'
$dbInput = Read-Host 'Вставте прямий PostgreSQL URI з Neon' -AsSecureString
$dbUri = [System.UriBuilder]::new([System.Net.NetworkCredential]::new('', $dbInput).Password)
if ($dbUri.Host -notmatch '^ep-[a-z0-9-]+(?:\.[a-z0-9-]+)*\.neon\.tech$' -or
    $dbUri.Host.Split('.')[0].EndsWith('-pooler')) {
    throw 'Потрібен прямий endpoint Neon.'
}
$dbUri.Query = 'sslmode=verify-full&channel_binding=require&schema=public'
$env:DATABASE_URL = $dbUri.Uri.AbsoluteUri
Remove-Variable dbInput, dbUri
Set-Location backend
npm.cmd ci --include=dev
if ($LASTEXITCODE -ne 0) { throw 'Не вдалося встановити залежності.' }
```

Node.js має бути 24.x. Backend перевіряє сертифікат та ім'я сервера через `pg`. Prisma CLI використовує пряме підключення і перетворює параметри на `sslmode=require&sslaccept=strict` для рушія міграцій. У разі помилки TLS перевірте endpoint і довірені кореневі сертифікати. [TLS у драйвері pg](https://www.prisma.io/postgres/ssl-connection-error), [Параметри PostgreSQL у Prisma](https://docs.prisma.io/docs/orm/v6/overview/databases/postgresql)

## 3. Застосуйте міграції

У тому самому терміналі, у `backend/`, застосуйте міграції й перевірте, чи всі вони виконані. Для наступних версій повторюйте цю операцію окремо за планом оновлення БД.

```powershell
npm.cmd run prisma:migrate:deploy
if ($LASTEXITCODE -ne 0) { throw 'Міграції не застосовано.' }
npm.cmd run prisma:migrate:status
if ($LASTEXITCODE -ne 0) { throw 'Перевірте історію міграцій.' }
```

## 4. Ініціалізуйте хмарну БД

Запустіть одну з двох команд інтерактивно. Перша створює три категорії (0%, 10%, 20%) і чотири правила штрафів (`NONE`, `MINOR`, `MAJOR`, `LOST`). Друга також додає п'ять демонстраційних видань і 12 примірників.

```powershell
npm.cmd run db:init-cloud
# Або, якщо потрібен демонстраційний фонд
npm.cmd run db:init-cloud -- --demo-catalog
```

CLI перевіряє версію PostgreSQL, поточну базу й роль, схему та історію міграцій до підтвердження. Звірте показаний endpoint з Neon Console і введіть показане `host/database`. Стартові записи, що вже існують, зберігають свої правки. Ініціалізація працює транзакційно. Якщо в підготовленій БД уже зайнято ім'я стартової категорії чи демонстраційний інвентарний номер іншим записом, команда відхиляє операцію. Локальний `db:seed` працює окремо, зі своїм чинним обмеженням на навчальну БД.

## 5. Створіть першого ADMIN

У тому самому інтерактивному терміналі виконайте команду нижче. Введіть адресу й власний пароль та підтвердьте пароль. CLI відхиляє повторне створення, коли в БД вже є активний ADMIN.

```powershell
npm.cmd run auth:bootstrap-admin
if ($LASTEXITCODE -ne 0) { throw 'Перевірте результат створення ADMIN.' }
Remove-Item Env:DATABASE_URL, Env:NODE_ENV
```

Міграції, хмарна ініціалізація та створення адміністратора виконуються з локального термінала. Старт HTTP-процесу запускає тільки API. Віддалений shell і pre-deploy command не потрібні для Render Free. [Обмеження Render Free](https://render.com/docs/free), [Команди розгортання Render](https://render.com/docs/deploys)

## 6. Створіть Render Web Service

Під'єднайте GitHub-репозиторій із підготовленою версією до Render, виберіть **Web Service**, середовище **Node** і потрібну гілку. Для демонстрації доступний Free plan. Виберіть регіон поблизу Neon.

| Поле | Значення |
| --- | --- |
| Root Directory | `backend` |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `node dist/server.js` |
| Health Check Path | `/api/health` |

`/api/health` повертає 200, якщо HTTP-процес відповідає. Окремий `/api/ready` повертає 200 після перевірки з'єднання та наявності таблиці сесій або 503 з короткою відповіддю. Використайте readiness для перевірки після деплою. Постійний liveness-probe не звертається до Neon. [Render Web Services](https://render.com/docs/web-services), [Перевірки Render](https://render.com/docs/health-checks)

## 7. Налаштуйте змінні Render

| Змінна | Значення |
| --- | --- |
| `NODE_VERSION` | `24.22.3` |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Захищений URI з кроку 2. Збережіть у Render як секрет |
| `CORS_ORIGIN` | Остаточний HTTPS origin Vercel. До його отримання задайте `https://invalid.invalid` |
| `SESSION_TTL_SECONDS` | `28800` |
| `SESSION_COOKIE_SAME_SITE` | `lax` |
| `LOGIN_BEHIND_PROXY` | `true` |
| `PORT` | Задає Render. Сервер слухає цей порт на `0.0.0.0` |

За спільною ingress-адресою режим `LOGIN_BEHIND_PROXY` зберігає ліміти 8 спроб на облікову адресу та 300 на процес за 15 хвилин. Локальний режим додатково обмежує IP сокета до 40 спроб. Backend не довіряє `X-Forwarded-For`. Лічильники існують у пам'яті процесу, тому перезапуск їх скидає, а в кількох інстансах ліміти діятимуть окремо. Після першого запуску скопіюйте фактичний HTTPS origin Render. [Версії Node.js у Render](https://render.com/docs/node-version)

## 8. Створіть Vercel Project

Імпортуйте той самий GitHub-репозиторій. Виберіть **Root Directory** `frontend`, **Framework** Vite, **Node.js** 24.x. Репозиторій задає `npm ci --include=dev`, `npm run build` та **Output Directory** `dist` у `frontend/vercel.ts`. [Vite на Vercel](https://vercel.com/docs/frameworks/frontend/vite), [Версії Node.js у Vercel](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)

## 9. Налаштуйте SPA routing та API proxy

Додайте до середовища **Production** у Vercel такі змінні.

| Змінна | Значення |
| --- | --- |
| `VITE_API_URL` | `/api` |
| `RENDER_API_ORIGIN` | Фактичний HTTPS origin виданого Render домену `onrender.com`, без шляху та кінцевого слеша |

`frontend/vercel.ts` генерує external rewrite `/api/:path*` до того самого шляху на Render і SPA rewrite на `/index.html` для сторінок React Router. API і Vite assets виключено зі SPA fallback. Під час роботи адреса сервісу фіксована. Кешування external rewrite не вмикайте. Backend повертає `Cache-Control: no-store` для API. [Конфігурація vercel.ts](https://vercel.com/docs/project-configuration/vercel-ts), [External rewrites і кешування](https://vercel.com/docs/routing/rewrites)

## 10. Задайте остаточний CORS_ORIGIN

Скопіюйте стабільний Production origin Vercel. У Render встановіть як `CORS_ORIGIN` його точне значення з `https://`, без кінцевого слеша, шляху чи wildcard. Збережіть і розгорніть нову конфігурацію Render. Після зміни змінних Vercel також виконайте redeploy. Для preview з іншим доменом потрібна своя погоджена пара origin і backend.

## 11. Перевірте авторизацію через домен Vercel

```powershell
$renderOrigin = (Read-Host 'HTTPS origin Render').TrimEnd('/')
$vercelOrigin = (Read-Host 'Production HTTPS origin Vercel').TrimEnd('/')
Invoke-RestMethod "$renderOrigin/api/health"
Invoke-RestMethod "$renderOrigin/api/ready"
Invoke-RestMethod "$vercelOrigin/api/health"
Invoke-RestMethod "$vercelOrigin/api/ready"
Invoke-WebRequest -UseBasicParsing "$vercelOrigin/rentals" | Select-Object StatusCode
```

1. Відкрийте production URL Vercel у приватному вікні й увійдіть як ADMIN. У браузерному Network перевірте `POST /api/auth/login` → 200, точний `Origin`, `X-Library-Request: 1`, та `Set-Cookie` із `HttpOnly; Secure; SameSite=Lax; Path=/api`. Домен cookie має відповідати frontend, а `Cache-Control` — містити `no-store`.
2. Перезавантажте внутрішню сторінку. `GET /api/auth/me` має отримати cookie й повернути роль. Вийдіть через `POST /api/auth/logout`, перевірте очищення cookie, 401 на `/api/auth/me` і повернення на екран входу.
3. Під чинним сеансом перевірте 403 для запису з неправильним `Origin` або без `X-Library-Request`. Невідомий шлях під `/api/` має повертати JSON-помилку, а внутрішній UI шлях — оболонку SPA. Фільтровані GET з query, POST, PATCH та DELETE мають повертати очікувані API-статуси.
4. Створіть демонстраційний обліковий запис LIBRARIAN. Перевірте відсутність адміністративних дій і 403 при зверненні до захищеного адміністративного API. Змініть роль або деактивуйте цей обліковий запис з ADMIN і перевірте відкликання попередньої сесії.

## 12. Перевірте робочі сценарії в хмарі

З вигаданими даними створіть читача, перевірте каталог і примірники, видайте та поверніть книгу. У Network перевірте `X-Rental-Terms` у POST видачі. Змініть тариф або знижку після відкриття форми та звірте 409 при підтвердженні старих умов. Перевірте втрату, заставу, штраф, доплату, прострочення, фонди, прокати, фінанси та Dashboard. Переконайтеся, що повторне закриття не створює нового касового руху. Запишіть фактичні URL і результат перевірок після роботи зі створеними сервісами.

API звітів приймає обидва написання `Europe/Kyiv` і `Europe/Kiev` та передає до PostgreSQL `Europe/Kyiv`. Це підтримує браузери зі старішою назвою зони та збірки PostgreSQL, у яких немає старого псевдоніма.

## Локальні перевірки перед деплоєм

На Windows PowerShell із двох каталогів застосунків:

```powershell
# У backend/
npm.cmd ci --include=dev
npm.cmd run build
npm.cmd run typecheck
npm.cmd test
# У frontend/
npm.cmd ci --include=dev
$env:VITE_API_URL = '/api'
npm.cmd run build
Remove-Item Env:VITE_API_URL
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
# За потреби задайте CHROME_PATH до Chrome, Chromium або Microsoft Edge.
npm.cmd run test:readers-ui
npm.cmd run test:readers-ui -- --direct-api
```

Перший браузерний запуск проксіює `/api` через Vite до локального backend, другий використовує абсолютний API URL. Backend-тести окремо перевіряють production-атрибути cookie, CSRF, заголовки, методи, статуси, JSON та кешування через локальний HTTP proxy. Поведінку Vercel ingress і Render після простою перевіряйте за кроками 11–12. Render Free може запускатися із затримкою після простою. [Render Free](https://render.com/docs/free)
