import { Navigate, Route, Routes } from 'react-router';
import { AppLayout } from './components/AppLayout';
import { DashboardPage } from './pages/DashboardPage';
import { BooksPage } from './pages/BooksPage';
import { BookDetailsPage } from './pages/BookDetailsPage';
import { ReadersPage } from './pages/ReadersPage';
import { ReaderDetailsPage } from './pages/ReaderDetailsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { SectionPage } from './pages/SectionPage';
import { sections } from './pages/sections';

export function App() {
  return <Routes>
    <Route element={<AppLayout />}>
      <Route index element={<Navigate to="/dashboard" replace />} />
      <Route path="dashboard" element={<DashboardPage />} />
      <Route path="books" element={<BooksPage />} />
      <Route path="books/:id" element={<BookDetailsPage />} />
      <Route path="readers" element={<ReadersPage />} />
      <Route path="readers/:id" element={<ReaderDetailsPage />} />
      {sections.filter((section) => !['/dashboard', '/books', '/readers'].includes(section.path)).map((section) => <Route key={section.path} path={section.path} element={<SectionPage section={section} />} />)}
      <Route path="*" element={<NotFoundPage />} />
    </Route>
  </Routes>;
}
