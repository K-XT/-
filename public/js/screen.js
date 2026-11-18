import { fetchReveal, subscribeStream } from './api.js';

const phaseLabel = document.getElementById('phase-label');
const statusLine = document.getElementById('status-line');
const windowEl = document.getElementById('window-flag');
const viewCasting = document.getElementById('view-casting');
const viewStatement = document.getElementById('view-statement');
const viewInterrogate = document.getElementById('view-interrogate');
const viewConfront = document.getElementById('view-confront');
const viewVote = document.getElementById('view-vote');
const viewReveal = document.getElementById('view-reveal');
const viewEnding = document.getElementById('view-ending');
const groupsEl = document.getElementById('groups');
const tickerEl = document.getElementById('ticker');
const staleEl = document.getElementById('stale');
const voteTitle = document.getElementById('vote-title');
const voteCount = document.getElementById('vote-count');
const revealAccuse = document.getElementById('reveal-accuse');
const revealQualify = document.getElementById('reveal-qualify');
const revealAnswer = document.getElementById('reveal-answer');
const endingName = document.getElementById('ending-name');
const endingText = document.getElementById('ending-text');
const endingLine = document.getElementById('ending-line');
const statementGroup = document.getElementById('statement-group');
const statementTimer = document.getElementById('statement-timer');
const interrogateTarget = document.getElementById('interrogate-target');
const interrogateTimer = document.getElementById('interrogate-timer');
const clueboard = document.getElementById('clueboard');

const WINDOW_TEXT = { open: '开放', closing: '即将结束', locked: '已结束', makeup: '补录中' };

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

let mounted = false;
let lastTicker = '';
let revealData = null;
let revealLoading = false;
let lastSnapshot = null;
let tickTimer = 0;

const pct = (count, total) => (total ? Math.round((count / total) * 100) : 0);

const barRow = (name, count, total, correct) => `
  <li class="votebar${correct ? ' is-correct' : ''}">
    <span class="votebar__name">${esc(name)}</span>
    <span class="votebar__track"><span class="votebar__fill" style="width:${pct(count, total)}%"></span></span>
    <span class="votebar__num mono">${count}${correct ? ' · 正确' : ''}</span>
  </li>`;

function buildGroups(snapshot) {
  groupsEl.innerHTML = snapshot.roles
    .map(
      (role) => `
    <li class="group${role.full ? ' is-full' : ''}" data-role="${role.id}" data-group-no="${role.no}">
      <span class="group__no mono">0${role.no}</span>
      <span class="group__body">
        <span class="group__name serif">${esc(role.name)}</span>
        <span class="group__bar"><span class="group__fill" style="width:${pct(role.occupied, role.capacity)}%"></span></span>
      </span>
      <span class="group__count mono"><b>${role.occupied}</b><small>／${role.capacity}</small></span>
      <span class="group__flag" data-flag></span>
    </li>`,
    )
    .join('');
  mounted = true;
}

function renderCasting(snapshot) {
  if (!mounted || groupsEl.children.length !== snapshot.roles.length) buildGroups(snapshot);
  const silenced = new Set(snapshot.silencedGroups ?? []);

  snapshot.roles.forEach((role, index) => {
    const item = groupsEl.children[index];
    if (!item) return;
    item.classList.toggle('is-full', role.full);
    item.classList.toggle('is-silenced', silenced.has(role.no));
    const fill = item.querySelector('.group__fill');
    if (fill) fill.style.width = `${pct(role.occupied, role.capacity)}%`;
    const count = item.querySelector('.group__count b');
    if (count) count.textContent = String(role.occupied);
    const flag = item.querySelector('[data-flag]');
    if (flag) flag.textContent = silenced.has(role.no) ? '本轮静默' : '';
  });

  statusLine.textContent = `已归组 ${snapshot.joined}／${snapshot.total}`;

  const names = snapshot.groups.flatMap((group) => group.members.map((member) => member.name));
  const ticker = names.length ? `${names.join('　·　')}　·　${names.join('　·　')}` : '等待第一位同学归组';
  if (ticker !== lastTicker) {
    tickerEl.textContent = ticker;
    lastTicker = ticker;
  }
}

function renderStatement(snapshot) {
  const index = snapshot.statementIndex ?? 0;
  const groupNo = index >= 1 && index <= snapshot.roles.length ? index : 1;
  const role = snapshot.roles.find((item) => item.no === groupNo);
  const speaker = (snapshot.spokesman ?? []).find((item) => item.groupNo === groupNo);
  statementGroup.textContent = `第 ${groupNo} 组${role ? ` · ${role.name}` : ''}${speaker?.name ? ` · ${speaker.name}` : ''}`;
  statusLine.textContent = index === 0 ? '陈述准备' : `第 ${groupNo} 组陈述中`;
}

function renderInterrogate(snapshot) {
  const silenced = snapshot.silencedGroups ?? [];
  const pending = snapshot.pendingQuestions ?? 0;
  interrogateTarget.textContent = pending > 0 ? `待选问题 ${pending} 条` : '等待主持人点名';
  statusLine.textContent = silenced.length > 0 ? `本轮静默 ${silenced.length} 组` : '质询进行中';
}

function renderConfront(snapshot) {
  const items = snapshot.clues?.items ?? [];
  clueboard.innerHTML = items
    .map((item) => {
      if (item.status === 'hidden') {
        return `<div class="cluecard is-hidden"><span class="cluecard__no mono">${item.id}</span></div>`;
      }
      if (item.status === 'held') {
        return `
        <div class="cluecard is-held">
          <span class="cluecard__no mono">${item.id}</span>
          <span class="cluecard__name">${esc(item.name)}</span>
          <span class="cluecard__holder faint">第 ${item.holderNo} 组持有</span>
        </div>`;
      }
      const forced = item.id === 'L8';
      return `
      <div class="cluecard is-public${forced ? ' is-procedure' : ''}">
        ${forced ? '<span class="cluecard__stamp">核查小组调取</span><p class="cluecard__notice">核查小组已调取后台操作日志</p>' : ''}
        <span class="cluecard__no mono">${item.id}</span>
        <span class="cluecard__name">${esc(item.name)}</span>
        <p class="cluecard__content">${esc(item.content ?? '')}</p>
      </div>`;
    })
    .join('');
  statusLine.textContent = `公开线索 ${snapshot.clues?.publicCount ?? 0} · 定向 ${snapshot.clues?.heldCount ?? 0}`;
}

function renderVote(snapshot, phase) {
  const isDispose = phase === 'vote2';
  voteTitle.textContent = isDispose ? '处置投票' : '第一轮投票';
  const cast = isDispose ? (snapshot.votes?.cast2 ?? 0) : (snapshot.votes?.cast1 ?? 0);
  voteCount.textContent = `已投 ${cast}／${snapshot.total}`;
  statusLine.textContent = `已投 ${cast}／${snapshot.total}`;
}

function paintReveal(snapshot, data) {
  const total = snapshot.votes?.cast1 ?? 0;
  revealAccuse.innerHTML = (snapshot.roles ?? [])
    .map((role) => barRow(role.name, snapshot.votes?.accuse?.[role.id] ?? 0, total, role.id === data.accuse?.roleId))
    .join('');
  revealQualify.innerHTML = (data.qualifyOptions ?? [])
    .map((option) => barRow(option.text, snapshot.votes?.qualify?.[option.key] ?? 0, total, option.key === data.qualify?.key))
    .join('');
  revealAnswer.textContent = `正确答案：指认 ${data.accuse?.name}；定性 ${data.qualify?.key}`;
  if (data.ending) {
    endingName.textContent = data.ending.name ?? '';
    endingText.textContent = data.ending.threeMonths ?? '';
    endingLine.textContent = data.ending.line ?? '';
  }
}

async function ensureReveal() {
  if (revealData) return revealData;
  if (revealLoading) return null;
  revealLoading = true;
  const result = await fetchReveal();
  revealLoading = false;
  if (result?.ok) {
    revealData = result.data;
    if (lastSnapshot) paintReveal(lastSnapshot, revealData);
  }
  return revealData;
}

function tick() {
  const snapshot = lastSnapshot;
  if (!snapshot) return;
  if (snapshot.phase === 'statement') {
    const started = Date.parse(snapshot.statementStartedAt ?? '');
    const left = Number.isFinite(started) ? Math.max(0, 60 - Math.floor((Date.now() - started) / 1000)) : 60;
    statementTimer.textContent = String(left);
  }
  if (snapshot.phase === 'interrogate') {
    const started = Date.parse(snapshot.phaseStartedAt ?? '');
    const left = Number.isFinite(started) ? Math.max(0, 30 - Math.floor((Date.now() - started) / 1000)) : 30;
    interrogateTimer.textContent = String(left);
  }
}

function render(snapshot) {
  lastSnapshot = snapshot;
  const phase = snapshot.phase ?? 'casting';

  phaseLabel.textContent = `零号提交 · ${snapshot.phaseLabel ?? '现场战况'}`;
  windowEl.textContent = WINDOW_TEXT[snapshot.window] ?? '开放';
  windowEl.dataset.state = snapshot.window;

  viewCasting.hidden = phase !== 'casting';
  viewStatement.hidden = phase !== 'statement';
  viewInterrogate.hidden = phase !== 'interrogate';
  viewConfront.hidden = phase !== 'confront';
  viewVote.hidden = phase !== 'vote1' && phase !== 'vote2';
  viewReveal.hidden = phase !== 'reveal';
  viewEnding.hidden = phase !== 'ending';

  if (!tickTimer) tickTimer = setInterval(tick, 1000);
  tick();

  if (phase === 'casting') {
    renderCasting(snapshot);
    return;
  }
  if (phase === 'statement') {
    renderStatement(snapshot);
    return;
  }
  if (phase === 'interrogate') {
    renderInterrogate(snapshot);
    return;
  }
  if (phase === 'confront') {
    renderConfront(snapshot);
    return;
  }
  if (phase === 'vote1' || phase === 'vote2') {
    renderVote(snapshot, phase);
    return;
  }
  if (phase === 'reveal' || phase === 'ending') {
    statusLine.textContent = `指认票 ${snapshot.votes?.cast1 ?? 0} · 处置票 ${snapshot.votes?.cast2 ?? 0}`;
    if (revealData) paintReveal(snapshot, revealData);
    else ensureReveal();
  }
}

const STATUS_TEXT = {
  reconnecting: '数据可能延迟，正在重新同步',
  polling: '实时推送不可用，已切换为每秒轮询',
  unsupported: '浏览器不支持实时推送，已切换为每秒轮询',
  stale: '数据可能延迟',
};

subscribeStream({
  onSnapshot: render,
  onStatus: (status) => {
    staleEl.hidden = status === 'live';
    if (!staleEl.hidden) {
      staleEl.textContent = STATUS_TEXT[status] ?? '数据可能延迟';
    }
  },
});