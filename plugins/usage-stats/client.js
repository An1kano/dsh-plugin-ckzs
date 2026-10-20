/**
 * Browser half of the usage-stats bundle.
 *
 * One dock entry under the composer shows three pills — account balance,
 * month-to-date estimated spend, and current-session estimated spend — and a
 * panel with the token breakdown behind them. Everything is read from the
 * bundle's own Host route (`GET usage-stats/data`) so the Host stays the only
 * computation site and no credential reaches the page.
 */
window.__ModuleLoader__.load({
  id: '@an1kano/dsh-usage-stats',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Client locale namespace owned by this bundle. */
    const NS = 'usage-stats'
    /** Document-relative Host route; the browser half addresses it like shipped plugins do. */
    const ROUTE = 'usage-stats/data'
    /** Balance and usage refresh cadence. */
    const POLL_MS = 20000

    const zh = {
      'pill.balance': '余额 {value}',
      'pill.month': '本月 {value}',
      'pill.session': '会话 {value}',
      'pill.pending': '用量 …',
      'panel.title': '用量与余额',
      'panel.refresh': '刷新',
      'panel.updated': '更新于 {time}',
      'account.title': '账户余额',
      'account.total': '总余额',
      'account.normal': '充值余额',
      'account.bonus': '赠送余额',
      'account.signedOut': '未登录 DeepSeek 账号',
      'account.unavailable': '账户服务不可用',
      'account.failed': '余额读取失败',
      'account.error': '余额读取失败：{error}',
      'month.title': '本月（{month}）',
      'month.none': '本月还没有用量',
      'session.title': '当前会话',
      'session.none': '当前会话还没有用量',
      'session.unavailable': '会话数据不可用',
      'row.cost': '估算金额',
      'row.calls': '请求次数',
      'row.input': '输入（未命中缓存）',
      'row.cacheRead': '缓存命中',
      'row.cacheWrite': '缓存写入',
      'row.output': '输出',
      'row.sessions': '有消耗的会话',
      'row.models': '按模型',
      'note.estimate': '金额按 DeepSeek 官方价目估算，高峰时段单价 ×{multiplier}；实际扣费以平台账单为准。',
      'state.loading': '读取中…',
      'state.error': '统计加载失败：{error}',
      'state.retry': '重试',
      'unit.tokens': 'tokens',
    }

    const en = {
      'pill.balance': 'Balance {value}',
      'pill.month': 'Month {value}',
      'pill.session': 'Session {value}',
      'pill.pending': 'Usage …',
      'panel.title': 'Usage & balance',
      'panel.refresh': 'Refresh',
      'panel.updated': 'Updated {time}',
      'account.title': 'Account balance',
      'account.total': 'Total balance',
      'account.normal': 'Top-up balance',
      'account.bonus': 'Bonus balance',
      'account.signedOut': 'Not signed in to DeepSeek',
      'account.unavailable': 'Account service unavailable',
      'account.failed': 'Balance unavailable',
      'account.error': 'Balance unavailable: {error}',
      'month.title': 'This month ({month})',
      'month.none': 'No usage yet this month',
      'session.title': 'Current session',
      'session.none': 'No usage yet in this session',
      'session.unavailable': 'Session data unavailable',
      'row.cost': 'Estimated cost',
      'row.calls': 'Requests',
      'row.input': 'Input (cache miss)',
      'row.cacheRead': 'Cache hit',
      'row.cacheWrite': 'Cache write',
      'row.output': 'Output',
      'row.sessions': 'Sessions with usage',
      'row.models': 'By model',
      'note.estimate': 'Costs are estimated from the official DeepSeek price list with peak hours ×{multiplier}; the platform invoice stays authoritative.',
      'state.loading': 'Loading…',
      'state.error': 'Could not load statistics: {error}',
      'state.retry': 'Retry',
      'unit.tokens': 'tokens',
    }

    const CSS = [
      '.dsh-us-root{display:flex;flex-direction:column;gap:4px;min-width:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px))}',
      '.dsh-us-row{display:flex;align-items:center;flex-wrap:wrap;gap:2px;min-width:0}',
      '.dsh-us-pill{box-sizing:border-box;border-radius:var(--dsw-radius-sm,6px);max-width:100%;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font:inherit;font-variant-numeric:tabular-nums;white-space:nowrap;background:0 0;border:none;align-items:center;gap:6px;padding:1px 8px;display:inline-flex;cursor:pointer}',
      '.dsh-us-pill:hover,.dsh-us-pill[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));color:var(--dsw-alias-label-secondary)}',
      '.dsh-us-pill svg{flex:none;width:14px;height:14px}',
      '.dsh-us-panel{box-sizing:border-box;width:min(420px,calc(100vw - 32px));margin:2px 0 4px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}',
      '.dsh-us-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:2px}',
      '.dsh-us-title{font-weight:600}',
      '.dsh-us-link{background:none;border:none;color:var(--dsw-alias-brand-primary);cursor:pointer;font:inherit;padding:0}',
      '.dsh-us-sec{margin-top:8px}',
      '.dsh-us-sec-title{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));margin-bottom:2px}',
      '.dsh-us-dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:2px 12px;margin:0}',
      '.dsh-us-dl dt{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-weight:400;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-us-dl dd{margin:0;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.dsh-us-note{margin-top:8px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:12px;line-height:1.45}',
      '.dsh-us-err{color:var(--dsw-alias-state-error-primary)}',
      '.dsh-us-muted{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}',
    ].join('\n')

    /** Currency symbol for one wallet currency. */
    function symbolOf(currency) {
      return currency === 'USD' ? '$' : '¥'
    }

    /** Format a money amount with enough precision for small estimates. */
    function formatAmount(value) {
      const amount = Number(value)
      if (!Number.isFinite(amount)) return '—'
      const absolute = Math.abs(amount)
      const digits = absolute === 0 ? 2 : absolute < 0.01 ? 4 : absolute < 1 ? 3 : 2
      return amount.toFixed(digits)
    }

    /** Format one server cost object. */
    function formatCost(cost) {
      if (!cost || typeof cost.amount !== 'number') return '—'
      return symbolOf(cost.currency) + formatAmount(cost.amount)
    }

    /** Format one wallet's balance string for the panel (trimmed, at most 6 decimals). */
    function formatWallet(wallet) {
      if (wallet === undefined || wallet === null) return '—'
      const amount = Number(wallet.balance)
      const value = Number.isFinite(amount) ? String(Number(amount.toFixed(6))) : String(wallet.balance)
      return symbolOf(wallet.currency) + value
    }

    /** Format a summed balance for the compact pills. */
    function formatBalanceTotal(value, currency) {
      const amount = Number(value)
      if (!Number.isFinite(amount)) return '—'
      return symbolOf(currency) + amount.toFixed(2)
    }

    /** Compact token count. */
    function formatTokens(value) {
      const count = Number(value)
      if (!Number.isFinite(count) || count <= 0) return '0'
      if (count < 1000) return String(Math.round(count))
      if (count < 1000000) return (count / 1000).toFixed(count < 10000 ? 2 : 1) + 'K'
      return (count / 1000000).toFixed(2) + 'M'
    }

    /** Local wall-clock label for one timestamp. */
    function formatClock(timestamp) {
      if (typeof timestamp !== 'number' || timestamp <= 0) return '—'
      const date = new Date(timestamp)
      const pad = (part) => String(part).padStart(2, '0')
      return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    }

    /** One pill button; the whole row shares one panel. */
    function Pill({ icon, label, expanded, onToggle }) {
      return h(
        'button',
        {
          type: 'button',
          className: 'dsh-us-pill',
          'aria-expanded': expanded,
          'aria-haspopup': 'true',
          onClick: onToggle,
        },
        icon,
        h('span', { className: 'dsh-us-label' }, label),
      )
    }

    function IconWallet() {
      return h(
        'svg',
        { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('rect', { x: 3, y: 6, width: 18, height: 13, rx: 3 }),
        h('path', { d: 'M3 10h18' }),
        h('circle', { cx: 16.5, cy: 14.5, r: 1.25, fill: 'currentColor', stroke: 'none' }),
      )
    }

    function IconCalendar() {
      return h(
        'svg',
        { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('rect', { x: 3.5, y: 5, width: 17, height: 15, rx: 2.5 }),
        h('path', { d: 'M3.5 10h17M8 3.5v3M16 3.5v3' }),
      )
    }

    function IconChat() {
      return h(
        'svg',
        { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M20 12.4c0 3.9-3.6 7-8 7-1 0-2-.2-2.9-.5L4.5 20l1.2-3.4C4.6 15.4 4 14 4 12.4c0-3.9 3.6-7 8-7s8 3.1 8 7z' }),
      )
    }

    /** Poll the Host route for this Session's statistics. */
    function useStats(sessionId) {
      const [state, setState] = React.useState({ data: null, error: null })
      const alive = React.useRef(true)
      const load = React.useCallback(async () => {
        const suffix = typeof sessionId === 'string' && sessionId !== ''
          ? `?session=${encodeURIComponent(sessionId)}`
          : ''
        try {
          const response = await fetch(ROUTE + suffix, {
            headers: { accept: 'application/json' },
            cache: 'no-store',
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const data = await response.json()
          if (!data || data.ok !== true) {
            throw new Error(data && typeof data.error === 'string' ? data.error : 'invalid response')
          }
          if (alive.current) setState({ data, error: null })
        } catch (error) {
          if (alive.current) {
            setState((previous) => ({
              data: previous.data,
              error: error instanceof Error ? error.message : String(error),
            }))
          }
        }
      }, [sessionId])

      React.useEffect(() => {
        alive.current = true
        load()
        const timer = setInterval(load, POLL_MS)
        const onVisible = () => {
          if (document.visibilityState === 'visible') load()
        }
        document.addEventListener('visibilitychange', onVisible)
        window.addEventListener('focus', onVisible)
        return () => {
          alive.current = false
          clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisible)
          window.removeEventListener('focus', onVisible)
        }
      }, [load])

      return { data: state.data, error: state.error, refresh: load }
    }

    /** Account section rows. */
    function AccountSection({ account, t }) {
      const wallets = Array.isArray(account.wallets) ? account.wallets : []
      const bonusWallets = Array.isArray(account.bonusWallets) ? account.bonusWallets : []
      if (account.status === 'unavailable') {
        return h(Section, { title: t('account.title') },
          h('div', { className: 'dsh-us-muted' }, t('account.unavailable')))
      }
      if (account.status === 'signed-out') {
        return h(Section, { title: t('account.title') },
          h('div', { className: 'dsh-us-muted' }, t('account.signedOut')))
      }
      if (account.status !== 'ready' && wallets.length === 0 && bonusWallets.length === 0) {
        const label = account.status === 'error' && typeof account.error === 'string'
          ? t('account.error', { error: account.error })
          : t('account.failed')
        return h(Section, { title: t('account.title') },
          h('div', { className: 'dsh-us-err' }, label))
      }
      const rows = []
      const currency = account.currency === 'USD' ? 'USD' : 'CNY'
      const matching = wallets.concat(bonusWallets).filter((wallet) => wallet.currency === currency)
      if (matching.length > 0) {
        const total = matching.reduce((sum, wallet) => sum + (Number(wallet.balance) || 0), 0)
        rows.push(h('dt', { key: 'total' }, t('account.total')))
        rows.push(h('dd', { key: 'total-v' }, formatBalanceTotal(total, currency)))
      }
      for (const wallet of wallets) {
        rows.push(h('dt', { key: `n-${wallet.currency}` }, t('account.normal')))
        rows.push(h('dd', { key: `nv-${wallet.currency}` }, formatWallet(wallet)))
      }
      for (const wallet of bonusWallets) {
        rows.push(h('dt', { key: `b-${wallet.currency}` }, t('account.bonus')))
        rows.push(h('dd', { key: `bv-${wallet.currency}` }, formatWallet(wallet)))
      }
      if (rows.length === 0) {
        return h(Section, { title: t('account.title') },
          h('div', { className: 'dsh-us-muted' }, t('account.failed')))
      }
      return h(Section, { title: t('account.title') }, h('dl', { className: 'dsh-us-dl' }, rows))
    }

    /** One titled block of the panel. */
    function Section({ title, children }) {
      return h('div', { className: 'dsh-us-sec' },
        h('div', { className: 'dsh-us-sec-title' }, title),
        children)
    }

    /** Token and cost rows of one summarized scope. */
    function UsageRows({ summary, t, extraRows }) {
      const tokens = summary.tokens ?? {}
      const rows = []
      rows.push(h('dt', { key: 'cost' }, t('row.cost')))
      rows.push(h('dd', { key: 'cost-v' }, formatCost(summary.cost)))
      rows.push(h('dt', { key: 'calls' }, t('row.calls')))
      rows.push(h('dd', { key: 'calls-v' }, String(summary.calls ?? 0)))
      if (extraRows) rows.push(...extraRows)
      rows.push(h('dt', { key: 'input' }, t('row.input')))
      rows.push(h('dd', { key: 'input-v' }, formatTokens(tokens.input)))
      rows.push(h('dt', { key: 'cacheRead' }, t('row.cacheRead')))
      rows.push(h('dd', { key: 'cacheRead-v' }, formatTokens(tokens.cacheRead)))
      if (Number(tokens.cacheWrite) > 0) {
        rows.push(h('dt', { key: 'cacheWrite' }, t('row.cacheWrite')))
        rows.push(h('dd', { key: 'cacheWrite-v' }, formatTokens(tokens.cacheWrite)))
      }
      rows.push(h('dt', { key: 'output' }, t('row.output')))
      rows.push(h('dd', { key: 'output-v' }, formatTokens(tokens.output)))
      return h('dl', { className: 'dsh-us-dl' }, rows)
    }

    /** Per-model cost lines. */
    function ModelRows({ models, currency, multiplier, t }) {
      const list = Array.isArray(models)
        ? models.filter((model) => (model.tokens?.total ?? 0) > 0 || (model.totalTokens ?? 0) > 0)
        : []
      if (list.length === 0) return null
      const rows = [h('dt', { key: 'models-title' }, t('row.models'))]
      rows.push(h('dd', { key: 'models-v' }, ''))
      for (const model of list.slice(0, 5)) {
        const label = model.priced === false ? `${model.model} *` : model.model
        rows.push(h('dt', {
          key: `m-${model.model}`,
          title: model.priced === false ? t('note.estimate', { multiplier }) : undefined,
        }, label))
        rows.push(h('dd', { key: `mv-${model.model}` }, formatCost({ amount: model.cost, currency })))
      }
      return h('dl', { className: 'dsh-us-dl' }, rows)
    }

    /** Panel body; pure so the whole data branch stays render-testable. */
    function StatsPanel({ data, error, translate, onRefresh, open, onToggle }) {
      const currency = data?.account?.currency ?? data?.pricing?.currency ?? 'CNY'

      const wallets = Array.isArray(data?.account?.wallets) ? data.account.wallets : []
      const bonusWallets = Array.isArray(data?.account?.bonusWallets) ? data.account.bonusWallets : []
      const matching = wallets.concat(bonusWallets).filter((wallet) => wallet.currency === currency)
      const totalBalance = matching.reduce((sum, wallet) => sum + (Number(wallet.balance) || 0), 0)
      const balanceLabel = data === null
        ? translate('pill.pending')
        : matching.length > 0
          ? translate('pill.balance', { value: formatBalanceTotal(totalBalance, currency) })
          : translate('pill.balance', { value: '—' })
      const monthLabel = data === null
        ? translate('pill.pending')
        : translate('pill.month', { value: formatCost(data.month?.cost) })
      const sessionLabel = data === null
        ? translate('pill.pending')
        : translate('pill.session', {
            value: data.session && !data.session.unavailable ? formatCost(data.session.cost) : '—',
          })

      const sectionNodes = []
      if (data !== null) {
        sectionNodes.push(h(AccountSection, { key: 'account', account: data.account, t: translate }))

        const month = data.month
        if (month) {
          const monthChildren = []
          if (month.calls === 0 && month.totalTokens === 0) {
            monthChildren.push(h('div', { key: 'none', className: 'dsh-us-muted' }, translate('month.none')))
          } else {
            monthChildren.push(h(UsageRows, {
              key: 'rows',
              summary: month,
              t: translate,
              extraRows: [
                h('dt', { key: 'sessions' }, translate('row.sessions')),
                h('dd', { key: 'sessions-v' }, String(month.sessions ?? 0)),
              ],
            }))
            const models = Array.isArray(month.models) ? month.models : []
            if (models.length > 0) {
              monthChildren.push(h(ModelRows, {
                key: 'models',
                models,
                currency,
                multiplier: data.pricing?.peakMultiplier ?? 2,
                t: translate,
              }))
            }
          }
          sectionNodes.push(h(Section, { key: 'month', title: translate('month.title', { month: month.key }) },
            monthChildren))
        }

        const session = data.session
        if (session) {
          const sessionChildren = []
          if (session.unavailable) {
            sessionChildren.push(h('div', { key: 'na', className: 'dsh-us-muted' }, translate('session.unavailable')))
          } else if (session.calls === 0 && session.totalTokens === 0) {
            sessionChildren.push(h('div', { key: 'none', className: 'dsh-us-muted' }, translate('session.none')))
          } else {
            sessionChildren.push(h(UsageRows, { key: 'rows', summary: session, t: translate }))
            const models = Array.isArray(session.models) ? session.models : []
            if (models.length > 0) {
              sessionChildren.push(h(ModelRows, {
                key: 'models',
                models,
                currency,
                multiplier: data.pricing?.peakMultiplier ?? 2,
                t: translate,
              }))
            }
          }
          sectionNodes.push(h(Section, { key: 'session', title: translate('session.title') }, sessionChildren))
        }

        sectionNodes.push(h('div', { key: 'note', className: 'dsh-us-note' },
          translate('note.estimate', { multiplier: data.pricing?.peakMultiplier ?? 2 })))
      } else {
        const message = error !== null
          ? translate('state.error', { error })
          : translate('state.loading')
        sectionNodes.push(h('div', {
          key: 'state',
          className: error !== null ? 'dsh-us-err' : 'dsh-us-muted',
        }, message))
      }

      const head = h('div', { className: 'dsh-us-head' },
        h('span', { className: 'dsh-us-title' }, translate('panel.title')),
        h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '10px' } },
          h('span', { className: 'dsh-us-muted' },
            translate('panel.updated', { time: formatClock(data?.generatedAt) })),
          h('button', {
            type: 'button',
            className: 'dsh-us-link',
            onClick: onRefresh,
          }, translate('panel.refresh'))))

      return h('div', { className: 'dsh-us-root' },
        h('style', null, CSS),
        h('div', { className: 'dsh-us-row' },
          h(Pill, {
            icon: h(IconWallet, null),
            label: balanceLabel,
            expanded: open,
            onToggle,
          }),
          h(Pill, {
            icon: h(IconCalendar, null),
            label: monthLabel,
            expanded: open,
            onToggle,
          }),
          h(Pill, {
            icon: h(IconChat, null),
            label: sessionLabel,
            expanded: open,
            onToggle,
          })),
        open
          ? h('div', { className: 'dsh-us-panel', role: 'region', 'aria-label': translate('panel.title') },
              head,
              sectionNodes)
          : null)
    }

    /** The composer-dock entry: polling and open state around the pure panel. */
    function UsageStatsDock({ sessionId, t }) {
      const translate = typeof t === 'function' ? t : (key) => key
      const stats = useStats(sessionId)
      const [open, setOpen] = React.useState(false)

      React.useEffect(() => {
        if (!open) return undefined
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
      }, [open])

      return h(StatsPanel, {
        data: stats.data,
        error: stats.error,
        translate,
        onRefresh: () => {
          stats.refresh()
        },
        open,
        onToggle: () => setOpen((value) => !value),
      })
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(
          () => ctx.locale.register(NS, { zh, en }),
          'usage-stats: dictionaries',
        )
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.composer.dock',
              id: 'usage-stats',
              order: 2,
              locale: NS,
            },
            UsageStatsDock,
          ),
        )
      },
      /** Render-test seam for the repository's offline checks. */
      __test: {
        StatsPanel,
        UsageStatsDock,
        dictionaries: { zh, en },
        formatCost,
        formatTokens,
        formatWallet,
      },
    }
  },
})
