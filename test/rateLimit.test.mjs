import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit } from '../src/middleware/rateLimit.js';

function fakeReqRes(ip = '1.2.3.4') {
  const res = {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return { req: { ip }, res };
}

test('allows up to max requests then 429s with Retry-After', () => {
  const limiter = rateLimit({ windowMs: 60_000, max: 3, name: 'test' });
  try {
    for (let i = 0; i < 3; i++) {
      const { req, res } = fakeReqRes();
      let passed = false;
      limiter(req, res, () => { passed = true; });
      assert.equal(passed, true, `request ${i + 1} should pass`);
    }
    const { req, res } = fakeReqRes();
    let passed = false;
    limiter(req, res, () => { passed = true; });
    assert.equal(passed, false);
    assert.equal(res.statusCode, 429);
    assert.match(res.body.error, /too many/i);
    assert.ok(Number(res.headers['Retry-After']) > 0);
  } finally {
    limiter.stop();
  }
});

test('tracks IPs independently', () => {
  const limiter = rateLimit({ windowMs: 60_000, max: 1, name: 'test' });
  try {
    const a = fakeReqRes('10.0.0.1');
    const b = fakeReqRes('10.0.0.2');
    let aPassed = false, bPassed = false;
    limiter(a.req, a.res, () => { aPassed = true; });
    limiter(b.req, b.res, () => { bPassed = true; });
    assert.equal(aPassed, true);
    assert.equal(bPassed, true);

    const a2 = fakeReqRes('10.0.0.1');
    let a2Passed = false;
    limiter(a2.req, a2.res, () => { a2Passed = true; });
    assert.equal(a2Passed, false);
    assert.equal(a2.res.statusCode, 429);
  } finally {
    limiter.stop();
  }
});

test('window resets after windowMs', async () => {
  const limiter = rateLimit({ windowMs: 50, max: 1, name: 'test' });
  try {
    const first = fakeReqRes();
    limiter(first.req, first.res, () => {});

    const blocked = fakeReqRes();
    let blockedPassed = false;
    limiter(blocked.req, blocked.res, () => { blockedPassed = true; });
    assert.equal(blockedPassed, false);

    await new Promise(r => setTimeout(r, 60));
    const after = fakeReqRes();
    let afterPassed = false;
    limiter(after.req, after.res, () => { afterPassed = true; });
    assert.equal(afterPassed, true);
  } finally {
    limiter.stop();
  }
});
