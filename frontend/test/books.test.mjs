import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isBookCopiesResponse, isBookDetailsResponse, isBooksResponse } from '../src/api/book-contract.ts';
import { formatHryvnia } from '../src/utils/money.ts';

const book = {
  id: 'c7c0e4b4-87c4-4c6a-a841-18fdbed10002',
  title: 'Лісова пісня', author: 'Леся Українка', genre: 'Драма-феєрія',
  dailyPrice: '5.00', depositAmount: '300.00', archivedAt: null,
};
const copy = { id: '9d633d29-b0b8-4caf-9781-8c4deff3cf93', bookId: book.id, inventoryCode: 'INV-0003', status: 'AVAILABLE', condition: 'GOOD', conditionNotes: null };
const catalog = {
  data: [{ ...book, copyCount: 3, availableCopyCount: 2 }],
  pagination: { page: 1, pageSize: 12, total: 1, totalPages: 1 },
};

test('formats exact decimal strings, including zero, cents and the maximum amount', () => {
  for (const [value, expected] of [
    ['0.00', '0,00\u00a0грн'], ['0.01', '0,01\u00a0грн'], ['4.50', '4,50\u00a0грн'],
    ['1234.05', '1\u00a0234,05\u00a0грн'], ['9999999999.99', '9\u00a0999\u00a0999\u00a0999,99\u00a0грн'],
  ]) assert.equal(formatHryvnia(value), expected);
});

test('rejects malformed money instead of silently rounding or coercing it', () => {
  for (const value of ['-1.00', '1.001', '1e2', 'NaN', '1,50', '01.00', '10000000000.00', ' 1.00', '1']) {
    assert.throws(() => formatHryvnia(value));
  }
});

test('accepts backend catalog, empty results and pages beyond the result', () => {
  assert.equal(isBooksResponse(catalog), true);
  assert.equal(isBooksResponse({ data: [], pagination: { page: 1, pageSize: 12, total: 0, totalPages: 0 } }), true);
  assert.equal(isBooksResponse({ data: [], pagination: { page: 99, pageSize: 12, total: 5, totalPages: 1 } }), true);
});

test('rejects incompatible envelopes, pagination, counts, identities and numeric money', () => {
  const invalid = [null, [], {}, { data: [] },
    { ...catalog, pagination: { ...catalog.pagination, totalPages: 2 } },
    { ...catalog, pagination: { ...catalog.pagination, page: 0 } },
    { ...catalog, pagination: { ...catalog.pagination, total: -1 } },
    { ...catalog, pagination: { ...catalog.pagination, pageSize: 101 } },
    ...[{ dailyPrice: 5 }, { depositAmount: '1.005' }, { availableCopyCount: 4 }, { copyCount: -1 }, { id: '../bad' }]
      .map((changes) => ({ ...catalog, data: [{ ...catalog.data[0], ...changes }] })),
  ];
  for (const value of invalid) assert.equal(isBooksResponse(value), false);
});

test('validates details and all four copy statuses, including empty and archived books', () => {
  for (const status of ['AVAILABLE', 'RENTED', 'MAINTENANCE', 'LOST']) {
    const data = [{ ...copy, status }];
    assert.equal(isBookCopiesResponse({ data }), true);
    assert.equal(isBookDetailsResponse({ data: { ...book, copies: data } }), true);
  }
  assert.equal(isBookCopiesResponse({ data: [] }), true);
  assert.equal(isBookDetailsResponse({ data: { ...book, copies: [], archivedAt: '2026-11-23T10:00:00.000Z' } }), true);
});

test('rejects unknown statuses, missing copies and copies belonging to another book', () => {
  assert.equal(isBookCopiesResponse({ data: [{ ...copy, status: 'UNKNOWN' }] }), false);
  assert.equal(isBookCopiesResponse({ data: [{ ...copy, inventoryCode: '' }] }), false);
  assert.equal(isBookDetailsResponse({ data: book }), false);
  assert.equal(isBookDetailsResponse({ data: { ...book, copies: [{ ...copy, bookId: copy.id }] } }), false);
});
