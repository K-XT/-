import * as store from './store.js';
import { createSession, verifySession } from './auth.js';

const STATUS_BY_CODE = {
  identity_invalid: 401,
  gm_unauthorized: 401,
  invalid_request: 400,
  invalid_choice: 400,
  phase_closed: 409,
  role_unknown: 404,
  window_locked: 409,
  role_full: 409,
  switch_limit: 409,
  role_same: 409,
  clue_unknown: 404,
  clue_not_released: 409,
  clue_not_initialized: 500,
  not_holder: 403,
  role_required: 409,
  class_full: 409,
  already_claimed: 409,
  device_bound: 409,
  ambiguous_name: 409,
  quota_exhausted: 409,
  silenced: 409,
  silence_limit: 409,
  body_too_large: 413,
  bad_json: 400,
};

export function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('body_too_large'), { code: 'body_too_large' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('bad_json'), { code: 'bad_json' }));
      }
    });
    req.on('error', reject);
  });
}

async function readJson(req, res) {
  try {
    return { ok: true, body: await readBody(req) };
  } catch (error) {
    json(res, 400, { ok: false, code: error.code, message: error.message });
    return { ok: false, body: {} };
  }
}

function authorized(req) {
  return verifySession(req.headers['x-gm-token']);
}

function studentBrief() {
  const source = store.getCase();
  return {
    title: source.title,
    subtitle: source.subtitle,
    slogan: source.slogan,
    meta: source.meta,
    letter: source.letter,
    brief: source.brief,
    timeline: source.timeline,
  };
}

function publicVoteMeta() {
  const { accuse, qualify, dispose } = store.getCase().votes;
  return {
    accuse: { question: accuse.question, hint: accuse.hint },
    qualify: {
      question: qualify.question,
      options: qualify.options.map((option) => ({ key: option.key, text: option.text })),
    },
    dispose: {
      question: dispose.question,
      options: dispose.options.map((option) => ({ key: option.key, text: option.text, ending: option.ending })),
    },
  };
}

export async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method;

  if (pathname === '/api/health' && method === 'GET') {
    json(res, 200, {
      ok: true,
      service: 'zero-submission',
      version: '0.1.0-skeleton',
      constants: store.constants,
      now: new Date().toISOString(),
    });
    return true;
  }

  if (pathname === '/api/snapshot' && method === 'GET') {
    json(res, 200, { ok: true, data: store.snapshot() });
    return true;
  }

  if (pathname === '/api/enroll' && method === 'POST') {
    const parsed = await readJson(req, res);
    if (!parsed.ok) return true;
    const result = store.enroll(parsed.body.deviceId);
    json(res, result.ok ? 200 : STATUS_BY_CODE[result.code] ?? 400, result);
    return true;
  }

  if (pathname === '/api/roster' && method === 'GET') {
    json(res, 200, { ok: true, data: store.rosterPublic() });
    return true;
  }

  if (pathname === '/api/claim' && method === 'POST') {
    const parsed = await readJson(req, res);
    if (!parsed.ok) return true;
    const result = store.claim({
      studentId: parsed.body.studentId,
      deviceId: parsed.body.deviceId,
      name: parsed.body.name,
    });
    json(res, result.ok ? 200 : STATUS_BY_CODE[result.code] ?? 400, result);
    return true;
  }

  if (pathname === '/api/bootstrap' && method === 'GET') {
    const token = url.searchParams.get('token');
    const student = store.findStudentByToken(token);
    if (!student) {
      json(res, 401, { ok: false, code: 'identity_invalid', message: '凭证无效或已过期，请重新扫码' });
      return true;
    }
    const studentView = store.publicStudent(student);
    const snapshot = store.snapshot();
    const groupNo = studentView.roleNo;
    json(res, 200, {
      ok: true,
      data: {
        student: studentView,
        roleCard: store.studentRoleCard(student.id),
        roles: store.listRoles(),
        brief: studentBrief(),
        clues: store.clueViewFor(student.id),
        window: snapshot.window,
        phase: snapshot.phase,
        phaseLabel: snapshot.phaseLabel,
        quota: groupNo ? snapshot.quotas[groupNo] ?? null : null,
        silenced: groupNo ? snapshot.silencedGroups.includes(groupNo) : false,
        statementIndex: snapshot.statementIndex,
        myVotes: store.studentVotes(student.id),
        voteMeta: publicVoteMeta(),
      },
    });
    return true;
  }

  if (pathname === '/api/assign' && method === 'POST') {
    let body;
    try {
      body = await readBody(req);
    } catch (error) {
      json(res, STATUS_BY_CODE[error.code] ?? 400, { ok: false, code: error.code, message: error.message });
      return true;
    }
    const result = store.assign({ token: body.token, roleId: body.roleId, idemKey: body.idemKey });
    json(res, result.ok ? 200 : STATUS_BY_CODE[result.code] ?? 400, result);
    return true;
  }

  if (pathname === '/api/roles' && method === 'GET') {
    json(res, 200, { ok: true, data: store.listRoles() });
    return true;
  }

  if (pathname === '/api/clues' && method === 'GET') {
    const token = url.searchParams.get('token');
    const student = store.findStudentByToken(token);
    if (!student) {
      json(res, 401, { ok: false, code: 'identity_invalid', message: '凭证无效，请重新扫码' });
      return true;
    }
    json(res, 200, { ok: true, data: store.clueViewFor(student.id) });
    return true;
  }

  if (pathname === '/api/clues/reveal' && method === 'POST') {
    let body;
    try {
      body = await readBody(req);
    } catch (error) {
      json(res, 400, { ok: false, code: error.code, message: error.message });
      return true;
    }
    const result = store.volunteerReveal({ token: body.token, clueId: body.clueId });
    json(res, result.ok ? 200 : STATUS_BY_CODE[result.code] ?? 400, result);
    return true;
  }

  if (pathname === '/api/interrogate' && method === 'POST') {
    let body;
    try {
      body = await readBody(req);
    } catch (error) {
      json(res, 400, { ok: false, code: error.code, message: error.message });
      return true;
    }
    const result = store.submitQuestion({
      token: body.token,
      toGroupNo: body.toGroupNo,
      text: body.text,
      anonymous: body.anonymous,
    });
    json(res, result.ok ? 200 : STATUS_BY_CODE[result.code] ?? 400, result);
    return true;
  }

  if (pathname === '/api/vote' && method === 'POST') {
    let body;
    try {
      body = await readBody(req);
    } catch (error) {
      json(res, 400, { ok: false, code: error.code, message: error.message });
      return true;
    }
    const result = store.vote({ token: body.token, choices: body.choices, idemKey: body.idemKey });
    json(res, result.ok ? 200 : STATUS_BY_CODE[result.code] ?? 400, result);
    return true;
  }

  if (pathname === '/api/votes' && method === 'GET') {
    json(res, 200, { ok: true, data: store.voteSummaryPublic() });
    return true;
  }

  if (pathname === '/api/reveal' && method === 'GET') {
    const result = store.getReveal();
    json(res, result.ok ? 200 : STATUS_BY_CODE[result.code] ?? 409, result);
    return true;
  }

  if (pathname === '/api/admin/login' && method === 'POST') {
    let body;
    try {
      body = await readBody(req);
    } catch (error) {
      json(res, 400, { ok: false, code: error.code, message: error.message });
      return true;
    }
    const session = createSession(String(body.passcode ?? ''));
    if (!session) {
      json(res, 401, { ok: false, code: 'gm_unauthorized', message: '口令错误' });
      return true;
    }
    json(res, 200, { ok: true, data: session });
    return true;
  }

  if (pathname.startsWith('/api/admin/')) {
    if (!authorized(req)) {
      json(res, 401, { ok: false, code: 'gm_unauthorized', message: '缺少有效的控制台口令' });
      return true;
    }

    if (pathname === '/api/admin/state' && method === 'GET') {
      json(res, 200, { ok: true, data: store.adminView() });
      return true;
    }

    if (pathname === '/api/admin/window' && method === 'POST') {
      let body;
      try {
        body = await readBody(req);
      } catch (error) {
        json(res, 400, { ok: false, code: error.code, message: error.message });
        return true;
      }
      const result = store.setWindow(body.state, body.operator ?? 'gm');
      json(res, result.ok ? 200 : 400, result);
      return true;
    }

    if (pathname === '/api/admin/move' && method === 'POST') {
      let body;
      try {
        body = await readBody(req);
      } catch (error) {
        json(res, 400, { ok: false, code: error.code, message: error.message });
        return true;
      }
      const result = store.moveStudent({
        studentId: body.studentId,
        toRoleId: body.toRoleId,
        operator: body.operator ?? 'gm',
      });
      json(res, result.ok ? 200 : STATUS_BY_CODE[result.code] ?? 400, result);
      return true;
    }

    if (pathname === '/api/admin/repair' && method === 'POST') {
      const result = store.repairCounters();
      json(res, 200, { ok: result.ok, data: result });
      return true;
    }

    if (pathname === '/api/admin/autofill' && method === 'POST') {
      let body;
      try {
        body = await readBody(req);
      } catch (error) {
        json(res, 400, { ok: false, code: error.code, message: error.message });
        return true;
      }
      const result = store.autofill({ operator: body.operator ?? 'gm' });
      json(res, 200, result);
      return true;
    }

    if (pathname === '/api/admin/rebalance' && method === 'POST') {
      let body;
      try {
        body = await readBody(req);
      } catch (error) {
        json(res, 400, { ok: false, code: error.code, message: error.message });
        return true;
      }
      const result = store.rebalance({ operator: body.operator ?? 'gm' });
      json(res, 200, result);
      return true;
    }

    if (pathname === '/api/admin/phase' && method === 'POST') {
      let body;
      try {
        body = await readBody(req);
      } catch (error) {
        json(res, 400, { ok: false, code: error.code, message: error.message });
        return true;
      }
      const result = store.setPhase(body.phase, body.operator ?? 'gm');
      json(res, result.ok ? 200 : 400, result);
      return true;
    }

    if (pathname === '/api/admin/clue/release' && method === 'POST') {
      const parsed = await readJson(req, res);
      if (!parsed.ok) return true;
      const result = store.releaseRound({ round: parsed.body.round, operator: parsed.body.operator ?? 'gm' });
      json(res, result.ok ? 200 : STATUS_BY_CODE[result.code] ?? 400, result);
      return true;
    }

    if (pathname === '/api/admin/clue/force' && method === 'POST') {
      const parsed = await readJson(req, res);
      if (!parsed.ok) return true;
      const result = store.forceReveal({ clueId: parsed.body.clueId, operator: parsed.body.operator ?? 'gm' });
      json(res, result.ok ? 200 : STATUS_BY_CODE[result.code] ?? 400, result);
      return true;
    }

    if (pathname === '/api/admin/interrogation' && method === 'POST') {
      const parsed = await readJson(req, res);
      if (!parsed.ok) return true;
      const result = store.recordInterrogation({
        fromGroupNo: parsed.body.fromGroupNo,
        toGroupNo: parsed.body.toGroupNo,
        question: parsed.body.question,
        answer: parsed.body.answer,
        channel: parsed.body.channel,
        operator: parsed.body.operator ?? 'gm',
      });
      json(res, result.ok ? 200 : STATUS_BY_CODE[result.code] ?? 400, result);
      return true;
    }

    if (pathname === '/api/admin/question' && method === 'POST') {
      const parsed = await readJson(req, res);
      if (!parsed.ok) return true;
      const result = store.markQuestion({
        id: parsed.body.id,
        status: parsed.body.status,
        operator: parsed.body.operator ?? 'gm',
      });
      json(res, result.ok ? 200 : STATUS_BY_CODE[result.code] ?? 400, result);
      return true;
    }

    if (pathname === '/api/admin/silence' && method === 'POST') {
      const parsed = await readJson(req, res);
      if (!parsed.ok) return true;
      const result = store.silenceGroup({
        groupNo: parsed.body.groupNo,
        reason: parsed.body.reason,
        operator: parsed.body.operator ?? 'gm',
      });
      json(res, result.ok ? 200 : STATUS_BY_CODE[result.code] ?? 400, result);
      return true;
    }

    if (pathname === '/api/admin/silence/revoke' && method === 'POST') {
      const parsed = await readJson(req, res);
      if (!parsed.ok) return true;
      const result = store.revokeSilence({ penaltyId: parsed.body.penaltyId, operator: parsed.body.operator ?? 'gm' });
      json(res, result.ok ? 200 : STATUS_BY_CODE[result.code] ?? 400, result);
      return true;
    }

    if (pathname === '/api/admin/statement' && method === 'POST') {
      const parsed = await readJson(req, res);
      if (!parsed.ok) return true;
      const result = store.setStatementIndex({ index: parsed.body.index, operator: parsed.body.operator ?? 'gm' });
      json(res, result.ok ? 200 : STATUS_BY_CODE[result.code] ?? 400, result);
      return true;
    }

    if (pathname === '/api/admin/spokesman' && method === 'POST') {
      const parsed = await readJson(req, res);
      if (!parsed.ok) return true;
      const result = store.setSpokesman({
        groupNo: parsed.body.groupNo,
        studentId: parsed.body.studentId ?? null,
        operator: parsed.body.operator ?? 'gm',
      });
      json(res, result.ok ? 200 : STATUS_BY_CODE[result.code] ?? 400, result);
      return true;
    }

    if (pathname === '/api/admin/release-device' && method === 'POST') {
      const parsed = await readJson(req, res);
      if (!parsed.ok) return true;
      const result = store.releaseDevice({
        studentId: parsed.body.studentId,
        operator: parsed.body.operator ?? 'gm',
      });
      json(res, result.ok ? 200 : STATUS_BY_CODE[result.code] ?? 400, result);
      return true;
    }

    if (pathname === '/api/admin/log' && method === 'GET') {
      const view = store.adminView();
      json(res, 200, {
        ok: true,
        data: {
          exportedAt: new Date().toISOString(),
          phase: view.phase,
          clues: view.clues,
          penalties: view.penalties,
          interrogations: view.interrogations,
          questionQueue: view.questionQueue,
          votes: view.votes,
          assignments: view.assignments,
          audit: view.audit,
        },
      });
      return true;
    }

    json(res, 404, { ok: false, code: 'not_found', message: `未知控制台接口：${pathname}` });
    return true;
  }

  return false;
}