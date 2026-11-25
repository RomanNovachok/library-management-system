import { createReportCreators, type ReportCreators } from './report-creators.js';
import { amountStrings, chargeTotals, money, rentalJson } from './report-format.js';
import { periodJson, reportPeriod } from './report-period.js';
import type { ReportsRepository } from './reports.repository.js';
import type { DashboardQuery, FinancialQuery, InventoryQuery, RentalsQuery } from './reports.schemas.js';

export class ReportService {
  constructor(
    private readonly repository: ReportsRepository,
    private readonly clock: () => Date = () => new Date(),
    private readonly creators: ReportCreators = createReportCreators(repository),
  ) {}

  inventory(query: InventoryQuery) {
    return this.creators.inventory.generate({ query, now: this.clock() });
  }

  rentals(query: RentalsQuery) {
    const now = this.clock();
    return this.creators.rentals.generate({ query, now, period: reportPeriod(query, now) });
  }

  financial(query: FinancialQuery) {
    const now = this.clock();
    return this.creators.financial.generate({ query, now, period: reportPeriod(query, now) });
  }

  async dashboard(query: DashboardQuery) {
    const now = this.clock();
    const period = reportPeriod(query, now);
    const { editions, availableCopies, readers, maintenanceCopies, overdueRentals, charges, liability,
      latestIssues, latestClosures, overdueItems } = await this.repository.read((db) => db.dashboard(period, now));
    return {
      generatedAt: now.toISOString(), period: periodJson(period),
      summary: { editions, availableCopies, readers, maintenanceCopies, overdueRentals, activeRentals: liability._count._all },
      financial: { ...amountStrings(chargeTotals(charges._sum.rentalFee, charges._sum.damageFine)), outstandingDeposits: money(liability._sum.depositSnapshot) },
      latestIssues: latestIssues.map((item) => rentalJson(item, now)),
      latestClosures: latestClosures.map((item) => rentalJson(item, now)),
      overdue: overdueItems.map((item) => rentalJson(item, now)),
    };
  }
}
