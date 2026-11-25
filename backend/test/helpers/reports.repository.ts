import type { ReportsData, ReportsRepository } from '../../src/modules/reports/reports.repository.js';

const charges = { _count: { _all: 0 }, _sum: { rentalFee: null, damageFine: null } };
const liability = { _count: { _all: 0 }, _sum: { depositSnapshot: null } };

export const emptyReportsData: ReportsData = {
  async inventory() { return { books: [], editions: 0, archivedEditions: 0, genreGroups: [], availableForIssue: 0, copyGroups: [], pageGroups: [] }; },
  async rentals() { return { items: [], states: [], overdueCount: 0, issuedCount: 0, closedCount: 0 }; },
  async financial() { return { charges, liability, cashGroups: [], closedRows: [], cashRows: [], buckets: { interval: 'day', items: [] } }; },
  async dashboard() {
    return { editions: 0, availableCopies: 0, readers: 0, maintenanceCopies: 0, overdueRentals: 0,
      charges, liability, latestIssues: [], latestClosures: [], overdueItems: [] };
  },
};

export function memoryReportsRepository(data: ReportsData = emptyReportsData): ReportsRepository {
  return { read: (operation) => operation(data) };
}
