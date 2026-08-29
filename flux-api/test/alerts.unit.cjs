/* Unit — Lote 1 · Alertas (lógica de preferências, limiares e dedup) */
const { test } = require('node:test');
const assert = require('node:assert');
const { Prisma } = require('@prisma/client');
const { AlertsService } = require('../dist/alerts/alerts.service.js');

const SECRETLESS = {};

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function makeService({ settingsRows = [], created = [] } = {}) {
  const prisma = {
    alertSetting: {
      findMany: async () => settingsRows,
      findUnique: async ({ where }) =>
        settingsRows.find((r) => r.userId === where.userId_kind.userId && r.kind === where.userId_kind.kind) || null,
      upsert: async ({ where, create }) => {
        const row = {
          id: 's' + (settingsRows.length + 1),
          userId: where.userId_kind.userId,
          kind: where.userId_kind.kind,
          enabled: create.enabled ?? true,
          threshold: create.threshold ?? null,
        };
        settingsRows.push(row);
        return row;
      },
    },
    authSession: {
      findMany: async () => [],
    },
  };
  const notifications = {
    createNotification: async (data) => {
      if (data.dedupKey === 'dup') throw p2002();
      created.push(data);
      return { id: 'n' + (created.length) };
    },
    safeCreate: async (data) => {
      try { await notifications.createNotification(data); return true; } catch { return false; }
    },
  };
  const svc = new AlertsService(prisma, notifications);
  return { svc, prisma, created };
}

test('getSettings devolve catálogo completo com defaults', async () => {
  const { svc } = makeService();
  const out = await svc.getSettings('u1');
  assert.strictEqual(out.items.length, 8);
  const pixAbove = out.items.find((i) => i.kind === 'PIX_ABOVE');
  assert.strictEqual(pixAbove.enabled, true);
  assert.strictEqual(pixAbove.threshold, 1000);
  assert.strictEqual(pixAbove.hasThreshold, true);
  const newDevice = out.items.find((i) => i.kind === 'NEW_DEVICE_LOGIN');
  assert.strictEqual(newDevice.hasThreshold, false);
  assert.strictEqual(newDevice.threshold, null);
});

test('getSettings reflete linhas personalizadas', async () => {
  const { svc } = makeService({
    settingsRows: [
      { userId: 'u1', kind: 'PIX_ABOVE', enabled: false, threshold: new Prisma.Decimal(50) },
    ],
  });
  const out = await svc.getSettings('u1');
  const pixAbove = out.items.find((i) => i.kind === 'PIX_ABOVE');
  assert.strictEqual(pixAbove.enabled, false);
  assert.strictEqual(pixAbove.threshold, 50);
  assert.strictEqual(pixAbove.customThreshold, true);
});

test('isEnabled: sem linha -> habilitado; linha desabilitada -> falso', async () => {
  const { svc } = makeService();
  assert.strictEqual(await svc.isEnabled('u1', 'PIX_SENT'), true);

  const withRow = makeService({
    settingsRows: [{ userId: 'u1', kind: 'PIX_SENT', enabled: false }],
  });
  assert.strictEqual(await withRow.svc.isEnabled('u1', 'PIX_SENT'), false);
});

test('updateSetting faz upsert respeitando limiar do catálogo', async () => {
  const rows = [];
  const { svc } = makeService({ settingsRows: rows });
  await svc.updateSetting('u1', 'BALANCE_BELOW', { enabled: true, threshold: 250 });
  const row = rows.find((r) => r.kind === 'BALANCE_BELOW');
  assert.strictEqual(Number(row.threshold), 250);

  // sem limiar definido para NEW_DEVICE_LOGIN -> threshold fica null
  await svc.updateSetting('u1', 'NEW_DEVICE_LOGIN', { enabled: false });
  const nd = rows.find((r) => r.kind === 'NEW_DEVICE_LOGIN');
  assert.strictEqual(nd.threshold, null);
});

test('onPixSent: PIX_ABOVE dispara só acima do limiar (dedup via chave por transação)', async () => {
  const { svc, created } = makeService();
  await svc.onPixSent({ userId: 'u1', txId: 'tx1', amount: 1500, counterpartyName: 'B', counterpartyNumber: '1', balanceAfter: null });
  const alert = created.find((c) => c.type === 'ALERT_MOVEMENT');
  assert.ok(alert, 'alerta criado');
  assert.strictEqual(alert.dedupKey, 'pixabove:tx1');

  const { svc: svc2, created: created2 } = makeService();
  await svc2.onPixSent({ userId: 'u1', txId: 'tx2', amount: 500, counterpartyName: 'B', counterpartyNumber: '1', balanceAfter: null });
  assert.strictEqual(created2.length, 0, 'abaixo do limiar não cria');
});

test('onPixSent: BALANCE_BELOW usa saldo após a movimentação', async () => {
  const { svc, created } = makeService();
  await svc.onPixSent({ userId: 'u1', txId: 'tx9', amount: 10, counterpartyName: 'B', counterpartyNumber: '1', balanceAfter: 40 });
  const low = created.find((c) => c.title.includes('Saldo abaixo'));
  assert.ok(low, 'alerta de saldo criado');

  const { svc: svc2, created: c2 } = makeService();
  await svc2.onPixSent({ userId: 'u1', txId: 'txA', amount: 10, counterpartyName: 'B', counterpartyNumber: '1', balanceAfter: 900 });
  assert.strictEqual(c2.length, 0);
});

test('dispatch idempotente: P2002 é engolido (já notificado)', async () => {
  const prisma = { alertSetting: { findUnique: async () => ({ enabled: true, threshold: null }) } };
  let attempts = 0;
  const svc = new AlertsService(prisma, {
    createNotification: async () => { attempts++; throw p2002(); },
    safeCreate: async () => { attempts++; return false; },
  });
  await svc.onPixSent({ userId: 'u1', txId: 'dup', amount: 5000, counterpartyName: 'B', counterpartyNumber: '1', balanceAfter: null });
  assert.strictEqual(attempts, 1, 'tentou criar exatamente uma vez');
});

test('dispatch usa a outbox quando a notificação do alerta falha', async () => {
  const queued = [];
  const prisma = {
    alertSetting: { findUnique: async () => null },
    notificationOutbox: { create: async ({ data }) => { queued.push(data); return data; } },
  };
  const svc = new AlertsService(prisma, {
    createNotification: async () => { throw new Error('transient'); },
    safeCreate: async (data) => { queued.push(data); return true; },
  });
  await svc.onPixSent({ userId: 'u1', txId: 'tx-outbox', amount: 5000, counterpartyName: 'B', counterpartyNumber: '1', balanceAfter: null });
  assert.strictEqual(queued.length, 1);
  assert.strictEqual(queued[0].dedupKey, 'pixabove:tx-outbox');
});

// ---------- onLogin ----------

function loginCtx(hash, ip) {
  return { userId: 'u1', sessionId: 'sid', deviceIdHash: hash, deviceLabel: 'Chrome no Windows', ip };
}

test('onLogin: sem deviceIdHash (legado) -> nenhum alerta', async () => {
  const { svc, created } = makeService();
  await svc.onLogin(loginCtx(null, '127.0.0.1'));
  assert.strictEqual(created.length, 0);
});

test('onLogin: primeiro dispositivo da conta -> sem alerta de novo dispositivo', async () => {
  const prisma = {
    alertSetting: { findUnique: async () => null },
    authSession: { findMany: async () => [] },
  };
  const created = [];
  const svc = new AlertsService(prisma, { createNotification: async (d) => { created.push(d); return { id: 'n' }; }, safeCreate: async (d) => { created.push(d); return true; } });
  await svc.onLogin(loginCtx('hash-a', '189.28.12.7'));
  assert.strictEqual(created.length, 0);
});

test('onLogin: hash novo após já ter dispositivos -> NEW_DEVICE_LOGIN', async () => {
  const previous = [{ deviceIdHash: 'hash-a', ip: '189.28.12.7' }];
  const prisma = {
    alertSetting: { findUnique: async () => null },
    authSession: { findMany: async () => previous },
  };
  const created = [];
  const svc = new AlertsService(prisma, { createNotification: async (d) => { created.push(d); return { id: 'n' }; }, safeCreate: async (d) => { created.push(d); return true; } });
  await svc.onLogin(loginCtx('hash-b', '189.28.99.99'));
  assert.strictEqual(created.length, 1);
  assert.strictEqual(created[0].type, 'ALERT_SECURITY');
  assert.strictEqual(created[0].dedupKey, 'login:sid');
});

test('onLogin: mesmo dispositivo, rede diferente -> SUSPICIOUS_LOGIN', async () => {
  const previous = [{ deviceIdHash: 'hash-a', ip: '189.28.12.7' }];
  const prisma = {
    alertSetting: { findUnique: async () => null },
    authSession: { findMany: async () => previous },
  };
  const created = [];
  const svc = new AlertsService(prisma, { createNotification: async (d) => { created.push(d); return { id: 'n' }; }, safeCreate: async (d) => { created.push(d); return true; } });
  await svc.onLogin(loginCtx('hash-a', '177.40.9.9'));
  assert.strictEqual(created.length, 1);
  assert.ok(created[0].title.toLowerCase().includes('rede'));
});

test('onLogin: mesmo dispositivo e mesma rede -> nada', async () => {
  const previous = [{ deviceIdHash: 'hash-a', ip: '189.28.12.7' }];
  const prisma = {
    alertSetting: { findUnique: async () => null },
    authSession: { findMany: async () => previous },
  };
  const created = [];
  const svc = new AlertsService(prisma, { createNotification: async (d) => { created.push(d); return { id: 'n' }; }, safeCreate: async (d) => { created.push(d); return true; } });
  await svc.onLogin(loginCtx('hash-a', '189.28.99.1'));
  assert.strictEqual(created.length, 0);
});

test('onBalanceChanged alerta somente na transição abaixo/acima do limite', async () => {
  const states = [];
  const created = [];
  const prisma = {
    alertSetting: { findUnique: async () => ({ enabled: true, threshold: new Prisma.Decimal(100) }) },
    alertState: {
      findUnique: async () => states[0] || null,
      create: async ({ data }) => { states[0] = { id: 's1', ...data }; return states[0]; },
      update: async ({ data }) => { Object.assign(states[0], data); return states[0]; },
      updateMany: async ({ data }) => { Object.assign(states[0], data); return { count: 1 }; },
    },
    $transaction: async (fn) => fn({ alertState: prisma.alertState }),
  };
  const svc = new AlertsService(prisma, { createNotification: async (d) => { created.push(d); return { id: 'n' }; }, safeCreate: async (d) => { created.push(d); return true; } });

  await svc.onBalanceChanged({ userId: 'u1', before: 150, after: 80, entityId: 'a' });
  await svc.onBalanceChanged({ userId: 'u1', before: 80, after: 70, entityId: 'b' });
  await svc.onBalanceChanged({ userId: 'u1', before: 70, after: 120, entityId: 'c' });
  await svc.onBalanceChanged({ userId: 'u1', before: 120, after: 90, entityId: 'd' });

  assert.strictEqual(created.length, 2);
  assert.strictEqual(Number(created[0].amount), 80);
  assert.strictEqual(Number(created[1].amount), 90);
});
