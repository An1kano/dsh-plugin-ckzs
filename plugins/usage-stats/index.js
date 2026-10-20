/**
 * Host half of the usage-stats bundle.
 *
 * It serves one JSON route for the browser half of the same bundle:
 *
 *   GET /usage-stats/data?session=<sessionId>
 *
 * The payload carries the DeepSeek account balance, month-to-date token use
 * and estimated cost, and the current session's token use and estimated cost.
 * Session token accounting is folded from the durable log's `assistant/message`
 * usage records; money is estimated from the official DeepSeek price table
 * (peak hours cost twice the off-peak rate). The account balance is the only
 * authoritative money figure.
 *
 * The browser half only needs the route, so the Host owns both the trust fence
 * (`ctx.connection.requestRejection`) and every computation.
 */

/** Cordis function-plugin name. */
export const name = 'usage-stats'

/** Hard dependencies: the route carrier and the request trust fence. */
export const inject = ['webServer', 'connection']

/** Document-relative path the browser half fetches. */
const ROUTE_PATH = '/usage-stats/data'

/** Price tables are per 1M tokens. */
const PER_MILLION = 1_000_000

/**
 * Off-peak official prices per 1M tokens, by currency.
 * Peak hours are billed at twice these rates (DeepSeek official rule).
 * `deepseek-flash` is also the fallback for a model this table does not name.
 */
const DEFAULT_PRICING = {
  CNY: {
    'deepseek-flash': { cacheHit: 0.02, cacheMiss: 1, output: 4 },
    'deepseek-v4-pro': { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
  },
  USD: {
    'deepseek-flash': { cacheHit: 0.003, cacheMiss: 0.15, output: 0.6 },
    'deepseek-v4-pro': { cacheHit: 0.022, cacheMiss: 0.66, output: 1.98 },
  },
}

/** Legacy model names that are served and billed as another model. */
const MODEL_ALIASES = {
  'deepseek-v4-flash': 'deepseek-flash',
  'deepseek-v4-flash-vision-exp': 'deepseek-flash',
}

/** Resolved plugin configuration defaults. */
const CONFIG_DEFAULTS = {
  currency: 'CNY',
  locale: 'zh-CN',
  peakPricing: true,
  peakMultiplier: 2,
  peakTimeZoneOffsetMinutes: 480,
  peakRanges: [[9 * 60, 12 * 60], [14 * 60, 18 * 60]],
  accountTtlMs: 60000,
  usageTtlMs: 20000,
  sessionCacheTtlMs: 300000,
  maxSessions: 200,
  pricing: null,
}

/** Clamp one numeric option. */
function numberOption(value, fallback, minimum, maximum) {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN
  if (Number.isNaN(parsed)) return fallback
  return Math.min(maximum, Math.max(minimum, parsed))
}

/** Validate and complete the Loader row's config. */
function normalizeConfig(raw) {
  const input = typeof raw === 'object' && raw !== null ? raw : {}
  const ranges = Array.isArray(input.peakRanges)
    ? input.peakRanges
        .filter((range) => Array.isArray(range) && range.length === 2)
        .map(([start, end]) => [numberOption(start, 0, 0, 1440), numberOption(end, 0, 0, 1440)])
        .filter(([start, end]) => end > start)
    : []
  return {
    currency: input.currency === 'USD' ? 'USD' : CONFIG_DEFAULTS.currency,
    locale: typeof input.locale === 'string' && input.locale !== '' ? input.locale : CONFIG_DEFAULTS.locale,
    peakPricing: input.peakPricing !== false,
    peakMultiplier: numberOption(input.peakMultiplier, CONFIG_DEFAULTS.peakMultiplier, 1, 10),
    peakTimeZoneOffsetMinutes: numberOption(
      input.peakTimeZoneOffsetMinutes,
      CONFIG_DEFAULTS.peakTimeZoneOffsetMinutes,
      -720,
      840,
    ),
    peakRanges: ranges.length > 0 ? ranges : CONFIG_DEFAULTS.peakRanges,
    accountTtlMs: numberOption(input.accountTtlMs, CONFIG_DEFAULTS.accountTtlMs, 5000, 600000),
    usageTtlMs: numberOption(input.usageTtlMs, CONFIG_DEFAULTS.usageTtlMs, 1000, 600000),
    sessionCacheTtlMs: numberOption(
      input.sessionCacheTtlMs,
      CONFIG_DEFAULTS.sessionCacheTtlMs,
      1000,
      3600000,
    ),
    maxSessions: numberOption(input.maxSessions, CONFIG_DEFAULTS.maxSessions, 1, 5000),
    pricing: typeof input.pricing === 'object' && input.pricing !== null ? input.pricing : null,
  }
}

/** Resolve one model name through the alias table. */
function normalizeModel(model) {
  if (typeof model !== 'string' || model === '') return 'unknown'
  return MODEL_ALIASES[model] ?? model
}

/** Canonical local month window that contains `now`. */
function monthWindow(now) {
  const date = new Date(now)
  const start = new Date(date.getFullYear(), date.getMonth(), 1).getTime()
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime()
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  return { key, start, end }
}

/** Whether one event timestamp falls in a DeepSeek peak-pricing window. */
function isPeak(time, config) {
  const shifted = new Date(time + config.peakTimeZoneOffsetMinutes * 60000)
  const weekday = shifted.getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
  return config.peakRanges.some(([start, end]) => minutes >= start && minutes < end)
}

/** One all-zero token bucket. */
function emptyTokens() {
  return { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
}

/** Add all token fields of `source` into `target`. */
function addTokens(target, source) {
  target.input += source.input
  target.cacheRead += source.cacheRead
  target.cacheWrite += source.cacheWrite
  target.output += source.output
}

/** Total billed token count of one bucket. */
function tokenTotal(tokens) {
  return tokens.input + tokens.cacheRead + tokens.cacheWrite + tokens.output
}

/** A scope holding per-model peak and off-peak buckets. */
function emptyScope() {
  return { calls: 0, firstAt: null, lastAt: null, models: new Map() }
}

/** The per-model bucket pair of one scope. */
function modelBucket(scope, model) {
  let bucket = scope.models.get(model)
  if (bucket === undefined) {
    bucket = { peak: emptyTokens(), off: emptyTokens() }
    scope.models.set(model, bucket)
  }
  return bucket
}

/** Observe one timestamp on a scope. */
function touchScope(scope, time) {
  if (scope.firstAt === null || time < scope.firstAt) scope.firstAt = time
  if (scope.lastAt === null || time > scope.lastAt) scope.lastAt = time
}

/** Fold one session event into the all-time and in-month scopes. */
function foldEvent(entry, event, month, config) {
  if (event === null || typeof event !== 'object') return
  const data = event.data
  if (event.type !== 'assistant/message' || data === null || typeof data !== 'object') return
  const usage = data.usage
  if (usage === null || typeof usage !== 'object') return
  const tokens = {
    input: Math.max(0, Number(usage.inputTokens) || 0),
    cacheRead: Math.max(0, Number(usage.cacheReadTokens) || 0),
    cacheWrite: Math.max(0, Number(usage.cacheWriteTokens) || 0),
    output: Math.max(0, Number(usage.outputTokens) || 0),
  }
  if (tokenTotal(tokens) === 0) return
  const time = typeof event.time === 'number' ? event.time : Date.now()
  const model = normalizeModel(data.message?.source?.model)
  const phase = isPeak(time, config) ? 'peak' : 'off'
  const scopes = [entry.total]
  if (time >= month.start && time < month.end) scopes.push(entry.month)
  for (const scope of scopes) {
    scope.calls += 1
    touchScope(scope, time)
    addTokens(modelBucket(scope, model)[phase], tokens)
  }
}

/** A session's accumulated usage. */
function emptyEntry(monthKey) {
  return {
    monthKey,
    lastSeq: -1,
    at: 0,
    total: emptyScope(),
    month: emptyScope(),
  }
}

/** Resolve the off-peak price of one model in one currency. */
function priceOf(model, currency, config) {
  const overrides = config.pricing !== null ? config.pricing[currency] : undefined
  const base = DEFAULT_PRICING[currency] ?? DEFAULT_PRICING.CNY
  const table = overrides !== null && typeof overrides === 'object' ? { ...base, ...overrides } : base
  const key = normalizeModel(model)
  return table[key] ?? base['deepseek-flash']
}

/** Cost of one bucket at one base price. */
function bucketCost(tokens, price, factor) {
  return (
    (factor *
      (tokens.input * price.cacheMiss +
        tokens.cacheWrite * price.cacheMiss +
        tokens.cacheRead * price.cacheHit +
        tokens.output * price.output)) /
    PER_MILLION
  )
}

/** Whether the price table names this exact model. */
function isPriced(model, currency, config) {
  const overrides = config.pricing !== null ? config.pricing[currency] : undefined
  const table = overrides !== null && typeof overrides === 'object'
    ? { ...(DEFAULT_PRICING[currency] ?? DEFAULT_PRICING.CNY), ...overrides }
    : DEFAULT_PRICING[currency] ?? DEFAULT_PRICING.CNY
  return Object.prototype.hasOwnProperty.call(table, normalizeModel(model))
}

/** Summarize one scope into the wire shape. */
function summarizeScope(scope, currency, config) {
  const models = []
  const tokens = emptyTokens()
  let amount = 0
  for (const [model, bucket] of scope.models) {
    const price = priceOf(model, currency, config)
    const peakFactor = config.peakPricing ? config.peakMultiplier : 1
    const peakCost = bucketCost(bucket.peak, price, peakFactor)
    const offCost = bucketCost(bucket.off, price, 1)
    const modelTokens = emptyTokens()
    addTokens(modelTokens, bucket.off)
    addTokens(modelTokens, bucket.peak)
    addTokens(tokens, modelTokens)
    amount += peakCost + offCost
    models.push({
      model,
      priced: isPriced(model, currency, config),
      tokens: modelTokens,
      totalTokens: tokenTotal(modelTokens),
      cost: peakCost + offCost,
      peakTokens: tokenTotal(bucket.peak),
    })
  }
  models.sort((left, right) => right.cost - left.cost || right.totalTokens - left.totalTokens)
  return {
    calls: scope.calls,
    firstAt: scope.firstAt,
    lastAt: scope.lastAt,
    tokens,
    totalTokens: tokenTotal(tokens),
    cost: amount,
    models,
  }
}

/** Read a monotonic event sequence; a branded number is a plain number on the wire. */
function seqOf(event) {
  return typeof event.seq === 'number' ? event.seq : -1
}

/** Load the own events of one logical session without making it live. */
async function loadOwnEvents(ctx, sessionId) {
  const live = ctx.get('sessions')?.get(sessionId)
  if (live !== undefined) return { events: live.ownEvents(), live: true }
  const query = ctx.get('sessionQuery')
  if (query === undefined) throw new Error('session query service is not available')
  const observation = await query.observeSession(sessionId, { projectionMode: 'none' })
  try {
    const events = Array.isArray(observation.events) ? observation.events : []
    const inherited = Number(observation.inheritedEventCount) || 0
    return { events: inherited > 0 ? events.slice(inherited) : events, live: false }
  } finally {
    if (typeof observation[Symbol.dispose] === 'function') observation[Symbol.dispose]()
  }
}

/** Fold one session from scratch. */
async function foldSession(ctx, sessionId, month, config) {
  const entry = emptyEntry(month.key)
  const { events } = await loadOwnEvents(ctx, sessionId)
  for (const event of events) {
    foldEvent(entry, event, month, config)
    entry.lastSeq = Math.max(entry.lastSeq, seqOf(event))
  }
  entry.at = Date.now()
  return entry
}

/** Fold only events newer than the cached watermark of a live session. */
function foldSessionTail(ctx, entry, sessionId, month, config) {
  const live = ctx.get('sessions')?.get(sessionId)
  if (live === undefined) return false
  const events = live.ownEvents()
  for (const event of events) {
    if (seqOf(event) <= entry.lastSeq) continue
    foldEvent(entry, event, month, config)
    entry.lastSeq = seqOf(event)
  }
  entry.at = Date.now()
  return true
}

/** Merge one session's in-month scope into the cross-session scope. */
function mergeMonth(target, source) {
  target.calls += source.calls
  if (source.firstAt !== null) touchScope(target, source.firstAt)
  if (source.lastAt !== null) touchScope(target, source.lastAt)
  for (const [model, bucket] of source.models) {
    const merged = modelBucket(target, model)
    addTokens(merged.peak, bucket.peak)
    addTokens(merged.off, bucket.off)
  }
}

/** Compact wire projection of one token bucket. */
function wireTokens(tokens) {
  return {
    input: tokens.input,
    cacheRead: tokens.cacheRead,
    cacheWrite: tokens.cacheWrite,
    output: tokens.output,
    totalInput: tokens.input + tokens.cacheRead + tokens.cacheWrite,
    total: tokenTotal(tokens),
  }
}

/** Wire projection of one summarized scope. */
function wireSummary(summary, currency) {
  return {
    calls: summary.calls,
    firstAt: summary.firstAt,
    lastAt: summary.lastAt,
    tokens: wireTokens(summary.tokens),
    cost: { amount: roundMoney(summary.cost), currency },
    models: summary.models.map((model) => ({
      model: model.model,
      priced: model.priced,
      tokens: wireTokens(model.tokens),
      cost: roundMoney(model.cost),
      peakTokens: model.peakTokens,
    })),
  }
}

/** Round an estimated amount to sub-cent precision. */
function roundMoney(value) {
  return Math.round(value * 1e6) / 1e6
}

/** Read the account balance through the optional account service. */
async function readAccount(ctx, state) {
  const now = Date.now()
  if (state.account !== null && now - state.account.at < state.config.accountTtlMs) {
    return state.account.value
  }
  if (state.accountInFlight !== null) return state.accountInFlight
  state.accountInFlight = (async () => {
    const service = ctx.get('deepseekAccount')
    if (service === undefined) return { status: 'unavailable', wallets: [], bonusWallets: [], links: null }
    let links = null
    try {
      const view = await service.getState()
      if (view !== null && typeof view === 'object' && view.links) links = view.links
      if (view !== null && typeof view === 'object' && view.status === 'signed-out') {
        return { status: 'signed-out', wallets: [], bonusWallets: [], links }
      }
    } catch {
      // A failed local state read still allows the balance query below.
    }
    try {
      const balance = await service.getBalance({
        version: '1.0.0',
        locale: state.config.locale,
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
      })
      if (balance === null) return { status: 'signed-out', wallets: [], bonusWallets: [], links }
      if (balance.status !== 'ready') return { status: 'failed', wallets: [], bonusWallets: [], links }
      return {
        status: 'ready',
        wallets: Array.isArray(balance.value) ? balance.value.map((wallet) => ({ ...wallet, kind: 'normal' })) : [],
        bonusWallets: Array.isArray(balance.bonusWallets)
          ? balance.bonusWallets.map((wallet) => ({ ...wallet, kind: 'bonus' }))
          : [],
        links,
      }
    } catch (error) {
      return {
        status: 'error',
        wallets: [],
        bonusWallets: [],
        links,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })().then((value) => {
    state.account = { at: Date.now(), value }
    state.accountInFlight = null
    return value
  }, (error) => {
    state.accountInFlight = null
    throw error
  })
  return state.accountInFlight
}

/** Collect every figure one response carries. */
async function collect(ctx, state, sessionId) {
  const now = Date.now()
  const warnings = []
  const account = await readAccount(ctx, state).catch((error) => ({
    status: 'error',
    wallets: [],
    bonusWallets: [],
    links: null,
    error: error instanceof Error ? error.message : String(error),
  }))
  const currency = pickCurrency(account, state.config)
  const month = monthWindow(now)

  if (
    state.usage !== null &&
    state.usage.config === state.config &&
    now - state.usage.at < state.config.usageTtlMs &&
    state.usage.monthKey === month.key
  ) {
    return buildPayload(state, account, currency, month, state.usage, sessionId, warnings)
  }

  const query = ctx.get('sessionQuery')
  let records = []
  if (query !== undefined) {
    try {
      records = await query.listSessions()
    } catch (error) {
      warnings.push(`session list failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  } else {
    warnings.push('session query service is unavailable')
  }

  const ordered = Array.isArray(records)
    ? [...records].sort((left, right) => (right.header?.createdAt ?? 0) - (left.header?.createdAt ?? 0))
    : []
  const selected = ordered.slice(0, state.config.maxSessions)
  if (sessionId !== undefined && !selected.some((record) => record.header?.id === sessionId)) {
    const extra = ordered.find((record) => record.header?.id === sessionId)
    if (extra !== undefined) selected.push(extra)
  }

  const monthScope = emptyScope()
  let monthSessions = 0
  let scanned = 0
  const alive = new Set()
  for (const record of selected) {
    const id = record.header?.id
    if (typeof id !== 'string') continue
    alive.add(id)
    try {
      let entry = state.sessions.get(id)
      if (entry === undefined || entry.monthKey !== month.key) {
        entry = await foldSession(ctx, id, month, state.config)
        state.sessions.set(id, entry)
      } else if (record.live) {
        foldSessionTail(ctx, entry, id, month, state.config)
      } else if (now - entry.at >= state.config.sessionCacheTtlMs) {
        entry = await foldSession(ctx, id, month, state.config)
        state.sessions.set(id, entry)
      }
      scanned += 1
      if (entry.month.calls > 0 || entry.month.models.size > 0) monthSessions += 1
      mergeMonth(monthScope, entry.month)
    } catch (error) {
      warnings.push(`session ${id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  for (const id of state.sessions.keys()) {
    if (!alive.has(id)) state.sessions.delete(id)
  }

  state.usage = { at: Date.now(), monthKey: month.key, config: state.config, scope: monthScope, sessions: monthSessions, scanned }
  return buildPayload(state, account, currency, month, state.usage, sessionId, warnings)
}

/** Wallet currency wins over the configured default. */
function pickCurrency(account, config) {
  const normal = Array.isArray(account.wallets) ? account.wallets[0] : undefined
  if (normal !== undefined && (normal.currency === 'CNY' || normal.currency === 'USD')) return normal.currency
  const bonus = Array.isArray(account.bonusWallets) ? account.bonusWallets[0] : undefined
  if (bonus !== undefined && (bonus.currency === 'CNY' || bonus.currency === 'USD')) return bonus.currency
  return config.currency
}

/** Build the HTTP payload from one collection. */
function buildPayload(state, account, currency, month, usage, sessionId, warnings) {
  const monthSummary = summarizeScope(usage.scope, currency, state.config)
  const entry = sessionId !== undefined ? state.sessions.get(sessionId) : undefined
  const sessionSummary = entry !== undefined ? summarizeScope(entry.total, currency, state.config) : null
  return {
    ok: true,
    generatedAt: Date.now(),
    account: {
      status: account.status,
      currency,
      wallets: Array.isArray(account.wallets) ? account.wallets : [],
      bonusWallets: Array.isArray(account.bonusWallets) ? account.bonusWallets : [],
      links: account.links ?? null,
      ...(account.error !== undefined ? { error: account.error } : {}),
    },
    month: {
      key: month.key,
      start: month.start,
      endExclusive: month.end,
      sessions: usage.sessions,
      scanned: usage.scanned,
      ...wireSummary(monthSummary, currency),
    },
    session: sessionId === undefined
      ? null
      : {
          id: sessionId,
          ...(sessionSummary === null ? { unavailable: true } : wireSummary(sessionSummary, currency)),
        },
    pricing: {
      currency,
      peakNow: isPeak(Date.now(), state.config),
      peakPricing: state.config.peakPricing,
      peakMultiplier: state.config.peakMultiplier,
      perMillionTokens: true,
    },
    warnings,
  }
}

/** Write one JSON response. */
function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/** Register the one stats route behind the connection trust fence. */
export function apply(ctx, rawConfig) {
  const state = {
    config: normalizeConfig(rawConfig),
    sessions: new Map(),
    usage: null,
    account: null,
    accountInFlight: null,
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_PATH,
        handler: async (req, res) => {
          const rejection = ctx.connection.requestRejection(req)
          if (rejection !== undefined) {
            res.statusCode = rejection
            res.end()
            return
          }
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.statusCode = 405
            res.setHeader('allow', 'GET, HEAD')
            res.end()
            return
          }
          try {
            const url = new URL(String(req.url ?? ROUTE_PATH), 'http://localhost')
            const sessionId = url.searchParams.get('session') ?? undefined
            const payload = await collect(ctx, state, sessionId)
            sendJson(res, 200, payload)
          } catch (error) {
            sendJson(res, 500, {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        },
      }),
    `usage-stats: GET ${ROUTE_PATH}`,
  )
}

/** Internals used by the repository's own checks; no runtime consumer reads this. */
export const __internals = {
  normalizeConfig,
  normalizeModel,
  monthWindow,
  isPeak,
  foldEvent,
  emptyEntry,
  emptyScope,
  summarizeScope,
  mergeMonth,
  wireSummary,
  collect,
  priceOf,
  buildPayload,
  DEFAULT_PRICING,
}
