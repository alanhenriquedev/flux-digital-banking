const { test } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcrypt');

const util = require('../dist/security/security.util.js');
const { SecurityService } = require('../dist/security/security.service.js');
const { AuthService } = require('../dist/auth/auth.service.js');
const { JwtStrategy } = require('../dist/auth/strategies/jwt.strategy.js');

const configStub = {
  get: (k) => {
    if (k === 'SESSION_TOUCH_INTERVAL_MS') return '300000';
    if (k === 'SESSION_EXPIRES_IN') return '7d';
    return undefined;
  },
};

test('maskIp mascara IPv4 mantendo só os dois primeiros octetos', () => {
  assert.strictEqual(util.maskIp('189.28.12.7'), '189.28.***.***');
});

test('maskIp mascara IPv4 mapeado (::ffff:a.b.c.d)', () => {
  assert.strictEqual(util.maskIp('::ffff:189.28.12.7'), '189.28.***.***');
});

test('maskIp mascara IPv6', () => {
  const masked = util.maskIp('2001:0db8:85a3:0000:0000:8a2e:0370:7334');
  assert.ok(masked.includes(':****:'));
  assert.ok(!masked.includes('8a2e'));
});

test('maskIp devolve null para ausência', () => {
  assert.strictEqual(util.maskIp(null), null);
  assert.strictEqual(util.maskIp(undefined), null);
});

test('truncate limita a 255 caracteres', () => {
  const long = 'a'.repeat(400);
  assert.strictEqual(util.sanitizeUserAgent(long).length, 255);
  assert.strictEqual(util.sanitizeUserAgent('curto'), 'curto');
});

test('summarizeUserAgent gera rótulos simples', () => {
  assert.strictEqual(
    util.summarizeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'),
    'Chrome no Windows',
  );
  assert.strictEqual(
    util.summarizeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edg/126.0 Safari/537.36'),
    'Edge no Windows',
  );
  assert.strictEqual(
    util.summarizeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'),
    'Safari no iPhone',
  );
});

function mockPrisma(overrides = {}) {
  return {
    $transaction: async (fn) => fn({
      loginHistory: { create: overrides.createLogin || (async (d) => ({ id: 'h1', ...d })) },
      user: { update: overrides.updateUser || (async (d) => ({ id: 'u1', ...d.data })) },
    }),
    user: {
      findUnique: overrides.findUser || (async () => ({
        lastLoginAt: new Date('2026-08-18T12:00:00Z'),
        createdAt: new Date('2026-01-01T00:00:00Z'),
        emailVerified: true,
        emailVerifiedAt: new Date('2026-01-01T01:00:00Z'),
      })),
    },
    loginHistory: {
      count: overrides.count || (async () => 3),
      findMany: overrides.findMany || (async () => [
        {
          id: 'h3', ip: '189.28.12.7', userAgent: 'ua-b' + 'x'.repeat(200),
          deviceLabel: 'Chrome no Windows', createdAt: new Date('2026-08-18T12:00:00Z'),
        },
        {
          id: 'h2', ip: '10.0.0.4', userAgent: 'ua-a', deviceLabel: 'Edge no Windows',
          createdAt: new Date('2026-08-17T12:00:00Z'),
        },
      ]),
    },
    authSession: {
      create: overrides.sessionCreate || (async (d) => ({ id: 'ns', ...d.data })),
      findUnique: overrides.findSession || (async () => null),
      updateMany: overrides.sessionUpdateMany || (async (d) => ({ count: 1 })),
      findFirst: overrides.findSessionFirst || (async () => ({ id: 's1' })),
      findMany: overrides.sessionFindMany || (async () => []),
    },
  };
}

test('safeCreateLoginRecord engole falha do banco (não rejeita)', async () => {
  const prisma = { $transaction: async () => { throw new Error('db down'); } };
  const svc = new SecurityService(prisma, configStub);
  await assert.doesNotReject(svc.safeCreateLoginRecord('u1', { ip: '10.0.0.1', userAgent: 'x' }));
});

test('safeCreateLoginRecord persiste histórico e lastLoginAt, com UA truncada', async () => {
  let capturedLogin;
  let capturedUpdate;
  const prisma = {
    $transaction: async (fn) => fn({
      loginHistory: {
        create: async (d) => { capturedLogin = d.data; return { id: 'h1' }; },
      },
      user: {
        update: async (d) => { capturedUpdate = d; return {}; },
      },
    }),
  };
  const svc = new SecurityService(prisma, configStub);
  const longUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' + 'y'.repeat(400);
  await svc.safeCreateLoginRecord('u1', { ip: '189.28.12.7', userAgent: longUa });

  assert.strictEqual(capturedLogin.userId, 'u1');
  assert.strictEqual(capturedLogin.ip, '189.28.12.7');
  assert.ok(capturedLogin.userAgent.length <= 255, `UA armazenada com ${capturedLogin.userAgent.length} chars`);
  assert.strictEqual(capturedLogin.deviceLabel, 'Chrome no Windows');
  assert.strictEqual(capturedUpdate.where.id, 'u1');
  assert.ok(capturedUpdate.data.lastLoginAt instanceof Date);
});

test('createSession grava sessão com TTL, IP sanitizado e deviceLabel', async () => {
  let created;
  const prisma = {
    authSession: {
      create: async (d) => { created = d.data; return { id: 'ns', ...d.data }; },
    },
  };
  const svc = new SecurityService(prisma, configStub);
  const ttlMs = 10_000;
  await svc.createSession('u1', { ip: '189.28.12.7', userAgent: 'Mozilla/5.0 (Windows NT; Chrome/126.0 Safari/537.36)' }, ttlMs);

  assert.strictEqual(created.userId, 'u1');
  assert.strictEqual(created.ip, '189.28.12.7');
  assert.strictEqual(created.deviceLabel, 'Chrome no Windows');
  assert.strictEqual(created.expiresAt.getTime() - created.lastUsedAt.getTime(), ttlMs);
});

test('touchSession respeita throttle de 5 minutos', async () => {
  let updateCalls = 0;
  const svc = new SecurityService(
    { authSession: { updateMany: async () => { updateCalls++; return { count: 1 }; } } },
    configStub,
  );
  await svc.touchSession('s1');
  await svc.touchSession('s1');
  await svc.touchSession('s1');
  assert.strictEqual(updateCalls, 1, 'apenas 1 write dentro do intervalo');
});

test('falha ao atualizar lastUsedAt não rejeita (autenticação intacta)', async () => {
  const svc = new SecurityService(
    { authSession: { updateMany: async () => { throw new Error('db'); } } },
    configStub,
  );
  await assert.doesNotReject(svc.touchSession('s1'));
});

test('listActiveSessions mascara IP, resume UA e marca a atual', async () => {
  const prisma = mockPrisma({
    sessionFindMany: async () => [
      {
        id: 's1', userId: 'u1', deviceLabel: 'Chrome no Windows', ip: '189.28.12.7',
        userAgent: 'ua', createdAt: new Date(), lastUsedAt: new Date(), expiresAt: new Date(),
      },
    ],
  });
  const svc = new SecurityService(prisma, configStub);
  const out = await svc.listActiveSessions('u1', 's1');
  assert.strictEqual(out.items.length, 1);
  assert.strictEqual(out.items[0].current, true);
  assert.strictEqual(out.items[0].ipMasked, '189.28.***.***');
  assert.ok(out.items[0].userAgent.length <= 100);
});

test('revokeSession revoga com id+userId', async () => {
  let where;
  const svc = new SecurityService(
    {
      authSession: {
        updateMany: async (d) => { where = d.where; return { count: 1 }; },
        findFirst: async () => ({ id: 's1' }),
      },
    },
    configStub,
  );
  const out = await svc.revokeSession('s1', 'u1');
  assert.strictEqual(out.revoked, true);
  assert.strictEqual(where.id, 's1');
  assert.strictEqual(where.userId, 'u1');
});

test('revokeSession idempotente: segunda chamada -> alreadyRevoked', async () => {
  const svc = new SecurityService(
    {
      authSession: {
        updateMany: async () => ({ count: 0 }),
        findFirst: async () => ({ id: 's1' }),
      },
    },
    configStub,
  );
  const out = await svc.revokeSession('s1', 'u1');
  assert.strictEqual(out.revoked, false);
  assert.strictEqual(out.alreadyRevoked, true);
});

test('revokeSession de sessão inexistente -> 404', async () => {
  const svc = new SecurityService(
    {
      authSession: {
        updateMany: async () => ({ count: 0 }),
        findFirst: async () => null,
      },
    },
    configStub,
  );
  await assert.rejects(svc.revokeSession('ghost', 'u1'), { name: 'NotFoundException' });
});

test('revokeOthers revoga todas exceto a atual', async () => {
  let where;
  const svc = new SecurityService(
    {
      authSession: {
        updateMany: async (d) => { where = d.where; return { count: 3 }; },
      },
    },
    configStub,
  );
  const out = await svc.revokeOthers('u1', 'currentSid');
  assert.strictEqual(out.revoked, 3);
  assert.strictEqual(where.userId, 'u1');
  assert.strictEqual(where.id.not, 'currentSid');
});

test('revokeCurrent revoga a sessão do token', async () => {
  let where;
  const svc = new SecurityService(
    {
      authSession: {
        updateMany: async (d) => { where = d.where; return { count: 1 }; },
      },
    },
    configStub,
  );
  await svc.revokeCurrent('s1', 'u1');
  assert.strictEqual(where.id, 's1');
  assert.strictEqual(where.userId, 'u1');
});

test('revokeCurrent com sid nulo não toca o banco', async () => {
  let calls = 0;
  const svc = new SecurityService(
    { authSession: { updateMany: async () => { calls++; return { count: 0 }; } } },
    configStub,
  );
  await svc.revokeCurrent(null, 'u1');
  assert.strictEqual(calls, 0);
});

test('revokeAll usa o motivo informado (reset de senha)', async () => {
  let captured;
  const svc = new SecurityService(
    { authSession: { updateMany: async (d) => { captured = d; return { count: 2 }; } } },
    configStub,
  );
  await svc.revokeAll('u1', 'PASSWORD_CHANGED');
  assert.strictEqual(captured.where.userId, 'u1');
  assert.strictEqual(captured.data.revokedReason, 'PASSWORD_CHANGED');
});

test('getOverview retorna visão isolada por usuário', async () => {
  const svc = new SecurityService(mockPrisma(), configStub);
  const out = await svc.getOverview('u1');
  assert.ok(out.lastLoginAt instanceof Date);
  assert.strictEqual(out.totalLogins, 3);
  assert.strictEqual(out.emailVerified, true);
  assert.ok(out.emailVerifiedAt);
  assert.ok(out.createdAt);
});

test('getOverview lança UnauthorizedException para usuário inexistente', async () => {
  const prisma = mockPrisma({ findUser: async () => null });
  const svc = new SecurityService(prisma, configStub);
  await assert.rejects(svc.getOverview('ghost'), { name: 'UnauthorizedException' });
});

test('listLogins pagina, mascara IP e resume userAgent', async () => {
  const svc = new SecurityService(mockPrisma(), configStub);
  const out = await svc.listLogins('u1', { page: 1, limit: 2 });

  assert.strictEqual(out.items.length, 2);
  assert.strictEqual(out.meta.total, 3);
  assert.strictEqual(out.meta.page, 1);
  assert.strictEqual(out.meta.totalPages, 2);

  for (const item of out.items) {
    assert.ok(item.ipMasked.includes('***'), `IP mascarado: ${item.ipMasked}`);
    assert.ok(!item.ipMasked.includes('189.28.12'), 'não expõe o IP completo');
    assert.ok(item.userAgent.length <= 100, 'UA resumida na resposta');
    assert.ok(item.deviceLabel);
  }
});

function buildAuth(overrides = {}) {
  const passwordHash = bcrypt.hashSync('Senha#2026', 4);
  return new AuthService(
    overrides.users || { findByEmail: async () => ({ id: 'u1', email: 'a@b.com', passwordHash, emailVerified: true, fullName: 'A B', cpf: '123' }) },
    overrides.accounts || { findByUserId: async () => ({ id: 'acc1', agency: '0001', number: '1', balance: 10 }) },
    overrides.jwt || { signAsync: async () => 'tok' },
    overrides.mail || {},
    overrides.config || { get: () => 'false' },
    overrides.notifications || { safeCreate: async () => {} },
    overrides.security || {
      createSession: async () => ({ id: 'sess1', expiresAt: new Date() }),
      safeCreateLoginRecord: async () => {},
    },
  );
}

test('login cria sessão e assina JWT com {sub, sid} sem email', async () => {
  let capturedPayload;
  const auth = buildAuth({
    jwt: { signAsync: async (p) => { capturedPayload = p; return 'tok'; } },
  });
  const out = await auth.login({ email: 'a@b.com', password: 'Senha#2026' }, { ip: '10.0.0.9', userAgent: 'ua' });
  assert.strictEqual(out.accessToken, 'tok');
  assert.strictEqual(capturedPayload.sub, 'u1');
  assert.strictEqual(capturedPayload.sid, 'sess1');
  assert.ok(!('email' in capturedPayload), 'não deve conter email');
});

test('login não expõe falha do histórico (safeCreateLoginRecord com erro)', async () => {
  const auth = buildAuth({
    security: {
      createSession: async () => ({ id: 'sess1', expiresAt: new Date() }),
      safeCreateLoginRecord: async () => { throw new Error('histórico falhou'); },
    },
  });
  const out = await auth.login({ email: 'a@b.com', password: 'Senha#2026' });
  assert.strictEqual(out.accessToken, 'tok');
});

test('resetPassword revoga todas as sessões com PASSWORD_CHANGED', async () => {
  const passwordHash = bcrypt.hashSync('Senha#2026', 4);
  const revoked = [];
  const auth = new AuthService(
    {
      findByPasswordResetToken: async () => ({ id: 'u1', passwordHash, passwordResetTokenExpiry: new Date(Date.now() + 3_600_000) }),
      resetUserPassword: async () => {},
    },
    {},
    {},
    {},
    { get: () => '30m' },
    {},
    { revokeAll: async (userId, reason) => { revoked.push({ userId, reason }); } },
  );
  const out = await auth.resetPassword({ token: 'rawtoken', password: 'NovaSenha#2026' });
  assert.strictEqual(out.message, 'Senha redefinida com sucesso.');
  assert.deepStrictEqual(revoked, [{ userId: 'u1', reason: 'PASSWORD_CHANGED' }]);
});

test('logout revoga a sessão atual via revokeCurrent', async () => {
  let revokeArgs;
  const auth = buildAuth({
    security: {
      revokeCurrent: async (sid, userId) => { revokeArgs = { sid, userId }; return { message: 'Sessão encerrada.' }; },
    },
  });
  await auth.logout({ userId: 'u1', sid: 's1' });
  assert.deepStrictEqual(revokeArgs, { sid: 's1', userId: 'u1' });
});

test('JwtStrategy: token legado sem sid continua válido', async () => {
  const strategy = new JwtStrategy(
    { get: () => 'secret' },
    { findSession: async () => null, touchSession: async () => {} },
  );
  const out = await strategy.validate({ sub: 'u1' });
  assert.deepStrictEqual(out, { userId: 'u1', sid: null });
});

test('JwtStrategy: sessão válida retorna userId e sid', async () => {
  const touched = [];
  const session = { id: 's1', userId: 'u1', revokedAt: null, expiresAt: new Date(Date.now() + 60_000) };
  const strategy = new JwtStrategy(
    { get: () => 'secret' },
    { findSession: async () => session, touchSession: async (sid) => { touched.push(sid); } },
  );
  const out = await strategy.validate({ sub: 'u1', sid: 's1' });
  assert.deepStrictEqual(out, { userId: 'u1', sid: 's1' });
  assert.deepStrictEqual(touched, ['s1']);
});

test('JwtStrategy: sessão revogada é rejeitada', async () => {
  const session = { id: 's1', userId: 'u1', revokedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) };
  const strategy = new JwtStrategy(
    { get: () => 'secret' },
    { findSession: async () => session, touchSession: async () => {} },
  );
  await assert.rejects(strategy.validate({ sub: 'u1', sid: 's1' }), { name: 'UnauthorizedException' });
});

test('JwtStrategy: vínculo sid<>sub divergente é rejeitado', async () => {
  const session = { id: 's1', userId: 'u2', revokedAt: null, expiresAt: new Date(Date.now() + 60_000) };
  const strategy = new JwtStrategy(
    { get: () => 'secret' },
    { findSession: async () => session, touchSession: async () => {} },
  );
  await assert.rejects(strategy.validate({ sub: 'u1', sid: 's1' }), { name: 'UnauthorizedException' });
});

test('JwtStrategy: sessão inexistente é rejeitada', async () => {
  const strategy = new JwtStrategy(
    { get: () => 'secret' },
    { findSession: async () => null, touchSession: async () => {} },
  );
  await assert.rejects(strategy.validate({ sub: 'u1', sid: 's1' }), { name: 'UnauthorizedException' });
});

test('JwtStrategy: sessão expirada é rejeitada', async () => {
  const session = { id: 's1', userId: 'u1', revokedAt: null, expiresAt: new Date(Date.now() - 1000) };
  const strategy = new JwtStrategy(
    { get: () => 'secret' },
    { findSession: async () => session, touchSession: async () => {} },
  );
  await assert.rejects(strategy.validate({ sub: 'u1', sid: 's1' }), { name: 'UnauthorizedException' });
});