import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { createServer as httpServer } from 'node:http';
import path from 'node:path';
import { createServer } from 'vite';
import { register } from '../../backend/node_modules/tsx/dist/esm/api/index.mjs';
import { rentalFixture } from './rentals-ui-fixture.mjs';
import { checkReportsUI, reportsFixture } from './reports-ui-checks.mjs';

register();
const { createApp } = await import('../../backend/src/app.ts');
const { MemoryReadersRepository, validReaderInput, categoryId, otherCategoryId } = await import('../../backend/test/helpers/readers.repository.ts');
const { MemoryAuthRepository } = await import('../../backend/test/helpers/auth.repository.ts');
const { MemoryBooksRepository, bookId } = await import('../../backend/test/helpers/books.repository.ts');
const { MemoryBookCopiesRepository } = await import('../../backend/test/helpers/book-copies.repository.ts');
const { hashPassword } = await import('../../backend/src/modules/auth/passwords.ts');
const { Prisma } = await import('../../backend/src/generated/prisma/client.ts');
const { emptyReportsData, memoryReportsRepository } = await import('../../backend/test/helpers/reports.repository.ts');
const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((candidate) => candidate && existsSync(candidate));
assert.ok(chrome, 'Set CHROME_PATH to an installed Chrome/Chromium executable to run browser checks');
const repository = new MemoryReadersRepository();
const auth = new MemoryAuthRepository();
const password = `Browser fixture ${randomUUID()}!`;
const passwordHash = await hashPassword(password);
const admin = await auth.createAccount({ email: 'admin@example.test', role: 'ADMIN', passwordHash });
const librarian = await auth.createAccount({ email: 'librarian@example.test', role: 'LIBRARIAN', passwordHash });
const books = new MemoryBooksRepository();
const copies = new MemoryBookCopiesRepository();
copies.books.set(bookId, { id: bookId, archivedAt: null });
for (const copy of books.copies) copies.copies.set(copy.id, copy);
books.copies[0].condition = 'UNKNOWN';
const rentals = rentalFixture({ books, readers: repository, staff: librarian });
const reports = reportsFixture({ empty: emptyReportsData, decimal: (value) => new Prisma.Decimal(value), books });
for (let i = 0; i < 12; i++) await repository.create({ ...validReaderInput, fullName: `Тестовий Читач ${String(i).padStart(2, '0')}`, categoryId: i % 2 ? otherCategoryId : categoryId });
const requests = [];
let fault;
let delay = 0;
let meDelay = 0;
let reportsDelay = 0;
let app;
let origin;
const server = httpServer(async (req, res) => {
  requests.push({ method: req.method, url: req.url });
  if (req.url === '/api/auth/me' && meDelay) await new Promise((resolve) => setTimeout(resolve, meDelay));
  if (reportsDelay && /^\/api\/(reports\/|dashboard)/.test(req.url)) await new Promise((resolve) => setTimeout(resolve, reportsDelay));
  if (req.method !== 'OPTIONS' && delay && ['POST', 'PATCH'].includes(req.method)) await new Promise((resolve) => setTimeout(resolve, delay));
  if (req.method !== 'OPTIONS' && fault?.match(req)) {
    if (fault.partial) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' });
      res.write('{"data":');
      setTimeout(() => res.destroy(), 100);
      return;
    }
    if (fault.network) { req.socket.destroy(); return; }
    res.writeHead(fault.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' });
    res.end(JSON.stringify({ error: { code: fault.code ?? 'TEST_FAILURE' } }));
    return;
  }
  if (!await rentals(req, res, origin)) app(req, res);
});
const vite = await createServer({ server: { host: '127.0.0.1', port: 0 } });
console.info('Readers browser check: Vite configured');
let browser;
let socket;
let deadline;
try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  // Vite replaces the same public API configuration used by the application.
  vite.config.define ??= {};
  vite.config.define['import.meta.env.VITE_API_URL'] = JSON.stringify(`http://127.0.0.1:${server.address().port}/api`);
  await vite.listen();
  console.info('Readers browser check: test servers listening');
  origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  app = createApp({ CORS_ORIGIN: origin, NODE_ENV: 'development' }, {
    readersRepository: repository, authRepository: auth, booksRepository: books, bookCopiesRepository: copies,
    reportsRepository: memoryReportsRepository(reports.data),
  });
  const cache = path.resolve('node_modules/.cache');
  await mkdir(cache, { recursive: true });
  const profile = await mkdtemp(path.join(cache, 'chrome-readers-'));
  browser = spawn(chrome, ['--headless', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true });
  deadline = setTimeout(() => { browser.kill(); process.exitCode = 1; }, 120_000);
  const endpoint = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Chrome startup timed out')), 10_000);
    browser.on('error', (error) => { clearTimeout(timer); reject(error); });
    browser.stderr.on('data', (chunk) => {
      output += chunk.toString();
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  const targets = await fetch(`http://${new URL(endpoint).host}/json/list`, { signal: AbortSignal.timeout(10000) }).then((res) => res.json());
  socket = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome CDP connection timed out')), 10000);
    socket.onopen = () => { clearTimeout(timer); resolve(); };
    socket.onerror = () => { clearTimeout(timer); reject(new Error('Chrome CDP connection failed')); };
  });
  let nextId = 0;
  const pending = new Map();
  const runtimeErrors = [];
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails);
    if (message.id) {
      const callback = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) callback.reject(new Error(JSON.stringify(message.error))); else callback.resolve(message.result);
    }
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Chrome CDP timed out: ${method}`)); }, 10000);
    pending.set(id, {
      resolve: (result) => { clearTimeout(timer); resolve(result); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async (expression) => {
    for (let attempt = 0; attempt < 160; attempt++) {
      if (await evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timeout: ${expression}; page: ${await evaluate('document.querySelector("main")?.innerText')}`);
  };
  const navigate = async (route) => { await call('Page.navigate', { url: `${origin}${route}` }); };
  const click = async (text, scope = 'main') => {
    await evaluate(`{ const button = [...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find(item => item.textContent.trim() === ${JSON.stringify(text)}); if (!button) throw new Error('Button missing'); button.click(); }`);
  };
  const field = async (id, value) => {
    await evaluate(`{ const input = document.getElementById(${JSON.stringify(id)}); Object.getOwnPropertyDescriptor(input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); }`);
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  };
  const ready = () => waitFor(`document.querySelector('section[aria-label="Список читачів"][aria-busy="false"] ul') !== null`);
  const dialogReady = () => waitFor(`document.querySelector('dialog[open] #reader-categoryId') !== null`);
  const closed = () => waitFor(`!document.querySelector('dialog')`);
  const count = (method) => requests.filter((request) => request.method === method).length;
  const fill = (scope, values) => evaluate(`{
    const root = document.querySelector(${JSON.stringify(scope)});
    for (const [name, value] of Object.entries(${JSON.stringify(values)})) root.querySelector('[name="' + name + '"]').value = value;
  }`);
  const loginReady = () => waitFor(`location.pathname === '/login' && !!document.querySelector('input[name="password"]')`);
  const loginAs = async (email, value = password) => {
    await loginReady();
    await fill('main form', { email, password: value });
    await click('Увійти');
  };
  const hasButton = (label) => `[...document.querySelectorAll('main button')].some(button => button.textContent.trim() === ${JSON.stringify(label)})`;

  await call('Runtime.enable'); await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await navigate('/books'); await loginReady();
  assert.ok(!requests.some((request) => request.url.startsWith('/api/books')));
  await loginAs(admin.email, 'incorrect');
  await waitFor(`document.querySelector('[role="alert"]')?.textContent.includes('Неправильна електронна адреса або пароль')`);
  await fill('main form', { email: admin.email, password });
  delay = 400;
  const loginCount = requests.filter(({ method, url }) => method === 'POST' && url === '/api/auth/login').length;
  await evaluate(`{ const form = document.querySelector('main form'); form.requestSubmit(); form.requestSubmit(); }`);
  await waitFor(`location.pathname === '/books' && ${hasButton('Додати книгу')}`);
  delay = 0;
  assert.equal(requests.filter(({ method, url }) => method === 'POST' && url === '/api/auth/login').length, loginCount + 1);
  assert.ok(await evaluate(`document.querySelector('header').textContent.includes('Адміністратор')`));
  assert.ok(await evaluate(`!document.cookie.includes('library_session') && localStorage.length === 0 && sessionStorage.length === 0`));

  meDelay = 650;
  await call('Page.reload');
  await waitFor(`document.querySelector('main')?.textContent.includes('Перевіряємо сеанс')`);
  assert.equal(await evaluate(`document.querySelector('nav') === null`), true);
  await waitFor(hasButton('Додати книгу'));
  meDelay = 0;
  await navigate(`/books/${bookId}`);
  await waitFor(hasButton('Додати примірник'));
  await navigate('/administration');
  await waitFor(`document.querySelector('#staff-title') !== null && document.querySelector('main ul li') !== null`);
  await click('Додати працівника');
  await fill('dialog', { email: 'new@example.test', password });
  await click('Створити обліковий запис', 'dialog');
  await closed();
  await waitFor(`document.querySelector('main ul').textContent.includes('new@example.test')`);
  await evaluate(`[...document.querySelectorAll('main li')].find(row => row.textContent.includes('new@example.test')).querySelector('button').click()`);
  await evaluate(`document.querySelector('dialog input[name="isActive"]').click()`);
  await click('Зберегти зміни', 'dialog'); await closed();
  await waitFor(`[...document.querySelectorAll('main li')].some(row => row.textContent.includes('new@example.test') && row.textContent.includes('Неактивний'))`);
  const resetPassword = `Reset browser ${randomUUID()}!`;
  await evaluate(`[...document.querySelectorAll('main li')].find(row => row.textContent.includes('new@example.test')).querySelectorAll('button')[1].click()`);
  await fill('dialog', { password: resetPassword });
  await click('Зберегти зміни', 'dialog'); await closed();

  await navigate('/dashboard');
  await waitFor(`!!document.querySelector('main a[href="/administration"]')`);
  await click('Вийти', 'header'); await loginReady();
  assert.equal(auth.sessions.size, 0);
  await navigate('/books'); await loginAs(librarian.email);
  await waitFor(`location.pathname === '/books' && document.querySelector('header')?.textContent.includes('Бібліотекар')`);
  assert.equal(await evaluate(hasButton('Додати книгу')), false);
  assert.equal(await evaluate(`document.querySelector('[href="/administration"]')`), null);
  await navigate(`/books/${bookId}`);
  await waitFor(`document.querySelector('main h1')?.textContent === 'Alpha' && document.querySelector('main')?.textContent.includes('TEST-0')`);
  for (const label of ['Редагувати', 'Архівувати', 'Додати примірник', 'Видалити']) assert.equal(await evaluate(hasButton(label)), false);
  await navigate('/administration');
  await waitFor(`location.pathname === '/dashboard'`);
  assert.equal(await evaluate(`document.querySelector('[href="/administration"]')`), null);
  await waitFor(`document.querySelector('main')?.textContent.includes('Видач ще немає.')`);
  await auth.deleteAccountSessions(librarian.id);
  await evaluate(`document.querySelector('nav [href="/readers"]').click()`);
  await loginReady();
  await loginAs(librarian.email); await ready();
  console.info('PASS login, private route, duplicate submit, reload, ADMIN/LIBRARIAN UI, staff forms, logout and revoked session redirect');

  await navigate('/readers?pageSize=10&page=2'); await ready();
  assert.equal(await evaluate(`document.querySelectorAll('section ul > li').length`), 2);
  await field('reader-search', 'Тестовий Читач 01'); await ready();
  await waitFor(`document.querySelectorAll('section ul > li').length === 1`);
  assert.equal(await evaluate(`new URLSearchParams(location.search).has('page')`), false);
  await field('reader-search', ''); await field('reader-category-filter', categoryId); await ready();
  await waitFor(`document.querySelectorAll('section ul > li').length === 6`);
  assert.equal(await evaluate(`new URLSearchParams(location.search).get('categoryId')`), categoryId);
  await field('reader-category-filter', ''); await ready();
  await click('Додати читача'); await dialogReady();
  const postBefore = count('POST');
  await click('Зареєструвати читача', 'dialog');
  await waitFor(`document.querySelectorAll('dialog [aria-invalid="true"]').length === 4`);
  assert.equal(count('POST'), postBefore);
  await field('reader-fullName', 'Умовний Новий Читач');
  await field('reader-address', 'Умовна адреса 2'); await field('reader-phone', '+380 (00) 000-00-02');
  await field('reader-categoryId', otherCategoryId);
  delay = 300;
  await evaluate(`{ const form = document.querySelector('dialog form'); for (let i = 0; i < 2; i++) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }`);
  await waitFor(`document.querySelector('dialog button[type="submit"]')?.disabled === true`);
  await closed(); delay = 0; await ready();
  assert.equal(count('POST'), postBefore + 1);
  const created = [...repository.readers.values()].find((reader) => reader.fullName === 'Умовний Новий Читач');
  assert.ok(created);
  await evaluate(`document.querySelector('section ul a').click()`);
  await waitFor(`document.querySelector('h1')?.textContent === 'Умовний Новий Читач' && document.querySelector('main')?.textContent.includes('ще немає прокатів')`);
  assert.ok(await evaluate(`document.querySelector('main').textContent.includes('12,50%')`));
  await click('Редагувати профіль'); await dialogReady();
  assert.equal(await evaluate(`document.getElementById('reader-address').value`), 'Умовна адреса 2');
  await field('reader-categoryId', categoryId); await field('reader-phone', '0000000003');
  const patchBefore = count('PATCH'); delay = 300;
  await evaluate(`{ const form = document.querySelector('dialog form'); for (let i = 0; i < 2; i++) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }`);
  await closed(); delay = 0;
  await waitFor(`document.querySelector('main')?.textContent.includes('0000000003')`);
  assert.equal(count('PATCH'), patchBefore + 1);
  assert.equal(repository.readers.get(created.id).categoryId, categoryId);
  assert.equal(repository.readers.get(created.id).address, 'Умовна адреса 2');
  console.info('PASS list/search/filter/pages, required validation, database categories, create/edit, empty history and duplicate POST/PATCH prevention');

  fault = { match: (req) => req.method === 'PATCH', status: 400, code: 'READER_CATEGORY_NOT_FOUND' };
  await click('Редагувати профіль'); await dialogReady(); await field('reader-address', 'Умовна адреса 3'); await click('Зберегти зміни', 'dialog');
  await waitFor(`document.querySelector('dialog [role="alert"]')?.textContent.includes('Категорію не знайдено')`);
  await click('Скасувати', 'dialog'); await closed(); fault = undefined;
  await evaluate(`document.querySelector('main > a').click()`); await ready();
  assert.equal(await evaluate(`new URLSearchParams(location.search).get('search')`), 'Умовний Новий Читач');
  fault = { match: (req) => req.url.startsWith('/api/reader-categories'), status: 500 };
  await click('Додати читача');
  await waitFor(`document.querySelector('dialog [role="alert"]') !== null`);
  assert.equal(await evaluate(`document.querySelector('dialog button[type="submit"]') === null`), true);
  fault = undefined; await click('Спробувати ще раз', 'dialog'); await dialogReady();
  await click('Скасувати', 'dialog'); await closed();
  fault = { match: (req) => req.url.startsWith('/api/readers'), status: 403, code: 'ROLE_FORBIDDEN' };
  await navigate('/readers');
  await waitFor(`document.querySelector('main [role="alert"]')?.textContent.includes('роль')`);
  fault = { match: (req) => req.url.startsWith('/api/readers'), network: true };
  await navigate('/readers');
  await waitFor(`document.querySelector('main [role="alert"]')?.textContent.includes('з’єднатися із сервером')`);
  fault = undefined;
  await navigate('/readers?search=НемаєТакогоЧитача');
  await waitFor(`document.querySelector('main')?.textContent.includes('Читачів не знайдено')`);
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await navigate(`/readers/${created.id}`);
  await waitFor(`document.querySelector('h1')?.textContent === 'Умовний Новий Читач'`);
  assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'));
  await click('Редагувати профіль'); await dialogReady();
  assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'));
  await click('Скасувати', 'dialog'); await closed();
  console.info('PASS category API recovery, missing category error, 403, offline/empty states, return navigation, mobile layout and no runtime exceptions');

  const dialogText = (value) => `document.querySelector('dialog')?.textContent.includes(${JSON.stringify(value)})`;
  const selectInDialog = async (index, value) => {
    await evaluate(`{ const select = document.querySelectorAll('dialog select')[${index}]; const option = [...select.options].find(x => x.textContent.includes(${JSON.stringify(value)})); select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); }`);
  };
  const enterText = (selector, value) => evaluate(`{ const input = document.querySelector(${JSON.stringify(selector)}); const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); }`);
  const comboKey = (index, key) => evaluate(`document.querySelectorAll('dialog [role=combobox]')[${index}].dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }))`);
  async function fillIssue() {
    await click('Видати книгу');
    await waitFor(`document.querySelectorAll('dialog[open] [role=combobox]').length === 2`);
    await evaluate(`document.querySelector('dialog [role=combobox]').focus(); document.querySelector('dialog [role=combobox]').click()`);
    await waitFor(dialogText('Сторінка 1'));
    await click('Далі', 'dialog');
    await waitFor(dialogText('Тестовий Читач 11'));
    await enterText('dialog [role=combobox]', 'Тестовий Читач 11');
    await waitFor(`document.querySelectorAll('dialog [role=option]').length === 1 && document.querySelector('dialog [role=option]').textContent.includes('11')`);
    await comboKey(0, 'ArrowDown'); await comboKey(0, 'Enter');
    await waitFor(`document.querySelector('dialog [role=combobox]').value.includes('11') && document.querySelector('dialog [role=combobox]').getAttribute('aria-expanded') === 'false'`);
    await evaluate(`{ const book = document.querySelectorAll('dialog [role=combobox]')[1]; book.focus(); book.click(); }`);
    await waitFor(`document.querySelectorAll('dialog [role=combobox]')[1].getAttribute('aria-expanded') === 'true'`);
    await enterText('dialog [role=combobox][placeholder="Назва, автор або жанр"]', 'Drama');
    await waitFor(dialogText('Alpha'));
    await comboKey(1, 'Escape');
    await waitFor(`!document.querySelector('dialog [role=listbox]')`);
    await comboKey(1, 'Enter');
    await waitFor(dialogText('Alpha'));
    await evaluate(`[...document.querySelectorAll('dialog [role=option]')].find(e => e.textContent.includes('Alpha')).click()`);
    await waitFor(`document.querySelectorAll('dialog select')[0]?.options.length === 2`);
    await selectInDialog(0, 'TEST-0');
    await waitFor(dialogText('Огляньте примірник перед видачею'));
    await selectInDialog(1, 'Незначні пошкодження');
    await enterText('dialog textarea', 'Старий надрив');
    await evaluate(`{ const input = document.querySelector('dialog input[type=datetime-local]'); const date = new Date(Date.now() + 86400000); const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, local); input.dispatchEvent(new Event('input', { bubbles: true })); }`);
    await waitFor(dialogText('Підтверджую отримання застави'));
    assert.ok(await evaluate(`document.querySelector('dialog button[type=submit]').disabled`));
    await evaluate(`document.querySelector('dialog input[type=checkbox]').click()`);
    await waitFor(`!document.querySelector('dialog button[type=submit]').disabled`);
  }
  const issueCount = () => requests.filter(({ method, url }) => method === 'POST' && url === '/api/rentals').length;
  const closeCount = () => requests.filter(({ method, url }) => method === 'POST' && url.endsWith('/close')).length;
  const previewCount = () => requests.filter(({ method, url }) => method === 'POST' && url.endsWith('/return-preview')).length;
  const doubleSubmit = () => evaluate(`{ const form = document.querySelector('dialog form'); for (let i = 0; i < 2; i++) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }`);
  await navigate('/rentals?status=ACTIVE&pageSize=10');
  await waitFor(`document.querySelector('main')?.textContent.includes('Прокатів не знайдено')`);
  await fillIssue();
  fault = { match: (req) => req.method === 'POST' && req.url === '/api/rentals', status: 409, code: 'RENTAL_COPY_UNAVAILABLE' };
  await doubleSubmit();
  await waitFor(dialogText('Цей примірник уже видано'));
  assert.equal(issueCount(), 1);
  fault = undefined;
  await click('Оновити дані', 'dialog'); await closed();
  await fillIssue(); await doubleSubmit(); await closed();
  assert.equal(issueCount(), 2);
  await waitFor(`document.querySelector('main')?.textContent.includes('Книгу видано')`);
  await evaluate(`[...document.querySelectorAll('main a')].find(a => a.textContent === 'Деталі прокату').click()`);
  await waitFor(hasButton('Оформити повернення'));
  const breadcrumb = (text) => `document.querySelector('[aria-label="Шлях до сторінки"] [aria-current=page]')?.textContent === ${JSON.stringify(text)}`;
  const backLabel = (label) => `document.querySelector('main > a')?.textContent.includes(${JSON.stringify(label)})`;
  const follow = (label) => evaluate(`[...document.querySelectorAll('main a')].find(a => a.textContent.includes(${JSON.stringify(label)})).click()`);
  assert.ok(await evaluate(breadcrumb('Деталі прокату')));
  assert.ok(await evaluate(`document.querySelector('nav[aria-label="Основна навігація"] [href="/rentals"]').getAttribute('aria-current') === 'page'`));
  const rentalRoute = await evaluate('location.pathname + location.search');
  await follow('Картка книги та примірники');
  await waitFor(breadcrumb('Деталі книги')); await waitFor(backLabel('Повернутися до прокату'));
  await waitFor(`document.querySelector('main').textContent.includes('Старий надрив')`);
  await follow('Повернутися до прокату'); await waitFor(`location.pathname + location.search === ${JSON.stringify(rentalRoute)}`); await waitFor(hasButton('Оформити повернення'));
  await follow('Тестовий Читач 11'); await waitFor(breadcrumb('Профіль читача'));
  const readerRoute = await evaluate('location.pathname');
  await call('Page.reload'); await waitFor(backLabel('Повернутися до прокату')); await follow('Повернутися до прокату');
  await waitFor(hasButton('Оформити повернення')); await waitFor(backLabel('Повернутися до прокатів'));
  await navigate(`${readerRoute}?search=Тестовий&rentalsPage=1`); await waitFor(backLabel('Повернутися до читачів'));
  await waitFor(`!!document.querySelector('main ul a[href^="/rentals/"]')`);
  await follow('Alpha'); await waitFor(backLabel('Повернутися до читача'));
  await follow('Повернутися до читача'); await waitFor(`new URLSearchParams(location.search).get('rentalsPage') === '1'`);
  await navigate(`${rentalRoute.split('?')[0]}/extra`); await waitFor(breadcrumb('Сторінку не знайдено'));
  await navigate(rentalRoute); await waitFor(hasButton('Оформити повернення'));
  await click('Оформити повернення'); await waitFor(dialogText('Старий надрив'));
  await selectInDialog(0, 'Так');
  await waitFor(dialogText('Тяжкість нових пошкоджень'));
  await selectInDialog(1, 'Незначні пошкодження');
  await selectInDialog(2, 'Серйозні пошкодження');
  assert.ok(await evaluate(`document.querySelector('dialog button[type=submit]').disabled`));
  await enterText('dialog textarea', 'Додатковий надрив');
  await waitFor(dialogText('На обслуговуванні'));
  await click('Примірник втрачено', 'dialog');
  await waitFor(dialogText('Підтверджую касовий розрахунок'));
  assert.ok(await evaluate(dialogText('компенсація за втрату')));
  await evaluate(`document.querySelector('dialog input[type=checkbox]').click()`);
  fault = { match: (req) => req.method === 'POST' && req.url.endsWith('/close'), status: 409, code: 'RENTAL_PREVIEW_CHANGED' };
  await doubleSubmit(); await waitFor(dialogText('Сума або умови повернення змінилися'));
  assert.equal(closeCount(), 1);
  const previewBefore = previewCount();
  await click('Оновити дані', 'dialog'); await waitFor(dialogText('Підтверджую касовий розрахунок'));
  assert.equal(previewCount(), previewBefore + 1);
  assert.ok(await evaluate(`document.querySelector('dialog button[type=submit]').disabled`));
  await evaluate(`document.querySelector('dialog input[type=checkbox]').click()`);
  fault = { match: (req) => req.method === 'POST' && req.url.endsWith('/close'), partial: true };
  await doubleSubmit(); await waitFor(dialogText('Результат операції невідомий'));
  await doubleSubmit();
  assert.equal(closeCount(), 2);
  assert.ok(await evaluate(`document.querySelector('dialog button[type=submit]').disabled`));
  fault = undefined;
  await click('Оновити дані', 'dialog'); await closed(); await waitFor(hasButton('Оформити повернення'));
  await click('Оформити повернення'); await click('Примірник втрачено', 'dialog'); await waitFor(dialogText('Підтверджую касовий розрахунок'));
  await evaluate(`document.querySelector('dialog input[type=checkbox]').click()`);
  await doubleSubmit(); await closed();
  assert.equal(closeCount(), 3);
  await waitFor(`document.querySelector('main')?.textContent.includes('Втрату книги оформлено') && document.querySelector('main')?.textContent.includes('Отримання доплати')`);
  assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'));
  console.info('PASS Rentals combobox, physical condition, history navigation, breadcrumbs, confirmation, conflicts, stale preview, unknown outcome, LOST and mobile layout');
  await checkReportsUI({
    call, evaluate, waitFor, navigate, click, setFault: (value) => { fault = value; },
    setDelay: (value) => { reportsDelay = value; }, showRental: reports.showRental, requests,
    rental: {
      id: rentalRoute.split('/')[2].split('?')[0], status: 'LOST', issuedAt: new Date(), dueAt: new Date(), closedAt: new Date(),
      reader: { id: readerRoute.split('/')[2], fullName: 'Тестовий Читач 11' },
      copy: { inventoryCode: 'TEST-0', book: { id: bookId, title: 'Alpha' } },
    },
  });
  assert.deepEqual(runtimeErrors, []);
} finally {
  clearTimeout(deadline);
  socket?.close();
  browser?.kill();
  await vite.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
