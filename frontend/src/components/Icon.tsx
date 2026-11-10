import type { ReactNode } from 'react';
import type { IconName } from '../types/navigation';

interface IconProps {
  name: IconName;
  className?: string;
}

export function Icon({ name, className = 'size-5' }: IconProps) {
  const paths: Record<IconName, ReactNode> = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    books: <><path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Z" /><path d="M12 5v15M6 8h3M15 8h3" /></>,
    readers: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M17 15a5 5 0 0 1 4 5v1" /></>,
    rentals: <><path d="M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4" /></>,
    reports: <><path d="M6 3h9l4 4v14H6zM14 3v5h5M9 17v-3m4 3v-6m3 6v-4" /></>,
    administration: <><path d="M4 7h16M4 17h16" /><rect x="7" y="4" width="4" height="6" rx="1" /><rect x="14" y="14" width="4" height="6" rx="1" /></>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  };

  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
