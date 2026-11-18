import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(HERE, '..', 'data');

const readJson = (file) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));

export const CAPACITY = 7;
export const GROUP_COUNT = 6;
export const TOTAL_STUDENTS = 40;
export const SWITCH_LIMIT = 2;
export const IDEM_MIN_LENGTH = 6;

export const PHASES = Object.freeze([
  'casting',
  'statement',
  'interrogate',
  'confront',
  'vote1',
  'reveal',
  'vote2',
  'ending',
]);

export const PHASE_LABEL = Object.freeze({
  casting: '选角',
  statement: '第一轮陈述',
  interrogate: '第一轮质询',
  confront: '对质',
  vote1: '投票一',
  reveal: '真相揭晓',
  vote2: '处置投票',
  ending: '结局',
});

export const VOTE_ROUNDS = Object.freeze({
  vote1: ['accuse', 'qualify'],
  vote2: ['dispose'],
});

export const WINDOW_STATE = Object.freeze({
  OPEN: 'open',
  CLOSING: 'closing',
  LOCKED: 'locked',
  MAKEUP: 'makeup',
});

export const WINDOW_LABEL = Object.freeze({
  open: '开放',
  closing: '即将结束',
  locked: '已锁定',
  makeup: '补录中',
});

const roleSource = readJson('roles.json');
const studentSource = readJson('students.json');
const caseSource = readJson('case.json');
const clueSource = readJson('clues.json');

const state = {
  window: WINDOW_STATE.OPEN,
  phase: 'casting',
  seq: 0,
  roles: new Map(),
  students: new Map(),
  byToken: new Map(),
  assignments: [],
  idempotency: new Map(),
  votes: new Map(),
  voteIdem: new Map(),
  clueStates: new Map(),
  interrogations: [],
  interrogationQueue: [],
  penalties: [],
  spokesman: new Map(),
  quotas: new Map(),
  silenced: new Map(),
  statementIndex: 0,
  phaseStartedAt: null,
  statementStartedAt: null,
  deviceMap: new Map(),
  studentDevice: new Map(),
  audit: [],
  listeners: new Set(),
};

const now = () => new Date().toISOString();

function fail(code, message, extra = {}) {
  return { ok: false, code, message, ...extra };
}

function ok(data, meta = {}) {
  return { ok: true, code: 'ok', data, ...meta };
}

function seed() {
  for (const role of roleSource.roles) {
    state.roles.set(role.id, {
      id: role.id,
      no: role.no,
      name: role.name,
      title: role.title,
      situation: role.situation,
      hook: role.hook,
      occupied: 0,
      version: 0,
    });
  }
  for (const student of studentSource.students) {
    state.students.set(student.id, {
      id: student.id,
      no: student.no,
      name: student.name,
      token: student.token,
      roleId: null,
      version: 0,
      switches: 0,
      updatedAt: null,
    });
    state.byToken.set(student.token, student.id);
  }
}

function seedClues() {
  for (const clue of clueSource.clues) {
    state.clueStates.set(clue.id, {
      id: clue.id,
      status: 'hidden',
      releasedAt: null,
      releasedBy: null,
    });
  }
}

export function reset() {
  state.window = WINDOW_STATE.OPEN;
  state.phase = 'casting';
  state.seq = 0;
  state.roles.clear();
  state.students.clear();
  state.byToken.clear();
  state.assignments = [];
  state.idempotency = new Map();
  state.votes = new Map();
  state.voteIdem = new Map();
  state.clueStates = new Map();
  state.interrogations = [];
  state.interrogationQueue = [];
  state.penalties = [];
  state.spokesman = new Map();
  state.quotas = new Map();
  state.silenced = new Map();
  state.statementIndex = 0;
  state.phaseStartedAt = null;
  state.statementStartedAt = null;
  state.deviceMap = new Map();
  state.studentDevice = new Map();
  state.audit = [];
  seed();
  seedClues();
}

export function getCase() {
  return caseSource;
}

export function listRoles({ withSecret = false } = {}) {
  const secrets = new Map(roleSource.roles.map((r) => [r.id, r]));
  return [...state.roles.values()]
    .sort((a, b) => a.no - b.no)
    .map((role) => {
      const base = {
        id: role.id,
        no: role.no,
        name: role.name,
        title: role.title,
        situation: role.situation,
        hook: role.hook,
        occupied: role.occupied,
        capacity: CAPACITY,
        remaining: CAPACITY - role.occupied,
        full: role.occupied >= CAPACITY,
      };
      if (withSecret) {
        const source = secrets.get(role.id);
        base.secret = source.secret;
        base.task = source.task;
        base.timeline = source.timeline;
        base.defense = source.defense;
      }
      return base;
    });
}

export function publicStudent(student) {
  const role = student.roleId ? state.roles.get(student.roleId) : null;
  return {
    id: student.id,
    no: student.no,
    name: student.name,
    roleId: student.roleId,
    roleName: role ? role.name : null,
    roleTitle: role ? role.title : null,
    roleNo: role ? role.no : null,
    groupName: role ? `第 ${role.no} 组` : null,
    switches: student.switches,
    switchLimit: SWITCH_LIMIT,
    canSwitch: state.window !== WINDOW_STATE.LOCKED && student.switches < SWITCH_LIMIT,
  };
}

export function studentRoleCard(studentId) {
  const student = state.students.get(studentId);
  if (!student || !student.roleId) return null;
  const role = state.roles.get(student.roleId);
  if (!role) return null;
  const card = applySecret(role);
  return {
    id: card.id,
    no: card.no,
    name: card.name,
    title: card.title,
    situation: card.situation,
    hook: card.hook,
    capacity: CAPACITY,
    occupied: card.occupied,
    secret: card.secret,
    task: card.task,
    timeline: card.timeline,
    defense: card.defense,
  };
}

export function findStudentByToken(token) {
  const id = state.byToken.get(token);
  return id ? state.students.get(id) ?? null : null;
}

export function rosterPublic() {
  return [...state.students.values()]
    .sort((a, b) => a.no.localeCompare(b.no))
    .map((student) => ({
      id: student.id,
      name: student.name,
      claimed: state.studentDevice.has(student.id),
    }));
}

export function claim({ studentId, deviceId, name }) {
  const device = String(deviceId ?? '').trim();
  if (device.length < 8) return fail('invalid_request', '设备标识缺失');

  let student = studentId ? state.students.get(studentId) ?? null : null;
  if (!student) {
    const keyword = String(name ?? '').trim();
    if (!keyword) return fail('identity_invalid', '请输入姓名');
    const matches = [...state.students.values()].filter((item) => item.name === keyword);
    if (matches.length === 0) return fail('identity_invalid', '名单中没有这个姓名');
    if (matches.length > 1) return fail('ambiguous_name', '名单中有重名，请联系主持人');
    student = matches[0];
  }

  const boundDevice = state.studentDevice.get(student.id);
  if (boundDevice) {
    if (boundDevice === device) {
      return ok({ token: student.token, student: publicStudent(student), reused: true });
    }
    return fail('already_claimed', '这个姓名已被其他设备登录');
  }

  const existingStudentId = state.deviceMap.get(device);
  if (existingStudentId && existingStudentId !== student.id) {
    const existing = state.students.get(existingStudentId);
    return fail('device_bound', `本设备已登录为${existing?.name ?? '其他同学'}，请先释放或换设备`);
  }

  state.deviceMap.set(device, student.id);
  state.studentDevice.set(student.id, device);
  state.audit.push({ at: now(), operator: 'claim', action: 'claim', studentId: student.id });
  emit();
  return ok({ token: student.token, student: publicStudent(student), reused: false });
}

export function enroll(deviceId) {
  const device = String(deviceId ?? '').trim();
  if (device.length < 8) return fail('invalid_request', '设备标识缺失');

  const bound = state.deviceMap.get(device);
  if (bound) {
    const student = state.students.get(bound);
    if (student) return ok({ token: student.token, student: publicStudent(student), reused: true });
    state.deviceMap.delete(device);
  }

  const free = [...state.students.values()].find((student) => !state.studentDevice.has(student.id));
  if (!free) return fail('class_full', '40 个名额已分配完，请联系主持人释放');

  state.deviceMap.set(device, free.id);
  state.studentDevice.set(free.id, device);
  state.audit.push({ at: now(), operator: 'enroll', action: 'enroll', studentId: free.id });
  emit();
  return ok({ token: free.token, student: publicStudent(free), reused: false });
}

export function releaseDevice({ studentId, operator = 'gm' }) {
  const student = state.students.get(studentId);
  if (!student) return fail('identity_invalid', '学生不存在');
  const deviceId = state.studentDevice.get(studentId);
  if (!deviceId) return fail('invalid_request', '该身份未绑定设备');
  state.studentDevice.delete(studentId);
  state.deviceMap.delete(deviceId);
  state.audit.push({ at: now(), operator, action: 'release_device', studentId });
  emit();
  return ok({ studentId, deviceId });
}

function applySecret(role) {
  const source = roleSource.roles.find((r) => r.id === role.id);
  return { ...role, secret: source.secret, task: source.task, timeline: source.timeline, defense: source.defense };
}

function checkIdentity(token) {
  if (!token || typeof token !== 'string') {
    return fail('identity_invalid', '缺少进入凭证，请重新扫码');
  }
  const student = findStudentByToken(token);
  if (!student) {
    return fail('identity_invalid', '凭证无效或已过期，请重新扫码');
  }
  return ok(student);
}

function checkIdempotency(idemKey, studentId) {
  const record = state.idempotency.get(idemKey);
  if (!record) return null;
  if (record.studentId !== studentId) {
    return fail('invalid_request', '幂等标识与身份不匹配');
  }
  return record.result;
}

function remember(idemKey, studentId, result) {
  if (idemKey) {
    state.idempotency.set(idemKey, { studentId, result, at: now() });
  }
  return result;
}

function checkCapacity(roleId) {
  const role = state.roles.get(roleId);
  if (!role) {
    return fail('role_unknown', '角色不存在');
  }
  if (role.occupied >= CAPACITY) {
    return fail('role_full', '该角色已满员', { roleId, occupied: role.occupied, capacity: CAPACITY });
  }
  return ok(role);
}

function checkUniqueness(student, roleId) {
  if (student.roleId === roleId) return 'same';
  if (student.roleId) return 'switch';
  return 'first';
}

function counts() {
  const roles = new Map();
  for (const role of state.roles.values()) roles.set(role.id, role.occupied);
  let assigned = 0;
  for (const student of state.students.values()) if (student.roleId) assigned += 1;
  return { roles, assigned };
}

function assertCounts() {
  const { roles, assigned } = counts();
  let sum = 0;
  for (const value of roles.values()) sum += value;
  if (sum !== assigned) {
    throw new Error(`count_inconsistent: 六组之和 ${sum} !== 已归组 ${assigned}`);
  }
}

function commit(student, fromRoleId, toRoleId, action, idemKey) {
  const before = {
    roles: new Map([...state.roles.values()].map((r) => [r.id, { occupied: r.occupied, version: r.version }])),
    student: { roleId: student.roleId, version: student.version, switches: student.switches, updatedAt: student.updatedAt },
    seq: state.seq,
  };

  try {
    if (fromRoleId) {
      const from = state.roles.get(fromRoleId);
      if (!from || from.occupied <= 0) throw new Error(`bad_source_role: ${fromRoleId}`);
      from.occupied -= 1;
      from.version += 1;
    }
    const to = state.roles.get(toRoleId);
    if (!to) throw new Error(`bad_target_role: ${toRoleId}`);
    if (to.occupied + 1 > CAPACITY) throw new Error(`over_capacity: ${toRoleId}`);
    to.occupied += 1;
    to.version += 1;

    student.roleId = toRoleId;
    student.version += 1;
    if (fromRoleId) student.switches += 1;
    student.updatedAt = now();

    state.seq += 1;
    state.assignments.push({
      seq: state.seq,
      studentId: student.id,
      from: fromRoleId,
      to: toRoleId,
      action,
      idemKey,
      createdAt: student.updatedAt,
    });

    assertCounts();
  } catch (error) {
    for (const [id, snapshot] of before.roles) {
      const role = state.roles.get(id);
      if (role) {
        role.occupied = snapshot.occupied;
        role.version = snapshot.version;
      }
    }
    Object.assign(student, before.student);
    state.seq = before.seq;
    state.assignments.pop();
    throw error;
  }
}

function emit() {
  const snap = snapshot();
  for (const listener of state.listeners) {
    try {
      listener(snap);
    } catch {
      state.listeners.delete(listener);
    }
  }
}

export function assign({ token, roleId, idemKey }) {
  const identity = checkIdentity(token);
  if (!identity.ok) return identity;
  const student = identity.data;

  if (!idemKey || typeof idemKey !== 'string' || idemKey.length < IDEM_MIN_LENGTH) {
    return fail('invalid_request', '幂等标识缺失或格式不合法');
  }

  const replay = checkIdempotency(idemKey, student.id);
  if (replay) return replay;

  if (state.window === WINDOW_STATE.LOCKED) {
    return fail('window_locked', '选角已结束，当前仅可查看');
  }

  const capacity = checkCapacity(roleId);
  if (!capacity.ok) {
    return remember(idemKey, student.id, capacity);
  }

  const uniqueness = checkUniqueness(student, roleId);
  if (uniqueness === 'same') {
    return remember(idemKey, student.id, ok({ student: publicStudent(student), mode: 'replay' }));
  }
  if (uniqueness === 'switch' && student.switches >= SWITCH_LIMIT) {
    return fail('switch_limit', '改选已达上限');
  }

  const fromRoleId = student.roleId;
  commit(student, fromRoleId, roleId, uniqueness === 'switch' ? 'switch' : 'select', idemKey);

  const result = ok({
    student: publicStudent(student),
    role: applySecret(listRoles({ withSecret: true }).find((r) => r.id === roleId)),
    mode: uniqueness,
    movedFrom: fromRoleId,
    movedTo: roleId,
  });

  const finalResult = remember(idemKey, student.id, result);
  emit();
  return finalResult;
}

export function setWindow(next, operator = 'gm') {
  if (!Object.values(WINDOW_STATE).includes(next)) {
    return fail('invalid_request', `未知窗口状态：${next}`);
  }
  const prev = state.window;
  state.window = next;
  state.audit.push({ at: now(), operator, action: 'set_window', from: prev, to: next });
  emit();
  return ok({ window: next, label: WINDOW_LABEL[next], prev });
}

export function moveStudent({ studentId, toRoleId, operator = 'gm', idemKey = null }) {
  const student = state.students.get(studentId);
  if (!student) return fail('identity_invalid', '学生不存在');
  if (!state.roles.get(toRoleId)) return fail('role_unknown', '角色不存在');
  if (student.roleId === toRoleId) return fail('role_same', '该学生已在目标组');

  const capacity = checkCapacity(toRoleId);
  if (!capacity.ok) return capacity;

  const fromRoleId = student.roleId;
  commit(student, fromRoleId, toRoleId, 'admin_move', idemKey);
  state.audit.push({ at: now(), operator, action: 'move', studentId, from: fromRoleId, to: toRoleId });
  emit();
  return ok({ student: publicStudent(student), movedFrom: fromRoleId, movedTo: toRoleId });
}

export function autofill({ operator = 'gm' } = {}) {
  const pending = [...state.students.values()]
    .filter((student) => !student.roleId)
    .sort((a, b) => a.no.localeCompare(b.no));

  if (pending.length === 0) {
    return ok({ filled: 0, moves: [], snapshot: snapshot() });
  }

  const moves = [];
  for (const student of pending) {
    const open = [...state.roles.values()]
      .filter((role) => role.occupied < CAPACITY)
      .sort((a, b) => a.occupied - b.occupied || a.no - b.no);
    if (open.length === 0) break;
    const target = open[0];
    commit(student, null, target.id, 'admin_move', null);
    moves.push({
      studentId: student.id,
      name: student.name,
      no: student.no,
      toRoleId: target.id,
      roleNo: target.no,
    });
  }

  state.audit.push({ at: now(), operator, action: 'autofill', count: moves.length });
  emit();
  return ok({ filled: moves.length, moves, snapshot: snapshot() });
}

export function rebalance({ operator = 'gm' } = {}) {
  const moves = [];
  let guard = 0;

  while (guard < GROUP_COUNT * CAPACITY) {
    guard += 1;
    const ordered = [...state.roles.values()].sort((a, b) => b.occupied - a.occupied || a.no - b.no);
    const heaviest = ordered[0];
    const lightest = ordered[ordered.length - 1];
    if (!heaviest || !lightest) break;
    if (heaviest.occupied - lightest.occupied < 2) break;
    if (lightest.occupied >= CAPACITY) break;

    const candidate = [...state.students.values()]
      .filter((student) => student.roleId === heaviest.id)
      .sort((a, b) => b.no.localeCompare(a.no))[0];
    if (!candidate) break;

    commit(candidate, heaviest.id, lightest.id, 'admin_move', null);
    moves.push({
      studentId: candidate.id,
      name: candidate.name,
      no: candidate.no,
      fromRoleId: heaviest.id,
      fromNo: heaviest.no,
      toRoleId: lightest.id,
      toNo: lightest.no,
    });
  }

  if (moves.length > 0) {
    state.audit.push({ at: now(), operator, action: 'rebalance', count: moves.length });
    emit();
  }

  const finalSnapshot = snapshot();
  return ok({
    moved: moves.length,
    moves,
    distribution: finalSnapshot.roles.map((role) => role.occupied),
    snapshot: finalSnapshot,
  });
}

const ACCUSE_CHOICES = new Set(roleSource.roles.map((role) => role.id));
const QUALIFY_CHOICES = new Set(['A', 'B', 'C']);
const DISPOSE_CHOICES = new Set(['e1', 'e2', 'e3', 'e4']);

export function studentVotes(studentId) {
  const record = state.votes.get(studentId);
  return {
    accuse: record?.accuse ?? null,
    qualify: record?.qualify ?? null,
    dispose: record?.dispose ?? null,
    updatedAt: record?.updatedAt ?? null,
  };
}

export function voteSummary() {
  const accuse = {};
  for (const role of state.roles.values()) accuse[role.id] = 0;
  const qualify = { A: 0, B: 0, C: 0 };
  const dispose = { e1: 0, e2: 0, e3: 0, e4: 0 };
  let cast1 = 0;
  let cast2 = 0;

  for (const record of state.votes.values()) {
    if (record.accuse) {
      accuse[record.accuse] = (accuse[record.accuse] ?? 0) + 1;
      cast1 += 1;
    }
    if (record.qualify) qualify[record.qualify] += 1;
    if (record.dispose) {
      dispose[record.dispose] += 1;
      cast2 += 1;
    }
  }

  const ranked = Object.entries(dispose).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    phase: state.phase,
    total: TOTAL_STUDENTS,
    cast1,
    cast2,
    accuse,
    qualify,
    dispose,
    leadingDispose: ranked[0] && ranked[0][1] > 0 ? ranked[0][0] : null,
  };
}

export function voteSummaryPublic() {
  const summary = voteSummary();
  if (state.phase === 'reveal' || state.phase === 'ending') {
    return { ...summary, hidden: false };
  }
  return {
    phase: summary.phase,
    total: summary.total,
    cast1: summary.cast1,
    cast2: summary.cast2,
    hidden: true,
  };
}

const nextEventId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function clueMeta(id) {
  return clueSource.clues.find((item) => item.id === id) ?? null;
}

function holderGroupNo(clue) {
  if (!clue.holderRoleId) return null;
  const role = state.roles.get(clue.holderRoleId);
  return role ? role.no : null;
}

function clueSummary() {
  const items = clueSource.clues.map((clue) => {
    const clueState = state.clueStates.get(clue.id);
    const holderNo = holderGroupNo(clue);
    if (!clueState || clueState.status === 'hidden') {
      return { id: clue.id, round: clue.round, status: 'hidden', holderNo: null };
    }
    if (clueState.status === 'held') {
      return { id: clue.id, round: clue.round, status: 'held', name: clue.name, holderNo };
    }
    return {
      id: clue.id,
      round: clue.round,
      status: 'public',
      name: clue.name,
      content: clue.content,
      proves: clue.proves,
      holderNo,
    };
  });

  return {
    total: items.length,
    initialized: state.clueStates.size === clueSource.clues.length,
    publicCount: items.filter((item) => item.status === 'public').length,
    heldCount: items.filter((item) => item.status === 'held').length,
    items,
  };
}

export function clueViewFor(studentId) {
  const student = state.students.get(studentId);
  const myNo = student?.roleId ? state.roles.get(student.roleId)?.no ?? null : null;

  return clueSource.clues.map((clue) => {
    const clueState = state.clueStates.get(clue.id);
    const holderNo = holderGroupNo(clue);
    const base = {
      id: clue.id,
      round: clue.round,
      status: clueState?.status ?? 'hidden',
      holderNo: clueState?.status === 'hidden' ? null : holderNo,
    };

    if (!clueState || clueState.status === 'hidden') return base;

    if (clueState.status === 'held') {
      if (myNo !== null && myNo === holderNo) {
        return {
          ...base,
          name: clue.name,
          content: clue.content,
          proves: clue.proves,
          holder: true,
          forced: clue.forced,
          holderNote: '这张卡交不交、什么时候交，由你们组决定。',
        };
      }
      return { ...base, name: clue.name, holder: false };
    }

    return { ...base, name: clue.name, content: clue.content, proves: clue.proves, holder: myNo === holderNo };
  });
}

export function releaseRound({ round, operator = 'gm' }) {
  const group = clueSource.rounds.find((item) => item.round === Number(round));
  if (!group) return fail('invalid_request', `未知轮次：${round}`);
  if (state.clueStates.size === 0) {
    return fail('clue_not_initialized', '线索状态未初始化：检查 store 启动流程或重启服务');
  }

  const released = [];
  for (const clueId of group.clueIds) {
    const clueState = state.clueStates.get(clueId);
    const meta = clueMeta(clueId);
    if (!clueState || !meta || clueState.status !== 'hidden') continue;
    clueState.status = meta.visibility === 'public' ? 'public' : 'held';
    clueState.releasedAt = now();
    clueState.releasedBy = 'round';
    released.push({ id: clueId, status: clueState.status });
  }

  if (released.length > 0) {
    state.audit.push({ at: now(), operator, action: 'release_round', round: Number(round), count: released.length });
    emit();
  }
  return ok({ round: Number(round), released, clues: clueSummary() });
}

function forceRevealClue(clueId, operator, silent) {
  const meta = clueMeta(clueId);
  const clueState = state.clueStates.get(clueId);
  if (!meta || !clueState) return fail('clue_unknown', '线索不存在');
  if (clueState.status === 'public') {
    return ok({ clueId, status: 'public', releasedBy: clueState.releasedBy, idempotent: true });
  }

  clueState.status = 'public';
  clueState.releasedAt = clueState.releasedAt ?? now();
  clueState.releasedBy = clueState.releasedBy === 'voluntary' ? 'voluntary' : 'procedure';

  if (!silent) {
    state.audit.push({ at: now(), operator, action: 'clue_forced', clueId });
    emit();
  }
  return ok({ clueId, status: 'public', releasedBy: clueState.releasedBy });
}

export function forceReveal({ clueId, operator = 'gm' }) {
  return forceRevealClue(clueId, operator, false);
}

export function volunteerReveal({ token, clueId }) {
  const identity = checkIdentity(token);
  if (!identity.ok) return identity;
  const student = identity.data;
  const meta = clueMeta(clueId);
  const clueState = state.clueStates.get(clueId);
  if (!meta || !clueState) return fail('clue_unknown', '线索不存在');
  if (clueState.status === 'hidden') return fail('clue_not_released', '该线索尚未发放');
  if (clueState.status === 'public') return ok({ clueId, status: 'public', idempotent: true });

  const holderNo = holderGroupNo(meta);
  const myNo = student.roleId ? state.roles.get(student.roleId)?.no ?? null : null;
  if (myNo === null || myNo !== holderNo) return fail('not_holder', '只有持有组可以公开这张卡');

  clueState.status = 'public';
  clueState.releasedAt = now();
  clueState.releasedBy = 'voluntary';
  state.audit.push({ at: now(), operator: `group-${myNo}`, action: 'clue_volunteer', clueId });
  emit();
  return ok({ clueId, status: 'public', releasedBy: 'voluntary' });
}

export function submitQuestion({ token, toGroupNo, text, anonymous = false }) {
  const identity = checkIdentity(token);
  if (!identity.ok) return identity;
  const student = identity.data;
  if (state.phase !== 'interrogate') return fail('phase_closed', '当前不在质询阶段');

  const myRole = student.roleId ? state.roles.get(student.roleId) : null;
  if (!myRole) return fail('role_required', '尚未归组，无法质询');
  if (state.silenced.has(myRole.no)) return fail('silenced', '本轮静默，不能发起质询');

  const target = [...state.roles.values()].find((role) => role.no === Number(toGroupNo));
  if (!target) return fail('role_unknown', '被质询组不存在');
  if (target.no === myRole.no) return fail('invalid_request', '不能质询自己组');

  const trimmed = String(text ?? '').trim();
  if (trimmed.length < 2 || trimmed.length > 60) return fail('invalid_request', '问题需 2—60 字');

  const item = {
    id: nextEventId('q'),
    studentId: student.id,
    groupNo: myRole.no,
    toGroupNo: target.no,
    text: trimmed,
    anonymous: Boolean(anonymous),
    status: 'pending',
    at: now(),
  };
  state.interrogationQueue.push(item);
  emit();
  return ok({
    item: { id: item.id, groupNo: item.groupNo, toGroupNo: item.toGroupNo, anonymous: item.anonymous, status: item.status },
    remaining: state.quotas.get(myRole.no) ?? 0,
  });
}

export function recordInterrogation({ fromGroupNo, toGroupNo, question = '', answer = 'decline', channel = 'oral', operator = 'gm' }) {
  if (state.phase !== 'interrogate') return fail('phase_closed', '当前不在质询阶段');

  const from = Number(fromGroupNo);
  const to = Number(toGroupNo);
  if (!Number.isInteger(from) || from < 1 || from > GROUP_COUNT) return fail('invalid_request', '质询组不合法');
  if (!Number.isInteger(to) || to < 1 || to > GROUP_COUNT) return fail('invalid_request', '被质询组不合法');
  if (from === to) return fail('invalid_request', '不能质询自己组');
  if (state.silenced.has(from)) return fail('silenced', '该组本轮静默');
  if ((state.quotas.get(from) ?? 0) <= 0) return fail('quota_exhausted', '该组本轮质询机会已用完');
  if (!['yes', 'no', 'decline'].includes(answer)) return fail('invalid_request', '回答只能是 yes/no/decline');

  state.quotas.set(from, (state.quotas.get(from) ?? 0) - 1);
  const item = {
    id: nextEventId('i'),
    fromGroupNo: from,
    toGroupNo: to,
    question: String(question ?? '').slice(0, 80),
    answer,
    channel,
    at: now(),
    operator,
  };
  state.interrogations.push(item);
  state.audit.push({ at: now(), operator, action: 'interrogation', fromGroupNo: from, toGroupNo: to, answer });
  emit();
  return ok({ item, remaining: state.quotas.get(from) });
}

export function markQuestion({ id, status, operator = 'gm' }) {
  if (!['shown', 'rejected'].includes(status)) return fail('invalid_request', '队列状态不合法');
  const item = state.interrogationQueue.find((entry) => entry.id === id);
  if (!item) return fail('invalid_request', '质询不存在');
  item.status = status;
  item.decidedAt = now();
  item.decidedBy = operator;
  state.audit.push({ at: now(), operator, action: 'question_mark', id, status });
  emit();
  return ok({ item });
}

export function silenceGroup({ groupNo, reason = '', operator = 'gm' }) {
  const no = Number(groupNo);
  const role = [...state.roles.values()].find((item) => item.no === no);
  if (!role) return fail('role_unknown', '组不存在');

  if (state.silenced.has(no)) {
    const existing = state.penalties.find((item) => item.id === state.silenced.get(no));
    return ok({ penalty: existing, idempotent: true });
  }

  const prior = state.penalties.filter((item) => item.groupNo === no && !item.revoked).length;
  if (prior >= 1) return fail('silence_limit', '该组已静默过一次，第二次请私下提醒');

  const penalty = {
    id: nextEventId('p'),
    groupNo: no,
    phase: state.phase,
    reason: String(reason ?? '').slice(0, 80),
    operator,
    at: now(),
    revoked: false,
  };
  state.penalties.push(penalty);
  state.silenced.set(no, penalty.id);
  state.audit.push({ at: now(), operator, action: 'silence', groupNo: no });
  emit();
  return ok({ penalty });
}

export function revokeSilence({ penaltyId, operator = 'gm' }) {
  const penalty = state.penalties.find((item) => item.id === penaltyId);
  if (!penalty) return fail('invalid_request', '记录不存在');
  penalty.revoked = true;
  penalty.revokedAt = now();
  penalty.revokedBy = operator;
  if (state.silenced.get(penalty.groupNo) === penaltyId) state.silenced.delete(penalty.groupNo);
  state.audit.push({ at: now(), operator, action: 'silence_revoke', penaltyId });
  emit();
  return ok({ penalty });
}

export function setStatementIndex({ index, operator = 'gm' }) {
  const next = Number(index);
  if (!Number.isInteger(next) || next < 0 || next > GROUP_COUNT) return fail('invalid_request', '陈述序号不合法');
  state.statementIndex = next;
  state.statementStartedAt = now();
  state.audit.push({ at: now(), operator, action: 'statement_index', index: next });
  emit();
  return ok({ index: next });
}

export function setSpokesman({ groupNo, studentId = null, operator = 'gm' }) {
  const no = Number(groupNo);
  const role = [...state.roles.values()].find((item) => item.no === no);
  if (!role) return fail('role_unknown', '组不存在');

  if (studentId === null) {
    state.spokesman.delete(no);
  } else {
    const student = state.students.get(studentId);
    if (!student || student.roleId !== role.id) return fail('invalid_request', '该学生不在这个组');
    state.spokesman.set(no, studentId);
  }
  state.audit.push({ at: now(), operator, action: 'spokesman', groupNo: no, studentId });
  emit();
  return ok({ groupNo: no, studentId });
}

export function penaltySummary() {
  const active = state.penalties.filter((item) => !item.revoked);
  return {
    total: active.length,
    items: active.map((item) => ({ id: item.id, groupNo: item.groupNo, phase: item.phase })),
  };
}

export function setPhase(next, operator = 'gm') {
  if (!PHASES.includes(next)) {
    return fail('invalid_request', `未知活动阶段：${next}`);
  }
  const prev = state.phase;
  state.phase = next;
  state.phaseStartedAt = now();
  state.silenced.clear();

  if (next === 'interrogate') {
    state.quotas.clear();
    for (const role of state.roles.values()) state.quotas.set(role.no, 1);
  }

  if (next === 'statement') {
    state.statementIndex = 0;
  }

  let forced = null;
  if (next === 'confront') {
    const result = forceRevealClue('L8', 'procedure', true);
    if (result.ok) forced = 'L8';
  }

  state.audit.push({ at: now(), operator, action: 'set_phase', from: prev, to: next });
  emit();
  return ok({ phase: next, label: PHASE_LABEL[next], prev, forced });
}

function rememberVote(idemKey, studentId, result) {
  state.voteIdem.set(idemKey, { studentId, result, at: now() });
  return result;
}

export function vote({ token, choices, idemKey }) {
  const identity = checkIdentity(token);
  if (!identity.ok) return identity;
  const student = identity.data;

  if (!idemKey || typeof idemKey !== 'string' || idemKey.length < IDEM_MIN_LENGTH) {
    return fail('invalid_request', '幂等标识缺失或格式不合法');
  }

  const replay = state.voteIdem.get(idemKey);
  if (replay) {
    if (replay.studentId !== student.id) return fail('invalid_request', '幂等标识与身份不匹配');
    return replay.result;
  }

  if (state.phase !== 'vote1' && state.phase !== 'vote2') {
    return fail('phase_closed', '当前不在投票阶段');
  }

  const record = state.votes.get(student.id) ?? { accuse: null, qualify: null, dispose: null, updatedAt: null };

  if (state.phase === 'vote1') {
    const accuse = choices?.accuse;
    const qualify = choices?.qualify;
    if (!ACCUSE_CHOICES.has(accuse)) return fail('invalid_choice', '指认票选项不合法');
    if (!QUALIFY_CHOICES.has(qualify)) return fail('invalid_choice', '定性票选项不合法');
    record.accuse = accuse;
    record.qualify = qualify;
  } else {
    const dispose = choices?.dispose;
    if (!DISPOSE_CHOICES.has(dispose)) return fail('invalid_choice', '处置票选项不合法');
    record.dispose = dispose;
  }

  record.updatedAt = now();
  state.votes.set(student.id, record);

  const result = ok({
    phase: state.phase,
    choices: studentVotes(student.id),
    summary: voteSummaryPublic(),
  });
  rememberVote(idemKey, student.id, result);
  emit();
  return result;
}

export function getReveal() {
  if (state.phase !== 'reveal' && state.phase !== 'ending') {
    return fail('phase_closed', '尚未进入揭晓阶段');
  }
  const source = caseSource;
  const summary = voteSummary();
  const endingId = summary.leadingDispose ?? 'e1';
  const ending = source.endings.find((item) => item.id === endingId) ?? source.endings[0];
  return ok({
    phase: state.phase,
    puzzles: source.reveal.puzzles,
    chain: source.reveal.chain,
    chainNote: source.reveal.chainNote,
    theme: source.reveal.theme,
    accuse: { roleId: source.votes.accuse.answerRoleId, name: source.votes.accuse.answer },
    qualify: { key: source.votes.qualify.answerKey },
    qualifyOptions: source.votes.qualify.options.map((option) => ({ key: option.key, text: option.text })),
    endings: source.endings,
    ending,
    summary,
  });
}

export function snapshot() {
  const roles = listRoles();
  let joined = 0;
  for (const role of roles) joined += role.occupied;

  const groups = roles.map((role) => {
    const members = [...state.students.values()]
      .filter((s) => s.roleId === role.id)
      .sort((a, b) => a.no.localeCompare(b.no))
      .map((s, index) => ({ seq: index + 1, no: s.no, name: s.name }));
    return { no: role.no, roleId: role.id, roleName: role.name, occupied: role.occupied, capacity: CAPACITY, members };
  });

  return {
    window: state.window,
    windowLabel: WINDOW_LABEL[state.window],
    phase: state.phase,
    phaseLabel: PHASE_LABEL[state.phase],
    votes: voteSummaryPublic(),
    clues: clueSummary(),
    silencedGroups: [...state.silenced.keys()],
    spokesman: [...state.spokesman.entries()].map(([groupNo, studentId]) => ({
      groupNo,
      name: state.students.get(studentId)?.name ?? null,
    })),
    statementIndex: state.statementIndex,
    phaseStartedAt: state.phaseStartedAt,
    statementStartedAt: state.statementStartedAt,
    quotas: Object.fromEntries(state.quotas),
    pendingQuestions: state.interrogationQueue.filter((item) => item.status === 'pending').length,
    total: TOTAL_STUDENTS,
    joined,
    remaining: TOTAL_STUDENTS - joined,
    percent: TOTAL_STUDENTS === 0 ? 0 : Math.round((joined / TOTAL_STUDENTS) * 1000) / 10,
    roles,
    groups,
    ts: now(),
  };
}

export function unselected() {
  return [...state.students.values()]
    .filter((s) => !s.roleId)
    .sort((a, b) => a.no.localeCompare(b.no))
    .map((s) => ({ id: s.id, no: s.no, name: s.name, deviceBound: state.studentDevice.has(s.id) }));
}

export function reconcile() {
  const actual = new Map();
  for (const role of state.roles.values()) actual.set(role.id, 0);
  for (const student of state.students.values()) {
    if (student.roleId) actual.set(student.roleId, (actual.get(student.roleId) ?? 0) + 1);
  }
  const drift = [];
  for (const role of state.roles.values()) {
    const real = actual.get(role.id) ?? 0;
    if (real !== role.occupied) {
      drift.push({ roleId: role.id, roleName: role.name, counter: role.occupied, actual: real });
    }
  }
  return { ok: drift.length === 0, drift, checkedAt: now() };
}

export function repairCounters() {
  const result = reconcile();
  for (const item of result.drift) {
    const role = state.roles.get(item.roleId);
    if (role) role.occupied = item.actual;
  }
  if (!result.ok) state.audit.push({ at: now(), action: 'repair_counters', drift: result.drift });
  return reconcile();
}

export function adminView() {
  return {
    window: state.window,
    windowLabel: WINDOW_LABEL[state.window],
    phase: state.phase,
    phaseLabel: PHASE_LABEL[state.phase],
    votes: voteSummary(),
    clues: clueSummary(),
    penalties: state.penalties.slice(-30),
    silencing: [...state.silenced.keys()],
    interrogations: state.interrogations.slice(-30),
    questionQueue: state.interrogationQueue.slice(-30),
    quotas: Object.fromEntries(state.quotas),
    spokesman: [...state.spokesman.entries()].map(([groupNo, studentId]) => ({
      groupNo,
      name: state.students.get(studentId)?.name ?? null,
    })),
    statementIndex: state.statementIndex,
    penaltyTotals: penaltySummary(),
    snapshot: snapshot(),
    unselected: unselected(),
    roster: [...state.students.values()]
      .sort((a, b) => a.no.localeCompare(b.no))
      .map((student) => {
        const role = student.roleId ? state.roles.get(student.roleId) : null;
        return {
          id: student.id,
          no: student.no,
          name: student.name,
          token: student.token,
          deviceBound: state.studentDevice.has(student.id),
          roleId: student.roleId,
          roleName: role ? role.name : null,
          roleNo: role ? role.no : null,
          switches: student.switches,
        };
      }),
    roles: listRoles({ withSecret: true }),
    audit: state.audit.slice(-50),
    assignments: state.assignments.slice(-50),
    reconcile: reconcile(),
  };
}

export function subscribe(listener) {
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

export const constants = Object.freeze({
  CAPACITY,
  GROUP_COUNT,
  TOTAL_STUDENTS,
  SWITCH_LIMIT,
  WINDOW_STATE,
  WINDOW_LABEL,
});

seed();seedClues();