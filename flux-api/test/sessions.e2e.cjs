const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const PORT = 3334;
const BASE = `http://127.0.0.1:${PORT}/api`;
const envFile = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const getEnv = (k) => {
  const m = envFile.match(new RegExp(`^${k}=(.*)$`, 'm'));
  return m ? m[1].replace(/^"|"$/g, '') : undefined;
};
const DATABASE_URL = getEnv('DATABASE_URL');
const JWT_SECRET = getEnv('JWT_SECRET');

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

let server;
const suffix = Date.now().toString(36);
const EMAILS = ['a', 'b', 'c'].map((l) => `sess_e2e_${l}_${suffix}@flux.test`);
const [EMAIL_A, EMAIL_B, EMAIL_C] = EMAILS;
const PASSWORD = 'Flux2026x';

function genCpf() {
  function digit(digs) {
    let sum = 0;
    for (let i = 0; i < digs.length; i++) sum += Number(digs[i]) * (digs.length + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  }
  const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join('');
  const d1 = digit(base);
  const d2 = digit(base + d1);
  return base + d1 + d2;
}

async function api(method, route, { token, body, headers = {} } = {}) {
  const res = await fetch(BASE + route, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* sem corpo */ }
  return { status: res.status, json };
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE + '/auth/me');
      if (res.status === 401) return;
    } catch { /* ainda subindo */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Servidor não subiu');
}

before(async () => {
  server = spawn('node', ['dist/main'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  await waitForServer();
});

after(async () => {
  try {
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
  } finally {
    await prisma.$disconnect();
    if (server) server.kill();
  }
});

async function register(email) {
  const reg = await api('POST', '/auth/register', {
    body: { fullName: 'Ana Silva', email, cpf: genCpf(), password: PASSWORD, acceptTerms: true },
  });
  assert.strictEqual(reg.status, 201, `registro: ${JSON.stringify(reg)}`);
  await prisma.user.update({
    where: { email },
    data: { emailVerified: true, emailVerifiedAt: new Date() },
  });
  const u = await prisma.user.findUnique({ where: { email } });
  return u.id;
}

async function login(email) {
  const res = await api('POST', '/auth/login', {
    body: { email, password: PASSWORD },
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36' },
  });
  assert.strictEqual(res.status, 201, `login: ${JSON.stringify(res)}`);
  return res.json.accessToken;
}

function userId(email) { return prisma.user.findUnique({ where: { email } }).then((u) => u.id); }

async function sessionsOf(email) {
  const u = await prisma.user.findUnique({ where: { email } });
  return prisma.authSession.findMany({ where: { userId: u.id } });
}

test('login cria sessão e o JWT carrega sid (sem email)', async () => {
  await register(EMAIL_A);
  const token = await login(EMAIL_A);

  const decoded = jwt.decode(token);
  assert.ok(decoded.sid, 'token deve conter sid');
  assert.strictEqual(decoded.sub, await userId(EMAIL_A));
  assert.ok(!('email' in decoded), 'token não deve conter email');

  const sessions = await sessionsOf(EMAIL_A);
  assert.strictEqual(sessions.length, 1);
  assert.strictEqual(sessions[0].revokedAt, null);
  assert.strictEqual(sessions[0].deviceLabel, 'Chrome no Windows');
});

test('GET /auth/security/sessions lista com flag current', async () => {
  const token = await login(EMAIL_A);
  const res = await api('GET', '/auth/security/sessions', { token });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.items.length, 2);
  const current = res.json.items.filter((i) => i.current);
  assert.strictEqual(current.length, 1, 'apenas a sessão atual deve ser marcada');
  assert.ok(current[0].ipMasked.includes('***'));
  assert.ok(current[0].userAgent.length <= 100);
});

test('múltiplos logins criam múltiplas sessões', async () => {
  await login(EMAIL_A);
  await login(EMAIL_A);
  const sessions = await sessionsOf(EMAIL_A);
  assert.strictEqual(sessions.length, 4, '4 logins no total');

  const fresh = await login(EMAIL_A);
  const res = await api('GET', '/auth/security/sessions', { token: fresh });
  assert.strictEqual(res.json.items.length, 5);
});

test('DELETE /auth/security/sessions/:id revoga apenas a sessão alvo', async () => {
  const tok1 = await login(EMAIL_A);
  const tok2 = await login(EMAIL_A);
  const sid2 = jwt.decode(tok2).sid;

  const del = await api('DELETE', `/auth/security/sessions/${sid2}`, { token: tok1 });
  assert.strictEqual(del.status, 200);
  assert.strictEqual(del.json.revoked, true);

  assert.strictEqual((await api('GET', '/auth/me', { token: tok2 })).status, 401, 'token revogado -> 401');
  assert.strictEqual((await api('GET', '/auth/me', { token: tok1 })).status, 200, 'outra sessão segue válida');
});

test('DELETE idempotente: segunda chamada -> alreadyRevoked', async () => {
  const tok1 = await login(EMAIL_A);
  const tok2 = await login(EMAIL_A);
  const sid2 = jwt.decode(tok2).sid;

  const first = await api('DELETE', `/auth/security/sessions/${sid2}`, { token: tok1 });
  assert.strictEqual(first.json.revoked, true);

  const second = await api('DELETE', `/auth/security/sessions/${sid2}`, { token: tok1 });
  assert.strictEqual(second.status, 200);
  assert.strictEqual(second.json.alreadyRevoked, true);
});

test('cross-user: B não vê nem revoga sessões de A (404)', async () => {
  await register(EMAIL_B);
  const tokB = await login(EMAIL_B);
  const tokA = await login(EMAIL_A);
  const sidA = jwt.decode(tokA).sid;

  const list = await api('GET', '/auth/security/sessions', { token: tokB });
  assert.strictEqual(list.json.items.length, 1, 'B vê só as próprias sessões');

  const del = await api('DELETE', `/auth/security/sessions/${sidA}`, { token: tokB });
  assert.strictEqual(del.status, 404, 'cross-user não vaza existência');

  assert.strictEqual((await api('GET', '/auth/me', { token: tokA })).status, 200, 'sessão de A intacta');
});

test('POST /auth/security/sessions/revoke-others mantém a atual e revoga as demais', async () => {
  const tokB = await login(EMAIL_B);
  const tokB2 = await login(EMAIL_B);

  const res = await api('POST', '/auth/security/sessions/revoke-others', { token: tokB });
  assert.strictEqual(res.status, 201);
  assert.ok(res.json.revoked >= 1);

  assert.strictEqual((await api('GET', '/auth/me', { token: tokB2 })).status, 401, 'outra sessão revogada');
  assert.strictEqual((await api('GET', '/auth/me', { token: tokB })).status, 200, 'sessão atual intacta');
});

test('POST /auth/logout revoga a sessão atual (token -> 401)', async () => {
  const tokB = await login(EMAIL_B);
  const sid = jwt.decode(tokB).sid;

  const out = await api('POST', '/auth/logout', { token: tokB });
  assert.strictEqual(out.status, 201);

  const row = await prisma.authSession.findUnique({ where: { id: sid } });
  assert.ok(row.revokedAt, 'sessão revogada no banco');
  assert.strictEqual(row.revokedReason, 'LOGOUT');

  assert.strictEqual((await api('GET', '/auth/me', { token: tokB })).status, 401, 'token revogado -> 401');
});

test('sessão expirada -> 401 (expiração conferida no banco)', async () => {
  const tokA = await login(EMAIL_A);
  const sid = jwt.decode(tokA).sid;
  await prisma.authSession.update({
    where: { id: sid },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  assert.strictEqual((await api('GET', '/auth/me', { token: tokA })).status, 401);
});

test('reset de senha revoga todas as sessões (revokedReason PASSWORD_CHANGED)', async () => {
  await register(EMAIL_C);
  const tokC1 = await login(EMAIL_C);
  const tokC2 = await login(EMAIL_C);

  const rawToken = 'reset-token-' + crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
  await prisma.user.update({
    where: { id: await userId(EMAIL_C) },
    data: { passwordResetToken: hash, passwordResetTokenExpiry: new Date(Date.now() + 3_600_000) },
  });

  const res = await api('POST', '/auth/reset-password', {
    body: { token: rawToken, password: 'NovaSenha#2026' },
  });
  assert.strictEqual(res.status, 201, JSON.stringify(res));

  const rows = await sessionsOf(EMAIL_C);
  assert.ok(rows.length >= 2);
  for (const row of rows) {
    assert.ok(row.revokedAt, 'sessão revogada');
    assert.strictEqual(row.revokedReason, 'PASSWORD_CHANGED');
  }
  assert.strictEqual((await api('GET', '/auth/me', { token: tokC1 })).status, 401);
  assert.strictEqual((await api('GET', '/auth/me', { token: tokC2 })).status, 401);

  const relogin = await api('POST', '/auth/login', { body: { email: EMAIL_C, password: 'NovaSenha#2026' } });
  assert.strictEqual(relogin.status, 201, 'nova senha permite login');
});

test('token legado sem sid continua funcionando', async () => {
  const legacy = jwt.sign({ sub: await userId(EMAIL_A) }, JWT_SECRET, { expiresIn: '1h' });
  const res = await api('GET', '/auth/me', { token: legacy });
  assert.strictEqual(res.status, 200, 'token legado aceito');
});

test('lastUsedAt respeita o throttle (sem write a cada request)', async () => {
  const token = await login(EMAIL_B);
  const sid = jwt.decode(token).sid;

  const before = (await prisma.authSession.findUnique({ where: { id: sid } })).lastUsedAt;
  await api('GET', '/auth/me', { token });
  await api('GET', '/auth/me', { token });
  await api('GET', '/auth/security/sessions', { token });
  const after = (await prisma.authSession.findUnique({ where: { id: sid } })).lastUsedAt;

  assert.strictEqual(
    after.getTime(),
    before.getTime(),
    'lastUsedAt não deve ser gravado em cada request (throttle 5min)',
  );
});