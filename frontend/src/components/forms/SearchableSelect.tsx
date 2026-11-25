import { useCallback, useId, useRef, useState } from 'react';
import type { Page } from '../../api/reader-contract';
import { useApiResource } from '../../hooks/useApiResource';

export function SearchableSelect<T extends { id: string }>({ label, placeholder, value, onChange, load, format, unavailable }: {
  label: string; value: T | undefined; onChange: (value: T | undefined) => void;
  placeholder?: string;
  load: (query: { search: string; page: number; pageSize: number }, signal: AbortSignal) => Promise<Page<T>>;
  format: (item: T) => string; unavailable?: (item: T) => boolean;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [highlight, setHighlight] = useState('');
  const query = useCallback((signal: AbortSignal) =>
    open ? load({ search: search.trim(), page, pageSize: 10 }, signal) : Promise.resolve(null), [open, search, page, load]);
  const { resource, retry } = useApiResource(query, 250);
  const result = resource.status === 'success' ? resource.data : null;
  const items = result?.data ?? [];
  const selectable = items.filter((item) => !unavailable?.(item));
  const highlighted = selectable.find((item) => item.id === highlight);
  const activeId = highlighted ? `${id}-${highlighted.id}` : undefined;

  function reset() {
    setSearch(''); setPage(1); setHighlight('');
  }
  function choose(item: T) {
    onChange(item);
    inputRef.current?.focus();
    reset(); setOpen(false);
  }
  function changePage(target: number) {
    setPage(target); setHighlight('');
  }

  return <div className="relative min-w-0" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) { reset(); setOpen(false); }
  }}>
    <label htmlFor={id} className="mb-2 block text-sm font-medium">{label}</label>
    <div className="relative">
      <input ref={inputRef} id={id} type="text" role="combobox" autoComplete="off" aria-autocomplete="list"
        aria-controls={open ? `${id}-list` : undefined} aria-expanded={open} aria-activedescendant={activeId}
        className="form-input pr-12" maxLength={200} placeholder={placeholder}
        value={value ? format(value) : search}
        onClick={() => setOpen(true)} onFocus={(event) => { setOpen(true); if (value) event.currentTarget.select(); }}
        onChange={(event) => {
          if (value) onChange(undefined);
          setSearch(event.target.value); setOpen(true); changePage(1);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); reset(); setOpen(false); }
          if (event.key === 'Enter') { event.preventDefault(); if (open && highlighted) choose(highlighted); else setOpen(true); }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); setOpen(true);
            if (!selectable.length) return;
            const index = selectable.findIndex((item) => item.id === highlight);
            const next = event.key === 'ArrowDown'
              ? (index + 1) % selectable.length
              : index <= 0 ? selectable.length - 1 : index - 1;
            const item = selectable[next];
            if (item) {
              setHighlight(item.id);
              document.getElementById(`${id}-${item.id}`)?.scrollIntoView({ block: 'nearest' });
            }
          }
        }} />
      {value && <button type="button" aria-label={`Очистити поле «${label}»`} className="absolute inset-y-0 right-0 min-w-11 text-muted"
        onClick={() => { onChange(undefined); reset(); setOpen(true); inputRef.current?.focus(); }}>×</button>}
    </div>
    {open && <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-line bg-white shadow-lg">
      <ul id={`${id}-list`} role="listbox" aria-label={label} aria-busy={resource.status === 'loading'} className="max-h-48 overflow-auto">
        {items.map((item) => <li key={item.id} id={`${id}-${item.id}`} role="option" aria-selected={value?.id === item.id}
          aria-disabled={unavailable?.(item) || undefined} className={`break-words px-3 py-2 text-sm ${unavailable?.(item) ? 'text-muted' : 'cursor-pointer hover:bg-sage'} ${highlight === item.id ? 'bg-sage' : ''}`}
          onMouseDown={(event) => event.preventDefault()} onClick={() => { if (!unavailable?.(item)) choose(item); }}>{format(item)}</li>)}
      </ul>
      {resource.status === 'loading' && <p role="status" className="p-3 text-sm text-muted">Завантажуємо…</p>}
      {resource.status === 'error' && <div role="alert" className="p-3 text-sm text-amber-950">{resource.error.message}{' '}
        <button type="button" className="min-h-11 underline" onClick={retry}>Оновити список</button></div>}
      {result && items.length === 0 && <p role="status" className="p-3 text-sm text-muted">За цим пошуком записів немає.</p>}
      {result && (result.pagination.totalPages > 1 || page > 1) && <div className="flex flex-wrap items-center justify-between gap-1 border-t border-line p-2 text-xs text-muted">
        <button type="button" className="button-secondary" disabled={page === 1} onClick={() => { inputRef.current?.focus(); changePage(page - 1); }}>Назад</button>
        <span>Сторінка {page}</span>
        <button type="button" className="button-secondary" disabled={page >= result.pagination.totalPages} onClick={() => { inputRef.current?.focus(); changePage(page + 1); }}>Далі</button>
      </div>}
    </div>}
  </div>;
}
