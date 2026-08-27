const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 3334;
const BASE = `http://127.0.0.1:${PORT}/api`;
const envFile = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const getEnv = (k) => {
  const m = envFile.match(new RegExp(`^${k}=(.*)$`, 'm'));
  return m ? m[1].replace(/^"|"$/g, '') : undefined;
};
const DATABASE_URL = getEnv('DATABASE_URL');

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

let server;
const suffix = Date.now().toString(36);
const EMAIL_A = `security_e2e_a_${suffix}@flux.test`;
const EMAIL_B = `security_e2e_b_${suffix}@flux.test`;
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

const LONG_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 ' +
  'x'.repeat(400);

async function api(method, route, { token, body, headers = {} } = {}) {
  const res = await fetch(BASE + route, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* sem corpo JSON */ }
  return { status: res.status, json };
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE + '/auth/me');
      if (res.status === 401) return;
    } catch { /* não subiu ainda */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Servidor não subiu no prazo');
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
    await prisma.user.deleteMany({ where: { email: { in: [EMAIL_A, EMAIL_B] } } });
  } finally {
    await prisma.$disconnect();
    if (server) server.kill();
  }
});

async function registerAndVerify(email) {
  const reg = await api('POST', '/auth/register', {
    body: { fullName: 'Ana Silva', email, cpf: genCpf(), password: PASSWORD, acceptTerms: true },
  });
  assert.strictEqual(reg.status, 201, `registro: ${JSON.stringify(reg)}`);
  await prisma.user.update({
    where: { email },
    data: { emailVerified: true, emailVerifiedAt: new Date() },
  });
}

async function login(email, ua) {
  const res = await api('POST', '/auth/login', {
    body: { email, password: PASSWORD },
    headers: ua ? { 'User-Agent': ua } : {},
  });
  assert.strictEqual(res.status, 201, `login: ${JSON.stringify({ status: res.status, json: res.json })}`);
  assert.ok(res.json.accessToken, 'login deve retornar accessToken');
  return res.json.accessToken;
}

test('login válido cria LoginHistory e atualiza lastLoginAt', async () => {
  await registerAndVerify(EMAIL_A);
  const token = await login(EMAIL_A, LONG_UA);

  const count = await prisma.loginHistory.count({ where: { user: { email: EMAIL_A } } });
  assert.strictEqual(count, 1, 'deve existir 1 registro de acesso');

  const u = await prisma.user.findUnique({ where: { email: EMAIL_A } });
  assert.ok(u.lastLoginAt instanceof Date, 'lastLoginAt deve estar setado');

  const rec = await prisma.loginHistory.findFirst({ where: { user: { email: EMAIL_A } } });
  assert.ok(rec.userAgent.length <= 255, `User-Agent armazenada com ${rec.userAgent.length} chars`);
  assert.strictEqual(rec.deviceLabel, 'Chrome no Windows');
  assert.ok(token);

  await api('POST', '/auth/login', { body: { email: EMAIL_A, password: PASSWORD } });
  const countLater = await prisma.loginHistory.count({ where: { user: { email: EMAIL_A } } });
  assert.strictEqual(countLater, 2, 'múltiplos logins criam múltiplos registros');
});

test('múltiplos logins criam múltiplos registros (total final 4)', async () => {
  for (let i = 0; i < 2; i++) {
    await login(EMAIL_A, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Stagefright Safari/604.1');
  }
  const count = await prisma.loginHistory.count({ where: { user: { email: EMAIL_A } } });
  assert.strictEqual(count, 4);
});

test('overview retorna dados de segurança do próprio usuário', async () => {
  const token = await login(EMAIL_A);
  const res = await api('GET', '/auth/security/overview', { token });
  assert.strictEqual(res.status, 200);
  assert.ok(res.json.lastLoginAt, 'lastLoginAt presente');
  assert.strictEqual(res.json.totalLogins, 5);
  assert.ok(res.json.createdAt);
  assert.strictEqual(res.json.emailVerified, true);
  assert.ok(res.json.emailVerifiedAt);
});

test('histórico paginado: página limita, mascara IP e resume UA', async () => {
  const token = await login(EMAIL_A);
  const p1 = await api('GET', '/auth/security/logins?page=1&limit=2', { token });
  assert.strictEqual(p1.status, 200);
  assert.strictEqual(p1.json.items.length, 2);
  assert.strictEqual(p1.json.meta.total, 6);
  assert.strictEqual(p1.json.meta.totalPages, 3);

  const raws = await prisma.loginHistory.findMany({
    where: { user: { email: EMAIL_A } },
    select: { ip: true },
  });
  const rawSet = new Set(raws.map((r) => r.ip));

  for (const item of p1.json.items) {
    assert.ok(typeof item.ipMasked === 'string' && item.ipMasked.includes('***'), `IP mascarado: ${item.ipMasked}`);
    assert.ok(!rawSet.has(item.ipMasked), 'IP mascarado não deve vazar o IP completo');
    assert.ok(item.userAgent.length <= 100, `UA resumida na resposta (${item.userAgent.length})`);
  }

  const p2 = await api('GET', '/auth/security/logins?page=2&limit=2', { token });
  assert.strictEqual(p2.json.items.length, 2);
  const ids1 = new Set(p1.json.items.map((i) => i.id));
  const overlap = p2.json.items.filter((i) => ids1.has(i.id));
  assert.strictEqual(overlap.length, 0, 'páginas não devem ter registros repetidos');
});

test('cross-user impossível: user B vê apenas seus próprios acessos', async () => {
  await registerAndVerify(EMAIL_B);
  const tokenB = await login(EMAIL_B, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36');

  const ov = await api('GET', '/auth/security/overview', { token: tokenB });
  assert.strictEqual(ov.status, 200);
  assert.strictEqual(ov.json.totalLogins, 1, 'B não pode ver os acessos de A');

  const lg = await api('GET', '/auth/security/logins?page=1&limit=10', { token: tokenB });
  assert.strictEqual(lg.json.meta.total, 1);
  assert.ok(lg.json.items.every((i) => i.deviceLabel === 'Chrome no Windows'));
});

test('sem JWT ou com JWT inválido retorna 401', async () => {
  const noToken = await api('GET', '/auth/security/overview');
  assert.strictEqual(noToken.status, 401);

  const noTokenLogins = await api('GET', '/auth/security/logins');
  assert.strictEqual(noTokenLogins.status, 401);

  const invalid = await api('GET', '/auth/security/overview', { token: 'token-invalido' });
  assert.strictEqual(invalid.status, 401);
});