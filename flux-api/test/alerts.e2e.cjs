/* E2E Lote 1 · Alertas configuráveis — wiring ponta a ponta */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 3337;
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
const EMAIL_A = `alerts_a_${suffix}@flux.test`;
const EMAIL_B = `alerts_b_${suffix}@flux.test`;
const PASSWORD = 'Flux2026x';
let tokenA;
let tokenB;
let accBNumber;

async function api(method, route, { token, body, ua } = {}) {
  const res = await fetch(BASE + route, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(ua ? { 'User-Agent': ua } : {}),
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
    body: { fullName: 'Alerta Tester', email, cpf: genCpf(), password: PASSWORD, acceptTerms: true },
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

test('GET /alerts/settings devolve catálogo completo com defaults', async () => {
  tokenA = await registerAndLogin(EMAIL_A);
  const res = await api('GET', '/alerts/settings', { token: tokenA });
  assert.strictEqual(res.status, 200);
  const kinds = res.json.items.map((i) => i.kind);
  [
    'NEW_DEVICE_LOGIN','SUSPICIOUS_LOGIN','PIX_ABOVE','BALANCE_BELOW',
    'PIX_SENT','PIX_RECEIVED','LOAN_CONTRACTED','LOAN_INSTALLMENT_DUE',
  ].forEach((k) => assert.ok(kinds.includes(k), k));
  const pixAbove = res.json.items.find((i) => i.kind === 'PIX_ABOVE');
  assert.strictEqual(pixAbove.threshold, 1000, 'limiar padrão 1000');
  assert.strictEqual(pixAbove.enabled, true);
});

test('PUT atualiza preferência isolada por usuário e persiste', async () => {
  tokenB = await registerAndLogin(EMAIL_B);
  accBNumber = (await prisma.account.findUnique({ where: { userId: (await prisma.user.findUnique({ where: { email: EMAIL_B } })).id } })).number;

  const put = await api('PUT', '/alerts/settings/PIX_SENT', { token: tokenA, body: { enabled: false } });
  assert.strictEqual(put.status, 200);

  const putTh = await api('PUT', '/alerts/settings/PIX_ABOVE', { token: tokenA, body: { threshold: 10 } });
  assert.strictEqual(putTh.status, 200);

  const a = await api('GET', '/alerts/settings', { token: tokenA });
  assert.strictEqual(a.json.items.find((i) => i.kind === 'PIX_SENT').enabled, false);
  assert.strictEqual(a.json.items.find((i) => i.kind === 'PIX_ABOVE').threshold, 10);

  const b = await api('GET', '/alerts/settings', { token: tokenB });
  assert.strictEqual(b.json.items.find((i) => i.kind === 'PIX_SENT').enabled, true, 'B não é afetado por A');

  const bad = await api('PUT', '/alerts/settings/NAO_EXISTE', { token: tokenA, body: { enabled: false } });
  assert.strictEqual(bad.status, 400);
});

test('PIX_SENT desativado: sem notificação de envio; alerta de limiar dispara', async () => {
  // Ajusta saldo para o teste de limite inferior mais tarde
  const pix = await api('POST', '/pix/send', {
    token: tokenA,
    body: { accountNumber: accBNumber, amount: 25, description: 'alertas' },
  });
  assert.strictEqual(pix.status, 201);

  const uA = await prisma.user.findUnique({ where: { email: EMAIL_A } });
  const notifs = await prisma.notification.findMany({
    where: { userId: uA.id }, orderBy: { createdAt: 'desc' }, take: 20,
  });

  const pixOut = notifs.filter((n) => n.type === 'PIX_OUT');
  assert.strictEqual(pixOut.length, 0, 'preferência desligada suprime PIX_OUT clássica');

  const above = notifs.find((n) => n.dedupKey && n.dedupKey.startsWith('pixabove:') && n.amount?.toNumber?.() === 25);
  assert.ok(above, 'alerta PIX acima do limiar criado (25 >= 10)');

  // B (recebido habilitado por padrão) recebeu a notificação clássica
  const uB = await prisma.user.findUnique({ where: { email: EMAIL_B } });
  const bNotifs = await prisma.notification.findMany({ where: { userId: uB.id, type: 'PIX_IN' } });
  assert.ok(bNotifs.length >= 1, 'recebedor continua notificado');
});

test('PIX_SENT reativado volta a notificar envios', async () => {
  await api('PUT', '/alerts/settings/PIX_SENT', { token: tokenA, body: { enabled: true } });
  const pix = await api('POST', '/pix/send', {
    token: tokenA,
    body: { accountNumber: accBNumber, amount: 5 },
  });
  assert.strictEqual(pix.status, 201);

  const uA = await prisma.user.findUnique({ where: { email: EMAIL_A } });
  const pixOut = await prisma.notification.findMany({ where: { userId: uA.id, type: 'PIX_OUT' } });
  assert.ok(pixOut.length >= 1, 'notificação clássica restaurada');
});

test('BALANCE_BELOW: alerta quando o saldo fica abaixo do limiar', async () => {
  const me = await api('GET', '/auth/me', { token: tokenA });
  const bal = me.json.account.balance;
  await api('PUT', '/alerts/settings/BALANCE_BELOW', { token: tokenA, body: { threshold: bal + 100 } });

  const beforeCount = await countAlerts(tokenA, 'Saldo abaixo');
  const pix = await api('POST', '/pix/send', {
    token: tokenA,
    body: { accountNumber: accBNumber, amount: 1 },
  });
  assert.strictEqual(pix.status, 201);

  const afterCount = await countAlerts(tokenA, 'Saldo abaixo');
  assert.strictEqual(afterCount, beforeCount + 1, 'um novo alerta de saldo');
});

test('login: novo dispositivo gera ALERT_SECURITY; mesmo dispositivo+rede não gera', async () => {
  const UA_CHROME = 'Mozilla/5.0 (Windows NT 10.0) Chrome/126.0 Safari/537.36';
  const UA_EDGE = 'Mozilla/5.0 (Windows NT 10.0) Edg/126.0 Safari/537.36';

  const l1 = await api('POST', '/auth/login', {
    body: { email: EMAIL_A, password: PASSWORD, deviceId: '11111111-1111-4111-8111-111111111111' },
    ua: UA_CHROME,
  });
  assert.strictEqual(l1.status, 201);
  const n1 = await countAlerts(tokenA, undefined, 'ALERT_SECURITY');
  assert.strictEqual(n1, 0, 'primeiro dispositivo da conta não alerta');

  const l2 = await api('POST', '/auth/login', {
    body: { email: EMAIL_A, password: PASSWORD, deviceId: '22222222-2222-4222-8222-222222222222' },
    ua: UA_EDGE,
  });
  assert.strictEqual(l2.status, 201);
  const n2 = await countAlerts(tokenA, undefined, 'ALERT_SECURITY');
  assert.ok(n2 >= 1, 'segundo dispositivo -> NEW_DEVICE_LOGIN');

  const l3 = await api('POST', '/auth/login', {
    body: { email: EMAIL_A, password: PASSWORD, deviceId: '11111111-1111-4111-8111-111111111111' },
    ua: UA_CHROME,
  });
  assert.strictEqual(l3.status, 201);
  const n3same = await sameDeviceSameNetworkCount();
  assert.strictEqual(n3same.suspiciousForChrome, 0, 'mesmo dispositivo/rede não é suspeito');
});

async function sameDeviceSameNetworkCount() {
  const u = await prisma.user.findUnique({ where: { email: EMAIL_A } });
  const rows = await prisma.notification.findMany({
    where: { userId: u.id, type: 'ALERT_SECURITY' },
    orderBy: { createdAt: 'desc' },
  });
  const suspiciousChrome = rows.filter((n) => n.title.toLowerCase().includes('rede') && n.message.includes('Chrome')).length;
  return { suspiciousForChrome: suspiciousChrome };
}
async function countAlerts(token, titleLike, type) {
  const me = await api('GET', '/auth/me', { token });
  const u = await prisma.user.findUnique({ where: { id: me.json.user.id } });
  const where = { userId: u.id };
  if (type) where.type = type;
  if (titleLike) where.title = { contains: titleLike };
  return prisma.notification.count({ where });
}

test('empréstimo contratado -> LOAN_CONTRACTED (respeita preferência)', async () => {
  const req = await api('POST', '/loans', {
    token: tokenA,
    body: { amount: 600, installments: 6 },
  });
  assert.strictEqual(req.status, 201, JSON.stringify(req));
  const loanId = req.json.loan?.id || req.json.id;

  const contract = await api('POST', `/loans/${loanId}/contract`, { token: tokenA });
  assert.ok([200, 201].includes(contract.status), JSON.stringify(contract));

  const u = await prisma.user.findUnique({ where: { email: EMAIL_A } });
  const contracted = await prisma.notification.findMany({
    where: { userId: u.id, dedupKey: `loan:${loanId}` },
  });
  assert.strictEqual(contracted.length, 1, 'exatamente um alerta por empréstimo');

  // parcela vencendo em 2 dias -> lembrete lazy via GET /loans
  const firstPending = await prisma.loanInstallment.findFirst({
    where: { loanId, status: 'PENDING' },
    orderBy: { number: 'asc' },
  });
  await prisma.loanInstallment.update({
    where: { id: firstPending.id },
    data: { dueDate: new Date(Date.now() + 2 * 864e5) },
  });

  await api('GET', '/loans', { token: tokenA });
  const due1 = await prisma.notification.findMany({
    where: { userId: u.id, dedupKey: `due:${firstPending.id}` },
  });
  assert.strictEqual(due1.length, 1, 'lembrete criado uma vez');

  await api('GET', '/loans', { token: tokenA });
  const due2 = await prisma.notification.findMany({
    where: { userId: u.id, dedupKey: `due:${firstPending.id}` },
  });
  assert.strictEqual(due2.length, 1, 'sem duplicidade no segundo acesso (dedup)');
});
