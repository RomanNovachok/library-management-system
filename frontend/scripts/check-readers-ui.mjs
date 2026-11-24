import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { createServer as httpServer } from 'node:http';
import path from 'node:path';
import { createServer } from 'vite';
import { register } from '../../backend/node_modules/tsx/dist/esm/api/index.mjs';

register();
const { createApp } = await import('../../backend/src/app.ts');
const { MemoryReadersRepository, validReaderInput, categoryId, otherCategoryId } = await import('../../backend/test/helpers/readers.repository.ts');
const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((candidate) => candidate && existsSync(candidate));
assert.ok(chrome, 'Set CHROME_PATH to an installed Chrome/Chromium executable to run browser checks');
const repository = new MemoryReadersRepository();
for (let i = 0; i < 12; i++) await repository.create({ ...validReaderInput, fullName: `Тестовий Читач ${String(i).padStart(2, '0')}`, categoryId: i % 2 ? otherCategoryId : categoryId });
const requests = [];
let fault;
let delay = 0;
let app;
let origin;
const server = httpServer(async (req, res) => {
  requests.push({ method: req.method, url: req.url });
  if (req.method !== 'OPTIONS' && delay && ['POST', 'PATCH'].includes(req.method)) await new Promise((resolve) => setTimeout(resolve, delay));
  if (req.method !== 'OPTIONS' && fault?.match(req)) {
    if (fault.network) { req.socket.destroy(); return; }
    res.writeHead(fault.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin });
    res.end(JSON.stringify({ error: { code: fault.code ?? 'TEST_FAILURE' } }));
    return;
  }
  app(req, res);
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
  app = createApp({ CORS_ORIGIN: origin, NODE_ENV: 'development' }, { readersRepository: repository });
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
  const targets = await fetch(`http://${new URL(endpoint).host}/json/list`).then((res) => res.json());
  socket = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
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
    pending.set(++nextId, { resolve, reject }); socket.send(JSON.stringify({ id: nextId, method, params }));
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

  await call('Runtime.enable'); await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
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
  fault = { match: (req) => req.url.startsWith('/api/readers'), status: 403, code: 'ADMIN_ACCESS_FORBIDDEN' };
  await navigate('/readers');
  await waitFor(`document.querySelector('main [role="alert"]')?.textContent.includes('локальної розробки')`);
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
  assert.deepEqual(runtimeErrors, []);
  console.info('PASS category API recovery, missing category error, production 403, offline/empty states, return navigation, mobile layout and no runtime exceptions');
} finally {
  clearTimeout(deadline);
  socket?.close();
  browser?.kill();
  await vite.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
