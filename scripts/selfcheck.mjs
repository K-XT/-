import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import * as store from '../server/store.js';
import { createSession, inspectSession, verifyPasscode, verifySession } from '../server/auth.js';
import { MODULES, suggestion } from '../public/js/modules.js';
import { STAGE } from '../public/js/state.js';
import { createQrMatrix } from '../public/js/qr.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const roster = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'data', 'students.json'), 'utf8')).students;

const tokenOf = (index) => roster[index].token;
const idOf = (index) => roster[index].id;

const ROLE_IDS = ['linche', 'zhouyu', 'chenmo', 'suwan', 'gucheng', 'shenzhibai'];

const results = [];

async function run(name, fn) {
  store.reset();
  try {
    await fn();
    results.push({ name, status: 'PASS', detail: '' });
  } catch (error) {
    results.push({ name, status: 'FAIL', detail: error.message.split('\n')[0] });
  }
}

function skip(name, reason) {
  results.push({ name, status: 'SKIP', detail: reason });
}

function occupied(roleId) {
  const role = store.snapshot().roles.find((item) => item.id === roleId);
  return role ? role.occupied : -1;
}

function sumOccupied() {
  return store.snapshot().roles.reduce((total, role) => total + role.occupied, 0);
}

const bootSnapshot = store.snapshot();
const bootRelease = store.releaseRound({ round: 1, operator: 'boot-check' });

await run('启动初始化 check_boot_init', () => {
  assert.equal(bootSnapshot.clues.initialized, true, '模块加载后线索状态必须已初始化');
  assert.equal(bootSnapshot.clues.publicCount, 0, '启动快照应为全部未发放');
  assert.equal(bootRelease.ok, true, '启动后发放必须成功');
  assert.equal(bootRelease.data.released.length, 5, '启动后发第 1 轮必须释放 5 张');
});

await run('容量数学 check_capacity_math', () => {
  assert.equal(store.CAPACITY * store.GROUP_COUNT > store.TOTAL_STUDENTS, true, '6×7 必须大于 40');
  for (let i = 0; i < store.CAPACITY; i += 1) {
    const result = store.assign({ token: tokenOf(i), roleId: 'linche', idemKey: `cap-fill-${i}` });
    assert.equal(result.ok, true, `第 ${i + 1} 位应可选入`);
  }
  const eighth = store.assign({ token: tokenOf(store.CAPACITY), roleId: 'linche', idemKey: 'cap-overflow' });
  assert.equal(eighth.code, 'role_full', '第 8 位必须被拒绝');
  assert.equal(occupied('linche'), store.CAPACITY, '满员后计数必须为 7');
});

await run('满员提示 check_full_guidance', () => {
  const fullRole = {
    id: 'linche',
    no: 1,
    name: '林澈',
    title: '队长',
    situation: '两个月的工作，和一行注释',
    hook: '你删过一行注释。',
    occupied: 7,
    capacity: 7,
    remaining: 0,
    full: true,
  };
  const spareRole = { id: 'zhouyu', no: 2, name: '周予', title: '技术', occupied: 4, capacity: 7, remaining: 3, full: false };
  const html = MODULES[STAGE.WALL].render({}, { roles: [fullRole, spareRole] });
  assert.equal(html.includes('aria-disabled="true"'), true, '满员按钮必须呈现不可选态');
  assert.equal(/<button[^>]*data-act="pick"[^>]*\sdisabled/.test(html), false, '不得使用原生 disabled，否则点击无任何反馈');
  assert.equal(html.includes('已满 7／7'), true, '按钮文案必须写明已满');
  const hint = suggestion([fullRole, spareRole], 'linche');
  assert.equal(hint.includes('周予'), true, '替代引导必须点名仍有空位的角色');
  assert.equal(hint.includes('3'), true, '替代引导必须给出剩余位数');
});

await run('重复提交 check_idempotency', () => {
  const key = 'idem-dup-0001';
  const first = store.assign({ token: tokenOf(0), roleId: 'linche', idemKey: key });
  const second = store.assign({ token: tokenOf(0), roleId: 'linche', idemKey: key });
  const third = store.assign({ token: tokenOf(0), roleId: 'linche', idemKey: key });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(third.ok, true);
  assert.equal(occupied('linche'), 1, '重复提交不得产生第二条归属');
  assert.equal(sumOccupied(), 1, '六组之和必须等于已归组人数');
  assert.equal(store.reconcile().ok, true, '重算后不应出现漂移');
});

await run('改选迁移 check_switch_consistency', () => {
  store.assign({ token: tokenOf(0), roleId: 'linche', idemKey: 'sw-a-select' });
  store.assign({ token: tokenOf(1), roleId: 'linche', idemKey: 'sw-b-select' });
  const beforeSum = sumOccupied();
  const beforeJoined = store.snapshot().joined;
  const moved = store.assign({ token: tokenOf(0), roleId: 'zhouyu', idemKey: 'sw-a-move' });
  assert.equal(moved.ok, true);
  assert.equal(moved.data.mode, 'switch');
  assert.equal(moved.data.movedFrom, 'linche');
  assert.equal(moved.data.movedTo, 'zhouyu');
  assert.equal(sumOccupied(), beforeSum, '迁移后两组人数之和必须不变');
  assert.equal(store.snapshot().joined, beforeJoined, '已归组总数必须不变');
  assert.equal(occupied('linche'), 1);
  assert.equal(occupied('zhouyu'), 1);
  assert.equal(store.findStudentByToken(tokenOf(0)).switches, 1, '改选次数须累计');
});

await run('并发抢位 check_concurrent_grab', () => {
  for (let i = 0; i < store.CAPACITY - 1; i += 1) {
    store.assign({ token: tokenOf(i), roleId: 'linche', idemKey: `grab-fill-${i}` });
  }
  assert.equal(occupied('linche'), store.CAPACITY - 1, '应只剩最后 1 位');
  const winner = store.assign({ token: tokenOf(20), roleId: 'linche', idemKey: 'grab-first' });
  const loser = store.assign({ token: tokenOf(21), roleId: 'linche', idemKey: 'grab-second' });
  assert.equal(winner.ok, true);
  assert.equal(loser.code, 'role_full', '后到者必须被判满员');
  assert.equal(store.findStudentByToken(tokenOf(21)).roleId, null, '失败者仍停留在未归组态');
  const alternatives = store.snapshot().roles.filter((role) => !role.full && role.id !== 'linche');
  assert.equal(alternatives.length > 0, true, '满员时必须存在可改投角色');
});

await run('计数一致 check_count_consistency', () => {
  let index = 0;
  for (const roleId of ROLE_IDS) {
    for (let i = 0; i < 4; i += 1) {
      const result = store.assign({ token: tokenOf(index), roleId, idemKey: `count-${index}` });
      assert.equal(result.ok, true);
      index += 1;
    }
  }
  const snapshot = store.snapshot();
  assert.equal(index, 24);
  assert.equal(sumOccupied(), snapshot.joined, '单组之和必须恒等于总进度');
  assert.equal(snapshot.remaining, store.TOTAL_STUDENTS - snapshot.joined, '剩余人数必须可推导');
  assert.equal(store.reconcile().ok, true, '冗余计数与明细必须一致');
});

await run('不满表现 check_underfull_not_red', () => {
  const slim = {
    id: 'chenmo',
    no: 3,
    name: '陈默',
    title: '数据',
    situation: '87 个人，拿不出手',
    hook: '那个数字，是你一条一条填的。',
    occupied: 4,
    capacity: 7,
    remaining: 3,
    full: false,
  };
  const html = MODULES[STAGE.WALL].render({}, { roles: [slim] });
  assert.equal(html.includes('is-full'), false, '未满卡片不得带满员态样式');
  assert.equal(html.includes('已满'), false, '未满卡片不得出现「已满」字样');
  assert.equal(html.includes('可选'), true, '未满卡片应使用余位表达');
  const css = fs.readFileSync(path.join(HERE, '..', 'public', 'css', 'student.css'), 'utf8');
  assert.equal(css.includes('.rolecard.is-full .rolecard__count'), true, '印泥红只允许挂在满员态');
  assert.equal(/\n\.rolecard__count\s*\{[^}]*seal-red/.test(css), false, '未满态的计数不得使用印泥红');
});

await run('窗口锁定 check_window_lock', () => {
  store.assign({ token: tokenOf(0), roleId: 'linche', idemKey: 'lock-before' });
  const before = sumOccupied();
  const locked = store.setWindow('locked', 'selfcheck');
  assert.equal(locked.ok, true);
  const blocked = store.assign({ token: tokenOf(1), roleId: 'zhouyu', idemKey: 'lock-after' });
  assert.equal(blocked.code, 'window_locked', '锁定后写入口必须失效');
  assert.equal(sumOccupied(), before, '锁定期间人数不得变化');
  store.setWindow('open', 'selfcheck');
});

await run('断网恢复 check_offline_recovery', async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  let attempt = 0;
  const bodies = [];
  globalThis.fetch = async (url, options) => {
    bodies.push(JSON.parse(options.body));
    attempt += 1;
    if (attempt < 3) throw new Error('offline');
    return {
      status: 200,
      json: async () => ({ ok: true, data: { mode: 'first', student: { roleId: 'linche', roleNo: 1 } } }),
    };
  };
  const { submitAssignment } = await import('../public/js/api.js');
  const result = await submitAssignment({ token: tokenOf(0), studentId: idOf(0), roleId: 'linche', attempts: 3 });
  assert.equal(result.ok, true, '网络恢复后必须自动提交成功');
  assert.equal(bodies.length, 3, '应经历 2 次失败 + 1 次成功');
  assert.equal(new Set(bodies.map((item) => item.idemKey)).size, 1, '重试必须复用同一幂等标识');
  assert.equal(localStorage.getItem('zero-submission.pending'), null, '成功后必须清除暂存');
});

skip('大屏可读 check_screen_legibility', '大屏视图已实现，字号用 vh 单位，未在真实投影上验证 5 米可读');
skip('动效降级 check_reduced_motion', 'tokens.css 已做时长降级，未逐项验证降级后页面功能完整性');

await run('兜底通道 check_admin_fallback', () => {
  store.setWindow('locked', 'selfcheck');
  const result = store.autofill({ operator: 'selfcheck' });
  assert.equal(result.ok, true);
  assert.equal(result.data.filled, store.TOTAL_STUDENTS, 'GM 须能一次补齐全班');
  const snapshot = store.snapshot();
  assert.equal(snapshot.joined, store.TOTAL_STUDENTS);
  assert.equal(sumOccupied(), store.TOTAL_STUDENTS);
  const distribution = snapshot.roles
    .map((role) => role.occupied)
    .slice()
    .sort((a, b) => b - a);
  assert.deepEqual(distribution, [7, 7, 7, 7, 6, 6], '补齐后应按人少优先均分为 7/7/7/7/6/6');
  assert.equal(store.reconcile().ok, true);
  const again = store.autofill({ operator: 'selfcheck' });
  assert.equal(again.data.filled, 0, '已归组时补齐应为空操作');
});

await run('控制台会话 check_gm_session', () => {
  const session = createSession('linghao2026');
  assert.equal(Boolean(session), true, '正确口令必须签发会话');
  assert.equal(verifySession(session.session), true, '签发的会话必须验签通过');
  assert.equal(verifySession(`${session.session}0`), false, '篡改签名必须被拒绝');
  assert.equal(verifySession('a.b.c.d'), false, '伪造结构必须被拒绝');
  assert.equal(inspectSession('').ok, false, '空会话必须被拒绝');
  assert.equal(verifyPasscode('wrong'), false, '错误口令必须被拒绝');
  assert.equal(createSession('wrong'), null, '错误口令不得签发会话');
  assert.equal(session.expiresAt > session.issuedAt, true, '会话必须有有效期');
});

await run('二维码矩阵 check_qr_matrix', () => {
  const finderOk = (matrix, row0, col0) => {
    for (let row = 0; row < 7; row += 1) {
      for (let col = 0; col < 7; col += 1) {
        const expected = row === 0 || row === 6 || col === 0 || col === 6 || (row >= 2 && row <= 4 && col >= 2 && col <= 4);
        if (matrix[row0 + row][col0 + col] !== expected) return false;
      }
    }
    return true;
  };

  const v1 = createQrMatrix('ZS:tok-01');
  assert.equal(v1.version, 1);
  assert.equal(v1.size, 21);
  assert.equal(v1.modules.length, 21);
  assert.equal(finderOk(v1.modules, 0, 0) && finderOk(v1.modules, 0, 14) && finderOk(v1.modules, 14, 0), true, '三个定位图案必须成立');
  for (let i = 8; i < 13; i += 1) {
    assert.equal(v1.modules[6][i], i % 2 === 0, '时序图案必须交替');
  }
  assert.equal(v1.mask >= 0 && v1.mask <= 7, true, '掩码编号必须在 0—7');

  assert.equal(createQrMatrix(`ZS:${'x'.repeat(20)}`).version, 2);
  assert.equal(createQrMatrix(`ZS:${'x'.repeat(20)}`).size, 25);
  assert.equal(createQrMatrix('x'.repeat(30)).version, 3);
  assert.equal(createQrMatrix('x'.repeat(50)).version, 4);
  assert.throws(() => createQrMatrix('x'.repeat(200)), /qr_too_long/);
});

await run('同步降级 check_stream_fallback', async () => {
  const listeners = new Map();
  let created = null;
  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.closed = false;
      created = this;
    }
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    }
    close() {
      this.closed = true;
    }
    fire(type) {
      for (const handler of listeners.get(type) ?? []) handler({});
    }
  }
  globalThis.EventSource = FakeEventSource;
  let polls = 0;
  globalThis.fetch = async () => {
    polls += 1;
    return { status: 200, json: async () => ({ ok: true, data: { joined: 0, roles: [] } }) };
  };

  const statuses = [];
  const { subscribeStream } = await import('../public/js/api.js');
  const stop = subscribeStream({
    onSnapshot: () => {},
    onStatus: (status) => statuses.push(status),
    pollInterval: 20,
    failureThreshold: 2,
    probeInterval: 100000,
  });

  created.fire('error');
  created.fire('error');
  assert.equal(statuses.includes('polling'), true, '连续失败必须切换到轮询');
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(polls > 0, true, '降级后必须实际发起轮询');
  stop();
  assert.equal(created.closed, true, '取消订阅必须关闭事件源');
});

await run('投票门控 check_vote_phase_gate', () => {
  const blocked = store.vote({ token: tokenOf(0), choices: { accuse: 'linche', qualify: 'C' }, idemKey: 'vote-gate-1' });
  assert.equal(blocked.code, 'phase_closed', '选角阶段不得投票');

  store.setPhase('vote1', 'selfcheck');
  const accepted = store.vote({ token: tokenOf(0), choices: { accuse: 'linche', qualify: 'C' }, idemKey: 'vote-gate-2' });
  assert.equal(accepted.ok, true, '投票一阶段必须接受指认票与定性票');

  const wrongRound = store.vote({ token: tokenOf(1), choices: { dispose: 'e1' }, idemKey: 'vote-gate-3' });
  assert.equal(wrongRound.code, 'invalid_choice', '第一轮不接受处置票');

  const badAccuse = store.vote({ token: tokenOf(1), choices: { accuse: 'nobody', qualify: 'C' }, idemKey: 'vote-gate-4' });
  assert.equal(badAccuse.code, 'invalid_choice', '不存在的指认对象必须拒绝');

  const badQualify = store.vote({ token: tokenOf(1), choices: { accuse: 'linche', qualify: 'Z' }, idemKey: 'vote-gate-5' });
  assert.equal(badQualify.code, 'invalid_choice', '超出 A/B/C 的定性票必须拒绝');

  store.setPhase('reveal', 'selfcheck');
  const closed = store.vote({ token: tokenOf(1), choices: { dispose: 'e1' }, idemKey: 'vote-gate-6' });
  assert.equal(closed.code, 'phase_closed', '揭晓阶段不得投票');
});

await run('投票计数 check_vote_tally', () => {
  store.setPhase('vote1', 'selfcheck');
  store.vote({ token: tokenOf(0), choices: { accuse: 'linche', qualify: 'C' }, idemKey: 'tally-1' });
  store.vote({ token: tokenOf(1), choices: { accuse: 'linche', qualify: 'C' }, idemKey: 'tally-2' });
  store.vote({ token: tokenOf(2), choices: { accuse: 'gucheng', qualify: 'B' }, idemKey: 'tally-3' });

  const first = store.voteSummary();
  assert.equal(first.cast1, 3);
  assert.equal(first.accuse.linche, 2);
  assert.equal(first.accuse.gucheng, 1);
  assert.equal(first.qualify.C, 2);
  assert.equal(first.qualify.B, 1);

  store.vote({ token: tokenOf(0), choices: { accuse: 'zhouyu', qualify: 'A' }, idemKey: 'tally-4' });
  const after = store.voteSummary();
  assert.equal(after.cast1, 3, '改票不得增加投票人数');
  assert.equal(after.accuse.linche, 1, '改票必须从原选项扣减');
  assert.equal(after.accuse.zhouyu, 1);
  assert.equal(after.qualify.C, 1);

  const hidden = store.voteSummaryPublic();
  assert.equal(hidden.hidden, true, '投票阶段分布必须隐藏');
  assert.equal(hidden.accuse, undefined, '投票阶段不得下发分布明细');

  store.setPhase('vote2', 'selfcheck');
  store.vote({ token: tokenOf(0), choices: { dispose: 'e4' }, idemKey: 'tally-5' });
  store.vote({ token: tokenOf(1), choices: { dispose: 'e4' }, idemKey: 'tally-6' });
  store.vote({ token: tokenOf(2), choices: { dispose: 'e1' }, idemKey: 'tally-7' });

  const second = store.voteSummary();
  assert.equal(second.cast2, 3);
  assert.equal(second.dispose.e4, 2);
  assert.equal(second.dispose.e1, 1);
  assert.equal(second.leadingDispose, 'e4', '处置票最高项必须可判定');
});

await run('投票幂等 check_vote_idempotency', () => {
  store.setPhase('vote1', 'selfcheck');
  const key = 'vote-idem-1';
  const first = store.vote({ token: tokenOf(0), choices: { accuse: 'linche', qualify: 'C' }, idemKey: key });
  const replay = store.vote({ token: tokenOf(0), choices: { accuse: 'gucheng', qualify: 'A' }, idemKey: key });
  assert.equal(first.ok, true);
  assert.equal(replay.ok, true);
  assert.equal(replay.data.choices.accuse, 'linche', '同一幂等键必须返回首次结果');

  const summary = store.voteSummary();
  assert.equal(summary.cast1, 1, '重放不得产生第二票');
  assert.equal(summary.accuse.linche, 1);

  const crossStudent = store.vote({ token: tokenOf(1), choices: { accuse: 'linche', qualify: 'C' }, idemKey: key });
  assert.equal(crossStudent.code, 'invalid_request', '幂等键不得跨学生复用');
});

await run('揭晓与结局 check_reveal_ending', () => {
  const closed = store.getReveal();
  assert.equal(closed.code, 'phase_closed', '未揭晓前不得下发揭晓稿');

  store.setPhase('vote1', 'selfcheck');
  store.vote({ token: tokenOf(0), choices: { accuse: 'gucheng', qualify: 'A' }, idemKey: 'reveal-1' });
  store.setPhase('vote2', 'selfcheck');
  store.vote({ token: tokenOf(0), choices: { dispose: 'e2' }, idemKey: 'reveal-2' });
  store.setPhase('reveal', 'selfcheck');

  const result = store.getReveal();
  assert.equal(result.ok, true);
  assert.equal(result.data.puzzles.length, 3, '三条谜题答案必须齐备');
  assert.equal(result.data.chain.length > 20, true);
  assert.equal(result.data.theme.length, 3, '主题落点必须是三段');
  assert.equal(result.data.accuse.roleId, 'linche', '指认正确答案必须是林澈');
  assert.equal(result.data.qualify.key, 'C', '定性正确答案必须是 C');
  assert.equal(store.voteSummaryPublic().hidden, false, '揭晓后分布必须可见');

  store.setPhase('ending', 'selfcheck');
  const ending = store.getReveal();
  assert.equal(ending.data.ending.id, 'e2', '结局必须按处置票最高项决定');
  assert.equal(Boolean(ending.data.ending.threeMonths), true, '结局必须带三个月后的文案');
});

await run('一键调剂 check_admin_rebalance', () => {
  store.setWindow('locked', 'selfcheck');
  const plan = [7, 7, 7, 7, 7, 5];
  let index = 0;
  for (let round = 0; round < plan.length; round += 1) {
    for (let slot = 0; slot < plan[round]; slot += 1) {
      const result = store.moveStudent({ studentId: idOf(index), toRoleId: ROLE_IDS[round], operator: 'selfcheck' });
      assert.equal(result.ok, true, `第 ${index + 1} 位预置失败：${result.code}`);
      index += 1;
    }
  }

  const before = store.snapshot().roles.map((role) => role.occupied).sort((a, b) => b - a);
  assert.deepEqual(before, [7, 7, 7, 7, 7, 5], '预置分布必须是 7/7/7/7/7/5');

  const result = store.rebalance({ operator: 'selfcheck' });
  assert.equal(result.ok, true);
  assert.equal(result.data.moved, 1, '只差 1 人时必须只调 1 人');
  assert.equal(result.data.moves.length, 1);
  assert.equal(result.data.moves[0].fromNo > 0 && result.data.moves[0].toNo > 0, true, '调剂明细必须含原组与目标组');

  const after = store.snapshot().roles.map((role) => role.occupied).sort((a, b) => b - a);
  assert.deepEqual(after, [7, 7, 7, 7, 6, 6], '调剂后必须均衡到 7/7/7/7/6/6');
  assert.equal(store.snapshot().joined, store.TOTAL_STUDENTS, '调剂不得改变已归组总数');
  assert.equal(after[0] - after[after.length - 1] <= 1, true, '人数差必须不超过 1');

  const again = store.rebalance({ operator: 'selfcheck' });
  assert.equal(again.data.moved, 0, '已均衡时调剂必须为空操作');
  assert.equal(store.reconcile().ok, true, '调剂后冗余计数必须仍与明细一致');
});

await run('角色卡恢复 check_role_card_restore', () => {
  assert.equal(store.studentRoleCard(idOf(0)), null, '未选角不得有角色卡');

  const assigned = store.assign({ token: tokenOf(0), roleId: 'linche', idemKey: 'card-1' });
  assert.equal(assigned.ok, true);

  const card = store.studentRoleCard(idOf(0));
  assert.equal(card.id, 'linche');
  assert.equal(Boolean(card.name && card.title && card.situation && card.hook), true, '公开身份四项必须齐备');

  for (const key of ['secret', 'task', 'timeline', 'defense']) {
    assert.equal(typeof card[key], 'string', `${key} 必须是字符串`);
    assert.equal(card[key].length > 10, true, `${key} 必须是完整文本，不能是空壳`);
  }

  assert.equal(store.studentRoleCard(idOf(1)), null, '未选角的其他人不得拿到角色卡');
  assert.equal(store.listRoles().some((role) => role.secret !== undefined), false, '角色墙不得携带任何秘密');

  const moved = store.assign({ token: tokenOf(0), roleId: 'zhouyu', idemKey: 'card-2' });
  assert.equal(moved.ok, true);
  const afterMove = store.studentRoleCard(idOf(0));
  assert.equal(afterMove.id, 'zhouyu', '改选后角色卡必须跟着换');
  assert.equal(afterMove.secret !== card.secret, true, '不同角色的秘密不能相同');
});

await run('线索三态 check_clue_visibility', () => {
  const initial = store.clueViewFor(idOf(0));
  assert.equal(initial.every((item) => item.status === 'hidden'), true, '初始全部未发放');
  assert.equal(initial[0].name, undefined, '未发放不得下发名称');

  store.assign({ token: tokenOf(0), roleId: 'linche', idemKey: 'clue-role-1' });
  store.assign({ token: tokenOf(2), roleId: 'zhouyu', idemKey: 'clue-role-2' });

  store.releaseRound({ round: 1, operator: 'selfcheck' });
  const after1 = store.clueViewFor(idOf(0));
  assert.equal(after1.filter((item) => item.status === 'public').length, 5, 'L1—L5 必须公开');
  assert.equal(after1.find((item) => item.id === 'L6').status, 'hidden', 'L6 仍未发放');

  store.releaseRound({ round: 2, operator: 'selfcheck' });
  const after2 = store.clueViewFor(idOf(0));
  const l6 = after2.find((item) => item.id === 'L6');
  assert.equal(l6.status, 'held');
  assert.equal(l6.holder, false, '非持有组不得标记持有');
  assert.equal(l6.content, undefined, '定向卡内容不得下发给他组');
  assert.equal(l6.name, '聊天记录', '定向卡名称对他组可见');

  const notHolder = store.volunteerReveal({ token: tokenOf(0), clueId: 'L6' });
  assert.equal(notHolder.code, 'not_holder', '非持有组不得交卡');

  const revealed = store.volunteerReveal({ token: tokenOf(2), clueId: 'L6' });
  assert.equal(revealed.ok, true, '持有组可以交卡');
  assert.equal(store.clueViewFor(idOf(0)).find((item) => item.id === 'L6').status, 'public', '交卡后全场可见');

  store.releaseRound({ round: 3, operator: 'selfcheck' });
  const held8 = store.clueViewFor(idOf(0)).find((item) => item.id === 'L8');
  assert.equal(held8.status, 'held');
  assert.equal(held8.holder, true, '林澈组持有 L8');
  assert.equal(held8.holderNote.includes('交不交'), true, '定向卡必须附带交卡提示');

  store.setPhase('confront', 'selfcheck');
  const afterConfront = store.clueViewFor(idOf(0)).find((item) => item.id === 'L8');
  assert.equal(afterConfront.status, 'public', '进入对质必须自动公开 L8');
  const again = store.forceReveal({ clueId: 'L8' });
  assert.equal(again.data.idempotent, true, 'L8 强制公开必须幂等');
});

await run('质询配额 check_interrogation_quota', () => {
  store.assign({ token: tokenOf(0), roleId: 'linche', idemKey: 'quota-role' });
  store.setPhase('interrogate', 'selfcheck');
  assert.equal(store.snapshot().quotas[1], 1, '进入质询阶段每组配额为 1');

  const first = store.recordInterrogation({ fromGroupNo: 1, toGroupNo: 2, answer: 'no', operator: 'selfcheck' });
  assert.equal(first.ok, true);
  assert.equal(first.data.remaining, 0, '记录一次后配额归零');

  const second = store.recordInterrogation({ fromGroupNo: 1, toGroupNo: 2, answer: 'yes', operator: 'selfcheck' });
  assert.equal(second.code, 'quota_exhausted', '同一组本轮第二次质询必须被拒');

  const badAnswer = store.recordInterrogation({ fromGroupNo: 2, toGroupNo: 1, answer: 'maybe', operator: 'selfcheck' });
  assert.equal(badAnswer.code, 'invalid_request', '回答只能是 yes/no/decline');

  const queued = store.submitQuestion({ token: tokenOf(0), toGroupNo: 2, text: '为什么改数字', anonymous: true });
  assert.equal(queued.ok, true, '文字质询必须入队');
  assert.equal(store.adminView().questionQueue.filter((item) => item.status === 'pending').length, 1);

  store.setPhase('interrogate', 'selfcheck');
  assert.equal(store.snapshot().quotas[1], 1, '重新进入质询阶段必须重置配额');
});

await run('静默态 check_silence_state', () => {
  store.assign({ token: tokenOf(0), roleId: 'linche', idemKey: 'silence-role' });
  store.setPhase('interrogate', 'selfcheck');

  const result = store.silenceGroup({ groupNo: 1, reason: '自检', operator: 'selfcheck' });
  assert.equal(result.ok, true);
  assert.deepEqual(store.snapshot().silencedGroups, [1], '静默必须出现在快照里');

  const blocked = store.submitQuestion({ token: tokenOf(0), toGroupNo: 2, text: '我还想问', anonymous: false });
  assert.equal(blocked.code, 'silenced', '静默组不得发起质询');

  const repeat = store.silenceGroup({ groupNo: 1, reason: '再来一次', operator: 'selfcheck' });
  assert.equal(repeat.ok, true);
  assert.equal(repeat.data.idempotent, true, '同阶段重复判定必须幂等');

  store.setPhase('confront', 'selfcheck');
  assert.equal(store.snapshot().silencedGroups.length, 0, '换阶段必须自动解除静默');

  store.setPhase('interrogate', 'selfcheck');
  const secondTime = store.silenceGroup({ groupNo: 1, reason: '第二次', operator: 'selfcheck' });
  assert.equal(secondTime.code, 'silence_limit', '同组全场最多静默一次');

  const penalty = store.adminView().penalties[0];
  const revoked = store.revokeSilence({ penaltyId: penalty.id, operator: 'selfcheck' });
  assert.equal(revoked.ok, true);
  assert.equal(store.snapshot().silencedGroups.length, 0, '撤销后大屏标记必须消失');

  const afterRevoke = store.silenceGroup({ groupNo: 1, reason: '撤销后重判', operator: 'selfcheck' });
  assert.equal(afterRevoke.ok, true, '撤销后可以重新判定');
});

await run('设备分配 check_device_enroll', () => {
  const first = store.enroll('device-0001');
  assert.equal(first.ok, true, '首台设备必须分配成功');
  assert.equal(first.data.reused, false);
  assert.equal(typeof first.data.token, 'string');

  const again = store.enroll('device-0001');
  assert.equal(again.ok, true);
  assert.equal(again.data.reused, true, '同一设备必须复用原身份');
  assert.equal(again.data.token, first.data.token);

  const second = store.enroll('device-0002');
  assert.equal(second.ok, true);
  assert.notEqual(second.data.token, first.data.token, '不同设备必须分到不同身份');

  for (let i = 3; i <= store.TOTAL_STUDENTS; i += 1) {
    const result = store.enroll(`device-${String(i).padStart(4, '0')}`);
    assert.equal(result.ok, true, `第 ${i} 台设备应分配成功`);
  }

  const overflow = store.enroll('device-overflow');
  assert.equal(overflow.code, 'class_full', '名额用尽必须拒绝并提示');

  const bound = store.adminView().roster.find((item) => item.deviceBound);
  assert.equal(Boolean(bound), true, '控制台必须能看到分配状态');

  const released = store.releaseDevice({ studentId: bound.id, operator: 'selfcheck' });
  assert.equal(released.ok, true, '主持人必须能释放名额');

  const reassigned = store.enroll('device-overflow');
  assert.equal(reassigned.ok, true, '释放后必须能重新分配');
});

const passed = results.filter((item) => item.status === 'PASS').length;
const failed = results.filter((item) => item.status === 'FAIL').length;
const skipped = results.filter((item) => item.status === 'SKIP').length;

const lines = ['', '零号提交 · 验收自检（26 项）', ''];
for (const item of results) {
  const mark = item.status === 'PASS' ? '绿' : item.status === 'FAIL' ? '红' : '黄';
  const suffix = item.detail ? `  ${item.detail}` : '';
  lines.push(`  [${mark}] ${item.status.padEnd(4)} ${item.name}${suffix}`);
}
lines.push('', `  绿 ${passed} / 黄 ${skipped} / 红 ${failed} / 共 ${results.length}`, '');

process.stdout.write(lines.join('\n'));
process.exit(failed > 0 ? 1 : 0);