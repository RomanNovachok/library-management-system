import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { AppLayout } from './components/AppLayout';
import { DashboardPage } from './pages/DashboardPage';
import { BooksPage } from './pages/BooksPage';
import { BookDetailsPage } from './pages/BookDetailsPage';
import { ReadersPage } from './pages/ReadersPage';
import { ReaderDetailsPage } from './pages/ReaderDetailsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ReportsPage } from './pages/ReportsPage';
import { AuthProvider } from './auth/AuthProvider';
import { useAuth } from './auth/useAuth';
import { LoginPage } from './pages/LoginPage';
import { AdministrationPage } from './pages/AdministrationPage';
import { RentalsPage } from './pages/RentalsPage';
import { RentalDetailsPage } from './pages/RentalDetailsPage';

function ProtectedRoute() {
  const { state } = useAuth();
  const { pathname, search, hash } = useLocation();
  return state.status === 'authenticated' ? <Outlet /> : <Navigate to="/login" state={{ from: pathname + search + hash }} replace />;
}

function AdminRoute() {
  const { state } = useAuth();
  return state.status === 'authenticated' && state.user.role === 'ADMIN' ? <AdministrationPage /> : <Navigate to="/dashboard" replace />;
}

export function App() {
  return <AuthProvider><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<ProtectedRoute />}>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="books" element={<BooksPage />} />
        <Route path="books/:id" element={<BookDetailsPage />} />
        <Route path="readers" element={<ReadersPage />} />
        <Route path="readers/:id" element={<ReaderDetailsPage />} />
        <Route path="rentals" element={<RentalsPage />} />
        <Route path="rentals/:id" element={<RentalDetailsPage />} />
        <Route path="administration" element={<AdminRoute />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Route>
  </Routes></AuthProvider>;
}
