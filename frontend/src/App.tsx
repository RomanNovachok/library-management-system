import { Navigate, Route, Routes } from 'react-router';
import { AppLayout } from './components/AppLayout';
import { DashboardPage } from './pages/DashboardPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { SectionPage } from './pages/SectionPage';
import { sections } from './pages/sections';

export function App() {
  return <Routes>
    <Route element={<AppLayout />}>
      <Route index element={<Navigate to="/dashboard" replace />} />
      <Route path="dashboard" element={<DashboardPage />} />
      {sections.filter((section) => section.path !== '/dashboard').map((section) => <Route key={section.path} path={section.path} element={<SectionPage section={section} />} />)}
      <Route path="*" element={<NotFoundPage />} />
    </Route>
  </Routes>;
}
