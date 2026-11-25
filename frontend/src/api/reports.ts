import { getJson } from './client';
import { isDashboard, isFinancialReport, isInventoryReport, isRentalsReport } from './report-contract';

export const getInventoryReport = (query: string, signal: AbortSignal) => getJson(`/reports/inventory?${query}`, isInventoryReport, signal);
export const getRentalsReport = (query: string, signal: AbortSignal) => getJson(`/reports/rentals?${query}`, isRentalsReport, signal);
export const getFinancialReport = (query: string, signal: AbortSignal) => getJson(`/reports/financial?${query}`, isFinancialReport, signal);
export const getDashboard = (timeZone: string, signal: AbortSignal) =>
  getJson(`/dashboard?${new URLSearchParams({ timeZone })}`, isDashboard, signal);
