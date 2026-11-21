import type { RequestHandler } from 'express';
import { bookParamsSchema, createBookSchema, listBooksSchema, updateBookSchema } from './books.schemas.js';
import type { BooksService } from './books.service.js';

export class BooksController {
  constructor(private readonly service: BooksService) {}

  list: RequestHandler = async (req, res) => {
    res.json(await this.service.list(listBooksSchema.parse(req.query)));
  };

  getById: RequestHandler = async (req, res) => {
    const { id } = bookParamsSchema.parse(req.params);
    res.json({ data: await this.service.getById(id) });
  };

  create: RequestHandler = async (req, res) => {
    const book = await this.service.create(createBookSchema.parse(req.body));
    res.location(`${req.baseUrl}/${book.id}`).status(201).json({ data: book });
  };

  update: RequestHandler = async (req, res) => {
    const { id } = bookParamsSchema.parse(req.params);
    res.json({ data: await this.service.update(id, updateBookSchema.parse(req.body)) });
  };

  archive: RequestHandler = async (req, res) => {
    const { id } = bookParamsSchema.parse(req.params);
    await this.service.archive(id);
    res.status(204).end();
  };
}
