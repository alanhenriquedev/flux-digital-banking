const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 3339;
const BASE = `http://127.0.0.1:${PORT}/api`;
const envFile = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const getEnv = (k) => { const m = envFile.match(new RegExp(`^${k}=(.*)$`, 'm')); return m ? m[1].replace(/^"|"$/g, '') : undefined; };
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: getEnv('DATABASE_URL') } } });
let server;
const suffix = Date.now().toString(36);
const emails = ['risk-a', 'risk-b', 'risk-c', 'risk-d'].map((v) => `${v}_${suffix}@flux.test`);
const PASSWORD = 'Flux2026x';
let tokenA;
let tokenB;

async function api(method, route, { token, body, headers = {} } = {}) {
  const res = await fetch(BASE + route, { method, headers: { 'Content-Type': 'application/json', ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
}
async function waitForServer() { for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/auth/me')).status === 401) return; } catch {} await new Promise((r) => setTimeout(r, 500)); } throw new Error('Servidor não subiu'); }
function cpf() { const b = String(Math.floor(100000000 + Math.random() * 899999999)); const d = (s) => { let x = 0; for (let i = 0; i < s.length; i++) x += Number(s[i]) * (s.length + 1 - i); const r = (x * 10) % 11; return r === 10 ? 0 : r; }; return b + d(b) + d(b + d(b)); }
async function registerLogin(email, deviceId) {
  const reg = await api('POST', '/auth/register', { body: { fullName: 'Risk Tester', email, cpf: cpf(), password: PASSWORD, acceptTerms: true } });
  assert.strictEqual(reg.status, 201);
  const u = await prisma.user.findUnique({ where: { email } });
  await prisma.user.update({ where: { id: u.id }, data: { emailVerified: true, emailVerifiedAt: new Date() } });
  const login = await api('POST', '/auth/login', { body: { email, password: PASSWORD, ...(deviceId ? { deviceId } : {}) } });
  assert.strictEqual(login.status, 201);
  return login.json.accessToken;
}
async function loginExisting(email, deviceId) {
  const login = await api('POST', '/auth/login', { body: { email, password: PASSWORD, deviceId } });
  assert.strictEqual(login.status, 201);
  return login.json.accessToken;
}

before(async () => {
  server = spawn(process.execPath, ['dist/main'], { cwd: path.join(__dirname, '..'), stdio: 'ignore', env: { ...process.env, PORT: String(PORT) } });
  await waitForServer();
  tokenA = await registerLogin(emails[0]);
  tokenB = await registerLogin(emails[1]);
  await registerLogin(emails[2]);
  await registerLogin(emails[3]);
});
after(async () => { try { await prisma.user.deleteMany({ where: { email: { in: emails } } }); } finally { await prisma.$disconnect(); if (server) server.kill(); } });

test('MEDIUM retorna confirmação sem movimentar e confirmação válida executa', async () => {
  const b = await prisma.account.findUnique({ where: { userId: (await prisma.user.findUnique({ where: { email: emails[1] } })).id } });
  const device = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const tokenNewDevice = await loginExisting(emails[0], device);
  const before = await prisma.account.findUnique({ where: { userId: (await prisma.user.findUnique({ where: { email: emails[0] } })).id } });
  const body = { accountNumber: b.number, amount: 10, idempotencyKey: '44444444-4444-4444-8444-444444444444' };
  const first = await api('POST', '/pix/send', { token: tokenNewDevice, body });
  assert.strictEqual(first.status, 201);
  assert.strictEqual(first.json.status, 'CONFIRMATION_REQUIRED');
  assert.strictEqual((await prisma.account.findUnique({ where: { id: before.id } })).balance.toString(), before.balance.toString());
  const confirmed = await api('POST', '/pix/send', { token: tokenNewDevice, body: { ...body, riskConfirmation: first.json.confirmationToken } });
  assert.strictEqual(confirmed.status, 201);
  assert.strictEqual((await prisma.account.findUnique({ where: { id: before.id } })).balance.toString(), before.balance.sub(10).toString());
});

test('score enviado pelo cliente não altera decisão e CRITICAL bloqueia antes do saldo', async () => {
  const userA = await prisma.user.findUnique({ where: { email: emails[0] } });
  const accountA = await prisma.account.findUnique({ where: { userId: userA.id } });
  const accountC = await prisma.account.findUnique({ where: { userId: (await prisma.user.findUnique({ where: { email: emails[2] } })).id } });
  const seed = await api('POST', '/pix/send', { token: tokenA, body: { accountNumber: accountC.number, amount: 10 } });
  assert.strictEqual(seed.status, 201);
  const tokenRisk = await loginExisting(emails[0], 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  const before = await prisma.account.findUnique({ where: { id: accountA.id } });
  const beforeTx = await prisma.transaction.count({ where: { accountId: accountA.id } });
  const tampered = await api('POST', '/pix/send', { token: tokenRisk, body: { accountNumber: (await prisma.account.findUnique({ where: { userId: (await prisma.user.findUnique({ where: { email: emails[1] } })).id } })).number, amount: 1000, riskScore: 0 } });
  assert.strictEqual(tampered.status, 400);
  const criticalTarget = await prisma.account.findUnique({ where: { userId: (await prisma.user.findUnique({ where: { email: emails[3] } })).id } });
  const critical = await api('POST', '/pix/send', { token: tokenRisk, body: { accountNumber: criticalTarget.number, amount: 1000 } });
  assert.strictEqual(critical.status, 403);
  assert.match(critical.json.message, /bloqueado por segurança/i);
  const after = await prisma.account.findUnique({ where: { id: accountA.id } });
  assert.strictEqual(after.balance.toString(), before.balance.toString());
  assert.strictEqual(await prisma.transaction.count({ where: { accountId: accountA.id } }), beforeTx);
});
