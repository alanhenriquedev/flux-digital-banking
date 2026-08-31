const { test } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcrypt');
const { AuthService } = require('../dist/auth/auth.service.js');

const passwordHash = bcrypt.hashSync('Senha#2026', 4);
const config = { get: (key) => key === 'JWT_SECRET' ? 'test-secret' : undefined };

function build({ users, mail }) {
  return new AuthService(
    users,
    { createForUser: async () => ({}) },
    { signAsync: async () => 'token' },
    mail,
    config,
    { safeCreate: async () => {} },
    { safeCreateLoginRecord: async () => {}, createSession: async () => ({ id: 's1' }) },
  );
}

test('reenvio não substitui token quando SMTP falha', async () => {
  let persisted = 0;
  const auth = build({
    users: {
      findByEmail: async () => ({ id: 'u1', email: 'a@test.local', fullName: 'Ana', passwordHash, emailVerified: false }),
      setEmailVerifyToken: async () => { persisted++; },
    },
    mail: { sendVerificationEmail: async () => { throw new Error('mail-delivery-failed'); } },
  });
  await assert.rejects(auth.resendVerification({ email: 'a@test.local', password: 'Senha#2026' }), { name: 'ServiceUnavailableException' });
  assert.strictEqual(persisted, 0);
});

test('reset e troca de e-mail não persistem token novo quando SMTP falha', async () => {
  let resetPersisted = 0;
  const resetAuth = build({
    users: {
      findByEmail: async () => ({ id: 'u1', email: 'a@test.local', fullName: 'Ana', passwordHash }),
      findByPasswordResetToken: async () => ({ id: 'u1', passwordResetTokenExpiry: new Date(Date.now() + 60_000), passwordHash }),
      consumePasswordResetToken: async () => { resetPersisted++; return { count: 1 }; },
    },
    mail: { sendPasswordResetEmail: async () => { throw new Error('mail-delivery-failed'); } },
  });
  await assert.rejects(resetAuth.forgotPassword({ email: 'a@test.local' }), { name: 'ServiceUnavailableException' });
  assert.strictEqual(resetPersisted, 0);

  let pendingPersisted = 0;
  const emailAuth = build({
    users: {
      findPasswordHashById: async () => ({ id: 'u1', passwordHash }),
      findById: async () => ({ id: 'u1', email: 'a@test.local', fullName: 'Ana' }),
      findByEmail: async () => null,
      setPendingEmail: async () => { pendingPersisted++; },
    },
    mail: { sendEmailChangeConfirmationEmail: async () => { throw new Error('mail-delivery-failed'); } },
  });
  await assert.rejects(emailAuth.requestEmailChange('u1', { newEmail: 'b@test.local', currentPassword: 'Senha#2026' }), { name: 'ServiceUnavailableException' });
  assert.strictEqual(pendingPersisted, 0);
});
