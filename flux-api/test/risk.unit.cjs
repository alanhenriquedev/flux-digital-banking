const { test } = require('node:test');
const assert = require('node:assert');
const { Prisma } = require('@prisma/client');
const { RiskEngineService } = require('../dist/risk/risk-engine.service.js');

function makeService({ current = null, previous = [], accountId = 'a1', history = [] } = {}) {
  const prisma = {
    authSession: {
      findFirst: async () => current,
      findMany: async () => previous,
    },
    account: { findUnique: async () => ({ id: accountId }) },
    transaction: { findMany: async () => history },
  };
  const notifications = { safeCreate: async () => true };
  const config = { get: () => 'risk-test-secret' };
  return new RiskEngineService(prisma, config, notifications);
}

const base = {
  accountNumber: '22222222', amount: 50, description: null,
  sessionId: 's1', ip: '10.1.1.5', now: new Date('2026-08-27T12:00:00'),
};

test('PIX normal sem sinais relevantes -> LOW', async () => {
  const svc = makeService({
    current: { deviceIdHash: 'known', ip: '10.1.1.1' },
    previous: [{ deviceIdHash: 'known', ip: '10.1.1.2' }],
    history: [{ amount: new Prisma.Decimal(50), counterpartyNumber: '22222222' }],
  });
  const result = await svc.assess('u1', base);
  assert.strictEqual(result.score, 0);
  assert.strictEqual(result.level, 'LOW');
  assert.deepStrictEqual(result.signals, []);
});

test('cada sinal objetivo é identificado e os pesos são somados', async () => {
  const svc = makeService({
    current: { deviceIdHash: 'new', ip: '10.1.1.1' },
    previous: [{ deviceIdHash: 'old', ip: '192.168.1.2' }],
    history: [{ amount: new Prisma.Decimal(100), counterpartyNumber: '33333333' }],
  });
  const result = await svc.assess('u1', { ...base, amount: 1000, now: new Date('2026-08-27T23:00:00') });
  assert.strictEqual(result.score, 100);
  assert.strictEqual(result.level, 'CRITICAL');
  assert.deepStrictEqual(result.signals, ['NEW_DEVICE', 'NEW_RECIPIENT', 'HIGH_VALUE', 'UNUSUAL_HOUR', 'DIFFERENT_NETWORK']);
});

test('faixas MEDIUM e HIGH são determinísticas', async () => {
  const medium = await makeService({
    current: { deviceIdHash: 'new', ip: '10.1.1.1' },
    previous: [{ deviceIdHash: 'old', ip: '10.1.1.1' }],
    history: [{ amount: new Prisma.Decimal(50), counterpartyNumber: '22222222' }],
  }).assess('u1', base);
  assert.strictEqual(medium.score, 30);
  assert.strictEqual(medium.level, 'MEDIUM');

  const high = await makeService({
    current: { deviceIdHash: 'new', ip: '10.1.1.1' },
    previous: [{ deviceIdHash: 'old', ip: '10.1.1.1' }],
    history: [{ amount: new Prisma.Decimal(100), counterpartyNumber: '22222222' }],
  }).assess('u1', { ...base, amount: 1000, now: new Date('2026-08-27T23:00:00') });
  assert.strictEqual(high.score, 65);
  assert.strictEqual(high.level, 'HIGH');
});

test('confirmação é assinada, vinculada ao usuário e ao payload', async () => {
  const svc = makeService({
    current: { deviceIdHash: 'new', ip: '10.1.1.1' },
    previous: [{ deviceIdHash: 'old', ip: '10.1.1.1' }],
    history: [{ amount: new Prisma.Decimal(50), counterpartyNumber: '22222222' }],
  });
  const assessment = await svc.assess('u1', base);
  assert.strictEqual(svc.decision('u1', assessment), 'CONFIRM');
  const token = svc.confirmationToken('u1', assessment);
  assert.strictEqual(svc.decision('u1', assessment, token), 'EXECUTE');
  assert.strictEqual(svc.decision('u2', assessment, token), 'CONFIRM');
  assert.strictEqual(svc.decision('u1', { ...assessment, operationHash: 'tampered' }, token), 'CONFIRM');
});
