import type { RequestHandler } from 'express';
import type { StaffLocals } from '../../middleware/staff-auth.js';
import {
  closeRentalSchema, emptyRentalQuery, issueRentalSchema, issueTermsVersionSchema, listRentalsSchema, rentalParamsSchema, returnPreviewSchema,
} from './rentals.schemas.js';
import type { RentalsService } from './rentals.service.js';

export class RentalsController {
  constructor(private readonly service: RentalsService) {}

  list: RequestHandler = async (req, res) => {
    res.json(await this.service.list(listRentalsSchema.parse(req.query)));
  };

  details: RequestHandler = async (req, res) => {
    const { id } = rentalParamsSchema.parse(req.params);
    emptyRentalQuery.parse(req.query);
    res.json({ data: await this.service.details(id) });
  };

  issue: RequestHandler = async (req, res) => {
    emptyRentalQuery.parse(req.query);
    const { staff }: StaffLocals = res.locals;
    const termsVersion = issueTermsVersionSchema.parse(req.get('X-Rental-Terms'));
    const rental = await this.service.issue(issueRentalSchema.parse(req.body), staff!.id, termsVersion);
    res.location(`${req.baseUrl}/rentals/${rental.id}`).status(201).json({ data: rental });
  };

  damageRules: RequestHandler = async (req, res) => {
    emptyRentalQuery.parse(req.query);
    res.json({ data: await this.service.damageRules() });
  };

  preview: RequestHandler = async (req, res) => {
    const { id } = rentalParamsSchema.parse(req.params);
    emptyRentalQuery.parse(req.query);
    res.json({ data: await this.service.preview(id, returnPreviewSchema.parse(req.body)) });
  };

  close: RequestHandler = async (req, res) => {
    const { id } = rentalParamsSchema.parse(req.params);
    emptyRentalQuery.parse(req.query);
    const { staff }: StaffLocals = res.locals;
    res.json({ data: await this.service.close(id, closeRentalSchema.parse(req.body), staff!.id) });
  };
}
