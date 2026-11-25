import type { BaseReport } from './base-report.js';
import { FinancialReport, InventoryReport, RentalsReport } from './report-generators.js';
import type { ReportsRepository } from './reports.repository.js';

type Product<Params, Result> = Pick<BaseReport<Params, unknown, unknown, Result>, 'generate'>;

export abstract class ReportCreator<Params, Result> {
  constructor(protected readonly repository: ReportsRepository) {}
  abstract createReport(): Product<Params, Result>;

  generate(params: Params) {
    return this.createReport().generate(params);
  }
}

type CreatorFor<Report extends Product<never, unknown>> = ReportCreator<
  Parameters<Report['generate']>[0], Awaited<ReturnType<Report['generate']>>
>;

export class InventoryReportCreator extends ReportCreator<
  Parameters<InventoryReport['generate']>[0], Awaited<ReturnType<InventoryReport['generate']>>
> {
  createReport() { return new InventoryReport(this.repository); }
}

export class RentalsReportCreator extends ReportCreator<
  Parameters<RentalsReport['generate']>[0], Awaited<ReturnType<RentalsReport['generate']>>
> {
  createReport() { return new RentalsReport(this.repository); }
}

export class FinancialReportCreator extends ReportCreator<
  Parameters<FinancialReport['generate']>[0], Awaited<ReturnType<FinancialReport['generate']>>
> {
  createReport() { return new FinancialReport(this.repository); }
}

export type ReportCreators = {
  inventory: CreatorFor<InventoryReport>;
  rentals: CreatorFor<RentalsReport>;
  financial: CreatorFor<FinancialReport>;
};

export function createReportCreators(repository: ReportsRepository): ReportCreators {
  return {
    inventory: new InventoryReportCreator(repository),
    rentals: new RentalsReportCreator(repository),
    financial: new FinancialReportCreator(repository),
  };
}
