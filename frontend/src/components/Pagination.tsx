import { Link } from 'react-router';
import type { Pagination as PaginationData } from '../api/reader-contract';

export function Pagination({ pagination, params, pageKey = 'page', label }: {
  pagination: PaginationData; params: URLSearchParams; pageKey?: string; label: string;
}) {
  const { page, totalPages } = pagination;
  function link(target: number) {
    const next = new URLSearchParams(params);
    if (target === 1) next.delete(pageKey); else next.set(pageKey, String(target));
    return { search: next.toString() };
  }
  if (totalPages <= 1 && page === 1) return null;
  return <nav aria-label={label} className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white p-4 text-sm">
    {page > 1 ? <Link className="button-secondary" to={link(Math.max(1, Math.min(page - 1, totalPages)))} rel="prev">← Назад</Link> : <span />}
    <span className="text-muted">Сторінка {page} з {totalPages || 1}</span>
    {page < totalPages ? <Link className="button-secondary" to={link(page + 1)} rel="next">Далі →</Link> : <span />}
  </nav>;
}
