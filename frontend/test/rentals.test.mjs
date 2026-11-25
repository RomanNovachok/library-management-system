import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const vite = await createServer({
  root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, envFile: false,
  server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent',
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('https://api.example.test/api') },
});
after(() => vite.close());
const api = await vite.ssrLoadModule('/src/api/rentals.ts');
const { isRentalResponse, isReturnPreviewResponse } = await vite.ssrLoadModule('/src/api/rental-contract.ts');
const { ApiError } = await vite.ssrLoadModule('/src/api/client.ts');
const id = 'c7c0e4b4-87c4-4c6a-a841-18fdbed10002';
const copyId = '9d633d29-b0b8-4caf-9781-8c4deff3cf93';
const readerId = '8de97695-ddc3-43a0-ac19-417670ddb9a2';
const ruleId = 'bdd7b5e7-c603-4e34-b004-cc9a78ec0673';
const stamp = '2026-11-02T10:00:00.000Z';
const staff = { id, email: 'staff@example.test', role: 'LIBRARIAN' };
const active = {
  id, status: 'ACTIVE', overdue: false, issuedAt: stamp, dueAt: '2026-11-03T10:00:00.000Z', closedAt: null,
  reader: { id: readerId, fullName: 'Олена' }, copy: { id: copyId, inventoryCode: 'TEST', status: 'RENTED', condition: 'GOOD', conditionNotes: null, book: { id, title: 'Книга', author: 'Автор' } },
  issuedBy: staff, closedBy: null, pricePerDaySnapshot: '10.05', depositSnapshot: '30.05',
  discountPercentSnapshot: '10.00', readerCategorySnapshot: 'Студент',
  billableDays: null, rentalFee: null, damageFine: null, damagePercentSnapshot: null,
  damageRuleId: null, damageRule: null, refundAmount: null, additionalPayment: null, cashMovements: [],
  conditionAtIssue: 'GOOD', conditionNotesAtIssue: null, conditionAtReturn: null, conditionNotesAtReturn: null, newDamageNotes: null,
};
const quote = {
  rentalId: id, damageRuleId: ruleId, copyStatus: 'LOST', status: 'LOST', billableDays: 1, damagePercent: '100.00',
  deposit: '30.05', rentalFee: '9.05', damageFine: '30.05', charges: '39.10', refundAmount: '0.00', additionalPayment: '9.05',
  previewVersion: 'a'.repeat(64),
  condition: 'LOST', conditionNotes: null, newDamageNotes: null,
};
const issue = { copyId, readerId, dueAt: active.dueAt };
const terms = { dailyPrice: '10.05', depositAmount: '30.05', categoryName: 'Студент', discountPercent: '10.00', condition: 'GOOD', conditionNotes: null };
const lostInput = { assessment: { type: 'LOST' } };
const signal = new AbortController().signal;

test('issue sends one authenticated write with exact input keys and a fingerprint of the displayed terms', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.example.test/api/rentals');
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'include');
    assert.equal(options.headers['X-Library-Request'], '1');
    assert.equal(options.headers['X-Rental-Terms'], createHash('sha256').update(JSON.stringify([readerId, copyId, ...Object.values(terms)])).digest('hex'));
    assert.deepEqual(JSON.parse(options.body), issue);
    return Response.json({ data: active }, { status: 201 });
  });
  assert.deepEqual(await api.issueRental(issue, terms, signal), active);
  assert.equal(fetch.mock.callCount(), 1);
});

test('preview and close validate the request identity and use the returned confirmation version', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.method, 'POST');
    if (url.endsWith('/return-preview')) {
      assert.deepEqual(JSON.parse(options.body), lostInput);
      return Response.json({ data: quote });
    }
    assert.deepEqual(JSON.parse(options.body), { ...lostInput, previewVersion: quote.previewVersion });
    return Response.json({ data: {
      ...active, status: 'LOST', copy: { ...active.copy, status: 'LOST', condition: 'LOST' }, closedAt: stamp, closedBy: staff, conditionAtReturn: 'LOST',
      billableDays: quote.billableDays, rentalFee: quote.rentalFee, damageFine: quote.damageFine,
      damagePercentSnapshot: quote.damagePercent, damageRuleId: ruleId, damageRule: { id: ruleId, code: 'LOST', label: 'Втрачено' },
      refundAmount: quote.refundAmount, additionalPayment: quote.additionalPayment,
    } });
  });
  const result = await api.getReturnPreview(id, lostInput, signal);
  assert.deepEqual(result, quote);
  assert.equal((await api.closeRental(id, { ...lostInput, previewVersion: result.previewVersion }, signal)).status, 'LOST');
  assert.equal(isReturnPreviewResponse({ data: { ...quote, damageFine: 30.05 } }), false);
  assert.equal(isReturnPreviewResponse({ data: { ...quote, status: 'RETURNED' } }), false);
  assert.equal(isRentalResponse({ data: { ...active, rentalFee: '0.00' } }), false);
});

test('writes handle API errors and connection failures without retrying uncertain results', async (t) => {
  for (const status of [400, 401, 403, 404, 409, 500, undefined]) {
    await t.test(String(status), async (subtest) => {
      const fetch = subtest.mock.method(globalThis, 'fetch', async () => {
        if (status === undefined) throw new TypeError('Offline');
        return Response.json({ error: { code: status === 409 ? 'RENTAL_PREVIEW_CHANGED' : 'TEST_ERROR' } }, { status });
      });
      await assert.rejects(api.closeRental(id, { ...lostInput, previewVersion: quote.previewVersion }, signal),
        (error) => error instanceof ApiError && error.status === status && error.outcomeUnknown === (status === 500 || status === undefined));
      assert.equal(fetch.mock.callCount(), 1);
    });
  }
});
