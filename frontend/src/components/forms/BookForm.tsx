import { useState } from 'react';
import type { Book, BookInput } from '../../api/book-contract';
import { createBook, updateBook } from '../../api/books';
import { useMutation } from '../../hooks/useMutation';
import { validateBookInput } from '../../utils/book-forms';
import type { FieldErrors } from '../../utils/book-forms';
import { Modal } from '../Modal';
import { FormActions, FormFeedback } from './FormFeedback';

const fields: { name: keyof BookInput; label: string; money?: boolean }[] = [
  { name: 'title', label: 'Назва' }, { name: 'author', label: 'Автор' }, { name: 'genre', label: 'Жанр' },
  { name: 'dailyPrice', label: 'Ціна прокату за добу, грн', money: true }, { name: 'depositAmount', label: 'Застава, грн', money: true },
];

export function BookForm({ book, onClose, onSaved, onRefresh }: {
  book?: Book; onClose: () => void; onSaved: (book: Book) => void; onRefresh: () => void;
}) {
  const [values, setValues] = useState<BookInput>(() => ({
    title: book?.title ?? '', author: book?.author ?? '', genre: book?.genre ?? '',
    dailyPrice: book?.dailyPrice.replace('.', ',') ?? '', depositAmount: book?.depositAmount.replace('.', ',') ?? '',
  }));
  const [errors, setErrors] = useState<FieldErrors<BookInput>>({});
  const { run, pending, error } = useMutation();

  return <Modal title={book ? 'Редагувати книгу' : 'Додати книгу'} pending={pending} onClose={onClose}>
    <form noValidate onSubmit={(event) => {
      event.preventDefault();
      const result = validateBookInput(values);
      setErrors(result.errors);
      if (!result.data) {
        const form = event.currentTarget;
        requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
        return;
      }
      const input = result.data;
      void run((signal) => book ? updateBook(book.id, input, signal) : createBook(input, signal), onSaved);
    }}>
      <FormFeedback error={error} onRefresh={onRefresh} />
      <fieldset disabled={pending} className="grid min-w-0 gap-4">
        {fields.map(({ name, label, money }) => <div key={name}>
          <label htmlFor={`book-${name}`} className="mb-2 block text-sm font-medium">{label}</label>
          <input id={`book-${name}`} name={name} required type="text" inputMode={money ? 'decimal' : 'text'} maxLength={money ? 13 : 1000}
            value={values[name]} onChange={(event) => setValues((current) => ({ ...current, [name]: event.target.value }))}
            placeholder={money ? '0,00' : undefined} aria-invalid={Boolean(errors[name])}
            aria-describedby={errors[name] ? `book-${name}-error` : money ? 'money-hint' : undefined} className="form-input" />
          {errors[name] && <p id={`book-${name}-error`} role="alert" className="mt-2 text-xs leading-5 text-rose-800">{errors[name]}</p>}
        </div>)}
        <p id="money-hint" className="text-xs leading-5 text-muted">Суми невід’ємні. Для копійок використовуйте кому або крапку, максимум два знаки.</p>
      </fieldset>
      <FormActions pending={pending} error={error} submitLabel={book ? 'Зберегти зміни' : 'Створити книгу'} onCancel={onClose} />
    </form>
  </Modal>;
}
