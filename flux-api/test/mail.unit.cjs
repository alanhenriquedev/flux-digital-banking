const { test } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcrypt');
const { MailService } = require('../dist/mail/mail.service.js');
const { UsersService } = require('../dist/users/users.service.js');

function mailService(overrides = {}) {
  const values = {
    MAIL_HOST: 'smtp.test.local', MAIL_PORT: '587', MAIL_USER: 'user',
    MAIL_PASS: 'pass', MAIL_SECURE: 'false', MAIL_FROM: 'Flux <no-reply@test.local>',
    FRONTEND_URL: 'https://app.test/', ...overrides,
  };
  const service = new MailService({ get: (key) => values[key] });
  return service;
}

test('MailService envia os três templates com links baseados em FRONTEND_URL', async () => {
  const sent = [];
  const service = mailService();
  service.transporter = {
    verify: async () => true,
    sendMail: async (message) => { sent.push(message); },
  };

  await service.sendVerificationEmail('a@test.local', 'Ana', 'verify-token');
  await service.sendPasswordResetEmail('a@test.local', 'Ana', 'reset-token');
  await service.sendEmailChangeConfirmationEmail('novo@test.local', 'Ana', 'change-token');

  assert.strictEqual(sent.length, 3);
  assert.ok(sent[0].html.includes('https://app.test/verificar_email.html?token=verify-token'));
  assert.ok(sent[1].html.includes('https://app.test/redefinir_senha.html?token=reset-token'));
  assert.ok(sent[2].html.includes('https://app.test/confirmar_email.html?token=change-token'));
  assert.ok(sent.every((message) => message.from === 'Flux <no-reply@test.local>'));
});

test('templates escapam nome fornecido pelo usuário', async () => {
  let message;
  const service = mailService();
  service.transporter = { sendMail: async (value) => { message = value; } };
  await service.sendVerificationEmail('a@test.local', '<img src=x onerror=alert(1)> & Ana', 't');
  assert.ok(message.html.includes('&lt;img src=x onerror=alert(1)&gt; &amp; Ana'));
  assert.ok(!message.html.includes('<img src=x onerror=alert(1)>'));
});

test('falha SMTP é registrada e relançada como erro neutro', async () => {
  const service = mailService();
  service.transporter = { sendMail: async () => { throw new Error('ECONNREFUSED secret-host'); } };
  await assert.rejects(service.sendVerificationEmail('a@test.local', 'Ana', 't'), { message: 'mail-delivery-failed' });
});

test('SMTP opcional não impede startup quando indisponível', async () => {
  const service = mailService();
  service.transporter = { verify: async () => { throw new Error('offline'); } };
  await assert.doesNotReject(service.onModuleInit());
});

test('CAS de tokens permite somente um consumo concorrente', async () => {
  const state = {
    emailVerifyToken: 'v', emailVerifyTokenExpiry: new Date(Date.now() + 60_000), emailVerified: false,
    passwordResetToken: 'r', passwordResetTokenExpiry: new Date(Date.now() + 60_000),
    id: 'u1', pendingEmail: 'new@test.local', pendingEmailToken: 'p', pendingEmailTokenExpiry: new Date(Date.now() + 60_000),
  };
  const prisma = { user: { updateMany: async ({ where, data }) => {
    const matches = where.emailVerifyToken
      ? state.emailVerifyToken === where.emailVerifyToken && !state.emailVerified
      : where.passwordResetToken
        ? state.passwordResetToken === where.passwordResetToken
        : state.pendingEmailToken === where.pendingEmailToken && state.id === where.id;
    if (!matches) return { count: 0 };
    Object.assign(state, data);
    return { count: 1 };
  } } };
  const users = new UsersService(prisma);
  const verify = await Promise.all([
    users.consumeEmailVerificationToken('v', new Date()),
    users.consumeEmailVerificationToken('v', new Date()),
  ]);
  assert.deepStrictEqual(verify.map((r) => r.count).sort(), [0, 1]);

  const reset = await Promise.all([
    users.consumePasswordResetToken('r', 'new-hash', new Date()),
    users.consumePasswordResetToken('r', 'other-hash', new Date()),
  ]);
  assert.deepStrictEqual(reset.map((r) => r.count).sort(), [0, 1]);

  const pending = await Promise.all([
    users.consumePendingEmailToken('u1', 'new@test.local', 'p', new Date()),
    users.consumePendingEmailToken('u1', 'new@test.local', 'p', new Date()),
  ]);
  assert.deepStrictEqual(pending.map((r) => r.count).sort(), [0, 1]);
});
