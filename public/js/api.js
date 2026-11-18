const TOKEN_KEY = 'zero-submission.token';
const GM_KEY = 'zero-submission.gm';
const PENDING_KEY = 'zero-submission.pending';

export function readToken() {
  const fromUrl = new URLSearchParams(location.search).get('t');
  if (fromUrl) {
    saveToken(fromUrl);
    return fromUrl;
  }
  return localStorage.getItem(TOKEN_KEY) ?? '';
}

export function saveToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function readGmToken() {
  return sessionStorage.getItem(GM_KEY) ?? '';
}

export function saveGmToken(token) {
  if (token) sessionStorage.setItem(GM_KEY, token);
}

export function clearGmToken() {
  sessionStorage.removeItem(GM_KEY);
}

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, code: 'network_error', message: '网络不稳，恢复后自动重试' };
  }
  const payload = await response.json().catch(() => null);
  if (!payload) {
    return { ok: false, code: 'bad_response', message: `响应无法解析（${response.status}）` };
  }
  return payload;
}

export async function bootstrap(token) {
  return request(`/api/bootstrap?token=${encodeURIComponent(token)}`);
}

export async function fetchSnapshot() {
  return request('/api/snapshot');
}

export async function fetchRoles() {
  return request('/api/roles');
}

export async function makeIdemKey(studentId, roleId, nonce = Date.now().toString(36)) {
  const raw = `${studentId}|${roleId}|${nonce}`;
  if (globalThis.crypto?.subtle) {
    try {
      const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
      return [...new Uint8Array(buffer)]
        .slice(0, 16)
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      return `k${raw.length}-${raw.replace(/[^a-zA-Z0-9]/g, '')}`;
    }
  }
  return `k${raw.length}-${raw.replace(/[^a-zA-Z0-9]/g, '')}`;
}

function readPending() {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null');
  } catch {
    return null;
  }
}

function writePending(payload) {
  if (payload) localStorage.setItem(PENDING_KEY, JSON.stringify(payload));
  else localStorage.removeItem(PENDING_KEY);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function submitAssignment({ token, studentId, roleId, idemKey, attempts = 3 }) {
  const key = idemKey ?? (await makeIdemKey(studentId ?? 'anon', roleId));
  const payload = { token, roleId, idemKey: key };
  writePending(payload);

  let last = { ok: false, code: 'offline', message: '网络不稳，恢复后自动提交' };
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await request('/api/assign', { method: 'POST', body: payload });
    if (result.code !== 'network_error') {
      writePending(null);
      return result;
    }
    last = result;
    await sleep(500 * (attempt + 1));
  }
  return last;
}

export async function flushPending() {
  const pending = readPending();
  if (!pending) return null;
  const result = await request('/api/assign', { method: 'POST', body: pending });
  if (result.code !== 'network_error') writePending(null);
  return result;
}

export function subscribeStream({
  onSnapshot,
  onStatus,
  pollInterval = 1000,
  failureThreshold = 3,
  probeInterval = 60000,
} = {}) {
  let closed = false;
  let source = null;
  let failures = 0;
  let pollTimer = 0;
  let probeTimer = 0;
  let polling = false;

  const emit = (snapshot) => {
    try {
      onSnapshot?.(snapshot);
    } catch {
      onStatus?.('stale');
    }
  };

  const stopPolling = () => {
    if (!polling) return;
    polling = false;
    clearInterval(pollTimer);
    pollTimer = 0;
  };

  const startPolling = () => {
    if (polling || closed) return;
    polling = true;
    onStatus?.('polling');
    pollTimer = setInterval(async () => {
      const result = await request('/api/snapshot');
      if (result?.ok) emit(result.data);
    }, pollInterval);
  };

  const connect = () => {
    if (closed) return;
    try {
      source = new EventSource('/api/stream');
    } catch {
      startPolling();
      return;
    }
    source.addEventListener('snapshot', (event) => {
      failures = 0;
      stopPolling();
      onStatus?.('live');
      try {
        emit(JSON.parse(event.data));
      } catch {
        onStatus?.('stale');
      }
    });
    source.addEventListener('error', () => {
      failures += 1;
      onStatus?.('reconnecting');
      if (failures >= failureThreshold && source) {
        source.close();
        source = null;
        startPolling();
      }
    });
  };

  if (typeof EventSource === 'undefined') {
    onStatus?.('unsupported');
    startPolling();
  } else {
    connect();
    probeTimer = setInterval(() => {
      if (!closed && polling && !source) connect();
    }, probeInterval);
  }

  return () => {
    closed = true;
    clearInterval(probeTimer);
    stopPolling();
    source?.close();
    source = null;
  };
}

export async function adminLogin(passcode) {
  return request('/api/admin/login', { method: 'POST', body: { passcode } });
}

export async function adminState(token) {
  return request('/api/admin/state', { headers: { 'x-gm-token': token } });
}

export async function adminWindow(token, state, operator = 'gm') {
  return request('/api/admin/window', {
    method: 'POST',
    headers: { 'x-gm-token': token },
    body: { state, operator },
  });
}

export async function adminMove(token, studentId, toRoleId, operator = 'gm') {
  return request('/api/admin/move', {
    method: 'POST',
    headers: { 'x-gm-token': token },
    body: { studentId, toRoleId, operator },
  });
}

export async function adminRepair(token) {
  return request('/api/admin/repair', {
    method: 'POST',
    headers: { 'x-gm-token': token },
    body: {},
  });
}
export async function adminAutofill(token, operator = 'gm') {
  return request('/api/admin/autofill', {
    method: 'POST',
    headers: { 'x-gm-token': token },
    body: { operator },
  });
}
export async function submitVote({ token, studentId, choices }) {
  const idemKey = await makeIdemKey(studentId ?? 'anon', JSON.stringify(choices ?? {}));
  return request('/api/vote', { method: 'POST', body: { token, choices, idemKey } });
}

export async function fetchVotes() {
  return request('/api/votes');
}

export async function fetchReveal() {
  return request('/api/reveal');
}

export async function adminPhase(token, phase, operator = 'gm') {
  return request('/api/admin/phase', {
    method: 'POST',
    headers: { 'x-gm-token': token },
    body: { phase, operator },
  });
}
export async function adminRebalance(token, operator = 'gm') {
  return request('/api/admin/rebalance', {
    method: 'POST',
    headers: { 'x-gm-token': token },
    body: { operator },
  });
}
export async function fetchClues(token) {
  return request(`/api/clues?token=${encodeURIComponent(token)}`);
}

export async function revealClue(token, clueId) {
  return request('/api/clues/reveal', { method: 'POST', body: { token, clueId } });
}

export async function submitQuestion({ token, toGroupNo, text, anonymous = false }) {
  return request('/api/interrogate', { method: 'POST', body: { token, toGroupNo, text, anonymous } });
}

export async function adminClueRelease(token, round, operator = 'gm') {
  return request('/api/admin/clue/release', {
    method: 'POST',
    headers: { 'x-gm-token': token },
    body: { round, operator },
  });
}

export async function adminClueForce(token, clueId, operator = 'gm') {
  return request('/api/admin/clue/force', {
    method: 'POST',
    headers: { 'x-gm-token': token },
    body: { clueId, operator },
  });
}

export async function adminInterrogation(token, payload) {
  return request('/api/admin/interrogation', {
    method: 'POST',
    headers: { 'x-gm-token': token },
    body: { operator: 'gm', ...payload },
  });
}

export async function adminQuestion(token, id, status) {
  return request('/api/admin/question', {
    method: 'POST',
    headers: { 'x-gm-token': token },
    body: { id, status, operator: 'gm' },
  });
}

export async function adminSilence(token, groupNo, reason) {
  return request('/api/admin/silence', {
    method: 'POST',
    headers: { 'x-gm-token': token },
    body: { groupNo, reason, operator: 'gm' },
  });
}

export async function adminSilenceRevoke(token, penaltyId) {
  return request('/api/admin/silence/revoke', {
    method: 'POST',
    headers: { 'x-gm-token': token },
    body: { penaltyId, operator: 'gm' },
  });
}

export async function adminStatement(token, index) {
  return request('/api/admin/statement', {
    method: 'POST',
    headers: { 'x-gm-token': token },
    body: { index, operator: 'gm' },
  });
}

export async function adminSpokesman(token, groupNo, studentId) {
  return request('/api/admin/spokesman', {
    method: 'POST',
    headers: { 'x-gm-token': token },
    body: { groupNo, studentId, operator: 'gm' },
  });
}

export async function fetchLog(token) {
  return request('/api/admin/log', { headers: { 'x-gm-token': token } });
}
const DEVICE_KEY = 'zero-submission.device';

export function readDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id =
      globalThis.crypto?.randomUUID?.() ??
      `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export async function enroll(deviceId) {
  return request('/api/enroll', { method: 'POST', body: { deviceId } });
}

export async function fetchRoster() {
  return request('/api/roster');
}

export async function claimIdentity(name, deviceId) {
  return request('/api/claim', { method: 'POST', body: { name, deviceId } });
}

export async function adminReleaseDevice(token, studentId) {
  return request('/api/admin/release-device', {
    method: 'POST',
    headers: { 'x-gm-token': token },
    body: { studentId, operator: 'gm' },
  });
}