export const STAGE = Object.freeze({
  IDENTITY: 'identity',
  PROLOGUE: 'prologue',
  BRIEF: 'brief',
  WALL: 'wall',
  CONFIRM: 'confirm',
  RESULT: 'result',
  PROFILE: 'profile',
  CLUES: 'clues',
  INTERROGATE: 'interrogate',
  VOTE: 'vote',
  REVEAL: 'reveal',
  ENDING: 'ending',
});

export const STAGE_ORDER = Object.freeze([
  STAGE.IDENTITY,
  STAGE.PROLOGUE,
  STAGE.BRIEF,
  STAGE.WALL,
  STAGE.CONFIRM,
  STAGE.RESULT,
  STAGE.CLUES,
  STAGE.INTERROGATE,
  STAGE.VOTE,
  STAGE.REVEAL,
  STAGE.ENDING,
]);

export const PHASE = Object.freeze({
  CASTING: 'casting',
  STATEMENT: 'statement',
  INTERROGATE: 'interrogate',
  CONFRONT: 'confront',
  VOTE1: 'vote1',
  REVEAL: 'reveal',
  VOTE2: 'vote2',
  ENDING: 'ending',
});

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

export const WINDOW_STATE = Object.freeze({
  OPEN: 'open',
  CLOSING: 'closing',
  LOCKED: 'locked',
  MAKEUP: 'makeup',
});

export function createState(initial) {
  let value = initial;
  const listeners = new Set();

  return {
    get() {
      return value;
    },
    set(patch) {
      const next = typeof patch === 'function' ? patch(value) : { ...value, ...patch };
      if (next === value) return value;
      value = next;
      for (const listener of listeners) listener(value);
      return value;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(value);
      return () => listeners.delete(listener);
    },
  };
}

export function canEnter(stage, state) {
  switch (stage) {
    case STAGE.PROLOGUE:
      return Boolean(state.student);
    case STAGE.BRIEF:
      return Boolean(state.student);
    case STAGE.WALL:
      return Boolean(state.student);
    case STAGE.CONFIRM:
      return Boolean(state.student) && Boolean(state.draftRoleId) && !state.submitting;
    case STAGE.RESULT:
      return Boolean(state.student?.roleId);
    case STAGE.PROFILE:
      return Boolean(state.student?.roleId);
    case STAGE.CLUES:
    case STAGE.INTERROGATE:
    case STAGE.VOTE:
    case STAGE.REVEAL:
    case STAGE.ENDING:
      return Boolean(state.student);
    default:
      return true;
  }
}

export function joinedCount(roles) {
  return (roles ?? []).reduce((total, role) => total + (role.occupied ?? 0), 0);
}

export function consistentTotals(snapshot) {
  if (!snapshot) return false;
  return joinedCount(snapshot.roles) === snapshot.joined && snapshot.joined + snapshot.remaining === snapshot.total;
}

export function fullRoles(roles) {
  return (roles ?? []).filter((role) => role.full);
}

export function availableRoles(roles, excludeId = null) {
  return (roles ?? []).filter((role) => !role.full && role.id !== excludeId);
}

export function pickAlternative(roles, excludeId) {
  const candidates = availableRoles(roles, excludeId).slice().sort((a, b) => b.remaining - a.remaining);
  return candidates[0] ?? null;
}

export function stageFlags(state) {
  const locked = state.window === WINDOW_STATE.LOCKED;
  return {
    locked,
    closing: state.window === WINDOW_STATE.CLOSING,
    canPick: !locked && !state.submitting,
    canSwitch: !locked && (state.student?.switches ?? 0) < (state.student?.switchLimit ?? 2),
  };
}