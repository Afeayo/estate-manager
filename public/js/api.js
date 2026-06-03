// public/js/api.js — Shared API client v2
const API_BASE = '/api';

const Auth = {
  getToken: () => localStorage.getItem('em_token'),
  getUser: () => { try { return JSON.parse(localStorage.getItem('em_user')); } catch { return null; } },
  logout: () => { localStorage.removeItem('em_token'); localStorage.removeItem('em_user'); window.location.href = '/'; },
  requireAuth: (role) => {
    const user = Auth.getUser(); const token = Auth.getToken();
    if (!token || !user) { window.location.href = '/'; return null; }
    if (role && user.role !== role && !(Array.isArray(role) && role.includes(user.role))) {
      window.location.href = '/'; return null;
    }
    return user;
  },
  // Route tenant to correct page based on onboarding status
  routeTenant: (onboarding_status) => {
    if (onboarding_status === 'active') return window.location.href = '/tenant/dashboard.html';
    if (onboarding_status === 'kyc_submitted' || onboarding_status === 'kyc_approved') return window.location.href = '/tenant/pending.html';
    if (onboarding_status === 'kyc_rejected') return window.location.href = '/tenant/pending.html';
    return window.location.href = '/tenant/onboarding.html'; // pending = new tenant
  }
};

const api = {
  async req(method, path, body, isForm) {
    const headers = {}; const token = Auth.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (!isForm && body) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${API_BASE}${path}`, { method, headers, body: isForm ? body : (body ? JSON.stringify(body) : null) });
    if (res.status === 401) { Auth.logout(); return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },
  get: (p) => api.req('GET', p),
  post: (p, b) => api.req('POST', p, b),
  put: (p, b) => api.req('PUT', p, b),
  del: (p) => api.req('DELETE', p),
  upload: (p, f) => api.req('POST', p, f, true),
};

const fmt = {
  money: (n) => '₦' + Number(n||0).toLocaleString('en-NG'),
  date: (d) => d ? new Date(d).toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'}) : '—',
  datetime: (d) => d ? new Date(d).toLocaleString('en-NG') : '—',
  ago: (d) => { const s=(Date.now()-new Date(d))/1000; if(s<60)return'just now'; if(s<3600)return`${Math.floor(s/60)}m ago`; if(s<86400)return`${Math.floor(s/3600)}h ago`; return`${Math.floor(s/86400)}d ago`; },
  badge: (st) => {
    const m = { active:'bg-green-100 text-green-700', occupied:'bg-blue-100 text-blue-700', vacant:'bg-gray-100 text-gray-600',
      paid:'bg-green-100 text-green-700', pending:'bg-yellow-100 text-yellow-700', overdue:'bg-red-100 text-red-700',
      open:'bg-blue-100 text-blue-700', in_progress:'bg-orange-100 text-orange-700', resolved:'bg-green-100 text-green-700',
      closed:'bg-gray-100 text-gray-600', maintenance:'bg-orange-100 text-orange-700', urgent:'bg-red-100 text-red-700',
      high:'bg-orange-100 text-orange-700', medium:'bg-yellow-100 text-yellow-700', low:'bg-gray-100 text-gray-600',
      granted:'bg-green-100 text-green-700', denied:'bg-red-100 text-red-700', expired:'bg-gray-100 text-gray-500',
      approved:'bg-green-100 text-green-700', rejected:'bg-red-100 text-red-700', kyc_submitted:'bg-blue-100 text-blue-700' };
    return `<span class="px-2 py-0.5 rounded-full text-xs font-semibold ${m[st]||'bg-gray-100 text-gray-600'}">${(st||'').replace(/_/g,' ')}</span>`;
  },
};

const toast = (msg, type='success') => {
  const el = document.createElement('div');
  const c = {success:'bg-green-700',error:'bg-red-600',info:'bg-blue-600',warning:'bg-amber-600'};
  const ic = {success:'check_circle',error:'error',info:'info',warning:'warning'};
  el.className = `fixed top-5 right-5 z-[9999] flex items-center gap-2 px-4 py-3 rounded-xl text-white text-sm font-semibold shadow-xl ${c[type]||c.success}`;
  el.style.cssText = 'animation: slideIn .3s ease; max-width:320px';
  el.innerHTML = `<span class="material-symbols-outlined text-base" style="font-variation-settings:'FILL' 1">${ic[type]||ic.success}</span>${msg}`;
  document.body.appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; el.style.transition='opacity .5s'; }, 3500);
  setTimeout(()=>el.remove(), 4000);
};
