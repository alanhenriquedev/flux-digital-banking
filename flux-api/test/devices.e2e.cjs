// E2E V1 — agrupamento de sessões por dispositivo.
// Prova os cenários 1-12 do plano usando servidor real + Postgres.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const PORT = 3335;
const BASE = `http://127.0.0.1:${PORT}/api`;
const envFile = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const getEnv = (k) => {
  const m = envFile.match(new RegExp(`^${k}=(.*)$`, 'm'));
  return m ? m[1].replace(/^"|"$/g, '') : undefined;
};
const DATABASE_URL = getEnv('DATABASE_URL');
const JWT_SECRET = getEnv('JWT_SECRET');
// mesmo fallback do SecurityService (DEVICE_ID_HASH_SECRET ?? JWT_SECRET)
const DEVICE_SECRET = getEnv('DEVICE_ID_HASH_SECRET') || JWT_SECRET;

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

let server;
const suffix = Date.now().toString(36);
const EMAILS = ['a', 'b', 'c', 'd'].map((l) => `dev_e2e_${l}_${suffix}@flux.test`);
const [EMAIL_A, EMAIL_B, EMAIL_C, EMAIL_D] = EMAILS;
const PASSWORD = 'Flux2026x';

const UA_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36';
const UA_EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/126.0 Safari/537.36';
const UA_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';

const DEVICE_CHROME = '11111111-1111-4111-8111-111111111111';
const DEVICE_EDGE = '22222222-2222-4222-8222-222222222222';
const DEVICE_SAFARI = '33333333-3333-4333-8333-333333333333';

function hmac(raw) {
  return crypto.createHmac('sha256', DEVICE_SECRET).update(raw, 'utf8').digest('hex');
}

let loginCount = 0;

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
}

/** login simulando um navegador/dispositivo específico */
async function login(email, { deviceId, ua } = {}) {
  loginCount++;
  const res = await api('POST', '/auth/login', {
    body: { email, password: PASSWORD, ...(deviceId ? { deviceId } : {}) },
    headers: ua ? { 'User-Agent': ua } : {},
  });
  assert.strictEqual(res.status, 201, `login: ${JSON.stringify(res)}`);
  return res.json.accessToken;
}

async function sessionsOf(email) {
  const u = await prisma.user.findUnique({ where: { email } });
  return prisma.authSession.findMany({ where: { userId: u.id } });
}

test('1) primeiro login no Chrome -> 1 dispositivo / 1 sessão / current correto', async () => {
  await register(EMAIL_A);
  const tok1 = await login(EMAIL_A, { deviceId: DEVICE_CHROME, ua: UA_CHROME });

  const res = await api('GET', '/auth/security/sessions', { token: tok1 });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.items.length, 1, '1 dispositivo');
  assert.strictEqual(res.json.items[0].sessionCount, 1);
  assert.strictEqual(res.json.items[0].current, true);
  assert.strictEqual(res.json.items[0].deviceLabel, 'Chrome no Windows');

  const rows = await sessionsOf(EMAIL_A);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].deviceIdHash, hmac(DEVICE_CHROME), 'banco guarda o HMAC, não o UUID');
  assert.ok(!JSON.stringify(rows).includes(DEVICE_CHROME), 'UUID cru nunca aparece no banco');
});

test('2+3) segundo e terceiro login no MESMO Chrome -> continua 1 dispositivo', async () => {
  const tok2 = await login(EMAIL_A, { deviceId: DEVICE_CHROME, ua: UA_CHROME });
  let res = await api('GET', '/auth/security/sessions', { token: tok2 });
  assert.strictEqual(res.json.items.length, 1, 'agrupado em 1 dispositivo');
  assert.strictEqual(res.json.items[0].sessionCount, 2);

  const tok3 = await login(EMAIL_A, { deviceId: DEVICE_CHROME, ua: UA_CHROME });
  res = await api('GET', '/auth/security/sessions', { token: tok3 });
  assert.strictEqual(res.json.items.length, 1);
  assert.strictEqual(res.json.items[0].sessionCount, 3, '3 sessões ativas no mesmo device');
  assert.strictEqual(res.json.items[0].current, true, 'representante atual marcado uma única vez');
});

test('4) outro navegador no mesmo PC -> 2 dispositivos', async () => {
  const tokEdge = await login(EMAIL_A, { deviceId: DEVICE_EDGE, ua: UA_EDGE });
  const res = await api('GET', '/auth/security/sessions', { token: tokEdge });

  assert.strictEqual(res.json.items.length, 2);
  const counts = res.json.items.map((i) => i.sessionCount).sort((a, b) => b - a);
  assert.deepStrictEqual(counts, [3, 1]);
  const edge = res.json.items.find((i) => i.current);
  assert.ok(edge, 'grupo do Edge é o atual');
  assert.strictEqual(edge.deviceLabel, 'Edge no Windows');
});

test('5) novo celular -> 3 dispositivos', async () => {
  const tokSafari = await login(EMAIL_A, { deviceId: DEVICE_SAFARI, ua: UA_SAFARI });
  const res = await api('GET', '/auth/security/sessions', { token: tokSafari });
  assert.strictEqual(res.json.items.length, 3);
  assert.strictEqual(res.json.items.filter((i) => i.current).length, 1);
  const safari = res.json.items.find((i) => i.deviceLabel === 'Safari no iPhone');
  assert.ok(safari, 'celular listado com label próprio');
});

test('6) histórico continua registrando TODOS os logins individuais', async () => {
  const res = await api('GET', '/auth/security/logins?page=1&limit=50', { token: await login(EMAIL_A, { deviceId: DEVICE_CHROME, ua: UA_CHROME }) });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(
    res.json.meta.total,
    loginCount,
    `histórico deve ter ${loginCount} entradas (uma por login)`,
  );
  assert.ok(loginCount >= 6, 'cenário anterior fez vários logins');
});

test('7) flag current correta por dispositivo após todos os logins', async () => {
  const tok = await login(EMAIL_A, { deviceId: DEVICE_EDGE, ua: UA_EDGE });
  const res = await api('GET', '/auth/security/sessions', { token: tok });
  const currents = res.json.items.filter((i) => i.current);
  assert.strictEqual(currents.length, 1, 'apenas um grupo current');
  assert.strictEqual(currents[0].deviceLabel, 'Edge no Windows');
});

test('8) revogar um dispositivo mata TODAS as sessões dele; demais seguem vivas', async () => {
  // tokens "novos" por grupo para provar sobrevivência
  const tokChromeOld = await login(EMAIL_A, { deviceId: DEVICE_CHROME, ua: UA_CHROME });
  const tokSafari = await login(EMAIL_A, { deviceId: DEVICE_SAFARI, ua: UA_SAFARI });
  loginCount += 2;

  const list = await api('GET', '/auth/security/sessions', { token: tokChromeOld });
  const chrome = list.json.items.find((i) => i.sessionCount >= 4 && i.deviceLabel === 'Chrome no Windows');
  assert.ok(chrome, 'grupo do Chrome presente com 4 sessões');

  const del = await api('DELETE', `/auth/security/sessions/${chrome.id}`, { token: tokSafari });
  assert.strictEqual(del.status, 200, JSON.stringify(del));
  assert.strictEqual(del.json.revoked, true);
  assert.ok(del.json.sessionsRevoked >= 4, 'revogou todas as sessões do Chrome');

  // todas as sessões do Chrome mortas no banco
  const rows = await sessionsOf(EMAIL_A);
  const chromeRows = rows.filter((r) => r.deviceIdHash === hmac(DEVICE_CHROME));
  assert.ok(chromeRows.length >= 4);
  for (const r of chromeRows) {
    assert.ok(r.revokedAt, 'sessão do Chrome revogada');
    assert.strictEqual(r.revokedReason, 'LOGOUT');
  }

  // Safari segue vivo; Chrome saiu da lista
  assert.strictEqual((await api('GET', '/auth/me', { token: tokSafari })).status, 200, 'outro device intacto');

  const after = await api('GET', '/auth/security/sessions', { token: tokSafari });
  assert.strictEqual(after.json.items.length, 2, 'restam Edge + Safari');
});

test('8b) cross-user: outro usuário não consegue revogar device alheio (404)', async () => {
  await register(EMAIL_B);
  const tokB = await login(EMAIL_B, { deviceId: DEVICE_CHROME, ua: UA_CHROME });

  const listA = await api('POST', '/auth/login', {
    body: { email: EMAIL_A, password: PASSWORD, deviceId: DEVICE_EDGE },
    headers: { 'User-Agent': UA_EDGE },
  });
  loginCount++;
  const sidA = jwt.decode(listA.json.accessToken).sid;

  const del = await api('DELETE', `/auth/security/sessions/${sidA}`, { token: tokB });
  assert.strictEqual(del.status, 404, 'não vaza nem permite revogar de outro usuário');
  assert.strictEqual((await api('GET', '/auth/me', { token: listA.json.accessToken })).status, 200);
});

test('9) revoke-others mantém a sessão atual e encerra os demais dispositivos', async () => {
  const tokKeep = await login(EMAIL_A, { deviceId: DEVICE_EDGE, ua: UA_EDGE });
  const tokKill = await login(EMAIL_A, { deviceId: DEVICE_SAFARI, ua: UA_SAFARI });
  loginCount += 2;

  const res = await api('POST', '/auth/security/sessions/revoke-others', { token: tokKeep });
  assert.strictEqual(res.status, 201);
  assert.ok(res.json.revoked >= 2);

  assert.strictEqual((await api('GET', '/auth/me', { token: tokKill })).status, 401);
  assert.strictEqual((await api('GET', '/auth/me', { token: tokKeep })).status, 200);

  const list = await api('GET', '/auth/security/sessions', { token: tokKeep });
  assert.strictEqual(list.json.items.length, 1, 'sobrou apenas o dispositivo atual');
  assert.strictEqual(list.json.items[0].current, true);
});

test('10) reset de senha continua revogando TUDO (PASSWORD_CHANGED)', async () => {
  await register(EMAIL_C);
  await login(EMAIL_C, { deviceId: DEVICE_CHROME, ua: UA_CHROME });
  await login(EMAIL_C, { deviceId: DEVICE_EDGE, ua: UA_EDGE });

  const rawToken = 'reset-' + crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const u = await prisma.user.findUnique({ where: { email: EMAIL_C } });
  await prisma.user.update({
    where: { id: u.id },
    data: { passwordResetToken: hash, passwordResetTokenExpiry: new Date(Date.now() + 3_600_000) },
  });

  const res = await api('POST', '/auth/reset-password', {
    body: { token: rawToken, password: 'NovaSenha#2026' },
  });
  assert.strictEqual(res.status, 201);

  const rows = await sessionsOf(EMAIL_C);
  assert.ok(rows.length >= 2);
  for (const row of rows) {
    assert.ok(row.revokedAt);
    assert.strictEqual(row.revokedReason, 'PASSWORD_CHANGED');
  }
});

test('11) sessões legadas (sem deviceId / hash null) seguem funcionando individualmente', async () => {
  await register(EMAIL_D);
  const legacyToken = await login(EMAIL_D); // SEM deviceId
  loginCount++;

  const res = await api('GET', '/auth/security/sessions', { token: legacyToken });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.items.length, 1, 'login sem deviceId = item próprio');
  assert.strictEqual(res.json.items[0].sessionCount, 1);

  // segunda sessão legada: também individual (não se funde com a primeira)
  const legacyToken2 = await login(EMAIL_D);
  loginCount++;
  const res2 = await api('GET', '/auth/security/sessions', { token: legacyToken2 });
  assert.strictEqual(res2.json.items.length, 2, 'legadas não se agregam entre si');
  for (const item of res2.json.items) assert.strictEqual(item.sessionCount, 1);

  // DELETE em legada revoga apenas ela mesma (comportamento preservado)
  const targetSid = jwt.decode(legacyToken2).sid;
  const del = await api('DELETE', `/auth/security/sessions/${targetSid}`, { token: legacyToken });
  assert.strictEqual(del.status, 200);
  assert.strictEqual(del.json.revoked, true);
  assert.strictEqual((await api('GET', '/auth/me', { token: legacyToken2 })).status, 401);
  assert.strictEqual((await api('GET', '/auth/me', { token: legacyToken })).status, 200);
});

test('12) nenhum deviceId cru é persistido no banco', async () => {
  const rows = await sessionsOf(EMAIL_A);
  assert.ok(rows.length > 0);
  const serialized = JSON.stringify(rows.map((r) => ({ h: r.deviceIdHash })));
  for (const raw of [DEVICE_CHROME, DEVICE_EDGE, DEVICE_SAFARI]) {
    assert.ok(!serialized.includes(raw), `UUID cru ${raw} não pode estar no banco`);
  }
  const grouped = rows.filter((r) => [DEVICE_CHROME, DEVICE_EDGE, DEVICE_SAFARI].some((d) => r.deviceIdHash === hmac(d)));
  assert.ok(grouped.length > 0, 'grupos guardam exatamente o HMAC esperado');
});
