/* E2E · API de Notificações — listagem, unread-count, leitura e isolamento */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 3338;
const BASE = `http://127.0.0.1:${PORT}/api`;
const envFile = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const getEnv = (k) => {
  const m = envFile.match(new RegExp(`^${k}=(.*)$`, 'm'));
  return m ? m[1].replace(/^"|"$/g, '') : undefined;
};
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: getEnv('DATABASE_URL') } } });

let server;
const suffix = Date.now().toString(36);
const EMAIL_A = `ntf_a_${suffix}@flux.test`;
const EMAIL_B = `ntf_b_${suffix}@flux.test`;
const PASSWORD = 'Flux2026x';
let tokenA;
let tokenB;
let userIdA;

async function api(method, route, { token, body } = {}) {
  const res = await fetch(BASE + route, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
}
async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + '/auth/me'); if (r.status === 401) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Servidor não subiu');
}
function genCpf() {
  function digit(digs) {
    let sum = 0;
    for (let i = 0; i < digs.length; i++) sum += Number(digs[i]) * (digs.length + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  }
  const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join('');
  const d1 = digit(base);
  return base + d1 + digit(base + d1);
}
async function registerAndLogin(email) {
  const reg = await api('POST', '/auth/register', {
    body: { fullName: 'Notif Tester', email, cpf: genCpf(), password: PASSWORD, acceptTerms: true },
  });
  assert.strictEqual(reg.status, 201);
  const u = await prisma.user.findUnique({ where: { email } });
  await prisma.user.update({ where: { id: u.id }, data: { emailVerified: true, emailVerifiedAt: new Date() } });
  const lg = await api('POST', '/auth/login', { body: { email, password: PASSWORD } });
  assert.strictEqual(lg.status, 201);
  return lg.json.accessToken;
}

before(async () => {
  server = spawn(process.execPath, ['dist/main'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'ignore',
    env: { ...process.env, PORT: String(PORT) },
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

test('listagem ordena por mais recente e expõe campos necessários', async () => {
  tokenA = await registerAndLogin(EMAIL_A);
  userIdA = (await prisma.user.findUnique({ where: { email: EMAIL_A } })).id;
  await prisma.notification.createMany({ data: [
    { userId: userIdA, type: 'PIX_OUT', title: 'PIX 1', dedupKey: 'd1' },
    { userId: userIdA, type: 'ALERT_MOVEMENT', title: 'Alerta saldo', dedupKey: 'd2' },
    { userId: userIdA, type: 'LOAN_APPROVED', title: 'Empréstimo', dedupKey: 'd3' },
  ] });
  const res = await api('GET', '/notifications?page=1&limit=50', { token: tokenA });
  assert.strictEqual(res.status, 200);
  assert.ok(res.json.items.length >= 3);
  assert.ok(res.json.items[0].createdAt >= res.json.items[res.json.items.length - 1].createdAt, 'ordem desc por data');
  const found = res.json.items.find((n) => n.title === 'Alerta saldo');
  assert.strictEqual(found.type, 'ALERT_MOVEMENT');
});

test('unread-count é isolado e atualiza após marcar como lida', async () => {
  const beforeUnread = (await api('GET', '/notifications/unread-count', { token: tokenA })).json.unread;
  assert.ok(beforeUnread > 0, 'há não lidas');
  const list = await api('GET', '/notifications?page=1&limit=50', { token: tokenA });
  const firstUnread = list.json.items.find((n) => !n.readAt);
  const mark = await api('POST', `/notifications/${firstUnread.id}/read`, { token: tokenA });
  assert.strictEqual(mark.status, 201);
  const afterUnread = (await api('GET', '/notifications/unread-count', { token: tokenA })).json.unread;
  assert.strictEqual(afterUnread, beforeUnread - 1);
});

test('read-all zera as não lidas e atualiza a interface pelo contador', async () => {
  const all = await api('POST', '/notifications/read-all', { token: tokenA });
  assert.strictEqual(all.status, 201);
  assert.ok(all.json.updated >= 0);
  const unread = (await api('GET', '/notifications/unread-count', { token: tokenA })).json.unread;
  assert.strictEqual(unread, 0);
});

test('isolamento cross-user: B não lê nem marca leitura nas notificações de A', async () => {
  tokenB = await registerAndLogin(EMAIL_B);
  const listB = await api('GET', '/notifications?page=1&limit=50', { token: tokenB });
  assert.strictEqual(listB.status, 200);
  assert.strictEqual(listB.json.items.length, 0, 'B não vê notificações de A');

  const listA = await api('GET', '/notifications?page=1&limit=50', { token: tokenA });
  const aNotif = listA.json.items[0];
  const markB = await api('POST', `/notifications/${aNotif.id}/read`, { token: tokenB });
  assert.strictEqual(markB.status, 404, 'B não pode marcar leitura de A');
});
