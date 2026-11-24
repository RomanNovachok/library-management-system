import type { RequestHandler } from 'express';
import { createReaderSchema, emptyReaderQuerySchema, listReadersSchema, paginationSchema, readerParamsSchema, updateReaderSchema } from './readers.schemas.js';
import type { ReadersService } from './readers.service.js';

export class ReadersController {
  constructor(private readonly service: ReadersService) {}
  list: RequestHandler = async (req, res) => { res.json(await this.service.list(listReadersSchema.parse(req.query))); };
  getById: RequestHandler = async (req, res) => {
    const { id } = readerParamsSchema.parse(req.params);
    emptyReaderQuerySchema.parse(req.query);
    res.json({ data: await this.service.getById(id) });
  };
  create: RequestHandler = async (req, res) => {
    emptyReaderQuerySchema.parse(req.query);
    const reader = await this.service.create(createReaderSchema.parse(req.body));
    res.location(`${req.baseUrl}/readers/${reader.id}`).status(201).json({ data: reader });
  };
  update: RequestHandler = async (req, res) => {
    const { id } = readerParamsSchema.parse(req.params);
    emptyReaderQuerySchema.parse(req.query);
    res.json({ data: await this.service.update(id, updateReaderSchema.parse(req.body)) });
  };
  categories: RequestHandler = async (req, res) => {
    emptyReaderQuerySchema.parse(req.query);
    res.json(await this.service.categories());
  };
  rentals: RequestHandler = async (req, res) => {
    const { id } = readerParamsSchema.parse(req.params);
    res.json(await this.service.rentals(id, paginationSchema.parse(req.query)));
  };
}
