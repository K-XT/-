import {
  adminAutofill,
  adminClueForce,
  adminClueRelease,
  adminInterrogation,
  adminLogin,
  adminMove,
  adminPhase,
  adminQuestion,
  adminRebalance,
  adminReleaseDevice,
  adminRepair,
  adminSilence,
  adminSilenceRevoke,
  adminSpokesman,
  adminState,
  adminStatement,
  adminWindow,
  clearGmToken,
  fetchLog,
  readGmToken,
  saveGmToken,
} from './api.js';

const WINDOW_TEXT = { open: '开放', closing: '将锁', locked: '已锁', makeup: '补录' };
const WINDOW_ORDER = ['open', 'closing', 'locked', 'makeup'];
const WINDOW_HINT = {
  open: '全功能可用，学生可选角与改选。',
  closing: '距锁定不足 2 分钟，学生端显示「选角即将结束」横幅。',
  locked: '学生端只读，所有写入口失效；仅控制台可调剂。',
  makeup: '锁定后由 GM 操作，学生端显示「由主持人调整」。',
};
const PHASE_TEXT = {
  casting: '选角',
  statement: '陈述',
  interrogate: '质询',
  confront: '对质',
  vote1: '投票一',
  reveal: '揭晓',
  vote2: '投票二',
  ending: '结局',
};
const PHASE_ORDER = ['casting', 'statement', 'interrogate', 'confront', 'vote1', 'reveal', 'vote2', 'ending'];
const PHASE_HINT = {
  casting: '开场选角阶段，学生端为角色墙与归组页；此处发放第 1 轮线索。',
  statement: '六组按 01→06 顺序陈述，每组 1 分钟；学生端只读提示。',
  interrogate: '口头质询为主、文字质询为辅；每组本轮 1 次机会。',
  confront: '三组互质；进入本阶段自动强制公开 L8，并发放第 3 轮线索。',
  vote1: '指认票与定性票同时开放，学生端自动切到投票页。',
  reveal: '公布指认与定性分布、正确答案、责任链与揭晓稿。',
  vote2: '处置票开放，决定最终结局。',
  ending: '按处置票最高项公布结局；平票按「撤回重做」优先。',
};
const ACTION_TEXT = {
  set_window: '切换窗口',
  move: '手动调剂',
  rebalance: '一键调剂',
  repair_counters: '重算计数',
  autofill: '一键补齐',
  set_phase: '切换阶段',
  release_round: '发放线索',
  clue_volunteer: '交卡',
  clue_forced: '强制公开',
  interrogation: '质询',
  silence: '静默',
  silence_revoke: '撤销静默',
  statement_index: '陈述推进',
  spokesman: '录入发言人',
  question_mark: '质询队列',
};

const gate = document.getElementById('gate');
const gateForm = document.getElementById('gate-form');
const gateError = document.getElementById('gate-error');
const consoleEl = document.getElementById('console');
const windowFlag = document.getElementById('window-flag');
const progressEl = document.getElementById('progress');
const windowActions = document.getElementById('window-actions');
const windowHint = document.getElementById('window-hint');
const phaseActions = document.getElementById('phase-actions');
const phaseHint = document.getElementById('phase-hint');
const voteStatus = document.getElementById('vote-status');
const votecounts = document.getElementById('votecounts');
const distribution = document.getElementById('distribution');
const reconcileFlag = document.getElementById('reconcile-flag');
const repairBtn = document.getElementById('repair-btn');
const autofillBtn = document.getElementById('autofill-btn');
const autofillHint = document.getElementById('autofill-hint');
const rebalanceBtn = document.getElementById('rebalance-btn');
const rebalanceHint = document.getElementById('rebalance-hint');
const moveForm = document.getElementById('move-form');
const moveStudent = document.getElementById('move-student');
const moveTarget = document.getElementById('move-target');
const moveHint = document.getElementById('move-hint');
const unselectedEl = document.getElementById('unselected');
const unselectedCount = document.getElementById('unselected-count');
const auditEl = document.getElementById('audit');
const logoutBtn = document.getElementById('logout-btn');
const exportBtn = document.getElementById('export-btn');
const clueStatus = document.getElementById('clue-status');
const clueActions = document.getElementById('clue-actions');
const clueHint = document.getElementById('clue-hint');
const clueWarning = document.getElementById('clue-warning');
const forceL8Btn = document.getElementById('force-l8');
const statementNow = document.getElementById('statement-now');
const statementNext = document.getElementById('statement-next');
const spokesmanGroup = document.getElementById('spokesman-group');
const spokesmanStudent = document.getElementById('spokesman-student');
const spokesmanSave = document.getElementById('spokesman-save');
const interrogateFrom = document.getElementById('interrogate-from');
const interrogateTo = document.getElementById('interrogate-to');
const interrogateAnswer = document.getElementById('interrogate-answer');
const interrogateSave = document.getElementById('interrogate-save');
const silenceGroup = document.getElementById('silence-group');
const silenceReason = document.getElementById('silence-reason');
const silenceApply = document.getElementById('silence-apply');
const silenceList = document.getElementById('silence-list');
const questionQueue = document.getElementById('question-queue');

let gm = readGmToken();
let timer = 0;
let inFlight = false;
let latest = null;

const timeOf = (iso) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '--:--:--' : date.toLocaleTimeString('zh-CN', { hour12: false });
};

const escText = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

function renderWindow(snapshot) {
  windowFlag.textContent = WINDOW_TEXT[snapshot.window] ?? '开放';
  windowFlag.dataset.state = snapshot.window;
  progressEl.textContent = `已归组 ${snapshot.joined}／${snapshot.total} · 未选 ${snapshot.remaining}`;
  windowActions.innerHTML = WINDOW_ORDER.map(
    (key) =>
      `<button class="segmented__btn${snapshot.window === key ? ' is-active' : ''}" data-window="${key}" type="button">${WINDOW_TEXT[key]}</button>`,
  ).join('');
  windowHint.textContent = WINDOW_HINT[snapshot.window] ?? '';
}

function renderDistribution(snapshot) {
  distribution.innerHTML = snapshot.roles
    .map((role) => {
      const low = role.occupied > 0 && role.occupied < 5;
      const label = role.full ? '已满' : low ? '缺人' : role.occupied === 0 ? '空组' : '正常';
      const cls = [role.full ? 'is-full' : '', low ? 'is-low' : ''].filter(Boolean).join(' ');
      return `
      <tr class="${cls}">
        <td class="mono">第 ${role.no} 组</td>
        <td>${role.name}<span class="table__sub">${role.title}</span></td>
        <td class="mono">${role.occupied}／${role.capacity}</td>
        <td class="mono">${role.remaining}</td>
        <td>${label}</td>
      </tr>`;
    })
    .join('');
}

function renderReconcile(reconcile) {
  if (reconcile.ok) {
    reconcileFlag.textContent = '计数一致';
    reconcileFlag.dataset.state = 'ok';
    reconcileFlag.title = `对账时间 ${timeOf(reconcile.checkedAt)}`;
    return;
  }
  reconcileFlag.textContent = `漂移 ${reconcile.drift.length} 处`;
  reconcileFlag.dataset.state = 'drift';
  reconcileFlag.title = reconcile.drift
    .map((item) => `${item.roleName}: 计数 ${item.counter} / 实际 ${item.actual}`)
    .join('；');
}

function renderSelects(data) {
  const keepStudent = moveStudent.value;
  const keepTarget = moveTarget.value;
  moveStudent.innerHTML = data.roster
    .map(
      (student) =>
        `<option value="${student.id}">${student.roleName ? `第 ${student.roleNo} 组` : '未选'} · ${student.name}（${student.no}）</option>`,
    )
    .join('');
  moveTarget.innerHTML = data.roles
    .map(
      (role) =>
        `<option value="${role.id}"${role.full ? ' disabled' : ''}>第 ${role.no} 组 · ${role.name}${role.full ? '（已满）' : ''}</option>`,
    )
    .join('');
  if (keepStudent) moveStudent.value = keepStudent;
  if (keepTarget) moveTarget.value = keepTarget;
}

function renderUnselected(list) {
  unselectedCount.textContent = `${list.length} 人`;
  if (list.length === 0) {
    unselectedEl.innerHTML = '<li class="people__empty">全班已归组</li>';
    return;
  }
  unselectedEl.innerHTML = list
    .map(
      (student) => `<li class="people__item">${student.name}<span>${student.no}</span>${
        student.deviceBound
          ? `<button class="btn btn--ghost people__action" data-release="${student.id}" type="button">释放登录</button>`
          : ''
      }</li>`,
    )
    .join('');
}

function renderAudit(list) {
  if (!list || list.length === 0) {
    auditEl.innerHTML = '<li class="log__empty">暂无操作</li>';
    return;
  }
  auditEl.innerHTML = list
    .slice()
    .reverse()
    .slice(0, 20)
    .map((item) => {
      const label = ACTION_TEXT[item.action] ?? item.action;
      const detail =
        item.action === 'set_window'
          ? `${WINDOW_TEXT[item.from] ?? item.from} → ${WINDOW_TEXT[item.to] ?? item.to}`
          : item.action === 'set_phase'
            ? `${PHASE_TEXT[item.from] ?? item.from} → ${PHASE_TEXT[item.to] ?? item.to}`
            : item.action === 'move'
              ? `${item.studentId}：${item.from ?? '未选'} → ${item.to}`
              : item.action === 'autofill'
                ? `补齐 ${item.count ?? 0} 人`
                : item.action === 'rebalance'
                  ? `调剂 ${item.count ?? 0} 人`
                  : item.drift
                  ? `修正 ${item.drift.length} 处`
                  : '';
      return `<li class="log__item"><span class="log__time mono">${timeOf(item.at)}</span><span>${label}${detail ? ` · ${detail}` : ''}</span></li>`;
    })
    .join('');
}

function renderPhase(data) {
  const phase = data.phase ?? 'casting';
  phaseActions.innerHTML = PHASE_ORDER.map(
    (key) =>
      `<button class="segmented__btn${phase === key ? ' is-active' : ''}" data-phase="${key}" type="button">${PHASE_TEXT[key]}</button>`,
  ).join('');
  phaseHint.textContent = PHASE_HINT[phase] ?? '';
}

function renderVotes(data) {
  const votes = data.votes ?? { cast1: 0, cast2: 0, accuse: {}, qualify: {}, dispose: {} };
  const phase = data.phase ?? 'casting';
  const roles = data.snapshot?.roles ?? [];

  if (phase === 'casting') {
    voteStatus.textContent = '未开始';
    votecounts.innerHTML = '<p class="panel__hint faint">进入投票阶段后开始计数。</p>';
    return;
  }

  voteStatus.textContent = `指认 ${votes.cast1} · 处置 ${votes.cast2}`;

  const accuseRows = roles
    .map((role) => `<li class="votecount"><span>${role.name}</span><span class="mono">${votes.accuse?.[role.id] ?? 0}</span></li>`)
    .join('');
  const qualifyRows = ['A', 'B', 'C']
    .map((key) => `<li class="votecount"><span>定性 ${key}</span><span class="mono">${votes.qualify?.[key] ?? 0}</span></li>`)
    .join('');
  const disposeRows = ['e1', 'e2', 'e3', 'e4']
    .map((key) => `<li class="votecount"><span>处置 ${key}</span><span class="mono">${votes.dispose?.[key] ?? 0}</span></li>`)
    .join('');

  votecounts.innerHTML = `
    <div class="votecounts__group"><p class="eyebrow">指认票</p><ul class="votecounts__list">${accuseRows}</ul></div>
    <div class="votecounts__group"><p class="eyebrow">定性票</p><ul class="votecounts__list">${qualifyRows}</ul></div>
    <div class="votecounts__group"><p class="eyebrow">处置票</p><ul class="votecounts__list">${disposeRows}</ul></div>
    <p class="panel__hint faint">揭晓前只在控制台可见，学生端与大屏不显示分布。</p>`;
}

function renderClues(data) {
  const clues = data.clues ?? { items: [], publicCount: 0, heldCount: 0, total: 9 };
  const items = clues.items ?? [];
  const released = items.filter((item) => item.status !== 'hidden');
  clueStatus.textContent = `公开 ${clues.publicCount} · 定向 ${clues.heldCount}`;
  clueHint.textContent = released.length === 0 ? '还没有发放线索。' : `已发放 ${released.length}／${clues.total} 张。`;

  const missing = ['L6', 'L7', 'L9'].filter((id) => {
    const item = items.find((entry) => entry.id === id);
    return item && item.status !== 'public';
  });
  clueWarning.hidden = missing.length === 0;
  clueWarning.textContent =
    missing.length === 0 ? '' : `缺卡预警：${missing.join('、')} 未公开，谜题可能无法完整定性；可进入对质后提请提交材料。`;

  statementNow.textContent = `第 ${data.statementIndex ?? 0} 组`;
}

let stageSelectSig = '';

function renderStageSelects(data) {
  const roles = data.snapshot?.roles ?? [];
  const sig = roles.map((role) => `${role.no}:${role.occupied}`).join('|');
  if (sig !== stageSelectSig) {
    stageSelectSig = sig;
    const options = roles.map((role) => `<option value="${role.no}">第 ${role.no} 组 · ${role.name}</option>`).join('');
    for (const select of [spokesmanGroup, interrogateFrom, interrogateTo, silenceGroup]) {
      if (!select) continue;
      const keep = select.value;
      select.innerHTML = options;
      if (keep) select.value = keep;
    }
  }

  const groupNo = Number(spokesmanGroup.value || 1);
  const members = (data.roster ?? []).filter((student) => student.roleNo === groupNo);
  if (members.length > 0) {
    const sigStudents = members.map((student) => student.id).join('|');
    if (spokesmanStudent.dataset.sig !== sigStudents) {
      spokesmanStudent.dataset.sig = sigStudents;
      const keepStudent = spokesmanStudent.value;
      spokesmanStudent.innerHTML = members
        .map((student) => `<option value="${student.id}">${student.name}（${student.no}）</option>`)
        .join('');
      if (keepStudent) spokesmanStudent.value = keepStudent;
    }
  }
}

function renderSilence(data) {
  const active = (data.penalties ?? []).filter((item) => !item.revoked);
  silenceList.innerHTML =
    active.length === 0
      ? '<li class="silencelist__empty faint">暂无静默</li>'
      : active
          .map(
            (item) => `<li class="silencelist__item">
              <span>第 ${item.groupNo} 组</span>
              <span class="faint">${escText(item.reason || '未填原因')}</span>
              <button class="btn btn--ghost" data-revoke="${item.id}" type="button">撤销</button>
            </li>`,
          )
          .join('');
}

function renderQuestions(data) {
  const queue = (data.questionQueue ?? []).filter((item) => item.status === 'pending');
  questionQueue.innerHTML =
    queue.length === 0
      ? '<li class="questionlist__empty faint">暂无待选问题</li>'
      : queue
          .map(
            (item) => `<li class="questionlist__item">
              <span class="mono">${item.anonymous ? '匿名' : `第 ${item.groupNo} 组`} → 第 ${item.toGroupNo} 组</span>
              <span>${escText(item.text)}</span>
              <span class="questionlist__actions">
                <button class="btn btn--ghost" data-question="${item.id}" data-status="shown" type="button">上屏</button>
                <button class="btn btn--ghost" data-question="${item.id}" data-status="rejected" type="button">跳过</button>
              </span>
            </li>`,
          )
          .join('');
}

function render(data) {
  latest = data;
  renderWindow(data.snapshot);
  renderPhase(data);
  renderClues(data);
  renderStageSelects(data);
  renderSilence(data);
  renderQuestions(data);
  renderVotes(data);
  renderDistribution(data.snapshot);
  renderReconcile(data.reconcile);
  renderSelects(data);
  renderUnselected(data.unselected);
  renderAudit(data.audit);
}

async function refresh() {
  if (!gm || inFlight) return;
  inFlight = true;
  const result = await adminState(gm);
  inFlight = false;
  if (!result.ok) {
    if (result.code === 'gm_unauthorized') {
      clearGmToken();
      gm = '';
      stop();
      enterGate('口令已失效，请重新输入');
      return;
    }
    gateError.textContent = result.message ?? '无法连接服务';
    return;
  }
  gate.hidden = true;
  consoleEl.hidden = false;
  gateError.textContent = '';
  render(result.data);
}

function start() {
  stop();
  refresh();
  timer = setInterval(refresh, 3000);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = 0;
}

function enterGate(message = '') {
  gate.hidden = false;
  consoleEl.hidden = true;
  gateError.textContent = message;
}

gateForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const passcode = new FormData(gateForm).get('passcode');
  const result = await adminLogin(String(passcode ?? '').trim());
  if (!result.ok) {
    gateError.textContent = result.message ?? '口令错误';
    return;
  }
  gm = result.data.session;
  saveGmToken(gm);
  start();
});

windowActions.addEventListener('click', async (event) => {
  const next = event.target.closest('[data-window]')?.dataset.window;
  if (!next) return;
  const result = await adminWindow(gm, next);
  if (!result.ok) {
    windowHint.textContent = result.message ?? '切换失败';
    return;
  }
  refresh();
});

let phaseArmed = null;
let phaseTimer = 0;

function disarmPhase() {
  phaseArmed = null;
  clearTimeout(phaseTimer);
  for (const item of phaseActions.querySelectorAll('[data-phase]')) {
    item.textContent = PHASE_TEXT[item.dataset.phase] ?? item.textContent;
  }
}

phaseActions.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-phase]');
  if (!button) return;
  const next = button.dataset.phase;
  if (latest?.phase === next) return;

  if (phaseArmed !== next) {
    disarmPhase();
    phaseArmed = next;
    button.textContent = `确认切到${PHASE_TEXT[next]}？`;
    phaseHint.textContent = '6 秒内再点一次生效。';
    phaseTimer = setTimeout(disarmPhase, 6000);
    return;
  }

  disarmPhase();
  const result = await adminPhase(gm, next);
  if (!result.ok) {
    phaseHint.textContent = `切换失败：${result.message ?? result.code}`;
    return;
  }
  phaseHint.textContent = `已切到「${PHASE_TEXT[next]}」`;
  refresh();
});

moveForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const studentId = moveStudent.value;
  const toRoleId = moveTarget.value;
  if (!studentId || !toRoleId) return;
  const student = moveStudent.selectedOptions[0]?.textContent ?? '';
  const result = await adminMove(gm, studentId, toRoleId);
  if (!result.ok) {
    moveHint.textContent = `调剂失败：${result.message ?? result.code}`;
    return;
  }
  moveHint.textContent = `已调剂 ${student}`;
  refresh();
});

repairBtn.addEventListener('click', async () => {
  const result = await adminRepair(gm);
  if (!result.ok) {
    reconcileFlag.textContent = '重算失败';
    reconcileFlag.dataset.state = 'drift';
    return;
  }
  refresh();
});

let autofillArmed = false;
let autofillTimer = 0;

function disarmAutofill() {
  autofillArmed = false;
  clearTimeout(autofillTimer);
  autofillBtn.textContent = '一键补齐六组';
  autofillBtn.dataset.armed = 'false';
}

autofillBtn.addEventListener('click', async () => {
  const pending = latest?.unselected?.length ?? 0;
  if (pending === 0) {
    autofillHint.textContent = '全班已归组，无需补齐。';
    return;
  }
  if (!autofillArmed) {
    autofillArmed = true;
    autofillBtn.textContent = `确认补齐 ${pending} 人？`;
    autofillBtn.dataset.armed = 'true';
    autofillHint.textContent = '会按「人少的组优先」均分，不占用学生改选次数。6 秒内再点一次生效。';
    clearTimeout(autofillTimer);
    autofillTimer = setTimeout(disarmAutofill, 6000);
    return;
  }
  disarmAutofill();
  const result = await adminAutofill(gm);
  if (!result.ok) {
    autofillHint.textContent = `补齐失败：${result.message ?? result.code}`;
    return;
  }
  autofillHint.textContent = `已补齐 ${result.data.filled} 人`;
  refresh();
});

function rebalancePlan(counts) {
  if (counts.length === 0) return 0;
  const sorted = counts.slice().sort((a, b) => b - a);
  let moved = 0;
  let guard = 0;
  while (sorted[0] - sorted[sorted.length - 1] >= 2 && guard < 100) {
    guard += 1;
    sorted[0] -= 1;
    sorted[sorted.length - 1] += 1;
    sorted.sort((a, b) => b - a);
    moved += 1;
  }
  return moved;
}

let rebalanceArmed = false;
let rebalanceTimer = 0;

function disarmRebalance() {
  rebalanceArmed = false;
  clearTimeout(rebalanceTimer);
  rebalanceBtn.textContent = '一键调剂';
  rebalanceBtn.dataset.armed = 'false';
}

rebalanceBtn.addEventListener('click', async () => {
  const roles = latest?.snapshot?.roles ?? [];
  const counts = roles.map((role) => role.occupied);
  const plan = rebalancePlan(counts);

  if (plan === 0) {
    rebalanceHint.textContent = counts.every((count) => count === 0)
      ? '还没有人归组，先用一键补齐六组。'
      : '当前分布已均衡，无需调剂。';
    return;
  }

  if (!rebalanceArmed) {
    rebalanceArmed = true;
    rebalanceBtn.textContent = `确认调剂 ${plan} 人？`;
    rebalanceBtn.dataset.armed = 'true';
    rebalanceHint.textContent = '从人多的组调出学生到人少的组，不占用改选次数。6 秒内再点一次生效。';
    clearTimeout(rebalanceTimer);
    rebalanceTimer = setTimeout(disarmRebalance, 6000);
    return;
  }

  disarmRebalance();
  const result = await adminRebalance(gm);
  if (!result.ok) {
    rebalanceHint.textContent = `调剂失败：${result.message ?? result.code}`;
    return;
  }
  const distribution = result.data.distribution.slice().sort((a, b) => b - a).join('／');
  rebalanceHint.textContent = `已调剂 ${result.data.moved} 人，分布 ${distribution}`;
  refresh();
});

clueActions.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-round]');
  if (!button) return;
  const round = Number(button.dataset.round);
  const result = await adminClueRelease(gm, round);
  if (!result.ok) {
    clueHint.textContent = `发放失败：${result.message ?? result.code}`;
    return;
  }
  const detail = result.data.released.map((item) => `${item.id}（${item.status === 'public' ? '公开' : '定向'}）`).join('、');
  await refresh();
  clueHint.textContent = detail ? `第 ${round} 轮已发放：${detail}` : `第 ${round} 轮此前已发放，无新增。`;
});

forceL8Btn.addEventListener('click', async () => {
  const result = await adminClueForce(gm, 'L8');
  if (!result.ok) {
    clueHint.textContent = `强制公开失败：${result.message ?? result.code}`;
    return;
  }
  await refresh();
  clueHint.textContent = 'L8 已重新投影（核查小组调取记录）。';
});

statementNext.addEventListener('click', async () => {
  const current = Number(latest?.statementIndex ?? 0);
  const next = Math.min(current + 1, 6);
  const result = await adminStatement(gm, next);
  if (!result.ok) {
    clueHint.textContent = `陈述推进失败：${result.message ?? result.code}`;
    return;
  }
  refresh();
});

spokesmanGroup.addEventListener('change', () => {
  spokesmanStudent.dataset.sig = '';
  refresh();
});

spokesmanSave.addEventListener('click', async () => {
  const groupNo = Number(spokesmanGroup.value);
  const studentId = spokesmanStudent.value || null;
  const result = await adminSpokesman(gm, groupNo, studentId);
  if (!result.ok) {
    clueHint.textContent = `录入失败：${result.message ?? result.code}`;
    return;
  }
  clueHint.textContent = `第 ${groupNo} 组发言人已录入。`;
  refresh();
});

interrogateSave.addEventListener('click', async () => {
  const result = await adminInterrogation(gm, {
    fromGroupNo: Number(interrogateFrom.value),
    toGroupNo: Number(interrogateTo.value),
    answer: interrogateAnswer.value,
    channel: 'oral',
  });
  if (!result.ok) {
    clueHint.textContent = `质询记录失败：${result.message ?? result.code}`;
    return;
  }
  clueHint.textContent = `已记录一次质询，第 ${result.data.item.fromGroupNo} 组剩余机会 ${result.data.remaining} 次。`;
  refresh();
});

silenceApply.addEventListener('click', async () => {
  const groupNo = Number(silenceGroup.value);
  const reason = silenceReason.value || '';
  const result = await adminSilence(gm, groupNo, reason);
  if (!result.ok) {
    clueHint.textContent = `静默失败：${result.message ?? result.code}`;
    return;
  }
  silenceReason.value = '';
  clueHint.textContent = `第 ${groupNo} 组本轮静默。`;
  refresh();
});

silenceList.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-revoke]');
  if (!button) return;
  const result = await adminSilenceRevoke(gm, button.dataset.revoke);
  if (!result.ok) {
    clueHint.textContent = `撤销失败：${result.message ?? result.code}`;
    return;
  }
  refresh();
});

questionQueue.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-question]');
  if (!button) return;
  const result = await adminQuestion(gm, button.dataset.question, button.dataset.status);
  if (!result.ok) {
    clueHint.textContent = `队列操作失败：${result.message ?? result.code}`;
    return;
  }
  refresh();
});

unselectedEl.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-release]');
  if (!button) return;
  const result = await adminReleaseDevice(gm, button.dataset.release);
  if (!result.ok) {
    clueHint.textContent = `释放失败：${result.message ?? result.code}`;
    return;
  }
  clueHint.textContent = '已释放该姓名的登录，其他设备可以重新选择。';
  refresh();
});

exportBtn.addEventListener('click', async () => {
  const result = await fetchLog(gm);
  if (!result.ok) {
    clueHint.textContent = '导出失败';
    return;
  }
  const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `zero-submission-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
});

logoutBtn.addEventListener('click', () => {
  clearGmToken();
  gm = '';
  stop();
  enterGate('');
});

if (gm) {
  start();
} else {
  enterGate('');
}