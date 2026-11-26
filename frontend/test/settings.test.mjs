import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { hasEditableDamageRate, normalizeSettingName, parseSettingPercent } from '../src/utils/settings-forms.ts';

const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, envFile: false,
  server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent',
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('https://api.example.test/api') },
});
after(() => vite.close());
const api = await vite.ssrLoadModule('/src/api/settings.ts');
const id = 'f3488667-8cf7-41df-923e-224296c84711';
const category = { id, name: 'Нова категорія', discountPercent: '25.50', readerCount: 2 };
const rule = { id, code: 'MINOR', label: 'Нова назва', penaltyPercent: '15.00', outcome: 'AVAILABLE' };
const signal = new AbortController().signal;

test('settings forms normalize whitespace and accept percentages with either decimal separator', () => {
  assert.equal(normalizeSettingName('  Тестова\t  група  '), 'Тестова група');
  for (const [input, output] of [['0', '0.00'], ['00,2', '0.20'], [' 25,50 ', '25.50'], ['12.3', '12.30'], ['100,00', '100.00']]) {
    assert.equal(parseSettingPercent(input), output);
  }
  for (const value of [' ', '100,01', '1,234', '100.000', '-1', '10e1', '25,5.0']) assert.equal(parseSettingPercent(value), undefined);
  assert.deepEqual(['NONE', 'MINOR', 'MAJOR', 'LOST'].map(hasEditableDamageRate), [false, true, true, false]);
});

test('settings API uses shared credentials, CSRF and partial patches', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, ...options });
    const item = url.includes('reader-categories') ? category : rule;
    return Response.json({ data: options.method === 'GET' ? [item] : item });
  });
  assert.deepEqual(await api.listAdminCategories(signal), [category]);
  assert.deepEqual(await api.listAdminDamageRules(signal), [rule]);
  assert.deepEqual(await api.createCategory({ name: category.name, discountPercent: '25.50' }, signal), category);
  assert.deepEqual(await api.updateCategory(id, { discountPercent: '30.00' }, signal), category);
  assert.deepEqual(await api.updateDamageRule(id, { label: rule.label }, signal), rule);
  assert.deepEqual(calls.map(({ url, method }) => [method, new URL(url).pathname]), [
    ['GET', '/api/settings/reader-categories'], ['GET', '/api/settings/damage-rules'],
    ['POST', '/api/settings/reader-categories'], ['PATCH', `/api/settings/reader-categories/${id}`], ['PATCH', `/api/settings/damage-rules/${id}`],
  ]);
  for (const options of calls) assert.equal(options.credentials, 'include');
  for (const { headers } of calls.slice(2)) assert.equal(headers['X-Library-Request'], '1');
  assert.deepEqual(JSON.parse(calls[3].body), { discountPercent: '30.00' });
  assert.deepEqual(JSON.parse(calls[4].body), { label: rule.label });
});

test('settings API validates list counts, write identity and localized HTTP errors', async (t) => {
  let result;
  t.mock.method(globalThis, 'fetch', async () => result);
  result = Response.json({ data: [{ ...category, readerCount: -1 }] });
  await assert.rejects(api.listAdminCategories(signal), /Формат відповіді/);
  result = Response.json({ data: { ...rule, id: 'f3488667-8cf7-41df-923e-224296c84712' } });
  await assert.rejects(api.updateDamageRule(id, { label: rule.label }, signal), { outcomeUnknown: true });
  for (const [status, code, message] of [
    [400, 'DAMAGE_RULE_RATE_FIXED', /Ставка цього правила фіксована/], [401, 'AUTH_REQUIRED', /Сеанс завершився/],
    [403, 'FORBIDDEN', /Ваша роль/], [404, 'DAMAGE_RULE_NOT_FOUND', /більше недоступне/],
    [409, 'READER_CATEGORY_NAME_EXISTS', /вже існує/], [500, 'INTERNAL_SERVER_ERROR', /тимчасово/],
  ]) {
    result = Response.json({ error: { code } }, { status });
    await assert.rejects(api.updateCategory(id, { name: category.name }, signal),
      (error) => error.status === status && message.test(error.message) && error.outcomeUnknown === (status === 500));
  }
});
