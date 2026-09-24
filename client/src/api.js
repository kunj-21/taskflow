// Tiny fetch wrapper: attaches the access token and current org, and transparently refreshes
// the token once on 401.
let accessToken = null;
let orgId = null;
let refreshing = null;

export const setAccessToken = (t) => { accessToken = t; };
export const getAccessToken = () => accessToken;
export const setOrgId = (id) => { orgId = id; };
export const getOrgId = () => orgId;

export async function refreshSession() {
  // Deduplicate concurrent refreshes — refresh tokens are single-use.
  refreshing ??= fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' })
    .then(async (r) => {
      if (!r.ok) throw new Error('Session expired');
      const data = await r.json();
      setAccessToken(data.accessToken);
      return data;
    })
    .finally(() => { refreshing = null; });
  return refreshing;
}

export async function api(path, { method = 'GET', body, retry = true, org = true } = {}) {
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'include',
    headers: {
      ...(body && { 'Content-Type': 'application/json' }),
      ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
      ...(org && orgId && { 'X-Org-Id': orgId }),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    await refreshSession();
    return api(path, { method, body, org, retry: false });
  }
  if (res.status === 204) return null;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.details = data.details;
    throw err;
  }
  return data;
}

export const toQuery = (params) => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v !== '' && v != null && q.set(k, v));
  const s = q.toString();
  return s ? `?${s}` : '';
};
