import { renderQrSvg } from './qr.js';
import { STAGE, PHASE, availableRoles, pickAlternative } from './state.js';

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

const timelineCards = (timeline) =>
  timeline
    .map(
      (item) => `
      <li class="timeline__item">
        <span class="timeline__date mono">${esc(item.date)}</span>
        <p class="timeline__event">${esc(item.event)}</p>
        <span class="timeline__who faint mono">${esc(item.who)}</span>
      </li>`,
    )
    .join('');

const roleCard = (role) => {
  const full = role.full;
  return `
  <article class="rolecard${full ? ' is-full' : ''}" data-role="${role.id}" data-flipped="false">
    <div class="rolecard__inner">
      <section class="rolecard__face rolecard__front" aria-hidden="false">
        <header class="rolecard__head">
          <span class="rolecard__no mono">0${role.no}</span>
          <span class="chip">${esc(role.title)}</span>
        </header>
        <h3 class="rolecard__name serif">${esc(role.name)}</h3>
        <p class="rolecard__sit">${esc(role.situation)}</p>
        <footer class="rolecard__foot">
          <span class="rolecard__count mono" data-count="${role.id}">${role.occupied}／${role.capacity}</span>
          <span class="rolecard__state faint">${full ? '已满' : role.remaining <= 2 ? '将满' : '可选'}</span>
        </footer>
      </section>
      <section class="rolecard__face rolecard__back" aria-hidden="true">
        <p class="rolecard__hook serif">${esc(role.hook)}</p>
        <div class="rolecard__actions">
          <button class="btn btn--primary" data-act="pick" data-role="${role.id}" data-full="${full}"${full ? ' aria-disabled="true"' : ''}>
            ${full ? '已满 7／7' : '就是他'}
          </button>
          <button class="btn btn--ghost" data-act="flip">再看看</button>
        </div>
      </section>
    </div>
  </article>`;
};

function identity(state, ctx) {
  const error = ctx.claimError;

  if (!error) {
    return `
    <section class="screen screen--identity">
      <p class="eyebrow">2026 年 11 月 · 学院核查</p>
      <h1 class="identity__title serif">零号提交</h1>
      <p class="identity__sub">一封匿名信，六个当事人，四十五分钟</p>
      <p class="identity__loading muted">正在进入…</p>
    </section>`;
  }

  return `
  <section class="screen screen--identity">
    <p class="eyebrow">2026 年 11 月 · 学院核查</p>
    <h1 class="identity__title serif">零号提交</h1>
    <p class="identity__sub">一封匿名信，六个当事人，四十五分钟</p>
    <p class="identity__error">${esc(error)}</p>
    <button class="btn btn--primary" data-act="retry-enroll" type="button">重试</button>
  </section>`;
}

function prologue(state, ctx) {
  const letter = ctx.brief.letter;
  return `
  <section class="screen screen--prologue">
    <article class="letter">
      <p class="letter__meta mono">${esc(letter.deliveredAt)}</p>
      ${letter.lines.map((line, index) => `<p class="letter__line serif" style="--line:${index}">${esc(line)}</p>`).join('')}
    </article>
    <p class="letter__caption faint mono">11 月 12 日 09:00，学院邮箱收到这封信。</p>
  </section>`;
}

function brief(state, ctx) {
  const source = ctx.brief;
  return `
  <section class="screen screen--brief">
    <ol class="brief">
      ${source.brief
        .map(
          (item, index) => `
        <li class="brief__panel" data-panel="${index}">
          <p class="eyebrow">${esc(item.kicker)}</p>
          <h2 class="brief__head serif">${esc(item.headline)}</h2>
          ${item.art === 'letter' ? `<blockquote class="brief__letter">${esc(source.letter.lines.join(' '))}</blockquote>` : ''}
          ${item.art === 'timeline' ? `<p class="brief__note faint">十一个节点，横向滑动查看。</p>` : ''}
          <p class="brief__body">${esc(item.body)}</p>
        </li>`,
        )
        .join('')}
    </ol>
    <div class="timeline">
      <p class="eyebrow">案发前六十天</p>
      <ul class="timeline__track">${timelineCards(source.timeline)}</ul>
    </div>
  </section>`;
}

function wall(state, ctx) {
  const summary = '六个人，一封匿名信，你是其中之一。';
  const fullCount = ctx.roles.filter((role) => role.full).length;
  return `
  <section class="screen screen--wall">
    <header class="wall__head">
      <p class="eyebrow">角色墙</p>
      <p class="wall__summary">${esc(summary)}</p>
      <p class="wall__hint faint">${fullCount > 0 ? `已有 ${fullCount} 个角色满员，其余仍可选。` : '点开卡片看背面，再决定。'}</p>
    </header>
    <div class="wall__grid">${ctx.roles.map(roleCard).join('')}</div>
  </section>`;
}

function confirm(state, ctx) {
  const role = ctx.roles.find((item) => item.id === state.draftRoleId);
  const targetRole = ctx.student?.roleId ? ctx.roles.find((item) => item.id === ctx.student.roleId) : null;
  const moveLine = targetRole
    ? `确认后将从第 ${targetRole.no} 组（${targetRole.name}）移到第 ${role.no} 组（${role.name}）`
    : `确认后将加入第 ${role.no} 组`;
  return `
  <section class="screen screen--confirm" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
    <div class="confirm">
      <p class="eyebrow">确认选择</p>
      <h2 class="confirm__title serif" id="confirm-title">你将扮演 ${esc(role.name)}</h2>
      <ul class="confirm__lines">
        <li>${esc(moveLine)}</li>
        <li>这个角色有 ${role.capacity} 个位置，已有 ${role.occupied} 人。</li>
        <li>确认后仍可改选一次。</li>
      </ul>
      <div class="confirm__actions">
        <button class="btn btn--primary" data-act="confirm" ${state.submitting ? 'disabled aria-disabled="true"' : ''}>
          ${state.submitting ? '正在登记…' : '确认'}
        </button>
        <button class="btn btn--ghost" data-act="cancel" ${state.submitting ? 'disabled' : ''}>我再想想</button>
      </div>
      <p class="confirm__note faint">可以隐瞒，不可以编造。</p>
    </div>
  </section>`;
}

function result(state, ctx) {
  const student = ctx.student;
  const group = ctx.snapshot?.groups?.find((item) => item.roleId === student.roleId);
  const members = group?.members ?? [];
  return `
  <section class="screen screen--result">
    <div class="stamp-wrap">
      <span class="stamp stamp--group serif">第 ${student.roleNo} 组</span>
    </div>
    <h2 class="result__title serif">你加入了第 ${student.roleNo} 组</h2>
    <p class="result__role muted">${esc(student.name)} · ${esc(student.roleName)}（${esc(student.roleTitle)}）</p>
    <ol class="roster">
      ${members
        .map(
          (member) => `
        <li class="roster__item">
          <span class="roster__seq mono">${String(member.seq).padStart(2, '0')}</span>
          <span class="roster__name">${esc(member.name)}</span>
          ${member.name === student.name ? '<span class="chip">你</span>' : ''}
        </li>`,
        )
        .join('')}
    </ol>
    <p class="result__guide">请到第 ${student.roleNo} 桌就座，等待主持人指令。</p>
    <p class="result__foot faint">你的角色卡已生成，可在我的角色卡中查看。</p>
  </section>`;
}

export function qrPayload(token) {
  const origin = globalThis.location?.origin ?? '';
  const fallback = token ? `ZS:${token}` : '';
  if (!token || !origin) return fallback;
  const url = `${origin}/?t=${encodeURIComponent(token)}`;
  return url.length <= 62 ? url : fallback;
}

function qrBlock(token) {
  const payload = qrPayload(token);
  if (!payload) return '<span class="qr__empty">暂无凭证</span>';
  try {
    return renderQrSvg(payload, { margin: 2 });
  } catch {
    return '<span class="qr__empty">二维码内容过长</span>';
  }
}

function roleSections(card) {
  if (!card) {
    return '<p class="faint profilecard__missing">角色卡尚未加载，请刷新页面或重新扫码。</p>';
  }
  const sections = [
    ['你的秘密', card.secret],
    ['你的任务', card.task],
    ['你的时间线', card.timeline],
    ['你的辩护要点', card.defense],
  ];
  return `
      <dl class="rolesections">
        ${sections
          .map(
            ([label, text]) => `
          <div class="rolesection">
            <dt class="eyebrow">${esc(label)}</dt>
            <dd>${esc(text)}</dd>
          </div>`,
          )
          .join('')}
      </dl>`;
}

function profile(state, ctx) {
  const student = ctx.student;
  const card = ctx.roleCard;
  const role = ctx.roles.find((item) => item.id === student.roleId);
  const group = ctx.snapshot?.groups?.find((item) => item.roleId === student.roleId);
  const locked = ctx.window === 'locked';
  return `
  <section class="screen screen--profile">
    <article class="profilecard card">
      <header class="profilecard__head">
        <p class="eyebrow">角色卡</p>
        <span class="chip mono">第 ${student.roleNo} 组 · ${String(group?.members?.length ?? 0).padStart(2, '0')}／${role?.capacity ?? 7}</span>
      </header>
      <h2 class="profilecard__name serif">${esc(student.roleName)}</h2>
      <p class="profilecard__title muted">${esc(role?.title ?? '')}</p>
      <p class="profilecard__sit">${esc(role?.situation ?? '')}</p>
      ${roleSections(card)}
      <hr class="rule" />
      <ul class="profilecard__meta mono">
        <li><span>组号</span><strong>第 ${student.roleNo} 组</strong></li>
        <li><span>组内序号</span><strong>${String(group?.members?.findIndex((m) => m.name === student.name) + 1 || 1).padStart(2, '0')}</strong></li>
        <li><span>改选</span><strong>${student.switches}／${student.switchLimit}</strong></li>
      </ul>
      <div class="profilecard__foot">
        <div class="qr">${qrBlock(ctx.token)}</div>
        <div class="profilecard__actions">
          <button class="btn btn--ghost" data-act="switch" ${locked || !student.canSwitch ? 'disabled' : ''}>
            ${locked ? '选角已结束' : student.canSwitch ? '改选角色' : '改选已达上限'}
          </button>
          <button class="btn btn--ghost" data-act="back-result">返回归组结果</button>
        </div>
      </div>
    </article>
  </section>`;
}

function unavailable(state) {
  const role = pickAlternative(state.roles ?? [], state.draftRoleId);
  const hint = role ? `隔壁${role.name}还剩 ${role.remaining} 个位。` : '所有角色已满，请联系主持人。';
  return `<p class="faint">${esc(hint)}</p>`;
}

const safeKey = (value) => String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '');

const voteOption = (group, key, main, sub, selected) => `
  <button class="voteopt${selected ? ' is-selected' : ''}" type="button" role="radio" aria-checked="${selected}" data-vote-group="${group}" data-vote-key="${safeKey(key)}">
    <span class="voteopt__main">${esc(main)}</span>
    ${sub ? `<span class="voteopt__sub faint">${esc(sub)}</span>` : ''}
  </button>`;

function barWidth(count, total) {
  if (!total) return 0;
  return Math.round((count / total) * 100);
}

function vote(state, ctx) {
  if (ctx.phase === PHASE.VOTE2) return voteDispose(state, ctx);
  return voteFirst(state, ctx);
}

function voteFirst(state, ctx) {
  const draft = ctx.draftVote ?? {};
  const accuseMeta = ctx.voteMeta?.accuse ?? { question: '谁的行为，让这件事从「失误」变成了「造假」？', hint: '' };
  const qualifyMeta = ctx.voteMeta?.qualify ?? { question: '给这件事定性', options: [] };
  return `
  <section class="screen screen--vote">
    <header class="vote__head">
      <p class="eyebrow">第一轮投票</p>
      <h2 class="vote__title serif">${esc(accuseMeta.question)}</h2>
      <p class="vote__hint faint">指认票与定性票同时投。${esc(accuseMeta.hint ?? '')}</p>
    </header>
    <fieldset class="vote__group" role="radiogroup">
      <legend class="vote__legend mono">指认票 · 六选一</legend>
      <div class="vote__options vote__options--roles">
        ${(ctx.roles ?? []).map((role) => voteOption('accuse', role.id, role.name, role.title, draft.accuse === role.id)).join('')}
      </div>
    </fieldset>
    <fieldset class="vote__group" role="radiogroup">
      <legend class="vote__legend mono">定性票 · 三选一</legend>
      <div class="vote__options">
        ${(qualifyMeta.options ?? []).map((option) => voteOption('qualify', option.key, option.text, option.key, draft.qualify === option.key)).join('')}
      </div>
    </fieldset>
    <p class="vote__status faint">${ctx.myVotes?.accuse ? '已提交，开放期间可改票' : '两票都选好后提交'}</p>
  </section>`;
}

function voteDispose(state, ctx) {
  const draft = ctx.draftVote ?? {};
  const meta = ctx.voteMeta?.dispose ?? { question: '处置票', options: [] };
  return `
  <section class="screen screen--vote">
    <header class="vote__head">
      <p class="eyebrow">处置投票</p>
      <h2 class="vote__title serif">${esc(meta.question)}</h2>
      <p class="vote__hint faint">这一票决定结局。四选一。</p>
    </header>
    <fieldset class="vote__group" role="radiogroup">
      <div class="vote__options vote__options--stack">
        ${(meta.options ?? []).map((option) => voteOption('dispose', option.key, option.text, option.ending, draft.dispose === option.key)).join('')}
      </div>
    </fieldset>
    <p class="vote__status faint">${ctx.myVotes?.dispose ? '已提交，开放期间可改票' : '选定后提交'}</p>
  </section>`;
}

function reveal(state, ctx) {
  const data = ctx.reveal;
  if (!data) {
    return `
    <section class="screen screen--reveal">
      <p class="eyebrow">真相揭晓</p>
      <p class="muted">正在调取揭晓稿…</p>
    </section>`;
  }
  const summary = ctx.votes ?? {};
  const accuseRows = (ctx.roles ?? [])
    .map((role) => {
      const count = summary.accuse?.[role.id] ?? 0;
      const correct = role.id === data.accuse?.roleId;
      return `<li class="votebar${correct ? ' is-correct' : ''}">
        <span class="votebar__name">${esc(role.name)}</span>
        <span class="votebar__track"><span class="votebar__fill" style="width:${barWidth(count, summary.cast1)}%"></span></span>
        <span class="votebar__num mono">${count}${correct ? ' · 正确' : ''}</span>
      </li>`;
    })
    .join('');
  const qualifyRows = (ctx.voteMeta?.qualify?.options ?? [])
    .map((option) => {
      const count = summary.qualify?.[option.key] ?? 0;
      const correct = option.key === data.qualify?.key;
      return `<li class="votebar${correct ? ' is-correct' : ''}">
        <span class="votebar__name">${esc(option.key)}</span>
        <span class="votebar__track"><span class="votebar__fill" style="width:${barWidth(count, summary.cast1)}%"></span></span>
        <span class="votebar__num mono">${count}${correct ? ' · 正确' : ''}</span>
      </li>`;
    })
    .join('');
  return `
  <section class="screen screen--reveal">
    <p class="eyebrow">真相揭晓</p>
    <h2 class="reveal__title serif">三条谜题的答案</h2>
    <ol class="reveal__puzzles">
      ${(data.puzzles ?? []).map((text) => `<li>${esc(text)}</li>`).join('')}
    </ol>
    <h3 class="reveal__sub serif">责任链</h3>
    <p class="reveal__chain">${esc(data.chain)}</p>
    <p class="reveal__note">${esc(data.chainNote)}</p>
    <div class="reveal__votes card">
      <p class="eyebrow">指认票分布</p>
      <ul class="votebars">${accuseRows}</ul>
      <p class="eyebrow">定性票分布</p>
      <ul class="votebars">${qualifyRows}</ul>
    </div>
    <div class="reveal__theme">
      ${(data.theme ?? []).map((text) => `<p>${esc(text)}</p>`).join('')}
    </div>
  </section>`;
}

function ending(state, ctx) {
  const item = ctx.reveal?.ending;
  if (!item) {
    return `
    <section class="screen screen--ending">
      <p class="eyebrow">结局</p>
      <p class="muted">等待主持人公布…</p>
    </section>`;
  }
  return `
  <section class="screen screen--ending">
    <p class="eyebrow">处置结果 · 结局</p>
    <h2 class="ending__name serif">${esc(item.name)}</h2>
    <p class="ending__trigger chip">${esc(item.trigger)}</p>
    <p class="ending__block">${esc(item.threeMonths)}</p>
    <p class="ending__block">${esc(item.later)}</p>
    <p class="ending__line serif">${esc(item.line)}</p>
  </section>`;
}

function clueCard(clue) {
  if (clue.status === 'hidden') {
    return `
    <li class="clue is-hidden">
      <span class="clue__no mono">${clue.id}</span>
      <span class="clue__hint faint">未发放</span>
    </li>`;
  }

  if (clue.status === 'held' && !clue.holder) {
    return `
    <li class="clue is-held">
      <header class="clue__head">
        <span class="clue__no mono">${clue.id}</span>
        <span class="clue__name">${esc(clue.name)}</span>
      </header>
      <p class="clue__meta faint">第 ${clue.holderNo} 组持有</p>
    </li>`;
  }

  return `
  <li class="clue is-open${clue.holder ? ' is-mine' : ''}">
    <header class="clue__head">
      <span class="clue__no mono">${clue.id}</span>
      <span class="clue__name">${esc(clue.name)}</span>
      ${clue.holder ? '<span class="chip">你持有</span>' : ''}
    </header>
    <p class="clue__content">${esc(clue.content)}</p>
    <p class="clue__proves faint">能证明：${esc(clue.proves)}</p>
    ${
      clue.status === 'held' && clue.holder
        ? `<p class="clue__note">${esc(clue.holderNote ?? '这张卡交不交、什么时候交，由你们组决定。')}</p>
           <button class="btn btn--primary" data-act="reveal-clue" data-clue="${clue.id}">公开这张卡</button>`
        : ''
    }
  </li>`;
}

function clues(state, ctx) {
  const items = ctx.clues ?? [];
  const publicCount = items.filter((item) => item.status === 'public').length;
  const heldCount = items.filter((item) => item.status === 'held').length;
  const hiddenCount = items.filter((item) => item.status === 'hidden').length;
  return `
  <section class="screen screen--clues">
    <header class="clues__head">
      <p class="eyebrow">线索册</p>
      <p class="clues__summary mono">公开 ${publicCount} · 持有 ${heldCount} · 未发放 ${hiddenCount}</p>
    </header>
    ${[1, 2, 3]
      .map(
        (round) => `
      <section class="clues__round">
        <h3 class="eyebrow">第 ${round} 轮</h3>
        <ul class="clues__list">
          ${items.filter((item) => item.round === round).map(clueCard).join('')}
        </ul>
      </section>`,
      )
      .join('')}
    <p class="clues__rule faint">可以隐瞒，不可以编造。交不交、什么时候交，由你们组决定。</p>
  </section>`;
}

function interrogate(state, ctx) {
  const quota = ctx.quota ?? 0;
  const silenced = Boolean(ctx.silenced);
  const myNo = ctx.student?.roleNo;
  const targets = (ctx.roles ?? []).filter((role) => role.no !== myNo);
  return `
  <section class="screen screen--interrogate">
    <header class="ask__head">
      <p class="eyebrow">第一轮质询</p>
      <h2 class="ask__title serif">质询台</h2>
      <p class="ask__quota mono">本组本轮质询机会：${quota} 次</p>
      ${silenced ? '<p class="ask__silenced">本轮静默，不能发起质询。</p>' : ''}
    </header>
    ${
      silenced
        ? ''
        : `<form class="askform" id="ask-form">
            <label class="sr-only" for="ask-target">被质询组</label>
            <select class="select" id="ask-target" name="toGroupNo">
              ${targets.map((role) => `<option value="${role.no}">第 ${role.no} 组 · ${esc(role.name)}</option>`).join('')}
            </select>
            <label class="sr-only" for="ask-text">你的问题</label>
            <input class="identity__input" id="ask-text" name="text" maxlength="60" placeholder="一句话问题，2—60 字" />
            <label class="askform__anon faint"><input type="checkbox" name="anonymous" /> 对其他同学匿名（主持人可见来源）</label>
            <button class="btn btn--primary" type="submit">提交问题</button>
          </form>
          <p class="faint">口头质询由主持人点名；这里提交的问题进入队列，由主持人挑 3—5 条上屏。</p>`
    }
    ${ctx.myQuestion ? `<p class="ask__done">已提交：${esc(ctx.myQuestion)}</p>` : ''}
  </section>`;
}

function bindClues(root, state, ctx) {
  root.addEventListener('click', (event) => {
    const button = event.target.closest('[data-act="reveal-clue"]');
    if (!button) return;
    if (button.dataset.armed !== 'true') {
      button.dataset.armed = 'true';
      button.textContent = '确认公开？';
      setTimeout(() => {
        if (!button.isConnected) return;
        button.dataset.armed = 'false';
        button.textContent = '公开这张卡';
      }, 3000);
      return;
    }
    ctx.revealClue(button.dataset.clue);
  });
}

function bindInterrogate(root, state, ctx) {
  const form = root.querySelector('#ask-form');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    ctx.askQuestion({
      toGroupNo: Number(data.get('toGroupNo')),
      text: String(data.get('text') ?? ''),
      anonymous: data.get('anonymous') === 'on',
    });
  });
}

export const MODULES = {
  [STAGE.IDENTITY]: { render: identity, bind: bindIdentity },
  [STAGE.PROLOGUE]: { render: prologue, bind: null },
  [STAGE.BRIEF]: { render: brief, bind: bindBrief },
  [STAGE.WALL]: { render: wall, bind: bindWall },
  [STAGE.CONFIRM]: { render: confirm, bind: bindConfirm },
  [STAGE.RESULT]: { render: result, bind: null },
  [STAGE.PROFILE]: { render: profile, bind: bindProfile },
  [STAGE.CLUES]: { render: clues, bind: bindClues },
  [STAGE.INTERROGATE]: { render: interrogate, bind: bindInterrogate },
  [STAGE.VOTE]: { render: vote, bind: bindVote },
  [STAGE.REVEAL]: { render: reveal, bind: null },
  [STAGE.ENDING]: { render: ending, bind: null },
};

function bindIdentity(root, state, ctx) {
  root.querySelector('[data-act="retry-enroll"]')?.addEventListener('click', () => ctx.retryEnroll());
}

function bindBrief(root, state, ctx) {
  const panels = [...root.querySelectorAll('.brief__panel')];
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) entry.target.classList.add('is-active');
      }
    },
    { threshold: 0.4 },
  );
  for (const panel of panels) observer.observe(panel);
}

function bindWall(root, state, ctx) {
  for (const card of root.querySelectorAll('.rolecard')) {
    card.addEventListener('click', (event) => {
      const action = event.target.closest('[data-act]')?.dataset.act;
      if (action === 'pick') return;
      if (action === 'flip') {
        toggleCard(card);
        return;
      }
      toggleCard(card);
    });
  }

  root.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-act="pick"]');
    if (!trigger) return;
    const roleId = trigger.dataset.role;
    const role = ctx.roles.find((item) => item.id === roleId);
    if (!role) return;
    if (role.full) {
      const card = trigger.closest('.rolecard');
      card?.classList.add('is-shake');
      setTimeout(() => card?.classList.remove('is-shake'), 240);
      ctx.toast(`该角色已满员。${suggestion(ctx.roles, roleId)}`, 4200);
      return;
    }
    ctx.pick(roleId);
  });
}

function toggleCard(card) {
  const flipped = card.dataset.flipped === 'true';
  card.dataset.flipped = flipped ? 'false' : 'true';
  card.querySelector('.rolecard__front').setAttribute('aria-hidden', String(!flipped));
  card.querySelector('.rolecard__back').setAttribute('aria-hidden', String(flipped));
}

export function suggestion(roles, roleId) {
  const target = pickAlternative(roles, roleId);
  return target ? `隔壁${target.name}还剩 ${target.remaining} 个位。` : '所有角色已满，请联系主持人。';
}

function bindConfirm(root, state, ctx) {
  root.querySelector('[data-act="confirm"]')?.addEventListener('click', () => ctx.confirm());
  root.querySelector('[data-act="cancel"]')?.addEventListener('click', () => ctx.cancel());
}

function bindProfile(root, state, ctx) {
  root.querySelector('[data-act="switch"]')?.addEventListener('click', () => ctx.switchRole());
  root.querySelector('[data-act="back-result"]')?.addEventListener('click', () => ctx.go(STAGE.RESULT));
}

function bindVote(root, state, ctx) {
  root.addEventListener('click', (event) => {
    const option = event.target.closest('[data-vote-group]');
    if (!option) return;
    const group = option.dataset.voteGroup;
    const key = option.dataset.voteKey;
    if (!group || !key) return;
    ctx.setDraft({ [group]: key });
    for (const item of root.querySelectorAll(`[data-vote-group="${group}"]`)) {
      const selected = item === option;
      item.classList.toggle('is-selected', selected);
      item.setAttribute('aria-checked', String(selected));
    }
  });
}

export { availableRoles, esc };