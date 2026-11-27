// Drop-in replacement for the Base44 SDK client, matching the sibling apps'
// pattern (see FireShield-Pro/StaffSync-Pro src/api/base44Client.js): Base44
// pages call `base44.auth.*` / `base44.entities.<Name>.*`; this implements
// the same shape against our own Express API (see /server).
const TOKEN_KEY = 'auth_token';

function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function setStoredToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore (private browsing, etc.) */ }
}

async function request(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error((data && data.message) || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function makeEntityClient(name) {
  const base = `/api/entities/${name}`;
  let lastChangeCheck = new Date().toISOString();

  return {
    list: (sort, limit) => {
      const params = new URLSearchParams();
      if (sort) params.set('sort', sort);
      if (limit) params.set('limit', String(limit));
      return request(`${base}?${params.toString()}`);
    },
    filter: (query = {}, sort) => {
      const params = new URLSearchParams();
      if (sort) params.set('sort', sort);
      return request(`${base}/filter?${params.toString()}`, { method: 'POST', body: query });
    },
    get: (id) => request(`${base}/${id}`),
    create: (payload) => request(base, { method: 'POST', body: payload }),
    update: (id, payload) => request(`${base}/${id}`, { method: 'PUT', body: payload }),
    delete: (id) => request(`${base}/${id}`, { method: 'DELETE' }),
    subscribe: (callback) => {
      let stopped = false;
      const poll = async () => {
        if (stopped) return;
        try {
          const result = await request(`${base}/changed-since?since=${encodeURIComponent(lastChangeCheck)}`);
          lastChangeCheck = result.now;
          if (result.changed) callback();
        } catch { /* ignore transient poll errors */ }
        if (!stopped) setTimeout(poll, 5000);
      };
      poll();
      return () => { stopped = true; };
    },
  };
}

export const base44 = {
  auth: {
    me: () => request('/api/auth/me'),
    loginViaEmailPassword: async (email, password) => {
      const result = await request('/api/auth/login', { method: 'POST', body: { email, password } });
      setStoredToken(result.token);
      return result.user;
    },
    register: (payload) => request('/api/auth/register', { method: 'POST', body: payload }),
    changePassword: (currentPassword, newPassword) =>
      request('/api/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } }),
    setToken: (token) => setStoredToken(token),
    logout: (returnUrl) => {
      setStoredToken(null);
      const target = returnUrl ? `/login?returnTo=${encodeURIComponent(returnUrl)}` : '/login';
      window.location.href = target;
    },
    redirectToLogin: (returnUrl) => {
      window.location.href = returnUrl ? `/login?returnTo=${encodeURIComponent(returnUrl)}` : '/login';
    },
  },
  entities: {
    TeamMember: makeEntityClient('TeamMember'),
    PendingInvite: makeEntityClient('PendingInvite'),
    Project: makeEntityClient('Project'),
    TaskAssignment: makeEntityClient('TaskAssignment'),
    TimesheetEntry: makeEntityClient('TimesheetEntry'),
    UserPermission: makeEntityClient('UserPermission'),
    AssignmentConflict: makeEntityClient('AssignmentConflict'),
    AccountStatusAudit: makeEntityClient('AccountStatusAudit'),
    CustomOption: makeEntityClient('CustomOption'),
    AppSetting: makeEntityClient('AppSetting'),
  },
  // Dedicated business-logic endpoints (server/routes/*.js, Task #23) — these
  // are the ONLY way to write TeamMember/Project/TimesheetEntry/
  // UserPermission/AssignmentConflict/AccountStatusAudit rows; the generic
  // entities above have those writes hard-blocked server-side.
  teamMembers: {
    roster: () => request('/api/team-members/roster'),
    users: () => request('/api/team-members/users'),
    updateUser: (id, payload) => request(`/api/team-members/users/${id}`, { method: 'PUT', body: payload }),
    create: (payload) => request('/api/team-members', { method: 'POST', body: payload }),
    update: (id, payload) => request(`/api/team-members/${id}`, { method: 'PUT', body: payload }),
    delete: (id) => request(`/api/team-members/${id}`, { method: 'DELETE' }),
  },
  approvals: {
    queue: () => request('/api/approvals/queue'),
    approve: (entryId) => request(`/api/approvals/${entryId}/approve`, { method: 'POST' }),
    reject: (entryId, reason) => request(`/api/approvals/${entryId}/reject`, { method: 'POST', body: { reason } }),
  },
  timesheets: {
    create: (payload) => request('/api/timesheets', { method: 'POST', body: payload }),
    update: (id, payload) => request(`/api/timesheets/${id}`, { method: 'PUT', body: payload }),
    delete: (id) => request(`/api/timesheets/${id}`, { method: 'DELETE' }),
    recall: (id) => request(`/api/timesheets/${id}/recall`, { method: 'POST' }),
    unlock: (id) => request(`/api/timesheets/${id}/unlock`, { method: 'POST' }),
    findDuplicates: () => request('/api/timesheets/find-duplicates'),
    deleteDuplicates: () => request('/api/timesheets/delete-duplicates', { method: 'POST' }),
  },
  projects: {
    list: () => request('/api/projects'),
    create: (payload) => request('/api/projects', { method: 'POST', body: payload }),
    update: (id, payload) => request(`/api/projects/${id}`, { method: 'PUT', body: payload }),
    delete: (id) => request(`/api/projects/${id}`, { method: 'DELETE' }),
  },
  planning: {
    assignTask: (payload) => request('/api/planning/tasks', { method: 'POST', body: payload }),
    updateTaskStatus: (id, status) => request(`/api/planning/tasks/${id}`, { method: 'PUT', body: { status } }),
    deleteTask: (id) => request(`/api/planning/tasks/${id}`, { method: 'DELETE' }),
    reassign: (payload) => request('/api/planning/reassign', { method: 'POST', body: payload }),
    resolveConflict: (payload) => request('/api/planning/conflicts/resolve', { method: 'POST', body: payload }),
    resourcePlan: (from, to) => {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      return request(`/api/planning/resource-plan?${params.toString()}`);
    },
    stageCapacity: (rows) => request('/api/planning/stage-capacity', { method: 'POST', body: { rows } }),
  },
  permissions: {
    authority: () => request('/api/permissions/authority'),
    selfAppointDomainAdmin: () => request('/api/permissions/authority/self-appoint', { method: 'POST' }),
    setDelegation: (flags) => request('/api/permissions/authority/delegation', { method: 'PUT', body: flags }),
    getUserPermission: (userId) => request(`/api/permissions/users/${userId}`),
    saveUserPermission: (userId, permissions) => request(`/api/permissions/users/${userId}`, { method: 'PUT', body: { permissions } }),
    setDomainAdmin: (userId, isDomainAdmin) => request(`/api/permissions/users/${userId}/set-domain-admin`, { method: 'POST', body: { is_domain_admin: isDomainAdmin } }),
    resetOverrides: (userId) => request(`/api/permissions/users/${userId}/reset-overrides`, { method: 'POST' }),
    resetPassword: (userId) => request(`/api/permissions/users/${userId}/reset-password`, { method: 'POST' }),
    disableAccount: (userId, reason) => request(`/api/permissions/users/${userId}/disable`, { method: 'POST', body: { reason } }),
    reenableAccount: (userId, reason, confirmations) => request(`/api/permissions/users/${userId}/reenable`, { method: 'POST', body: { reason, confirmations } }),
  },
  options: {
    bulkUpdate: (listType, rows) => request('/api/options/bulk-update', { method: 'POST', body: { list_type: listType, rows } }),
  },
};
