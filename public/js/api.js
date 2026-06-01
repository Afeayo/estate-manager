// public/js/api.js — Shared API client
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
  ago: (d) => { const s=(Date.now()-new Date(d))/1000; if(s<60)return'just now'; if(s<3600)return`${Math.floor(s/60)}m ago`; if(s<86400)return`${Math.floor(s/3600)}h ago`; return`${Math.floor(s/86400)}d ago`; },
  badge: (st) => {
    const m = { active:'bg-green-100 text-green-700', occupied:'bg-blue-100 text-blue-700', vacant:'bg-gray-100 text-gray-600',
      paid:'bg-green-100 text-green-700', pending:'bg-yellow-100 text-yellow-700', overdue:'bg-red-100 text-red-700',
      open:'bg-blue-100 text-blue-700', in_progress:'bg-orange-100 text-orange-700', resolved:'bg-green-100 text-green-700',
      closed:'bg-gray-100 text-gray-600', maintenance:'bg-orange-100 text-orange-700', urgent:'bg-red-100 text-red-700',
      high:'bg-orange-100 text-orange-700', medium:'bg-yellow-100 text-yellow-700', low:'bg-gray-100 text-gray-600',
      granted:'bg-green-100 text-green-700', denied:'bg-red-100 text-red-700', expired:'bg-gray-100 text-gray-500' };
    return `<span class="px-2 py-0.5 rounded-full text-xs font-semibold ${m[st]||'bg-gray-100 text-gray-600'}">${(st||'').replace('_',' ')}</span>`;
  },
  avatar: (name,src) => src ? `<img src="${src}" class="w-9 h-9 rounded-full object-cover"/>` : `<div class="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-white text-sm font-bold">${(name||'?')[0].toUpperCase()}</div>`,
  initials: (name) => (name||'?').split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase(),
};

const toast = (msg, type='success') => {
  const el = document.createElement('div');
  const c = {success:'bg-green-700',error:'bg-red-600',info:'bg-blue-600',warning:'bg-amber-600'};
  const ic = {success:'check_circle',error:'error',info:'info',warning:'warning'};
  el.className = `fixed top-5 right-5 z-[9999] flex items-center gap-2 px-4 py-3 rounded-xl text-white text-sm font-semibold shadow-xl ${c[type]||c.success} animate-bounce`;
  el.innerHTML = `<span class="material-symbols-outlined text-base" style="font-variation-settings:'FILL' 1">${ic[type]||ic.success}</span>${msg}`;
  document.body.appendChild(el); setTimeout(()=>el.style.opacity='0',3000); setTimeout(()=>el.remove(),3500);
};

const modal = {
  open: (id) => { const m=document.getElementById(id); if(m){m.classList.remove('hidden'); m.classList.add('flex');} },
  close: (id) => { const m=document.getElementById(id); if(m){m.classList.add('hidden'); m.classList.remove('flex');} },
};

// Close modal on backdrop click
document.addEventListener('click', e => { if(e.target.dataset.modalClose) modal.close(e.target.closest('[id]').id); });
