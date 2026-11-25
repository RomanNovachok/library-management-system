import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const vite = await createServer({
  root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, envFile: false,
  server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent',
});
after(() => vite.close());
const { detailBack, detailLink, detailTitle } = await vite.ssrLoadModule('/src/utils/detail-navigation.ts');
const rental = '/rentals/c7c0e4b4-87c4-4c6a-a841-18fdbed10002';
const reader = '/readers/8de97695-ddc3-43a0-ac19-417670ddb9a2';
const book = '/books/9d633d29-b0b8-4caf-9781-8c4deff3cf93';

test('detail breadcrumbs match exactly one nested segment and preserve actual 404 routes', () => {
  assert.equal(detailTitle(rental), 'Деталі прокату');
  assert.equal(detailTitle(reader), 'Профіль читача');
  assert.equal(detailTitle(book), 'Деталі книги');
  assert.equal(detailTitle(rental + '/unmapped'), undefined);
  assert.equal(detailTitle('/rentals-not-a-route'), undefined);
});

test('context navigation preserves queries, removes cycles and filters unsafe state', () => {
  const origin = { pathname: rental, search: '?status=ACTIVE&page=2', state: null };
  const readerLink = detailLink(origin, reader);
  const current = { pathname: reader, search: '?rentalsPage=3', state: readerLink.state };
  const back = detailBack(current, { pathname: '/readers', search: '' }, 'Повернутися до читачів');
  assert.deepEqual(back, { to: { pathname: rental, search: origin.search }, label: 'Повернутися до прокату', state: { detailTrail: [] } });
  assert.deepEqual(detailLink(current, rental), { to: back.to, state: back.state });
  const forged = { ...current, state: { detailTrail: [{ pathname: '//example.com', search: '' }, { pathname: reader, search: '' }] } };
  assert.deepEqual(detailBack(forged, { pathname: '/readers', search: '?page=2' }, 'Повернутися до читачів').to, { pathname: '/readers', search: '?page=2' });
});
