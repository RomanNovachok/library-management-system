import type { SectionDefinition } from '../types/navigation';

export const sections = [
  {
    path: '/dashboard', title: 'Головна', icon: 'dashboard',
    description: 'Огляд щоденної роботи бібліотеки.',
    plannedFeatures: [],
  },
  {
    path: '/books', title: 'Книги', icon: 'books',
    description: 'Каталог видань і облік фізичних примірників.',
    plannedFeatures: ['Пошук за назвою, автором і жанром', 'Перегляд доступності примірників', 'Облік стану бібліотечного фонду'],
  },
  {
    path: '/readers', title: 'Читачі', icon: 'readers',
    description: 'Профілі читачів та історія звернень до бібліотеки.',
    plannedFeatures: ['Реєстрація та редагування профілів', 'Категорії читачів', 'Перегляд історії прокатів'],
  },
  {
    path: '/rentals', title: 'Прокати', icon: 'rentals',
    description: 'Видача, повернення та облік користування книгами.',
    plannedFeatures: ['Оформлення видачі примірника', 'Повернення та закриття прокату', 'Перегляд активних і прострочених прокатів'],
  },
  {
    path: '/reports', title: 'Звіти', icon: 'reports',
    description: 'Інформація про книжковий фонд, прокати та фінанси.',
    plannedFeatures: ['Звіт про книжковий фонд', 'Звіт про видані книги', 'Фінансовий звіт за період'],
  },
  {
    path: '/administration', title: 'Адміністрування', icon: 'administration',
    description: 'Довідники та налаштування роботи бібліотеки.',
    plannedFeatures: ['Керування тарифами та категоріями знижок', 'Налаштування видів пошкоджень', 'Керування обліковими записами працівників'],
  },
] as const satisfies readonly SectionDefinition[];
