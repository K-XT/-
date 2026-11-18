import { MODULES, esc } from './modules.js';
import {
  bootstrap,
  clearToken,
  enroll,
  fetchClues,
  fetchReveal,
  fetchSnapshot,
  flushPending,
  readDeviceId,
  readToken,
  revealClue as apiRevealClue,
  saveToken,
  submitAssignment,
  submitQuestion as apiSubmitQuestion,
  submitVote,
  subscribeStream,
} from './api.js';
import { PHASE, PHASE_LABEL, STAGE, WINDOW_STATE, canEnter, createState, pickAlternative } from './state.js';

const stageRoot = document.getElementById('stage');
const actionbar = document.getElementById('actionbar');
const toastEl = document.getElementById('toast');
const progressEl = document.getElementById('progress');
const windowEl = document.getElementById('window-flag');

const WINDOW_TEXT = { open: '开放', closing: '即将结束', locked: '已结束', makeup: '补录中' };

const state = createState({
  stage: STAGE.IDENTITY,
  token: '',

  claimError: null,
  claiming: false,
  student: null,
  roleCard: null,
  roles: [],
  clues: [],
  quota: null,
  silenced: false,
  myQuestion: '',
  brief: null,
  snapshot: null,
  window: WINDOW_STATE.OPEN,
  phase: PHASE.CASTING,
  voteMeta: null,
  myVotes: { accuse: null, qualify: null, dispose: null },
  draftVote: {},
  reveal: null,
  submittingVote: false,
  draftRoleId: null,
  submitting: false,
});

let toastTimer = 0;
let lastWindow = null;

function toast(message, duration = 2600) {
  toastEl.textContent = message;
  toastEl.dataset.open = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.dataset.open = 'false';
  }, duration);
}

function context() {
  return {
    get student() {
      return state.get().student;
    },
    get roleCard() {
      return state.get().roleCard;
    },
    get token() {
      return state.get().token;
    },
    get roles() {
      return state.get().roles;
    },
    get brief() {
      return state.get().brief;
    },
    get snapshot() {
      return state.get().snapshot;
    },
    get window() {
      return state.get().window;
    },
    get phase() {
      return state.get().phase;
    },
    get voteMeta() {
      return state.get().voteMeta;
    },
    get myVotes() {
      return state.get().myVotes;
    },
    get draftVote() {
      return state.get().draftVote;
    },
    get reveal() {
      return state.get().reveal;
    },
    get votes() {
      return state.get().snapshot?.votes ?? null;
    },
    get clues() {
      return state.get().clues;
    },
    get quota() {
      return state.get().quota;
    },
    get silenced() {
      return state.get().silenced;
    },
    get myQuestion() {
      return state.get().myQuestion;
    },
    get claimError() {
      return state.get().claimError;
    },
    get claiming() {
      return state.get().claiming;
    },
    enter,
    retryEnroll,
    go,
    pick,
    confirm,
    cancel,
    switchRole,
    revealClue,
    askQuestion,
    setDraft,
    submitVote: castVote,
    toast,
  };
}

function render() {
  const current = state.get();
  const ctx = context();
  const module = MODULES[current.stage] ?? MODULES[STAGE.IDENTITY];
  stageRoot.dataset.stage = current.stage;
  stageRoot.innerHTML = module.render(current, ctx);
  module.bind?.(stageRoot, current, ctx);
  renderActionbar(current, ctx);
  topbar(current);
}

function topbar(current) {
  const joined = current.snapshot?.joined ?? 0;
  const total = current.snapshot?.total ?? 40;
  progressEl.textContent = joined === 0 ? `已归组 --／${total}` : `已归组 ${joined}／${total}`;
  const window = current.snapshot?.window ?? current.window;
  windowEl.textContent = WINDOW_TEXT[window] ?? '开放';
  windowEl.dataset.state = window;
}

function renderActionbar(current, ctx) {
  const actions = actionbarActions(current);
  actionbar.hidden = actions.length === 0;
  actionbar.innerHTML = actions
    .map(
      (action) =>
        `<button class="btn ${action.variant}" data-action="${action.id}"${action.disabled ? ' disabled' : ''}>${action.label}</button>`,
    )
    .join('');
}

function clueLabel(current) {
  const held = (current.clues ?? []).filter((item) => item.holder && item.status === 'held').length;
  return held > 0 ? `线索册 · ${held} 张待定` : '线索册';
}

function actionbarActions(current) {
  switch (current.stage) {
    case STAGE.PROLOGUE:
      return [{ id: 'to-brief', label: '开始说明情况', variant: 'btn--primary' }];
    case STAGE.BRIEF:
      return [
        { id: 'skip-brief', label: '跳过简报', variant: 'btn--ghost' },
        { id: 'to-wall', label: '我知道我是谁了', variant: 'btn--primary' },
      ];
    case STAGE.RESULT:
      return [
        { id: 'open-status', label: '看全员战况', variant: 'btn--ghost' },
        { id: 'to-clues', label: clueLabel(current), variant: 'btn--ghost' },
        { id: 'to-profile', label: '我的角色卡', variant: 'btn--primary' },
      ];
    case STAGE.PROFILE:
      return [
        { id: 'to-clues', label: clueLabel(current), variant: 'btn--ghost' },
        { id: 'back-result', label: '返回归组结果', variant: 'btn--ghost' },
      ];
    case STAGE.CLUES:
      return [{ id: 'back-result', label: '返回归组结果', variant: 'btn--ghost' }];
    case STAGE.VOTE: {
      const ready =
        current.phase === PHASE.VOTE2
          ? Boolean(current.draftVote?.dispose)
          : Boolean(current.draftVote?.accuse && current.draftVote?.qualify);
      const label =
        current.phase === PHASE.VOTE2
          ? current.myVotes?.dispose
            ? '提交改票'
            : '提交处置票'
          : current.myVotes?.accuse
            ? '提交改票'
            : '提交两票';
      return [{ id: 'submit-vote', label: current.submittingVote ? '正在提交…' : label, variant: 'btn--primary', disabled: !ready || current.submittingVote }];
    }
    default:
      return [];
  }
}

function stageForPhase(phase) {
  if (phase === PHASE.INTERROGATE) return STAGE.INTERROGATE;
  if (phase === PHASE.CONFRONT) return STAGE.CLUES;
  if (phase === PHASE.VOTE1 || phase === PHASE.VOTE2) return STAGE.VOTE;
  if (phase === PHASE.REVEAL) return STAGE.REVEAL;
  if (phase === PHASE.ENDING) return STAGE.ENDING;
  return null;
}

function setDraft(patch) {
  state.set((current) => ({ ...current, draftVote: { ...current.draftVote, ...patch } }));
  renderActionbar(state.get(), context());
}

async function castVote() {
  const current = state.get();
  if (current.submittingVote) return;

  const isDispose = current.phase === PHASE.VOTE2;
  const choices = isDispose
    ? { dispose: current.draftVote?.dispose }
    : { accuse: current.draftVote?.accuse, qualify: current.draftVote?.qualify };

  if (isDispose && !choices.dispose) {
    toast('请先选定处置方式');
    return;
  }
  if (!isDispose && (!choices.accuse || !choices.qualify)) {
    toast('指认票和定性票都要选');
    return;
  }

  state.set({ submittingVote: true });
  renderActionbar(state.get(), context());

  const result = await submitVote({ token: current.token, studentId: current.student.id, choices });
  state.set({ submittingVote: false });

  if (result.ok) {
    state.set({ myVotes: result.data.choices });
    render();
    toast(isDispose ? '处置票已提交，开放期间可改票' : '两票已提交，开放期间可改票');
    return;
  }

  renderActionbar(state.get(), context());
  if (result.code === 'phase_closed') {
    toast('投票已结束');
    return;
  }
  if (result.code === 'invalid_choice') {
    toast('选项不合法，请重新选择');
    return;
  }
  toast(result.message ?? '提交失败，请重试');
}

async function revealClue(clueId) {
  const current = state.get();
  if (!clueId) return;
  const result = await apiRevealClue(current.token, clueId);
  if (!result.ok) {
    toast(result.message ?? '公开失败');
    return;
  }
  await refreshClues();
  render();
  toast('这张卡已公开，全场可见');
}

async function refreshClues() {
  const token = state.get().token;
  if (!token) return;
  const result = await fetchClues(token);
  if (result?.ok) state.set({ clues: result.data });
}

async function askQuestion({ toGroupNo, text, anonymous }) {
  const current = state.get();
  const result = await apiSubmitQuestion({ token: current.token, toGroupNo, text, anonymous });
  if (!result.ok) {
    if (result.code === 'silenced') toast('本轮静默，不能发起质询');
    else if (result.code === 'phase_closed') toast('质询阶段已结束');
    else toast(result.message ?? '提交失败');
    return;
  }
  state.set({ myQuestion: String(text ?? '').trim() });
  render();
  toast('问题已提交，等待主持人挑选');
}

async function loadReveal() {
  if (state.get().reveal) return;
  const result = await fetchReveal();
  if (result?.ok) {
    state.set({ reveal: result.data });
    const stage = state.get().stage;
    if (stage === STAGE.REVEAL || stage === STAGE.ENDING) render();
  }
}

function syncPhase(snapshot) {
  const current = state.get();
  if (!current.student || !snapshot?.phase) return;
  const phase = snapshot.phase;

  if (phase === current.phase) {
    if ((phase === PHASE.REVEAL || phase === PHASE.ENDING) && !current.reveal) loadReveal();
    return;
  }

  state.set({ phase });
  refreshClues();
  const forced = stageForPhase(phase);

  if (forced) {
    if (current.stage !== forced) {
      state.set({ stage: forced });
      if (phase === PHASE.VOTE1) state.set({ draftVote: { ...current.myVotes } });
      render();
    }
    if (phase === PHASE.REVEAL || phase === PHASE.ENDING) loadReveal();
    return;
  }

  if ([STAGE.INTERROGATE, STAGE.VOTE, STAGE.REVEAL, STAGE.ENDING].includes(current.stage)) {
    state.set({ stage: current.student.roleId ? STAGE.RESULT : STAGE.WALL });
    render();
  }
}

function go(stage) {
  const current = state.get();
  if (!canEnter(stage, current)) {
    toast('请先完成上一项选择');
    return;
  }
  state.set({ stage });
  render();
}

async function autoEnroll() {
  const current = state.get();
  if (current.claiming) return;

  state.set({ claiming: true, claimError: null });
  render();

  const result = await enroll(readDeviceId());
  if (!result.ok) {
    const messages = {
      class_full: '40 个名额已分配完，请联系主持人释放',
      invalid_request: '设备标识异常，请刷新页面',
    };
    state.set({ claiming: false, claimError: messages[result.code] ?? result.message ?? '进入失败，请刷新重试' });
    render();
    return;
  }

  saveToken(result.data.token);
  state.set({ claiming: false, claimError: null });
  await enter(result.data.token);
}

async function retryEnroll() {
  await autoEnroll();
}

async function boot() {
  const stored = readToken();
  if (stored) {
    const result = await bootstrap(stored);
    if (result.ok) {
      await enter(stored);
      return;
    }
    clearToken();
  }
  await autoEnroll();
}

async function enter(token) {
  if (!token) {
    toast('请输入进入凭证');
    return;
  }
  const result = await bootstrap(token);
  if (!result.ok) {
    toast(result.message ?? '凭证无效，请重新扫码');
    return;
  }
  saveToken(token);
  const { student, roleCard, roles, brief, clues, window, phase, phaseLabel, quota, silenced, statementIndex, voteMeta, myVotes } =
    result.data;
  const votes = myVotes ?? { accuse: null, qualify: null, dispose: null };
  state.set({
    token,
    student,
    roleCard: roleCard ?? null,
    roles,
    clues: clues ?? [],
    quota: quota ?? null,
    silenced: Boolean(silenced),
    brief,
    window,
    phase: phase ?? PHASE.CASTING,
    voteMeta: voteMeta ?? null,
    myVotes: votes,
    draftVote: { accuse: votes.accuse, qualify: votes.qualify, dispose: votes.dispose },
    statementIndex: statementIndex ?? 0,
    phaseLabel: phaseLabel ?? PHASE_LABEL[PHASE.CASTING],
  });
  const forced = stageForPhase(phase ?? PHASE.CASTING);
  if (forced) {
    state.set({ stage: forced });
    render();
    loadReveal();
  } else if (student.roleId) {
    toast(`你已经加入第 ${student.roleNo} 组`, 3200);
    go(STAGE.RESULT);
  } else {
    go(STAGE.PROLOGUE);
  }
  refreshSnapshot();
}

function pick(roleId) {
  const current = state.get();
  if (current.window === WINDOW_STATE.LOCKED) {
    toast('选角已结束，当前仅可查看');
    return;
  }
  const role = current.roles.find((item) => item.id === roleId);
  if (!role) return;
  if (role.full) {
    toast(`该角色已满员。${suggestion(roleId)}`, 4200);
    return;
  }
  state.set({ draftRoleId: roleId });
  go(STAGE.CONFIRM);
}

function suggestion(roleId) {
  const target = pickAlternative(state.get().roles, roleId);
  return target ? `隔壁${target.name}还剩 ${target.remaining} 个位。` : '所有角色已满，请联系主持人。';
}

async function confirm() {
  const current = state.get();
  if (current.submitting || !current.draftRoleId) return;
  state.set({ submitting: true });
  render();

  const targetRoleId = current.draftRoleId;
  const result = await submitAssignment({
    token: current.token,
    studentId: current.student.id,
    roleId: targetRoleId,
  });

  if (result.ok) {
    const switched = result.data.mode === 'switch';
    state.set({
      student: result.data.student,
      roleCard: result.data.role ?? null,
      submitting: false,
      draftRoleId: null,
    });
    render();
    toast(switched ? `已移到第 ${result.data.student.roleNo} 组` : '登记完成，角色卡已生成', 3000);
    refreshClues();
    refreshSnapshot();
    return;
  }

  state.set({ submitting: false });
  handleFailure(result, targetRoleId);
}

function handleFailure(result, targetRoleId) {
  const current = state.get();
  const hasRole = Boolean(current.student?.roleId);

  if (result.code === 'role_full') {
    toast(`刚好满员，你慢了半秒。${suggestion(targetRoleId)}`, 4800);
    go(hasRole ? STAGE.RESULT : STAGE.WALL);
    refreshSnapshot();
    return;
  }

  if (result.code === 'window_locked') {
    toast('选角已结束，当前仅可查看');
    go(hasRole ? STAGE.RESULT : STAGE.WALL);
    refreshSnapshot();
    return;
  }

  if (result.code === 'switch_limit') {
    toast('改选已达上限，仍在原组');
    go(STAGE.RESULT);
    return;
  }

  if (result.code === 'identity_invalid') {
    clearToken();
    state.set({ student: null, stage: STAGE.IDENTITY });
    render();
    toast('凭证失效，请重新扫码');
    return;
  }

  if (result.code === 'network_error' || result.code === 'offline') {
    toast('网络不稳，恢复后自动提交', 4000);
    go(hasRole ? STAGE.RESULT : STAGE.WALL);
    return;
  }

  toast(result.message ?? '提交失败，请再试一次', 3600);
  go(hasRole ? STAGE.RESULT : STAGE.WALL);
}

function cancel() {
  go(STAGE.WALL);
}

function switchRole() {
  const current = state.get();
  if (current.window === WINDOW_STATE.LOCKED) {
    toast('选角已结束，无法改选');
    return;
  }
  if ((current.student?.switches ?? 0) >= (current.student?.switchLimit ?? 2)) {
    toast('改选已达上限');
    return;
  }
  state.set({ draftRoleId: null });
  go(STAGE.WALL);
  toast('选中新角色后，确认层会写明从哪到哪', 3600);
}

async function refreshSnapshot() {
  if (!state.get().token) return;
  const result = await fetchSnapshot();
  if (result?.ok) applySnapshot(result.data);
}

function applySnapshot(snapshot) {
  if (!snapshot?.roles) return;
  const current = state.get();
  const groupNo = current.student?.roleNo;
  state.set({
    snapshot,
    window: snapshot.window,
    quota: groupNo ? snapshot.quotas?.[groupNo] ?? null : null,
    silenced: groupNo ? (snapshot.silencedGroups ?? []).includes(groupNo) : false,
  });
  syncPhase(snapshot);
  const previousClues = current.snapshot?.clues;
  const nextClues = snapshot.clues;
  if (
    nextClues &&
    (!previousClues || previousClues.publicCount !== nextClues.publicCount || previousClues.heldCount !== nextClues.heldCount)
  ) {
    refreshClues();
  }
  topbar(state.get());
  for (const role of snapshot.roles) {
    const counter = stageRoot.querySelector(`[data-count="${role.id}"]`);
    if (counter) counter.textContent = `${role.occupied}／${role.capacity}`;
    const card = stageRoot.querySelector(`.rolecard[data-role="${role.id}"]`);
    if (!card) continue;
    card.classList.toggle('is-full', role.full);
    const pickButton = card.querySelector('[data-act="pick"]');
    if (pickButton) {
      pickButton.dataset.full = String(role.full);
      pickButton.setAttribute('aria-disabled', String(role.full));
      pickButton.textContent = role.full ? '已满 7／7' : '就是他';
    }
    const stateLabel = card.querySelector('.rolecard__state');
    if (stateLabel) stateLabel.textContent = role.full ? '已满' : role.remaining <= 2 ? '将满' : '可选';
  }
  const previousWindow = lastWindow;
  lastWindow = snapshot.window;
  if (
    snapshot.window === WINDOW_STATE.LOCKED &&
    previousWindow !== WINDOW_STATE.LOCKED &&
    state.get().student?.roleId
  ) {
    toast('选角已结束', 2400);
  }
}

function openStatusDrawer() {
  const snapshot = state.get().snapshot;
  if (!snapshot) {
    toast('战况尚未同步');
    return;
  }
  const drawer = document.createElement('div');
  drawer.className = 'drawer';
  drawer.innerHTML = `
    <div class="drawer__panel" role="dialog" aria-modal="true" aria-label="全员战况">
      <header class="drawer__head">
        <p class="eyebrow">全员战况</p>
        <button class="btn btn--ghost" data-close>收起</button>
      </header>
      <p class="drawer__total mono">已归组 ${snapshot.joined}／${snapshot.total}，还有 ${snapshot.remaining} 人未选</p>
      <ul class="drawer__bars">
        ${snapshot.roles
          .map(
            (role) => `
          <li class="bar">
            <span class="bar__name">${esc(role.name)}</span>
            <span class="bar__track"><span class="bar__fill" style="width:${Math.round((role.occupied / role.capacity) * 100)}%"></span></span>
            <span class="bar__num mono">${role.occupied}／${role.capacity}</span>
          </li>`,
          )
          .join('')}
      </ul>
      <p class="faint">人数每 500 毫秒合并推送一次，数值以服务端为准。</p>
    </div>`;
  document.body.append(drawer);
  requestAnimationFrame(() => {
    drawer.dataset.open = 'true';
  });
  const close = () => {
    drawer.dataset.open = 'false';
    setTimeout(() => drawer.remove(), 220);
  };
  drawer.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]') || event.target === drawer) close();
  });
}

actionbar.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  if (action === 'to-brief') go(STAGE.BRIEF);
  if (action === 'skip-brief') {
    toast('六个人，一封匿名信，你是其中之一。', 3600);
    go(STAGE.WALL);
  }
  if (action === 'to-wall') go(STAGE.WALL);
  if (action === 'to-profile') go(STAGE.PROFILE);
  if (action === 'to-clues') go(STAGE.CLUES);
  if (action === 'back-result') go(STAGE.RESULT);
  if (action === 'open-status') openStatusDrawer();
  if (action === 'submit-vote') castVote();
});

subscribeStream({
  onSnapshot: (snapshot) => {
    if (state.get().stage === STAGE.IDENTITY) {
      state.set({ snapshot, window: snapshot.window, roles: snapshot.roles });
      topbar(state.get());
      return;
    }
    applySnapshot(snapshot);
  },
  onStatus: (status) => {
    const stale = status === 'reconnecting' || status === 'polling' || status === 'unsupported';
    progressEl.dataset.stale = String(stale);
    progressEl.title =
      status === 'polling'
        ? '已切换为轮询同步'
        : status === 'reconnecting'
          ? '数据可能延迟'
          : status === 'unsupported'
            ? '浏览器不支持实时推送，使用轮询'
            : '';
  },
});

window.addEventListener('online', async () => {
  const result = await flushPending();
  if (result?.ok) {
    state.set({ student: result.data.student });
    render();
    toast('网络已恢复，选择已提交');
    refreshSnapshot();
  }
});


boot();