// Post-login cache warm-up (Skillora-style instant navigation).
//
// Right after login the SWR pageCache is cold, so the first visit to each page
// shows a spinner for one round trip. This module fires the same requests the
// heavy list pages make on first mount and stores the results under those
// pages' EXACT cache keys — so navigating there right after login paints
// instantly from cache while the page revalidates in the background.
//
// The dashboard is NOT warmed here: login lands on it immediately, so its own
// fetch is already the first request — warming it would just duplicate calls.
//
// IMPORTANT: keys and response shapes must mirror their owning pages:
//   students:*  → components/StudentsPage.js  (default filters, page 1)
//   employees:* → components/EmployeesPage.js (default filters, page 1)
// If a page's cacheKey or default filters change, update the matching warm
// function here.
import api from './api';
import { setCached } from './pageCache';

const warmStudents = async (viewSession) => {
  try {
    const params = { page: 1, limit: 20, sort_by: 'last_upgraded', status: 'active' };
    if (viewSession) params.academic_year = viewSession;
    const res = await api.get('/students', { params });
    const arr = Array.isArray(res.data) ? res.data : (Array.isArray(res.data?.students) ? res.data.students : []);
    const total = parseInt(res.headers?.['x-total-count'] ?? res.data?.total ?? arr.length);
    const pages = parseInt(res.headers?.['x-total-pages'] ?? res.data?.pages ?? 1);
    setCached(`students:${viewSession}:::active:1:`, { students: arr, total, pages });
  } catch { /* warm-up is best-effort; the page fetches normally if this fails */ }
};

const warmEmployees = async (viewSession) => {
  try {
    const res = await api.get('/employees', { params: { is_active: true, page: 1, limit: 30 } });
    const arr = Array.isArray(res.data) ? res.data : (res.data?.employees ?? []);
    const total = parseInt(res.headers?.['x-total-count'] ?? arr.length);
    const pages = parseInt(res.headers?.['x-total-pages'] ?? 1);
    setCached(`employees:${viewSession}:true::1`, { employees: arr, total, pages });
  } catch { /* best-effort */ }
};

// Fire-and-forget: never await this on the login path.
export const warmCacheAfterLogin = (user, viewSession) => {
  const role = user?.role;
  const vs = viewSession || localStorage.getItem('view_session') || '';
  if (role === 'admin' || role === 'accountant') warmStudents(vs);
  if (role === 'admin') warmEmployees(vs);
};

export default warmCacheAfterLogin;
