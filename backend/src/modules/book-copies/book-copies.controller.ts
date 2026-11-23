import type { RequestHandler } from 'express';
import {
  bookCopiesParamsSchema, bookCopyParamsSchema, createBookCopySchema, emptyCopyQuerySchema,
  listBookCopiesSchema, updateBookCopySchema,
} from './book-copies.schemas.js';
import type { BookCopiesService } from './book-copies.service.js';

export class BookCopiesController {
  constructor(private readonly service: BookCopiesService) {}

  list: RequestHandler = async (req, res) => {
    const { bookId } = bookCopiesParamsSchema.parse(req.params);
    res.json({ data: await this.service.list(bookId, listBookCopiesSchema.parse(req.query)) });
  };

  getById: RequestHandler = async (req, res) => {
    const { bookId, copyId } = bookCopyParamsSchema.parse(req.params);
    emptyCopyQuerySchema.parse(req.query);
    res.json({ data: await this.service.getById(bookId, copyId) });
  };

  create: RequestHandler = async (req, res) => {
    const { bookId } = bookCopiesParamsSchema.parse(req.params);
    emptyCopyQuerySchema.parse(req.query);
    const copy = await this.service.create(bookId, createBookCopySchema.parse(req.body));
    res.location(`${req.baseUrl}/${copy.id}`).status(201).json({ data: copy });
  };

  update: RequestHandler = async (req, res) => {
    const { bookId, copyId } = bookCopyParamsSchema.parse(req.params);
    emptyCopyQuerySchema.parse(req.query);
    res.json({ data: await this.service.update(bookId, copyId, updateBookCopySchema.parse(req.body)) });
  };

  delete: RequestHandler = async (req, res) => {
    const { bookId, copyId } = bookCopyParamsSchema.parse(req.params);
    emptyCopyQuerySchema.parse(req.query);
    await this.service.delete(bookId, copyId);
    res.status(204).end();
  };
}
