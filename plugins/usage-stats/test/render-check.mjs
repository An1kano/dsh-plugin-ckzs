/**
 * Offline render check for the usage-stats browser half.
 *
 * The Client runtime supplies React; there is no React copy in this workspace,
 * so the check evaluates the element tree with a minimal `createElement` and
 * walks it for the text a rendered panel would contain. That catches a broken
 * data branch (undefined props, bad nesting) without a browser.
 *
 * Run with: node plugins/usage-stats/test/render-check.mjs
 */
import assert from 'node:assert/strict'

let definition = null
globalThis.window = {
  __ModuleLoader__: {
    load(value) {
      definition = value
    },
  },
}

// Resolve the browser half relative to this check so the cwd does not matter.
const reactPath = new URL('../client.js', import.meta.url).href
await import(reactPath)
assert.ok(definition !== null, 'client module registered with the loader')
assert.equal(definition.id, '@an1kano/dsh-usage-stats')

const createElement = (type, props, ...children) => ({
  type,
  props: { ...(props ?? {}), children: children.flat(Infinity) },
})
const mockReact = {
  createElement,
  memo: (component) => component,
  useState: () => [undefined, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useRef: (value) => ({ current: value }),
}

const plugin = definition.factory((name) => {
  if (name === 'react') return mockReact
  throw new Error(`unexpected module: ${name}`)
})
assert.deepEqual(plugin.inject, ['slots', 'locale'])
assert.equal(typeof plugin.apply, 'function')

const { StatsPanel, dictionaries } = plugin.__test

assert.deepEqual(
  Object.keys(dictionaries.zh).sort(),
  Object.keys(dictionaries.en).sort(),
  'locale dictionaries cover the same keys',
)

/** Interpolate one dictionary entry the way the Client locale service does. */
function translator(dict) {
  return (key, params) => {
    const template = dict[key] ?? key
    return template.replace(/\{(\w+)\}/gu, (_, name) =>
      params !== undefined && params[name] !== undefined ? String(params[name]) : `{${name}}`)
  }
}

/** Concatenate every rendered text node. */
function textOf(node, out = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) textOf(child, out)
    return out
  }
  if (typeof node.type === 'function') {
    textOf(node.type(node.props), out)
    return out
  }
  if (node.type === 'style') return out
  textOf(node.props.children, out)
  return out
}

const sessionId = 'session-test'
const payload = {
  ok: true,
  generatedAt: Date.UTC(2026, 9, 20, 3, 4, 5),
  account: {
    status: 'ready',
    currency: 'CNY',
    wallets: [{ currency: 'CNY', balance: '120.5000000000000000', kind: 'normal' }],
    bonusWallets: [{ currency: 'CNY', balance: '7.2500000000000000', kind: 'bonus' }],
    links: { usageUrl: 'https://platform.deepseek.com/usage', topUpUrl: 'https://platform.deepseek.com/top_up' },
  },
  month: {
    key: '2026-10',
    sessions: 3,
    scanned: 4,
    calls: 42,
    totalTokens: 3200000,
    tokens: { input: 120000, cacheRead: 3000000, cacheWrite: 0, output: 80000, total: 3200000 },
    cost: { amount: 12.34567, currency: 'CNY' },
    models: [
      {
        model: 'deepseek-flash',
        priced: true,
        tokens: { input: 120000, cacheRead: 3000000, cacheWrite: 0, output: 80000, total: 3200000 },
        cost: 12.34567,
        peakTokens: 1600000,
      },
    ],
  },
  session: {
    id: sessionId,
    calls: 17,
    totalTokens: 1270000,
    tokens: { input: 40000, cacheRead: 1200000, cacheWrite: 0, output: 30000, total: 1270000 },
    cost: { amount: 0.9876, currency: 'CNY' },
    models: [
      {
        model: 'deepseek-flash',
        priced: true,
        tokens: { input: 40000, cacheRead: 1200000, cacheWrite: 0, output: 30000, total: 1270000 },
        cost: 0.9876,
        peakTokens: 635000,
      },
      {
        model: 'mystery-model',
        priced: false,
        tokens: { input: 1000, cacheRead: 0, cacheWrite: 0, output: 0, total: 1000 },
        cost: 0.000002,
        peakTokens: 1000,
      },
    ],
  },
  pricing: { currency: 'CNY', peakNow: true, peakPricing: true, peakMultiplier: 2, perMillionTokens: true },
  warnings: [],
}

const zh = translator(dictionaries.zh)
const text = textOf(StatsPanel({
  data: payload,
  error: null,
  translate: zh,
  onRefresh: () => {},
  open: true,
  onToggle: () => {},
})).join('|')

for (const expected of [
  '余额 ¥127.75',
  '本月 ¥12.35',
  '会话 ¥0.988',
  '用量与余额',
  '总余额',
  '充值余额',
  '赠送余额',
  '¥120.5',
  '本月（2026-10）',
  '估算金额',
  '请求次数',
  '输入（未命中缓存）',
  '缓存命中',
  '输出',
  '有消耗的会话',
  'deepseek-flash',
  'mystery-model *',
  '当前会话',
  '更新于',
  '刷新',
  '实际扣费以平台账单为准',
]) {
  assert.ok(text.includes(expected), `rendered panel contains "${expected}"`)
}
assert.ok(!text.includes('{'), 'no unresolved interpolation placeholders')

// Loading and failure branches render without data.
const loadingText = textOf(StatsPanel({
  data: null,
  error: null,
  translate: zh,
  onRefresh: () => {},
  open: true,
  onToggle: () => {},
})).join('|')
assert.ok(loadingText.includes('读取中'))
assert.ok(loadingText.includes('用量 …'))

const errorText = textOf(StatsPanel({
  data: null,
  error: 'HTTP 500',
  translate: zh,
  onRefresh: () => {},
  open: true,
  onToggle: () => {},
})).join('|')
assert.ok(errorText.includes('统计加载失败：HTTP 500'))

// A signed-out account hides wallets but keeps the month section.
const signedOut = {
  ...payload,
  account: { status: 'signed-out', currency: 'CNY', wallets: [], bonusWallets: [], links: null },
  session: { id: sessionId, calls: 0, totalTokens: 0, tokens: {}, cost: { amount: 0, currency: 'CNY' }, models: [] },
}
const signedOutText = textOf(StatsPanel({
  data: signedOut,
  error: null,
  translate: zh,
  onRefresh: () => {},
  open: true,
  onToggle: () => {},
})).join('|')
assert.ok(signedOutText.includes('未登录 DeepSeek 账号'))
assert.ok(signedOutText.includes('本月（2026-10）'))
assert.ok(signedOutText.includes('当前会话还没有用量'))

// English dictionaries render too; a closed panel shows no body.
const enText = textOf(StatsPanel({
  data: payload,
  error: null,
  translate: translator(dictionaries.en),
  onRefresh: () => {},
  open: false,
  onToggle: () => {},
})).join('|')
assert.ok(enText.includes('Balance ¥127.75'))
assert.ok(enText.includes('Month ¥12.35'))
assert.ok(enText.includes('Session ¥0.988'))
assert.ok(!enText.includes('刷新'), 'closed panel shows no body')

console.log('usage-stats: all client render checks passed')
