import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuth } from '../../src/server/auth.mjs';

test('错误口令被拒绝，正确口令可以创建和销毁会话', async () => {
  const auth = await createAuth({ password: 'fixture-password' });
  assert.equal(await auth.verifyPassword('wrong'), false);
  assert.equal(await auth.verifyPassword('fixture-password'), true);
  const token = auth.createSession();
  const request = { headers: { cookie: `workbench_session=${token}` } };
  assert.ok(auth.getSession(request));
  auth.destroySession(request);
  assert.equal(auth.getSession(request), null);
});
