import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeMoneyInput, validateBookInput, validateCopyInput } from '../src/utils/book-forms.ts';
import { apiErrorMessage } from '../src/api/error-messages.ts';
import { isBookResponse, isBookCopyResponse } from '../src/api/book-contract.ts';

const book = { title: ' Назва ', author: ' Автор ', genre: ' Роман ', dailyPrice: '4,5', depositAmount: '0' };

test('book forms normalize decimal text without floating point and trim required fields', () => {
  assert.deepEqual(validateBookInput(book), {
    data: { title: 'Назва', author: 'Автор', genre: 'Роман', dailyPrice: '4.50', depositAmount: '0.00' }, errors: {},
  });
  for (const [input, expected] of [['0', '0.00'], ['0.01', '0.01'], ['12,3', '12.30'], ['9999999999,99', '9999999999.99']]) {
    assert.equal(normalizeMoneyInput(input), expected);
  }
});

test('book forms reject empty/oversized text and invalid money instead of rounding it', () => {
  for (const field of ['title', 'author', 'genre']) {
    for (const value of ['', '   ', 'x'.repeat(1001)]) {
      const result = validateBookInput({ ...book, [field]: value });
      assert.equal(result.data, undefined);
      assert.ok(result.errors[field]);
    }
  }
  for (const value of ['', ' ', '-1', '1e2', 'NaN', 'Infinity', '1.001', '.50', '1.', '01.00', '10000000000', '1,2.3']) {
    assert.equal(normalizeMoneyInput(value), undefined, value);
    assert.ok(validateBookInput({ ...book, dailyPrice: value }).errors.dailyPrice);
  }
});

test('copy forms trim codes, reject invalid codes and omit status on creation or unchanged edits', () => {
  assert.deepEqual(validateCopyInput(' INV-01 ', 'AVAILABLE'), { data: { inventoryCode: 'INV-01' }, errors: {} });
  assert.deepEqual(validateCopyInput('INV-01', 'AVAILABLE', 'AVAILABLE'), { data: { inventoryCode: 'INV-01' }, errors: {} });
  for (const value of ['', '  ', 'x'.repeat(101), 'INV\0BAD']) assert.equal(validateCopyInput(value, 'AVAILABLE').data, undefined);
});

test('copy forms permit AVAILABLE/MAINTENANCE changes and inventory-only edits for RENTED/LOST', () => {
  for (const [previous, next] of [['AVAILABLE', 'MAINTENANCE'], ['MAINTENANCE', 'AVAILABLE']]) {
    assert.deepEqual(validateCopyInput('INV', next, previous).data, { inventoryCode: 'INV', status: next });
  }
  for (const previous of ['RENTED', 'LOST']) {
    assert.deepEqual(validateCopyInput('RENAMED', previous, previous).data, { inventoryCode: 'RENAMED' });
    for (const next of ['AVAILABLE', 'MAINTENANCE', 'RENTED', 'LOST'].filter((value) => value !== previous)) {
      assert.equal(validateCopyInput('INV', next, previous).data, undefined);
    }
  }
  for (const next of ['RENTED', 'LOST', 'UNKNOWN']) assert.equal(validateCopyInput('INV', next, 'AVAILABLE').data, undefined);
});

test('business conflicts and all required HTTP errors have actionable Ukrainian messages', () => {
  for (const [code, part] of [
    ['INVENTORY_CODE_EXISTS', 'номер уже'], ['COPY_HAS_RENTALS', 'історію прокатів'],
    ['COPY_ACTIVE_RENTAL', 'активний прокат'], ['COPY_STATUS_CONFLICT', 'статус'],
    ['COPY_WRITE_CONFLICT', 'одночасно'], ['BOOK_ARCHIVED', 'архівовано'],
  ]) assert.ok(apiErrorMessage(409, code).includes(part));
  for (const status of [400, 403, 404, 409, 500]) assert.match(apiErrorMessage(status), /[А-ЯІЇЄа-яіїє]/);
  assert.ok(apiErrorMessage(403, 'ROLE_FORBIDDEN').includes('роль'));
});

test('POST response contracts accept books without copies and copies with a server status', () => {
  const id = 'c7c0e4b4-87c4-4c6a-a841-18fdbed10002';
  const data = { ...validateBookInput(book).data, id, archivedAt: null };
  assert.equal(isBookResponse({ data }), true);
  assert.equal(isBookResponse({ data: { ...data, dailyPrice: 4.5 } }), false);
  assert.equal(isBookCopyResponse({ data: { id, bookId: id, inventoryCode: 'INV', status: 'AVAILABLE' } }), true);
  assert.equal(isBookCopyResponse({ data: { id, bookId: id, inventoryCode: 'INV', status: 'BAD' } }), false);
});
