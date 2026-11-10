# Попередня архітектура та GoF

## Принцип

Один GitHub-репозиторій (монорепозиторій) із `frontend/` (React + TypeScript) та `backend/` (Express + TypeScript). Frontend звертається до backend через REST API; дані зберігаються в PostgreSQL з використанням Prisma. Backend — модульний моноліт із модулями `books`, `readers`, `rentals`, `reports`, `auth`, `settings`. Всередині модуля: controller → service → repository/data access. При зміні БД бізнес-логіка не повинна змішуватися з Express-контролерами.

## Реалізація чотирьох GoF-патернів

**Strategy.** `DiscountStrategy` з реалізаціями `NoDiscountStrategy` і `PercentageDiscountStrategy`. Відсоток передається як значення з категорії, знімок якого зафіксований у прокаті. **Не** створюємо окремий клас під кожну категорію з БД.

**Observer.** `RentalEventPublisher` поширює `RentalIssued` і `RentalClosed` підписникам (`AuditLogSubscriber`, опціонально `NotificationSubscriber`). Опублікувати подію потрібно лише після успішної транзакції. У першій версії достатньо синхронного in-process механізму; для надійного асинхронного доставляння в майбутньому потрібен outbox.

**Template Method.** Абстрактний `BaseReport` реалізує фінальний алгоритм `generate(params)` (отримати дані → агрегувати → сформувати результат); конкретні `InventoryReport`, `RentalsReport`, `FinancialReport` реалізують кроки.

**Factory Method.** Абстрактний `ReportCreator` оголошує фабричний метод `createReport()`, який у `InventoryReportCreator`, `RentalsReportCreator`, `FinancialReportCreator` створює конкретні генератори. Це саме GoF Factory Method, не проста функція з `switch`.

## SOLID / GRASP

- SRP: сервіси прокату, розрахунку, звітів мають окрему відповідальність.
- OCP: нові способи розрахунку знижок підтримуються через інтерфейс стратегії; нові типи звітів — через нові генератори/творці.
- DIP: сервіси залежатимуть від контрактів, а не від деталей запитів до БД.
- GRASP: Controller приймає запити, Information Expert зберігає правила там, де знаходяться необхідні дані; High Cohesion, Low Coupling.

## Критичні технічні рішення

- Грошові значення — `Decimal`, не `float`.
- `BookCopy` перевіряємо і змінюємо атомарно разом із видачею.
- Знімки ціни/знижки/застави в `Rental`.
- Книги з історією не видаляємо фізично, а архівуємо.
- Backend перевіряє `ADMIN`/`LIBRARIAN`, а не лише frontend.
- Різницю між *нарахуваннями* та *рухом грошей* зберігаємо явно.

## Розгортання

Frontend і backend запускаються локально окремо та деплояться незалежно, хоча код залишається в одному репозиторії:

- **Frontend** — Vercel, коренева папка проєкту `frontend/`.
- **Backend** — Render Web Service, коренева папка сервісу `backend/`.
- **PostgreSQL** — окрема керована база даних; провайдера оберемо перед деплоєм. Локально — Docker Compose.

Під час початкової ініціалізації створюємо окремі `package.json` та lock-файли для `frontend/` і `backend/`. Поки не використовуємо спільні npm workspaces чи спільну папку пакетів: це спростить незалежні збірки на Vercel і Render. Якщо згодом з'явиться реальна потреба в спільних пакетах, повернемося до цього рішення.

Адреса API передається frontend через `VITE_API_URL`, а рядок підключення БД — тільки backend через `DATABASE_URL`. Backend дозволяє CORS для адреси frontend; секрети не потрапляють до репозиторію або клієнтської збірки. Докладніше — у [плані деплою](deployment.md).
