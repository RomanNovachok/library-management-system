import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// HTTP fixtures exercise React without a database. The separate backend check uses real Prisma transactions.
export function rentalFixture({ books, readers, staff }) {
  const rules = [
    { id: randomUUID(), code: 'NONE', label: 'Без пошкоджень', penaltyPercent: '0.00', outcome: 'AVAILABLE' },
    { id: randomUUID(), code: 'MINOR', label: 'Незначні пошкодження', penaltyPercent: '10.00', outcome: 'AVAILABLE' },
    { id: randomUUID(), code: 'MAJOR', label: 'Серйозні пошкодження', penaltyPercent: '50.00', outcome: 'MAINTENANCE' },
    { id: randomUUID(), code: 'LOST', label: 'Втрачено', penaltyPercent: '100.00', outcome: 'LOST' },
  ];
  const previewVersion = 'a'.repeat(64);
  let rental;
  const reply = (res, data, origin, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' });
    res.end(JSON.stringify(data));
  };
  return async (req, res, origin) => {
    const url = new URL(req.url, origin);
    const path = url.pathname;
    if (req.method === 'OPTIONS' || !(path === '/api/damage-rules' || /^\/api\/rentals(?:\/|$)/.test(path))) return false;
    if (path === '/api/damage-rules') reply(res, { data: rules }, origin);
    else if (req.method === 'GET' && path === '/api/rentals') {
      const page = Number(url.searchParams.get('page'));
      const pageSize = Number(url.searchParams.get('pageSize'));
      const data = rental ? [rental] : [];
      reply(res, { data, pagination: { page, pageSize, total: data.length, totalPages: data.length } }, origin);
    } else if (req.method === 'GET') {
      reply(res, { data: rental }, origin);
    } else {
      assert.equal(req.headers['x-library-request'], '1');
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      if (path === '/api/rentals') {
        assert.deepEqual(Object.keys(body).sort(), ['copyId', 'dueAt', 'inspection', 'readerId']);
        assert.deepEqual(body.inspection, { condition: 'MINOR_DAMAGE', conditionNotes: 'Старий надрив' });
        assert.match(req.headers['x-rental-terms'], /^[a-f0-9]{64}$/);
        const reader = readers.readers.get(body.readerId);
        const copy = books.copies.find(({ id }) => id === body.copyId);
        const book = books.books.get(copy.bookId);
        const issuedAt = new Date().toISOString();
        assert.ok(body.dueAt.endsWith('Z') && new Date(body.dueAt) > new Date());
        Object.assign(copy, { ...body.inspection, status: 'RENTED' });
        rental = {
          id: randomUUID(), status: 'ACTIVE', overdue: false, issuedAt, dueAt: body.dueAt, closedAt: null,
          reader: { id: reader.id, fullName: reader.fullName },
          copy: { ...copy, book: { id: book.id, title: book.title, author: book.author } },
          issuedBy: staff, closedBy: null, pricePerDaySnapshot: '4.50', depositSnapshot: '250.00',
          discountPercentSnapshot: '0.00', readerCategorySnapshot: 'Стандартна',
          conditionAtIssue: copy.condition, conditionNotesAtIssue: copy.conditionNotes,
          conditionAtReturn: null, conditionNotesAtReturn: null, newDamageNotes: null,
          billableDays: null, rentalFee: null, damageFine: null, damagePercentSnapshot: null, damageRuleId: null,
          damageRule: null, refundAmount: null, additionalPayment: null, cashMovements: [
            { id: randomUUID(), type: 'DEPOSIT_IN', amount: '250.00', createdAt: issuedAt, recordedBy: staff },
          ],
        };
        readers.rentalRows.push({
          id: rental.id, readerId: reader.id, status: rental.status, issuedAt: new Date(issuedAt), dueAt: new Date(body.dueAt),
          closedAt: null, copy: { inventoryCode: copy.inventoryCode, book: { title: book.title } },
        });
        reply(res, { data: rental }, origin, 201);
      } else {
        const { assessment } = body;
        const rule = rules.find(({ code }) => code === (assessment.type === 'DAMAGED' ? assessment.severity : assessment.type === 'LOST' ? 'LOST' : 'NONE'));
        const lost = rule.code === 'LOST';
        const condition = lost ? 'LOST' : assessment.condition ?? rental.conditionAtIssue;
        const newDamageNotes = assessment.newDamageNotes ?? null;
        const conditionNotes = [rental.conditionNotesAtIssue, newDamageNotes].filter(Boolean).join('\n') || null;
        const quote = {
          rentalId: rental.id, damageRuleId: rule.id, condition, conditionNotes, newDamageNotes,
          copyStatus: lost ? 'LOST' : condition === 'MAJOR_DAMAGE' ? 'MAINTENANCE' : body.copyStatus ?? 'AVAILABLE',
          status: lost ? 'LOST' : 'RETURNED', billableDays: 1, damagePercent: rule.penaltyPercent,
          deposit: '250.00', rentalFee: '4.50', damageFine: lost ? '250.00' : newDamageNotes ? '25.00' : '0.00',
          charges: lost ? '254.50' : newDamageNotes ? '29.50' : '4.50',
          refundAmount: lost ? '0.00' : newDamageNotes ? '220.50' : '245.50', additionalPayment: lost ? '4.50' : '0.00', previewVersion,
        };
        if (path.endsWith('/return-preview')) reply(res, { data: quote }, origin);
        else {
          assert.equal(body.previewVersion, previewVersion);
          const closedAt = new Date().toISOString();
          Object.assign(books.copies.find(({ id }) => id === rental.copy.id), {
            status: quote.copyStatus, condition, conditionNotes, lastClosedRentalId: rental.id,
          });
          rental = {
            ...rental, status: quote.status, copy: { ...rental.copy, status: quote.copyStatus, condition, conditionNotes },
            conditionAtReturn: condition, conditionNotesAtReturn: conditionNotes, newDamageNotes,
            closedAt, closedBy: staff, billableDays: 1, rentalFee: quote.rentalFee, damageFine: quote.damageFine,
            damagePercentSnapshot: rule.penaltyPercent, damageRuleId: rule.id, damageRule: rule,
            refundAmount: quote.refundAmount, additionalPayment: quote.additionalPayment,
            cashMovements: [...rental.cashMovements, { id: randomUUID(), type: 'TOPUP_IN', amount: '4.50', createdAt: closedAt, recordedBy: staff }],
          };
          Object.assign(readers.rentalRows.find(({ id }) => id === rental.id), { status: quote.status, closedAt: new Date(closedAt) });
          reply(res, { data: rental }, origin);
        }
      }
    }
    return true;
  };
}
