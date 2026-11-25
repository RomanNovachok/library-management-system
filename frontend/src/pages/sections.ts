import type { SectionDefinition } from '../types/navigation';

export const sections = [
  {
    path: '/dashboard', title: 'Головна', icon: 'dashboard',
    description: 'Огляд щоденної роботи бібліотеки.',
  },
  {
    path: '/books', title: 'Книги', icon: 'books',
    description: 'Каталог видань і облік фізичних примірників.',
  },
  {
    path: '/readers', title: 'Читачі', icon: 'readers',
    description: 'Профілі читачів та історія звернень до бібліотеки.',
  },
  {
    path: '/rentals', title: 'Прокати', icon: 'rentals',
    description: 'Видача, повернення та облік користування книгами.',
  },
  {
    path: '/reports', title: 'Звіти', icon: 'reports',
    description: 'Інформація про книжковий фонд, прокати та фінанси.',
  },
  {
    path: '/administration', title: 'Адміністрування', icon: 'administration',
    description: 'Довідники та налаштування роботи бібліотеки.',
  },
] as const satisfies readonly SectionDefinition[];
