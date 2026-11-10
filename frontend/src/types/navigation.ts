export type IconName = 'dashboard' | 'books' | 'readers' | 'rentals' | 'reports' | 'administration' | 'arrow' | 'menu';

export interface SectionDefinition {
  path: string;
  title: string;
  icon: IconName;
  description: string;
  plannedFeatures: readonly string[];
}
