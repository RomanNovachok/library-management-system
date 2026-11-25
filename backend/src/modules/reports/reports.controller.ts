import type { RequestHandler } from 'express';
import { dashboardQuerySchema, financialQuerySchema, inventoryQuerySchema, rentalsQuerySchema } from './reports.schemas.js';
import type { ReportService } from './reports.service.js';

export class ReportsController {
  constructor(private readonly service: ReportService) {}

  inventory: RequestHandler = async (req, res) => {
    res.json(await this.service.inventory(inventoryQuerySchema.parse(req.query)));
  };

  rentals: RequestHandler = async (req, res) => {
    res.json(await this.service.rentals(rentalsQuerySchema.parse(req.query)));
  };

  financial: RequestHandler = async (req, res) => {
    res.json(await this.service.financial(financialQuerySchema.parse(req.query)));
  };

  dashboard: RequestHandler = async (req, res) => {
    res.json(await this.service.dashboard(dashboardQuerySchema.parse(req.query)));
  };
}
