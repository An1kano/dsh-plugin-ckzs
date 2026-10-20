/**
 * Offline checks for the usage-stats Host half: pricing, peak windows,
 * month scoping, session scoping, and the route's trust fence.
 *
 * Run with: node plugins/usage-stats/test/host-check.mjs
 */
import assert from 'node:assert/strict'
import { apply, __internals } from '../index.js'

const { isPeak, monthWindow, normalizeConfig } = __internals

const at = (iso) => new Date(iso).getTime()

/** Build one assistant message with provider usage. */
function assistant(seq, iso, model, usage) {
  return {
    type: 'assistant/message',
    seq,
    time: at(iso),
    data: {
      usage,
      message: { role: 'assistant', source: { kind: 'model', provider: 'deepseek', model } },
    },
  }
}

const s1Events = [
  assistant(0, '2026-10-20T10:00:00+08:00', 'deepseek-flash', {
    inputTokens: 1000,
    cacheReadTokens: 2000,
    outputTokens: 500,
  }),
  { type: 'tool/call', seq: 1, time: at('2026-10-20T10:01:00+08:00'), data: {} },
  assistant(2, '2026-10-20T20:00:00+08:00', 'deepseek-flash', {
    inputTokens: 1000,
    outputTokens: 1000,
  }),
  assistant(3, '2026-09-15T20:00:00+08:00', 'deepseek-flash', {
    inputTokens: 1000000,
    outputTokens: 0,
  }),
  assistant(4, '2026-10-20T20:05:00+08:00', 'mystery-model', {
    inputTokens: 1000000,
    outputTokens: 0,
  }),
]

const s2Events = [
  assistant(0, '2026-10-02T20:00:00+08:00', 'deepseek-v4-pro', {
    inputTokens: 500000,
    outputTokens: 0,
  }),
]

const s1 = { id: 's1', seq: 5, ownEvents: () => s1Events }
const sessions = { get: (id) => (id === 's1' ? s1 : undefined) }
const sessionQuery = {
  async listSessions() {
    return [
      { header: { id: 's1', createdAt: at('2026-10-20T09:00:00+08:00') }, live: true, persisted: true },
      { header: { id: 's2', createdAt: at('2026-10-02T09:00:00+08:00') }, live: false, persisted: true },
    ]
  },
  async observeSession(id) {
    if (id !== 's2') throw new Error(`unexpected session ${id}`)
    return {
      events: s2Events,
      inheritedEventCount: 0,
      [Symbol.dispose]() {},
    }
  },
}

function accountService(overrides = {}) {
  return {
    async getState() {
      return overrides.state ?? {
        status: 'credential-stored',
        links: { usageUrl: 'https://platform.deepseek.com/usage', topUpUrl: 'https://platform.deepseek.com/top_up' },
      }
    },
    async getBalance() {
      return overrides.balance ?? {
        status: 'ready',
        value: [{ currency: 'CNY', balance: '12.34' }],
        bonusWallets: [{ currency: 'CNY', balance: '1.00' }],
      }
    },
  }
}

const routes = []
function makeCtx(services) {
  const effects = []
  return {
    effects,
    get: (name) => services[name],
    effect(fn) {
      effects.push(fn())
    },
    connection: {
      requestRejection() {
        return services.rejectWith
      },
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
  }
}

const ctx = makeCtx({
  sessions,
  sessionQuery,
  deepseekAccount: accountService(),
})
apply(ctx, {})
assert.equal(routes.length, 1, 'register one route')
const route = routes[0]
assert.equal(route.kind, 'exact')
assert.equal(route.path, '/usage-stats/data')

async function get(url) {
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name] = value
    },
    end(body) {
      this.body = body ?? ''
    },
  }
  await route.handler({ method: 'GET', url }, res)
  return { status: res.statusCode, headers: res.headers, json: res.body === '' ? null : JSON.parse(res.body) }
}

const response = await get('/usage-stats/data?session=s1')
assert.equal(response.status, 200, 'route answers 200')
assert.equal(response.headers['cache-control'], 'no-store')
const payload = response.json
assert.equal(payload.ok, true)
assert.equal(payload.account.status, 'ready')
assert.equal(payload.account.currency, 'CNY')
assert.equal(payload.account.wallets[0].balance, '12.34')
assert.equal(payload.account.bonusWallets[0].balance, '1.00')
assert.equal(payload.month.key, '2026-10')
assert.equal(payload.month.sessions, 2)
assert.equal(payload.month.calls, 4)
assert.equal(payload.month.scanned, 2)

const near = (actual, expected, message) => {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: expected ${expected}, got ${actual}`)
}

near(payload.month.cost.amount, 3.26108, 'month cost')
assert.equal(payload.month.tokens.input, 1502000)
assert.equal(payload.month.tokens.cacheRead, 2000)
assert.equal(payload.month.tokens.output, 1500)

const flash = payload.month.models.find((model) => model.model === 'deepseek-flash')
const pro = payload.month.models.find((model) => model.model === 'deepseek-v4-pro')
const mystery = payload.month.models.find((model) => model.model === 'mystery-model')
assert.ok(flash && pro && mystery, 'all models reported')
near(flash.cost, 0.01108, 'flash month cost')
assert.equal(flash.priced, true)
near(pro.cost, 2.25, 'pro month cost')
near(mystery.cost, 1.0, 'fallback-priced model cost')
assert.equal(mystery.priced, false, 'unknown model is flagged as unpriced')

assert.equal(payload.session.id, 's1')
assert.equal(payload.session.calls, 4)
near(payload.session.cost.amount, 2.01108, 'session all-time cost')
assert.equal(payload.session.tokens.input, 2002000)
assert.equal(payload.session.tokens.cacheRead, 2000)
assert.equal(payload.session.tokens.output, 1500)

// A second read inside the cache window still answers.
const again = await get('/usage-stats/data')
assert.equal(again.status, 200)
assert.equal(again.json.session, null, 'no session id means no session block')

// The trust fence decides before any work happens.
ctx.connection.requestRejection = () => 403
const rejected = await get('/usage-stats/data')
assert.equal(rejected.status, 403)
assert.ok(rejected.body === undefined || rejected.body === '', 'rejection carries no payload')

// A signed-out account still reports usage.
routes.length = 0
const signedOutCtx = makeCtx({
  sessions,
  sessionQuery,
  deepseekAccount: accountService({
    state: { status: 'signed-out', links: { usageUrl: 'u', topUpUrl: 't' } },
  }),
})
apply(signedOutCtx, {})
const signedOutRoute = routes[0]
const signedOutRes = {
  statusCode: 0,
  headers: {},
  body: '',
  setHeader(name, value) {
    this.headers[name] = value
  },
  end(body) {
    this.body = body ?? ''
  },
}
await signedOutRoute.handler({ method: 'GET', url: '/usage-stats/data?session=s1' }, signedOutRes)
const signedOut = JSON.parse(signedOutRes.body)
assert.equal(signedOut.account.status, 'signed-out')
assert.equal(signedOut.month.calls, 4, 'usage still folds without an account')

// Pure helpers.
const config = normalizeConfig({})
assert.equal(isPeak(at('2026-10-20T10:00:00+08:00'), config), true, 'Tuesday 10:00 is peak')
assert.equal(isPeak(at('2026-10-20T12:30:00+08:00'), config), false, 'lunch break is off-peak')
assert.equal(isPeak(at('2026-10-20T20:00:00+08:00'), config), false, 'evening is off-peak')
assert.equal(isPeak(at('2026-10-24T10:00:00+08:00'), config), false, 'Saturday is off-peak')
assert.deepEqual(monthWindow(at('2026-10-20T10:00:00+08:00')), {
  key: '2026-10',
  start: at('2026-10-01T00:00:00+08:00'),
  end: at('2026-11-01T00:00:00+08:00'),
})

console.log('usage-stats: all host checks passed')
