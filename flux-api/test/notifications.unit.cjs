const { test } = require('node:test');
const assert = require('node:assert');
const { NotificationsService } = require('../dist/notifications/notifications.service.js');

test('safeCreate persiste na outbox quando a criação falha', async () => {
  const queued = [];
  const prisma = {
    notification: { create: async () => { throw new Error('transient'); } },
    notificationOutbox: {
      create: async ({ data }) => { queued.push(data); return data; },
      findMany: async () => [],
    },
  };
  const service = new NotificationsService(prisma);
  await service.safeCreate({ userId: 'u1', type: 'PIX_OUT', title: 'PIX', entityType: 'transaction', entityId: 'tx1' });
  assert.strictEqual(queued.length, 1);
  assert.strictEqual(queued[0].dedupKey, 'PIX_OUT:transaction:tx1');
});

test('outbox reprocessa falha transitória e remove item entregue', async () => {
  let attempts = 0;
  let deleted = false;
  const item = { id: 'o1', userId: 'u1', type: 'PIX_OUT', title: 'PIX', message: null, amount: null, entityType: 'transaction', entityId: 'tx1', dedupKey: 'k1', attempts: 0 };
  const prisma = {
    notification: { create: async () => { attempts++; return { id: 'n1' }; } },
    notificationOutbox: {
      findMany: async () => deleted ? [] : [item],
      delete: async () => { deleted = true; },
      update: async () => {},
    },
  };
  const service = new NotificationsService(prisma);
  await service.processOutbox();
  assert.strictEqual(attempts, 1);
  assert.strictEqual(deleted, true);
});
