const { test } = require('node:test');
const assert = require('node:assert');
const { Prisma } = require('@prisma/client');
const { GoalsService, computeForecast } = require('../dist/goals/goals.service.js');

function dec(n) { return new Prisma.Decimal(n); }

function goalRow(overrides = {}) {
  const { extra, ...rest } = overrides;
  const base = {
    id: 'g1', userId: 'u1', name: 'Viagem', description: null,
    targetAmount: dec('5000'), currentAmount: dec('2850'),
    status: 'ACTIVE', deadline: new Date('2027-01-01'),
    createdAt: new Date('2026-06-01'), updatedAt: new Date('2026-08-01'),
    contributions: [
      { type: 'DEPOSIT', amount: dec('2850'), createdAt: new Date('2026-06-10') },
    ],
  };
  return { ...base, ...rest, ...(extra || {}) };
}

function prismaFor(rows = [goalRow()], account = { id: 'acc1', balance: dec('1000'), status: 'ACTIVE' }) {
  return {
    goal: {
      findMany: async () => rows,
      findFirst: async ({ where }) => rows.find((r) => r.id === where.id && r.userId === where.userId) || null,
      findUnique: async () => rows[0] || null,
      create: async ({ data }) => goalRow({ id: 'novo', ...data }),
      update: async ({ data, ...rest }) => {
        const base = rows.find((r) => r.id === rest.where.id) || rows[0];
        const merged = { ...base, ...data };
        if (data.currentAmount && data.currentAmount.increment !== undefined) {
          merged.currentAmount = base.currentAmount.add(data.currentAmount.increment);
        }
        return merged;
      },
      updateMany: async ({ where, data }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) return { count: 0 };
        if (where.status && row.status !== where.status) return { count: 0 };
        return { count: 1 };
      },
      delete: async () => ({ id: 'g1' }),
    },
    account: {
      findUnique: async () => account,
    },
    $transaction: async (fn) => fn({
      account: {
        updateMany: async ({ where }) => {
          if (where.balance && account.balance.lt(where.balance.gte)) return { count: 0 };
          return { count: 1 };
        },
        updateManyAlt: undefined,
      },
      goal: {
        updateMany: async () => ({ count: 1 }),
        update: async ({ data, where }) => {
          const base = rows.find((r) => r.id === where.id) || rows[0];
          const merged = { ...base };
          if (data.currentAmount && data.currentAmount.increment !== undefined) {
            merged.currentAmount = base.currentAmount.add(data.currentAmount.increment);
          }
          if (data.status) merged.status = data.status;
          return merged;
        },
      },
      transaction: { create: async (d) => ({ id: 'tx1', ...d.data }) },
      goalContribution: { create: async (d) => ({ id: 'c1', ...d.data }) },
    }),
  };
}

// ---------- previsão ----------

test('computeForecast sem aportes -> sem previsão', () => {
  const g = goalRow({ contributions: [] });
  assert.deepStrictEqual(computeForecast(g), { months: null, date: null });
});

test('computeForecast usa ritmo líquido dos aportes reais', () => {
  const now = Date.now();
  // janela de 10 dias -> clamp de meio mês => ritmo = líquido / 0.5
  const g = {
    currentAmount: dec('300'), targetAmount: dec('900'), status: 'ACTIVE',
    contributions: [
      { type: 'DEPOSIT', amount: dec('500'), createdAt: new Date(now - 10 * 864e5) },
      { type: 'WITHDRAW', amount: dec('200'), createdAt: new Date(now - 5 * 864e5) },
    ],
  };
  const f = computeForecast(g);
  // líquido 300 em 0.5 mês => ritmo 600/mês => restante 600 => exatamente 1 mês
  assert.strictEqual(f.months, 1);
  assert.ok(f.date instanceof Date && f.date.getTime() > Date.now());
});

test('computeForecast com retiradas maiores que aportes -> sem previsão', () => {
  const now = Date.now();
  const g = {
    currentAmount: dec('0'), targetAmount: dec('900'), status: 'ACTIVE',
    contributions: [
      { type: 'DEPOSIT', amount: dec('100'), createdAt: new Date(now - 60 * 864e5) },
      { type: 'WITHDRAW', amount: dec('400'), createdAt: new Date(now - 30 * 864e5) },
    ],
  };
  assert.strictEqual(computeForecast(g).months, null);
});

test('computeForecast meta concluída -> null', () => {
  const g = goalRow({ status: 'COMPLETED' });
  assert.strictEqual(computeForecast(g).months, null);
});

// ---------- listagem / cálculos ----------

test('list calcula percent, remaining e onTrack por deadline', async () => {
  const svc = new GoalsService(prismaFor([goalRow()]));
  const out = await svc.list('u1');
  const item = out.items[0];
  assert.strictEqual(item.targetAmount, 5000);
  assert.strictEqual(item.currentAmount, 2850);
  assert.strictEqual(item.remaining, 2150);
  assert.strictEqual(item.percent, 57);
  assert.strictEqual(item.onTrack, true);
  assert.ok(item.forecastMonths >= 1);
});

// ---------- criação ----------

test('create com deadline no passado -> 400', async () => {
  const svc = new GoalsService(prismaFor());
  await assert.rejects(
    svc.create('u1', { name: 'Viagem', targetAmount: 5000, deadline: '2020-01-01T00:00:00Z' }),
    { message: 'Data alvo deve ser hoje ou no futuro.' },
  );
});

// ---------- edição ----------

test('update em meta COMPLETED -> 409', async () => {
  const svc = new GoalsService(prismaFor([goalRow({ status: 'COMPLETED' })]));
  await assert.rejects(svc.update('u1', 'g1', { name: 'X' }), { message: /concluída/i });
});

test('update não permite objetivo menor que o já reservado', async () => {
  const svc = new GoalsService(prismaFor());
  await assert.rejects(
    svc.update('u1', 'g1', { targetAmount: 2000 }),
    { message: /não pode ser menor/i },
  );
});

// ---------- exclusão segura ----------

test('delete bloqueado enquanto houver valor reservado', async () => {
  const svc = new GoalsService(prismaFor());
  await assert.rejects(svc.remove('u1', 'g1'), { name: 'ConflictException' });
});

test('delete permitido com currentAmount = 0', async () => {
  const svc = new GoalsService(prismaFor([goalRow({ currentAmount: dec('0'), contributions: [] })]));
  const out = await svc.remove('u1', 'g1');
  assert.strictEqual(out.message, 'Meta excluída.');
});

test('delete de meta inexistente/outro usuário -> 404', async () => {
  const svc = new GoalsService(prismaFor([]));
  await assert.rejects(svc.remove('ghost-id', 'u1'), { name: 'NotFoundException' });
});
