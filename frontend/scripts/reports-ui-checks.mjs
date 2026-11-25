import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export function reportsFixture({ empty, decimal, books }) {
  const extra = Array.from({ length: 10 }, (_, index) => ({
    id: randomUUID(), title: `Фонд ${index}`, author: 'Автор', genre: 'Роман', archivedAt: null,
  }));
  let rental;
  const aggregate = (total) => ({ _count: { _all: total } });
  function page(items, number, size) {
    return items.slice((number - 1) * size, number * size);
  }
  return {
    showRental(row) { rental = row; },
    data: {
      ...empty,
      async inventory(query) {
        const catalogue = [...books.books.values(), ...extra].filter((book) =>
          (query.archived === 'all' || (query.archived === 'archived') === Boolean(book.archivedAt))
          && (!query.search || [book.title, book.author, book.genre].some((value) => value.toLowerCase().includes(query.search.toLowerCase()))));
        const rows = catalogue.filter((book) => !query.genre || book.genre.toLowerCase() === query.genre.toLowerCase());
        const pageRows = page(rows, query.page, query.pageSize);
        const genreGroups = [...new Set(catalogue.map((row) => row.genre))].sort().map((genre) => ({ genre }));
        return { books: pageRows, editions: rows.length, archivedEditions: rows.filter((row) => row.archivedAt).length,
          genreGroups, availableForIssue: 0, copyGroups: [], pageGroups: [] };
      },
      async rentals(query) {
        if (!rental) return empty.rentals();
        const items = query.status && query.status !== rental.status ? [] : [rental];
        return { items: page(items, query.page, query.pageSize), states: [{ status: 'LOST', ...aggregate(items.length) }],
          overdueCount: 0, issuedCount: items.length, closedCount: items.length };
      },
      async financial(query) {
        const data = await empty.financial();
        if (!rental) return data;
        const refund = decimal('310.20');
        const fee = decimal('4.80');
        return {
          ...data,
          cashGroups: [{ type: 'REFUND_OUT', _sum: { amount: refund }, ...aggregate(21) }],
          cashRows: [{ id: rental.id, type: 'REFUND_OUT', amount: refund, createdAt: rental.closedAt,
            recordedBy: { email: 'librarian@example.test' }, rental: { id: rental.id, copy: rental.copy } }],
          charges: { ...aggregate(1), _sum: { rentalFee: fee, damageFine: null } },
          closedRows: query.chargesPage === 1 ? [{ ...rental, rentalFee: fee, damageFine: decimal('0.00'),
            depositSnapshot: decimal('350.00'), refundAmount: refund, additionalPayment: decimal('0.00') }] : [],
          buckets: { interval: 'day', items: [{ bucket: '2026-11-25', rentalFee: fee, damageFine: decimal('0.00'),
            depositIn: decimal('0.00'), refundOut: refund, topupIn: decimal('0.00') }] },
        };
      },
      async dashboard() {
        const data = await empty.dashboard();
        if (!rental) return data;
        const active = { ...rental, status: 'ACTIVE', closedAt: null, dueAt: new Date(Date.now() - 90_000) };
        return { ...data, editions: 2, availableCopies: 3, readers: 12, maintenanceCopies: 1, overdueRentals: 1,
          liability: { ...aggregate(1), _sum: { depositSnapshot: decimal('350.00') } },
          latestIssues: [rental], latestClosures: [rental], overdueItems: [active] };
      },
    },
  };
}

export async function checkReportsUI({ call, evaluate, waitFor, navigate, click, setFault, setDelay, showRental, requests, rental }) {
  const has = (text) => `document.querySelector('main')?.textContent.includes(${JSON.stringify(text)})`;
  const heading = (text) => `[...document.querySelectorAll('main h2')].some((element) => element.textContent === ${JSON.stringify(text)})`;
  const searchValue = (key, value) => `new URLSearchParams(location.search).get(${JSON.stringify(key)}) === ${JSON.stringify(value)}`;
  const link = (text, scope = 'main') => evaluate(`{
    const label = ${JSON.stringify(text)};
    const anchor = [...document.querySelectorAll(${JSON.stringify(`${scope} a`)})].find((a) => {
      const name = a.textContent.trim();
      return name === label || name.startsWith('←') && name.slice(1).trim() === label;
    });
    if (!anchor) throw new Error('Link missing: ' + label);
    anchor.click();
  }`);
  const select = (label, value) => evaluate(`{
    const field = [...document.querySelectorAll('main label')].find((node) => node.firstChild.textContent.trim() === ${JSON.stringify(label)}).querySelector('select');
    field.value = ${JSON.stringify(value)};
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }`);

  setDelay(450);
  await navigate('/dashboard');
  await waitFor(has('Завантажуємо показники бібліотеки'));
  await waitFor(has('Видач ще немає.'));
  assert.ok(await evaluate(has('Закритих прокатів ще немає.')));
  assert.equal(await evaluate(`document.querySelector('main a[href="/administration"]')`), null);
  showRental(rental);
  await click('Оновити показники');
  await waitFor(heading('Потребують повернення'));
  assert.ok(await evaluate(has('350,00')));
  assert.ok(await evaluate(`!!document.querySelector('main a[href="/rentals?status=ACTIVE&overdue=true"]')`));
  await link('Деталі', '[aria-label="Останні видачі"]');
  await waitFor(has('Повернутися на головну'));
  await link('Повернутися на головну');
  await waitFor(heading('Стан бібліотеки'));

  await navigate('/reports?pageSize=10');
  await waitFor(heading('Видання та примірники'));
  assert.equal(await evaluate(`document.querySelectorAll('main tbody tr').length`), 10);
  await link('Далі →', '[aria-label="Сторінки книжкового фонду"]');
  await waitFor(searchValue('page', '2'));
  await waitFor(`document.querySelectorAll('main tbody tr').length === 2`);
  assert.ok(await evaluate(`!!document.querySelector('main select option[value="Novel"]')`));
  await select('Жанр', 'Novel');
  await waitFor(`${heading('Видання та примірники')} && ${has('Archived')} && ${searchValue('genre', 'Novel')} && ${searchValue('page', null)}`);
  assert.ok(await evaluate(has('Доступні для видачі')));
  assert.ok(await evaluate(has('Статус «Доступний»')));
  await select('Видання', 'archived');
  await waitFor(`${has('Archived')} && ${searchValue('archived', 'archived')} && !document.querySelector('main select option[value="Drama"]')`);
  await link('Archived');
  await waitFor(has('Повернутися до звітів'));
  const documentTime = await evaluate('performance.timeOrigin');
  await call('Page.reload');
  await waitFor(`performance.timeOrigin !== ${documentTime} && ${has('Повернутися до звітів')}`);
  await link('Повернутися до звітів');
  await waitFor(`location.pathname === '/reports' && ${heading('Видання та примірники')} && ${searchValue('archived', 'archived')} && ${searchValue('genre', 'Novel')}`);

  await link('Прокати', '[aria-label="Види звітів"]');
  await waitFor(has('Завантажуємо звіт про прокати'));
  assert.equal(await evaluate(heading('Видання та примірники')), false);
  await waitFor(heading('Прокати за датою видачі'));
  await select('Дата для відбору рядків', 'closedAt');
  await waitFor(heading('Прокати за датою закриття'));
  await select('Поточний статус', 'RETURNED');
  await waitFor(has('Прокатів за вибраними фільтрами не знайдено.'));
  await select('Поточний статус', '');
  await waitFor(has('Деталі'));
  await link(rental.reader.fullName, '[aria-label="Прокати за датою закриття"]');
  await waitFor(has('Повернутися до звітів'));
  await link('Повернутися до звітів');
  await waitFor(`${heading('Прокати за датою закриття')} && ${searchValue('dateBy', 'closedAt')}`);

  setFault({ match: (req) => req.url.startsWith('/api/reports/financial'), status: 500 });
  await link('Фінанси', '[aria-label="Види звітів"]');
  await waitFor(has('Завантажуємо фінансовий звіт'));
  assert.equal(await evaluate(heading('Прокати за датою закриття')), false);
  await waitFor(`!!document.querySelector('main [role="alert"]')`);
  setFault(undefined);
  setDelay(0);
  await click('Спробувати ще раз');
  await waitFor(heading('Касові операції'));
  assert.ok(await evaluate(has('-310,20')));
  assert.ok(await evaluate(heading('Динаміка за період')));
  await link('Далі →', '[aria-label="Сторінки касових операцій"]');
  await waitFor(`${heading('Касові операції')} && ${searchValue('cashPage', '2')} && ${searchValue('chargesPage', null)}`);
  await select('Період', 'custom');
  await waitFor(`!!document.querySelector('input[name="toDate"]')`);
  await evaluate(`document.querySelector('input[name="fromDate"]').value = '2026-03-29'; document.querySelector('input[name="toDate"]').value = '2026-03-29'`);
  const dateLabel = await evaluate(`new Intl.DateTimeFormat('uk-UA', { dateStyle: 'medium' }).format(new Date(2026, 2, 29))`);
  await click('Застосувати період');
  await waitFor(`${heading('Касові операції')} && ${has(dateLabel)} && ${searchValue('toDate', '2026-03-29')}`);
  const request = requests.findLast(({ url }) => url.startsWith('/api/reports/financial'));
  const query = new URL(request.url, 'http://localhost').searchParams;
  const dates = await evaluate(`[new Date(2026, 2, 29).toISOString(), new Date(2026, 2, 30).toISOString()]`);
  assert.deepEqual([query.get('from'), query.get('to')], dates);
  assert.equal(query.get('cashPage'), '1');
  assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'));
  console.info('PASS Reports and Dashboard loading, empty and error states, tabs, date filters, paging, charts, roles, detail navigation and mobile layout');
}
