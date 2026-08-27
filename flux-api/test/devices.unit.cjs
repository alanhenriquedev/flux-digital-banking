const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const { validate, IsUUID, MaxLength, IsOptional } = require('class-validator');

const util = require('../dist/security/security.util.js');
const { SecurityService } = require('../dist/security/security.service.js');
const { AuthService } = require('../dist/auth/auth.service.js');
const { LoginDto } = require('../dist/auth/dto/login.dto.js');

const SECRET = 'unit-secret';
const configStub = {
  get: (k) => {
    if (k === 'SESSION_TOUCH_INTERVAL_MS') return '300000';
    if (k === 'SESSION_EXPIRES_IN') return '7d';
    if (k === 'DEVICE_ID_HASH_SECRET') return SECRET;
    return undefined;
  },
};

function hmac(raw, secret = SECRET) {
  return crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
}

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

// ---------- util ----------

test('hashDeviceId é determinístico, HMAC-SHA256 e nunca devolve o valor cru', () => {
  const h1 = util.hashDeviceId(UUID_A, SECRET);
  const h2 = util.hashDeviceId(UUID_A, SECRET);
  assert.strictEqual(h1, h2);
  assert.strictEqual(h1.length, 64);
  assert.ok(/^[0-9a-f]{64}$/.test(h1));
  assert.notStrictEqual(h1, UUID_A);
  assert.ok(!h1.includes(UUID_A.slice(0, 8)));
});

test('hashDeviceId muda com o segredo (segredos diferentes -> hashes diferentes)', () => {
  assert.notStrictEqual(util.hashDeviceId(UUID_A, SECRET), util.hashDeviceId(UUID_A, 'outro'));
});

test('isValidDeviceId aceita apenas UUID v4 até 64 chars', () => {
  assert.strictEqual(util.isValidDeviceId(UUID_A), true);
  assert.strictEqual(util.isValidDeviceId(UUID_A.toUpperCase()), true);
  assert.strictEqual(util.isValidDeviceId('nao-e-uuid'), false);
  assert.strictEqual(util.isValidDeviceId('a'.repeat(63)), false); // uuid inválido
  assert.strictEqual(util.isValidDeviceId(`${UUID_A}${UUID_A}`), false); // > 64
  assert.strictEqual(util.isValidDeviceId(null), false);
  assert.strictEqual(util.isValidDeviceId(123), false);
});

// ---------- mocks ----------

function row(overrides = {}) {
  return {
    id: overrides.id || 's1',
    userId: 'u1',
    deviceLabel: overrides.deviceLabel || 'Chrome no Windows',
    ip: overrides.ip ?? '189.28.12.7',
    userAgent: overrides.userAgent || 'ua',
    deviceIdHash: overrides.hash !== undefined ? overrides.hash : hmac(UUID_A),
    createdAt: overrides.createdAt || new Date('2026-08-20T10:00:00Z'),
    lastUsedAt: overrides.lastUsedAt || new Date('2026-08-21T10:00:00Z'),
    expiresAt: overrides.expiresAt || new Date(Date.now() + 86_400_000),
    ...overrides.extra,
  };
}

function prismaForList(rows) {
  return {
    authSession: {
      findMany: async () => rows,
      findFirst: async () => null,
      updateMany: async () => ({ count: 0 }),
    },
  };
}

// ---------- createSession ----------

test('createSession persiste somente o HASH do deviceId (nunca o UUID cru)', async () => {
  let created;
  const prisma = { authSession: { create: async (d) => { created = d.data; return { id: 'ns', ...d.data }; } } };
  const svc = new SecurityService(prisma, configStub);

  await svc.createSession('u1', { ip: '10.0.0.1', userAgent: 'ua', deviceId: UUID_A });

  assert.strictEqual(created.deviceIdHash, hmac(UUID_A));
  assert.ok(!JSON.stringify(created).includes(UUID_A), 'UUID cru não pode aparecer no payload gravado');
});

test('createSession sem deviceId grava deviceIdHash null (login segue normal)', async () => {
  let created;
  const prisma = { authSession: { create: async (d) => { created = d.data; return { id: 'ns', ...d.data }; } } };
  const svc = new SecurityService(prisma, configStub);

  await svc.createSession('u1', { ip: '10.0.0.1', userAgent: 'ua' });
  assert.strictEqual(created.deviceIdHash, null);
});

test('createSession com deviceId inválido grava null em vez de quebrar o login', async () => {
  let created;
  const prisma = { authSession: { create: async (d) => { created = d.data; return { id: 'ns', ...d.data }; } } };
  const svc = new SecurityService(prisma, configStub);

  await svc.createSession('u1', { deviceId: 'injecao-nao-uuid' });
  assert.strictEqual(created.deviceIdHash, null);
});

// ---------- listActiveSessions: agrupamento ----------

test('3 logins no mesmo navegador -> 1 dispositivo / sessionCount 3 / representante mais recente', async () => {
  const rows = [
    row({ id: 's3', createdAt: new Date('2026-08-22T10:00:00Z'), lastUsedAt: new Date('2026-08-23T10:00:00Z') }),
    row({ id: 's2', createdAt: new Date('2026-08-21T10:00:00Z') }),
    row({ id: 's1', createdAt: new Date('2026-08-20T10:00:00Z') }),
  ];
  const svc = new SecurityService(prismaForList(rows), configStub);
  const out = await svc.listActiveSessions('u1', 's1');

  assert.strictEqual(out.items.length, 1, 'mesmo navegador deve vir agrupado');
  assert.strictEqual(out.items[0].sessionCount, 3);
  assert.strictEqual(out.items[0].id, 's3', 'representação = sessão mais recente');
  assert.strictEqual(out.items[0].current, true, 'sid atual pertence ao grupo');
});

test('navegadores diferentes -> dispositivos separados com contagens corretas', async () => {
  const rows = [
    row({ id: 'c3', createdAt: new Date('2026-08-22T10:00:00Z'), hash: hmac(UUID_A) }),
    row({ id: 'c2', createdAt: new Date('2026-08-21T09:00:00Z'), hash: hmac(UUID_A) }),
    row({ id: 'c1', createdAt: new Date('2026-08-20T08:00:00Z'), hash: hmac(UUID_A) }),
    row({ id: 'e1', createdAt: new Date('2026-08-19T08:00:00Z'), hash: hmac(UUID_B), deviceLabel: 'Edge no Windows' }),
  ];
  const svc = new SecurityService(prismaForList(rows), configStub);
  const out = await svc.listActiveSessions('u1', 'e1');

  assert.strictEqual(out.items.length, 2);
  assert.deepStrictEqual(out.items.map((i) => i.sessionCount), [3, 1]);
  assert.strictEqual(out.items[0].deviceLabel, 'Chrome no Windows');
  assert.strictEqual(out.items[1].deviceLabel, 'Edge no Windows');
  assert.strictEqual(out.items.filter((i) => i.current).length, 1);
  assert.strictEqual(out.items.find((i) => i.id === 'e1').current, true);
});

test('sessões legadas (deviceIdHash null) continuam aparecendo individualmente', async () => {
  const rows = [
    row({ id: 'new1', createdAt: new Date('2026-08-22T10:00:00Z'), hash: hmac(UUID_A) }),
    row({ id: 'legacy1', createdAt: new Date('2026-08-18T10:00:00Z'), hash: null }),
    row({ id: 'legacy2', createdAt: new Date('2026-08-17T10:00:00Z'), hash: null }),
  ];
  const svc = new SecurityService(prismaForList(rows), configStub);
  const out = await svc.listActiveSessions('u1', 'legacy1');

  assert.strictEqual(out.items.length, 3, 'legadas não se agrupam entre si');
  const legacies = out.items.filter((i) => i.id.startsWith('legacy'));
  for (const l of legacies) assert.strictEqual(l.sessionCount, 1);
  assert.strictEqual(out.items.find((i) => i.id === 'legacy1').current, true);
  assert.strictEqual(out.items.find((i) => i.id === 'new1').sessionCount, 1);
});

test('listagem ordena por sessão mais recente e mascara IP/UA como antes', async () => {
  const rows = [
    row({ id: 'b1', hash: hmac(UUID_B), createdAt: new Date('2026-08-25T10:00:00Z'), ip: '200.10.20.30' }),
    row({ id: 'a2', hash: hmac(UUID_A), createdAt: new Date('2026-08-24T10:00:00Z') }),
    row({ id: 'a1', hash: hmac(UUID_A), createdAt: new Date('2026-08-01T10:00:00Z') }),
  ];
  const svc = new SecurityService(prismaForList(rows), configStub);
  const out = await svc.listActiveSessions('u1', null);

  assert.deepStrictEqual(out.items.map((i) => i.id), ['b1', 'a2']);
  assert.strictEqual(out.items[0].ipMasked, '200.10.***.***');
  assert.ok(out.items[0].userAgent.length <= 100);
});

// ---------- revokeDevice ----------

test('revokeDevice revoga TODAS as sessões do grupo (userId + deviceIdHash)', async () => {
  let where;
  const svc = new SecurityService(
    {
      authSession: {
        findFirst: async () => ({ id: 's3', deviceIdHash: hmac(UUID_A) }),
        updateMany: async (d) => { where = d.where; return { count: 3 }; },
      },
    },
    configStub,
  );
  const out = await svc.revokeDevice('s3', 'u1');

  assert.strictEqual(out.revoked, true);
  assert.strictEqual(where.userId, 'u1');
  assert.strictEqual(where.deviceIdHash, hmac(UUID_A));
  assert.strictEqual(where.revokedAt, null);
  assert.strictEqual(out.sessionsRevoked, 3);
});

test('revokeDevice em sessão legada (null) revoga apenas ela mesma', async () => {
  let where;
  const svc = new SecurityService(
    {
      authSession: {
        findFirst: async () => ({ id: 'legacy1', deviceIdHash: null }),
        updateMany: async (d) => { where = d.where; return { count: 1 }; },
      },
    },
    configStub,
  );
  const out = await svc.revokeDevice('legacy1', 'u1');

  assert.strictEqual(where.id, 'legacy1');
  assert.strictEqual(where.deviceIdHash, undefined);
  assert.strictEqual(out.revoked, true);
  assert.strictEqual(out.sessionsRevoked, 1);
});

test('revokeDevice é à prova de cross-user (404 sem vazar existência)', async () => {
  const svc = new SecurityService(
    {
      authSession: {
        findFirst: async (d) => {
          // sempre filtrado por userId: sessão de outro usuário nunca é encontrada
          assert.strictEqual(d.where.userId, 'u1');
          return null;
        },
        updateMany: async () => ({ count: 0 }),
      },
    },
    configStub,
  );
  await assert.rejects(svc.revokeDevice('sessao-de-outro', 'u1'), { name: 'NotFoundException' });
});

test('revokeDevice idempotente: grupo já revogado -> alreadyRevoked', async () => {
  const svc = new SecurityService(
    {
      authSession: {
        findFirst: async () => ({ id: 's1', deviceIdHash: hmac(UUID_A) }),
        updateMany: async () => ({ count: 0 }),
      },
    },
    configStub,
  );
  const out = await svc.revokeDevice('s1', 'u1');
  assert.strictEqual(out.revoked, false);
  assert.strictEqual(out.alreadyRevoked, true);
});

// ---------- fluxo de login ----------

function buildAuth(securityOverride) {
  const passwordHash = bcrypt.hashSync('Senha#2026', 4);
  return new AuthService(
    { findByEmail: async () => ({ id: 'u1', email: 'a@b.com', passwordHash, emailVerified: true, fullName: 'A B', cpf: '123' }) },
    { findByUserId: async () => ({ id: 'acc1', agency: '0001', number: '1', balance: 10 }) },
    { signAsync: async () => 'tok' },
    {},
    { get: () => 'false' },
    { safeCreate: async () => {} },
    securityOverride,
  );
}

test('login encaminha deviceId ao SecurityService dentro do contexto', async () => {
  let captured;
  const auth = buildAuth({
    createSession: async (userId, ctx) => { captured = ctx; return { id: 's1', expiresAt: new Date() }; },
    safeCreateLoginRecord: async () => {},
  });
  await auth.login({ email: 'a@b.com', password: 'Senha#2026' }, { ip: '10.0.0.9', userAgent: 'ua', deviceId: UUID_A });
  assert.strictEqual(captured.deviceId, UUID_A);
});

test('login sem deviceId continua funcionando (compatibilidade)', async () => {
  let captured;
  const auth = buildAuth({
    createSession: async (userId, ctx) => { captured = ctx; return { id: 's1', expiresAt: new Date() }; },
    safeCreateLoginRecord: async () => {},
  });
  const out = await auth.login({ email: 'a@b.com', password: 'Senha#2026' }, { ip: '10.0.0.9', userAgent: 'ua' });
  assert.strictEqual(out.accessToken, 'tok');
  assert.strictEqual(captured.deviceId, undefined);
});

// ---------- DTO ----------

async function dtoResult(plain) {
  const dto = Object.assign(new LoginDto(), plain);
  const errors = await validate(dto, { skipMissingProperties: false });
  return errors;
}

test('LoginDto: deviceId ausente continua válido', async () => {
  const errors = await dtoResult({ email: 'a@b.com', password: 'x' });
  const deviceErrors = errors.filter((e) => e.property === 'deviceId');
  assert.strictEqual(deviceErrors.length, 0);
});

test('LoginDto: deviceId válido (uuid v4) passa', async () => {
  const errors = await dtoResult({ email: 'a@b.com', password: 'x', deviceId: UUID_A });
  assert.strictEqual(errors.length, 0);
});

test('LoginDto: deviceId malformado é rejeitado (nunca chega ao serviço)', async () => {
  const errors = await dtoResult({ email: 'a@b.com', password: 'x', deviceId: 'javascript:alert(1)' });
  assert.ok(errors.some((e) => e.property === 'deviceId'));
});

// sanity: IsUUID/MaxLength/IsOptional importados são os mesmos usados pelo DTO
test('sanity dos decorators do DTO', () => {
  assert.strictEqual(typeof IsUUID, 'function');
  assert.strictEqual(typeof MaxLength, 'function');
  assert.strictEqual(typeof IsOptional, 'function');
});
