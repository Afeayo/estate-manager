// public/js/api.js — Shared API client for EstateManager frontend
const API_BASE = '/api';

// ─── Auth Helpers ──────────────────────────────────────────
const Auth = {
  getToken: () => localStorage.getItem('em_token'),
  getUser: () => { try { return JSON.parse(localStorage.getItem('em_user')); } catch { return null; } },
  isLoggedIn: () => !!localStorage.getItem('em_token'),
  logout: () => {
    localStorage.removeItem('em_token');
    localStorage.removeItem('em_user');
    window.location.href = '/';
  },
  requireAuth: (role) => {
    const user = Auth.getUser();
    const token = Auth.getToken();
    if (!token || !user) { window.location.href = '/'; return null; }
    if (role && user.role !== role) {
      alert('Access denied. Insufficient permissions.');
      window.location.href = '/';
      return null;
    }
    return user;
  }
};

// ─── API Client ────────────────────────────────────────────
const api = {
  async request(method, path, body = null, isFormData = false) {
    const headers = {};
    const token = Auth.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (!isFormData && body) headers['Content-Type'] = 'application/json';

    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: isFormData ? body : (body ? JSON.stringify(body) : null)
    });

    if (res.status === 401) { Auth.logout(); return; }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },

  get: (path) => api.request('GET', path),
  post: (path, body) => api.request('POST', path, body),
  put: (path, body) => api.request('PUT', path, body),
  delete: (path) => api.request('DELETE', path),
  upload: (path, formData) => api.request('POST', path, formData, true),

  // ─── Specific API methods ────────────────────────────
  dashboard: {
    admin: () => api.get('/dashboard/admin'),
    tenant: () => api.get('/dashboard/tenant'),
    maintenance: () => api.get('/dashboard/maintenance'),
  },
  tenants: {
    list: (params = {}) => api.get('/tenants?' + new URLSearchParams(params)),
    get: (id) => api.get(`/tenants/${id}`),
    create: (data) => api.post('/tenants', data),
    update: (id, data) => api.put(`/tenants/${id}`, data),
    delete: (id) => api.delete(`/tenants/${id}`),
  },
  properties: {
    list: (params = {}) => api.get('/properties?' + new URLSearchParams(params)),
    stats: () => api.get('/properties/stats'),
    get: (id) => api.get(`/properties/${id}`),
    create: (data) => api.post('/properties', data),
    update: (id, data) => api.put(`/properties/${id}`, data),
  },
  leases: {
    list: () => api.get('/leases'),
    get: (id) => api.get(`/leases/${id}`),
    create: (data) => api.post('/leases', data),
    update: (id, data) => api.put(`/leases/${id}`, data),
  },
  bills: {
    list: (params = {}) => api.get('/bills?' + new URLSearchParams(params)),
    summary: () => api.get('/bills/summary'),
    get: (id) => api.get(`/bills/${id}`),
    create: (data) => api.post('/bills', data),
    bulkCreate: (data) => api.post('/bills/bulk', data),
    pay: (id, data) => api.post(`/bills/${id}/pay`, data),
    cancel: (id) => api.delete(`/bills/${id}`),
  },
  complaints: {
    list: (params = {}) => api.get('/complaints?' + new URLSearchParams(params)),
    stats: () => api.get('/complaints/stats'),
    get: (id) => api.get(`/complaints/${id}`),
    create: (formData) => api.upload('/complaints', formData),
    update: (id, data) => api.put(`/complaints/${id}`, data),
    sendMessage: (id, content) => api.post(`/complaints/${id}/messages`, { content }),
  },
  access: {
    cards: () => api.get('/access/cards'),
    createCard: (data) => api.post('/access/cards', data),
    updateCard: (id, data) => api.put(`/access/cards/${id}`, data),
    deleteCard: (id) => api.delete(`/access/cards/${id}`),
    visitorCodes: () => api.get('/access/visitor-codes'),
    createCode: (data) => api.post('/access/visitor-codes', data),
    revokeCode: (id) => api.delete(`/access/visitor-codes/${id}`),
    logs: (params = {}) => api.get('/access/logs?' + new URLSearchParams(params)),
  },
  notifications: {
    list: () => api.get('/notifications'),
    markRead: (id) => api.put(`/notifications/${id}/read`, {}),
    markAllRead: () => api.put('/notifications/read-all', {}),
    broadcast: (data) => api.post('/notifications/broadcast', data),
  },
  announcements: {
    list: () => api.get('/announcements'),
    create: (data) => api.post('/announcements', data),
  },
  activityLogs: {
    list: (params = {}) => api.get('/activity-logs?' + new URLSearchParams(params)),
  },
  reports: {
    financial: (params = {}) => api.get('/reports/financial?' + new URLSearchParams(params)),
  }
};

// ─── UI Helpers ─────────────────────────────────────────────
const UI = {
  formatCurrency: (n) => '₦' + Number(n || 0).toLocaleString(),
  formatDate: (d) => d ? new Date(d).toLocaleDateString('en-NG', { day:'numeric', month:'short', year:'numeric' }) : '—',
  timeAgo: (d) => {
    const diff = (Date.now() - new Date(d)) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
    return `${Math.floor(diff/86400)}d ago`;
  },
  statusBadge: (status) => {
    const map = {
      active: 'bg-green-100 text-green-700', occupied: 'bg-blue-100 text-blue-700',
      vacant: 'bg-gray-100 text-gray-600', paid: 'bg-green-100 text-green-700',
      pending: 'bg-yellow-100 text-yellow-700', overdue: 'bg-red-100 text-red-700',
      open: 'bg-blue-100 text-blue-700', in_progress: 'bg-orange-100 text-orange-700',
      resolved: 'bg-green-100 text-green-700', closed: 'bg-gray-100 text-gray-600',
      granted: 'bg-green-100 text-green-700', denied: 'bg-red-100 text-red-700',
      maintenance: 'bg-orange-100 text-orange-700', urgent: 'bg-red-100 text-red-700',
      high: 'bg-orange-100 text-orange-700', medium: 'bg-yellow-100 text-yellow-700',
      low: 'bg-gray-100 text-gray-600',
    };
    return `<span class="px-2 py-0.5 rounded-full text-xs font-semibold ${map[status] || 'bg-gray-100 text-gray-600'}">${status}</span>`;
  },
  toast: (msg, type = 'success') => {
    const el = document.createElement('div');
    const colors = { success: 'bg-green-700', error: 'bg-red-600', info: 'bg-blue-600', warning: 'bg-yellow-600' };
    el.className = `fixed top-4 right-4 z-50 px-5 py-3 rounded-xl text-white text-sm font-semibold shadow-lg flex items-center gap-2 ${colors[type] || colors.success}`;
    el.innerHTML = `<span class="material-symbols-outlined text-sm" style="font-variation-settings:'FILL' 1">${type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'check_circle'}</span>${msg}`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  },
  loading: (el, on) => {
    if (on) { el.dataset.orig = el.innerHTML; el.disabled = true; el.innerHTML = '<span class="material-symbols-outlined animate-spin text-sm">refresh</span> Loading...'; }
    else { el.innerHTML = el.dataset.orig || el.innerHTML; el.disabled = false; }
  }
};

// ─── Inject user info into nav if elements exist ──────────────
document.addEventListener('DOMContentLoaded', () => {
  const user = Auth.getUser();
  if (!user) return;

  // Fill in user name / role wherever the page uses placeholder text
  document.querySelectorAll('[data-user-name]').forEach(el => el.textContent = user.name);
  document.querySelectorAll('[data-user-role]').forEach(el => el.textContent = user.role);
  document.querySelectorAll('[data-user-avatar]').forEach(el => { el.src = user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=00361a&color=fff`; });

  // Logout buttons
  document.querySelectorAll('[data-logout]').forEach(el => el.addEventListener('click', Auth.logout));
});
