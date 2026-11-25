import { matchPath } from 'react-router';
import { record, uuid } from '../api/reader-contract';

const detailSections = {
  '/books': { title: 'Деталі книги', back: 'Повернутися до книги' },
  '/readers': { title: 'Профіль читача', back: 'Повернутися до читача' },
  '/rentals': { title: 'Деталі прокату', back: 'Повернутися до прокату' },
};
type DetailSection = keyof typeof detailSections;
type DetailLocation = { pathname: string; search: string };

export function detailSection(pathname: string) {
  return (Object.keys(detailSections) as DetailSection[]).find((section) => matchPath(`${section}/:id`, pathname));
}

export function detailTitle(pathname: string) {
  const section = detailSection(pathname);
  return section ? detailSections[section].title : undefined;
}

function safeLocation(value: unknown): value is DetailLocation {
  if (!record(value) || typeof value.pathname !== 'string' || typeof value.search !== 'string') return false;
  const section = detailSection(value.pathname);
  const id = section && matchPath(`${section}/:id`, value.pathname)?.params.id;
  return uuid(id) && value.pathname === `${section}/${id}` && (value.search === '' || value.search.startsWith('?'));
}

function samePage(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

function previousPages(state: unknown, pathname: string) {
  if (!record(state) || !Array.isArray(state.detailTrail)) return [];
  const visited = new Set([pathname.toLowerCase()]);
  return state.detailTrail.slice(-4).filter((item): item is DetailLocation => {
    if (!safeLocation(item) || visited.has(item.pathname.toLowerCase())) return false;
    visited.add(item.pathname.toLowerCase());
    return true;
  });
}

export function detailLink(current: DetailLocation & { state: unknown }, destination: string) {
  if (!safeLocation(current) || samePage(current.pathname, destination)) return { to: destination };
  const trail = previousPages(current.state, current.pathname);
  const earlier = trail.findIndex(({ pathname }) => samePage(pathname, destination));
  return {
    to: trail[earlier] ?? destination,
    state: { detailTrail: earlier < 0 ? [...trail, { pathname: current.pathname, search: current.search }].slice(-4) : trail.slice(0, earlier) },
  };
}

export function detailBack(current: DetailLocation & { state: unknown }, fallback: DetailLocation, label: string) {
  const trail = previousPages(current.state, current.pathname);
  const to = trail.pop();
  if (!to) return { to: fallback, label, state: undefined };
  return { to, label: detailSections[detailSection(to.pathname)!].back, state: { detailTrail: trail } };
}
