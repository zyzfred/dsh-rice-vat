/**
 * Host half of the rice-bowl bundle.
 *
 * Owns the only privileged work: reading the signed-in DeepSeek account balance,
 * accumulating real token spend from committed session events, and handing both
 * to the Client panel as JSON. No API key is read in this version.
 *
 * Accounting starts when the plugin is first loaded. Events are observed from a
 * live subscription only, so nothing is back-filled and no session log is replayed.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ROUTE_PATH = '/api/rice-bowl'
const PLUGIN_NAME = 'dsh-rice-vat'
const PLUGIN_VERSION = '1.0.1'

/**
 * Rice tiers, in CNY. Four discrete artwork states back these:
 *
 *   balance  > 100  → overflow  米堆成小山，溢出缸口
 *   6 < b ≤ 100     → full      米面平齐缸口
 *   0 < b ≤ 6       → low       缸底只剩几粒米
 *   b = 0           → empty     空缸
 */
const FULL_BALANCE = 100
const LOW_BALANCE = 6
/** Balance responses are cached this long so a polling panel cannot rate-limit itself. */
const BALANCE_TTL_MS = 45_000
/** How long one consumption stays "fresh" enough to animate. */
const EAT_WINDOW_MS = 6_000
/** Debounce for writing the ledger to disk. */
const SAVE_DELAY_MS = 1_500

/**
 * Preview switch. When true the panel is told the balance is zero, so the
 * empty-vat scene renders for a visual check without waiting for the account to
 * actually run dry. Flip back to false to return to real data — a plugin reload is
 * enough, no DSH restart needed.
 */
const FORCE_EMPTY = false

/**
 * Official DeepSeek list prices in CNY per million tokens, split by billing period.
 * Off-peak is exactly half of peak. Source: DeepSeek "模型 & 价格" documentation.
 */
const PRICES = {
  'deepseek-flash': {
    peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
    offPeak: { cacheHit: 0.02, cacheMiss: 1, output: 4 },
  },
  'deepseek-v4-pro': {
    peak: { cacheHit: 0.3, cacheMiss: 9, output: 27 },
    offPeak: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
  },
}

/** Model ids that still route to (and bill as) flash. */
const FLASH_ALIASES = new Set([
  'deepseek-flash',
  'deepseek-v4-flash',
  'deepseek-v4-flash-vision-exp',
  'deepseek-chat',
])

const PRO_ALIASES = new Set(['deepseek-v4-pro', 'deepseek-pro', 'deepseek-reasoner'])

/**
 * Map a CNY balance to a rice level in [0, 1].
 *
 * The artwork is discrete, so this continuous value is only used by the SVG
 * fallback vat and by the accessible label: 100 CNY = 1, 6 CNY = 0.05, 0 = 0.
 */
function riceLevel(balance) {
  if (typeof balance !== 'number' || !Number.isFinite(balance) || balance <= 0) return 0
  if (balance <= LOW_BALANCE) {
    return Math.round((balance / LOW_BALANCE) * 0.05 * 1000) / 1000
  }
  if (balance <= FULL_BALANCE) {
    const span = (balance - LOW_BALANCE) / (FULL_BALANCE - LOW_BALANCE)
    return Math.round((0.05 + span * 0.95) * 1000) / 1000
  }
  return 1
}

/** Which of the four vat artworks this balance selects. */
function tierFor(balance) {
  if (typeof balance !== 'number' || !Number.isFinite(balance) || balance <= 0) return 'empty'
  if (balance <= LOW_BALANCE) return 'low'
  if (balance <= FULL_BALANCE) return 'full'
  return 'overflow'
}

function toAmount(value) {
  const parsed = Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0
}

function round6(value) {
  return Math.round(value * 1e6) / 1e6
}

/**
 * DeepSeek bills a weekday daytime window at full price and everything else at
 * half. China has no DST, so a fixed +08:00 offset is exact. Chinese public
 * holidays are not modelled; on those days this over-estimates the cost.
 */
function billingPeriod(now = Date.now()) {
  const beijing = new Date(now + 8 * 3600 * 1000)
  const day = beijing.getUTCDay()
  const hour = beijing.getUTCHours() + beijing.getUTCMinutes() / 60
  const weekday = day >= 1 && day <= 5
  const peak = weekday && ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18))
  return peak ? 'peak' : 'offPeak'
}

function priceTableFor(model) {
  const id = String(model ?? '').toLowerCase()
  if (PRO_ALIASES.has(id) || id.includes('pro')) return PRICES['deepseek-v4-pro']
  if (FLASH_ALIASES.has(id) || id.includes('flash') || id.includes('chat') || id.includes('reasoner')) {
    return PRICES['deepseek-flash']
  }
  return PRICES['deepseek-flash']
}

/** Convert one token usage record into CNY. */
function costOf(usage, model, now) {
  const table = priceTableFor(model)
  const rates = table[billingPeriod(now)]

  const input = Number(usage?.inputTokens) || 0
  const output = Number(usage?.outputTokens) || 0
  const cacheRead = Math.min(Number(usage?.cacheReadTokens) || 0, input)
  const cacheMiss = Math.max(input - cacheRead, 0)

  const cny =
    (cacheRead * rates.cacheHit + cacheMiss * rates.cacheMiss + output * rates.output) / 1_000_000

  return {
    cny: round6(cny),
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheMissTokens: cacheMiss,
    pricing: { model: priceTableFor(model) === PRICES['deepseek-v4-pro'] ? 'deepseek-v4-pro' : 'deepseek-flash', period: billingPeriod(now) },
  }
}

function dayKey(now = Date.now()) {
  const beijing = new Date(now + 8 * 3600 * 1000)
  return beijing.toISOString().slice(0, 10)
}

function emptyLedger(now) {
  return { version: 1, installedAt: now, days: {}, calls: 0, cny: 0, tokens: 0 }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/**
 * Hard requirement: without it the plugin must stay inactive rather than apply
 * early and silently skip every registration.
 *
 * `apply` runs exactly once. Reading `ctx.get('webServer')` and returning when it
 * is not up yet would leave the route and the consumption subscription missing
 * for the whole process — the plugin looks enabled but serves nothing.
 */
export const inject = ['webServer']

export function apply(ctx) {
  const webServer = ctx.get('webServer')
  if (webServer === undefined) return

  let cached = { at: 0, doc: null }
  let ledger = null
  let saving = null
  let saveTimer = null
  const recent = []
  /* Set by the Client half on mount; proves the component mounted without crashing. */
  let lastRenderAt = 0
  let renderCount = 0
  let stateServed = 0
  let stateDenied = 0
  let pulseServed = 0
  let lastStateAt = 0
  let authOwner = 0
  let authToken = 0
  let authBootstrap = 0

  /**
   * Page-scoped bearer tokens.
   *
   * The plugin's route lives on its own prefix, so the shared `/api` admission
   * never runs for it and `peer` arrives undefined. The Host therefore mints one
   * token per authenticated index render and injects it into that page; only a
   * page the Host rendered for the owner can read balances.
   *
   * Tokens are stored as SHA-256 hashes and persisted, so a plugin reload does not
   * invalidate the page that is already open, and a process that reads the file
   * cannot reconstruct a usable token.
   */
  const TOKEN_TTL_MS = 7 * 24 * 3600 * 1000
  const tokens = new Map()

  function tokenDir() {
    return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'rice-bowl')
  }

  function tokenFile() {
    return join(tokenDir(), 'tokens.json')
  }

  function hashToken(value) {
    return createHash('sha256').update(String(value)).digest('hex')
  }

  function loadTokens() {
    try {
      const parsed = JSON.parse(readFileSync(tokenFile(), 'utf8'))
      const now = Date.now()
      for (const [hash, expiry] of Object.entries(parsed ?? {})) {
        const at = Number(expiry)
        if (Number.isFinite(at) && at > now) tokens.set(hash, at)
      }
    } catch {
      /* no stored tokens yet */
    }
  }

  function persistTokens() {
    try {
      mkdirSync(tokenDir(), { recursive: true })
      writeFileSync(tokenFile(), JSON.stringify(Object.fromEntries(tokens)), { mode: 0o600 })
    } catch {
      /* persistence is best-effort; the live map still works */
    }
  }

  function issueToken() {
    const token = randomBytes(24).toString('base64url')
    const now = Date.now()
    for (const [hash, expiry] of tokens) {
      if (expiry <= now) tokens.delete(hash)
    }
    if (tokens.size > 64) tokens.clear()
    tokens.set(hashToken(token), now + TOKEN_TTL_MS)
    persistTokens()
    return token
  }

  loadTokens()

  function authorize(request, peer) {
    if (peer?.principal?.kind === 'owner') return 'owner'

    const presented = request.headers.get('x-rice-bowl-token')
    if (typeof presented === 'string' && presented.length > 0) {
      const expiry = tokens.get(hashToken(presented))
      if (expiry !== undefined && expiry > Date.now()) return 'token'
    }

    /*
     * One-time bootstrap window, used only while this profile has never minted a
     * token (fresh install, or the very first reload after upgrading to
     * persisted tokens). As soon as one token exists it is dead forever, so the
     * steady state is fail-closed.
     */
    if (tokens.size === 0 && peer === undefined) {
      const host = String(request.headers.get('host') ?? '')
      const forwarded = request.headers.get('x-forwarded-for')
      if (/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(host) && forwarded === null) {
        return 'bootstrap'
      }
    }

    /* Fail closed: no owner peer, no valid page token, no data. */
    return null
  }

  const stateDir = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'rice-bowl')
  const ledgerPath = join(stateDir, 'ledger.json')

  /*
   * Artwork is not sensitive, so its route stays open; only money data is guarded.
   * Each key lists candidate files in preference order, so a processed `.webp`
   * automatically wins over the raw `.png` once it exists.
   */
  const ASSET_PREFIX = `${ROUTE_PATH}/asset/`
  const ASSET_ROOT = new URL('./assets/', import.meta.url)
  const ASSETS = new Map([
    ['vat-overflow', ['vat-overflow.webp', 'vat-overflow.png']],
    ['vat-full', ['vat-full.webp', 'vat-full.png']],
    ['vat-low', ['vat-low.webp', 'vat-low.png']],
    ['vat-empty', ['vat-empty.webp', 'vat-empty.png']],
    ['vat-rice-mask', ['vat-rice-mask.webp', 'vat-rice-mask.png']],
    ['vat-rice-overlay', ['vat-rice-overlay.webp', 'vat-rice-overlay.png']],
    ['girl-idle', ['girl-idle.webp', 'girl-idle.png']],
    ['girl-eat', ['girl-eat.webp', 'girl-eat.png']],
    ['girl-low', ['girl-low.webp', 'girl-low.png']],
    ['girl-sleep', ['girl-sleep.webp', 'girl-sleep.png']],
  ])
  const MEDIA_TYPES = new Map([
    ['webp', 'image/webp'],
    ['png', 'image/png'],
    ['gif', 'image/gif'],
  ])

  function assetExists(key) {
    const candidates = ASSETS.get(key)
    if (candidates === undefined) return false
    return candidates.some((name) => existsSync(new URL(name, ASSET_ROOT)))
  }

  /** Every sprite key the Client can request; each gets its own exact route. */
  const CACHED_ASSET_KEYS = [...ASSETS.keys()]

  const hasVatArt = ['vat-overflow', 'vat-full', 'vat-low', 'vat-empty'].every(assetExists)
  const hasGirlArt = ['girl-idle', 'girl-eat', 'girl-low', 'girl-sleep'].every(assetExists)
  const hasContinuousArt = assetExists('vat-rice-mask') && assetExists('vat-rice-overlay')
  const assetHits = new Map()
  const assetErrors = new Map()
  let lastAssetError = null

  /*
   * Balance anchor. The authoritative balance only refreshes every 45s, so between
   * refreshes the displayed figure is the anchor minus the cost recorded since it.
   * That is what makes the rice drain continuously instead of dropping in steps.
   */
  const anchor = { balance: null, currency: null, spent: 0, at: 0 }

  /**
   * Balance-read diagnostics. Counters and error codes only — never an amount —
   * so `/diag` can explain a failing panel without leaking the balance.
   */
  const accountDiag = { signedIn: null, lastAttemptAt: 0, lastOkAt: 0, lastError: null }

  async function loadLedger() {
    try {
      const raw = await readFile(ledgerPath, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed !== null && typeof parsed === 'object' && typeof parsed.days === 'object') {
        return {
          version: 1,
          installedAt: Number(parsed.installedAt) || Date.now(),
          days: parsed.days,
          calls: Number(parsed.calls) || 0,
          cny: Number(parsed.cny) || 0,
          tokens: Number(parsed.tokens) || 0,
        }
      }
    } catch {
      /* missing or unreadable ledger starts a fresh one */
    }
    return emptyLedger(Date.now())
  }

  async function flushLedger() {
    if (ledger === null) return
    if (saving !== null) return saving
    saving = (async () => {
      try {
        await mkdir(stateDir, { recursive: true })
        await writeFile(ledgerPath, JSON.stringify(ledger), 'utf8')
      } catch {
        /* accounting must never break the panel */
      } finally {
        saving = null
      }
    })()
    return saving
  }

  function scheduleSave() {
    if (saveTimer !== null) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      void flushLedger()
    }, SAVE_DELAY_MS)
    if (typeof saveTimer.unref === 'function') saveTimer.unref()
  }

  function record(usage, model, now) {
    if (ledger === null) return
    const cost = costOf(usage, model, now)
    const key = dayKey(now)
    const day = ledger.days[key] ?? { cny: 0, tokens: 0, calls: 0, byModel: {} }
    day.cny = round6(day.cny + cost.cny)
    day.tokens += cost.inputTokens + cost.outputTokens
    day.calls += 1

    const modelKey = cost.pricing.model
    const bucket = day.byModel[modelKey] ?? { cny: 0, tokens: 0, calls: 0 }
    bucket.cny = round6(bucket.cny + cost.cny)
    bucket.tokens += cost.inputTokens + cost.outputTokens
    bucket.calls += 1
    day.byModel[modelKey] = bucket

    ledger.days[key] = day
    ledger.calls += 1
    ledger.cny = round6(ledger.cny + cost.cny)
    ledger.tokens += cost.inputTokens + cost.outputTokens

    recent.push({ at: now, cny: cost.cny, tokens: cost.inputTokens + cost.outputTokens, model: modelKey })
    const cutoff = now - EAT_WINDOW_MS
    while (recent.length > 0 && recent[0].at < cutoff) recent.shift()

    if (anchor.balance !== null) {
      anchor.spent = round6(anchor.spent + cost.cny)
    }

    scheduleSave()
  }

  function spendSummary() {
    if (ledger === null) return null
    const now = Date.now()
    const today = ledger.days[dayKey()] ?? { cny: 0, tokens: 0, calls: 0, byModel: {} }
    const cutoff = now - EAT_WINDOW_MS
    const fresh = recent.filter((item) => item.at >= cutoff)
    const window = fresh.reduce((sum, item) => sum + item.cny, 0)
    return {
      today: Math.round(today.cny * 10000) / 10000,
      todayTokens: today.tokens,
      todayCalls: today.calls,
      todayByModel: today.byModel,
      total: Math.round(ledger.cny * 10000) / 10000,
      totalCalls: ledger.calls,
      installedAt: ledger.installedAt,
      recentCny: Math.round(window * 1e6) / 1e6,
      recentAt: fresh.length > 0 ? fresh[fresh.length - 1].at : null,
      period: billingPeriod(),
    }
  }

  function clientMetadata() {
    const now = new Date()
    return {
      version: PLUGIN_VERSION,
      locale: 'zh-CN',
      timezoneOffsetSeconds: -now.getTimezoneOffset() * 60,
    }
  }

  /**
   * The Platform balance endpoint occasionally fails transiently. Two short
   * retries keep a single hiccup from blanking the panel for a whole poll cycle.
   */
  async function getBalanceWithRetry(account) {
    const delays = [0, 600, 1_500]
    let lastError
    for (const delay of delays) {
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
      try {
        return await account.getBalance(clientMetadata())
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  }

  async function readBalance() {
    const account = ctx.get('deepseekAccount')
    if (account === undefined) return { signedIn: false, error: 'account-service-unavailable', accounts: [], primary: null, links: null }

    let state
    try {
      state = await account.getState()
    } catch {
      return { signedIn: false, error: 'account-state-unavailable', accounts: [], primary: null, links: null }
    }

    const links = state?.links === undefined ? null : { usageUrl: state.links.usageUrl, topUpUrl: state.links.topUpUrl }
    if (state?.status !== 'credential-stored') {
      return { signedIn: false, error: null, accounts: [], primary: null, links }
    }

    let balance
    try {
      balance = await getBalanceWithRetry(account)
    } catch {
      return { signedIn: true, error: 'balance-request-failed', accounts: [], primary: null, links }
    }
    if (balance === null || balance === undefined) {
      return { signedIn: false, error: 'signed-out', accounts: [], primary: null, links }
    }
    if (balance.status !== 'ready') {
      return { signedIn: true, error: 'balance-unavailable', accounts: [], primary: null, links }
    }

    const totals = new Map()
    const recharge = new Map()
    const bonus = new Map()
    for (const wallet of balance.value) {
      totals.set(wallet.currency, (totals.get(wallet.currency) ?? 0) + toAmount(wallet.balance))
      recharge.set(wallet.currency, (recharge.get(wallet.currency) ?? 0) + toAmount(wallet.balance))
    }
    for (const wallet of balance.bonusWallets) {
      totals.set(wallet.currency, (totals.get(wallet.currency) ?? 0) + toAmount(wallet.balance))
      bonus.set(wallet.currency, (bonus.get(wallet.currency) ?? 0) + toAmount(wallet.balance))
    }

    const wallets = [...totals.entries()]
      .map(([currency, total]) => ({
        currency,
        balance: Math.round(total * 100) / 100,
        recharge: Math.round((recharge.get(currency) ?? 0) * 100) / 100,
        bonus: Math.round((bonus.get(currency) ?? 0) * 100) / 100,
        level: riceLevel(total),
      }))
      .sort((a, b) => (a.currency === 'CNY' ? -1 : b.currency === 'CNY' ? 1 : 0))

    return {
      signedIn: true,
      error: null,
      links,
      accounts: [{ id: 'signed-in', label: 'DeepSeek 账户', kind: 'account', masked: null, wallets, level: wallets[0]?.level ?? 0 }],
      primary: wallets[0] ?? null,
    }
  }

  /**
   * Balance as it should be drawn right now: the last authoritative reading minus
   * everything recorded since. Null until a balance has been read once.
   */
  function liveBalance() {
    if (anchor.balance === null) return null
    const balance = Math.max(0, Math.round((anchor.balance - anchor.spent) * 10000) / 10000)
    return {
      currency: anchor.currency,
      balance,
      level: riceLevel(balance),
      tier: tierFor(balance),
      anchorAt: anchor.at,
      spentSinceAnchor: Math.round(anchor.spent * 10000) / 10000,
    }
  }

  /**
   * What the panel should draw. With FORCE_EMPTY on, an empty vat is reported so
   * the sleeping composite can be checked on the real UI, then switched back.
   */
  function liveForDisplay() {
    const live = liveBalance()
    if (!FORCE_EMPTY) return live
    const base = live ?? { currency: 'CNY', balance: 0, level: 0, anchorAt: 0, spentSinceAnchor: 0 }
    return { ...base, balance: 0, level: 0, tier: 'empty' }
  }

  async function readState() {
    const base = await readBalance()

    accountDiag.lastAttemptAt = Date.now()
    accountDiag.signedIn = base.signedIn === true
    accountDiag.lastError = base.error ?? null

    if (base.primary !== null && base.primary !== undefined) {
      anchor.balance = base.primary.balance
      anchor.currency = base.primary.currency
      anchor.spent = 0
      anchor.at = Date.now()
      accountDiag.lastOkAt = Date.now()
    }

    return {
      ok: true,
      plugin: PLUGIN_NAME,
      version: PLUGIN_VERSION,
      now: Date.now(),
      thresholds: { full: FULL_BALANCE, low: LOW_BALANCE },
      signedIn: base.signedIn,
      accounts: base.accounts,
      primary: FORCE_EMPTY && base.primary !== null ? { ...base.primary, balance: 0, level: 0 } : base.primary,
      links: base.links,
      error: base.error,
      stale: false,
      art: { vat: hasVatArt, girl: hasGirlArt, continuous: hasContinuousArt },
      live: liveForDisplay(),
      spend: spendSummary(),
    }
  }

  async function handle(request, peer) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return jsonResponse({ ok: false, error: 'method-not-allowed' }, 405)
    }

    let url
    try {
      url = new URL(request.url)
    } catch {
      return jsonResponse({ ok: false, error: 'bad-request' }, 400)
    }

    /* Sprite delivery. Public by design: the artwork carries no account data. */
    if (url.pathname.startsWith(ASSET_PREFIX)) {
      const key = url.pathname.slice(ASSET_PREFIX.length).replace(/\.[a-z0-9]+$/i, '')
      if (key === 'error') {
        const name = url.searchParams.get('name') ?? 'unknown'
        assetErrors.set(name, (assetErrors.get(name) ?? 0) + 1)
        lastAssetError = { name, at: Date.now() }
        return jsonResponse({ ok: true })
      }
      const candidates = ASSETS.get(key)
      if (candidates === undefined) {
        return new Response('not found', { status: 404 })
      }
      for (const name of candidates) {
        try {
          const bytes = await readFile(new URL(name, ASSET_ROOT))
          const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
          assetHits.set(key, (assetHits.get(key) ?? 0) + 1)
          return new Response(bytes, {
            headers: {
              'content-type': MEDIA_TYPES.get(ext) ?? 'application/octet-stream',
              'cache-control': 'public, max-age=86400',
            },
          })
        } catch {
          /* try the next candidate */
        }
      }
      return new Response('missing', { status: 404 })
    }

    /*
     * Diagnostics carry counters only — never a balance — so they stay reachable
     * without an owner peer while still proving the Client half mounted and
     * whether the server admitted its data requests.
     */
    if (url.pathname === `${ROUTE_PATH}/ping`) {
      renderCount += 1
      lastRenderAt = Date.now()
      return jsonResponse({ ok: true })
    }

    if (url.pathname === `${ROUTE_PATH}/diag`) {
      return jsonResponse({
        ok: true,
        now: Date.now(),
        renders: renderCount,
        lastRenderAt,
        stateServed,
        stateDenied,
        pulseServed,
        lastStateAt,
        auth: { owner: authOwner, token: authToken, bootstrap: authBootstrap },
        mintedTokens: tokens.size,
        assetHits: Object.fromEntries(assetHits),
        assetErrors: Object.fromEntries(assetErrors),
        lastAssetError,
        account: accountDiag,
        preview: FORCE_EMPTY ? 'forced-empty' : null,
      })
    }

    /*
     * Fail closed: a request the server could not attribute to the local owner
     * must never see balance data.
     */
    const mode = authorize(request, peer)
    if (mode === null) {
      stateDenied += 1
      return jsonResponse({ ok: false, error: 'forbidden' }, 403)
    }
    if (mode === 'owner') authOwner += 1
    else if (mode === 'token') authToken += 1
    else authBootstrap += 1

    /* Cheap liveness probe: no balance call, so the panel can poll it often. */
    if (url.pathname === `${ROUTE_PATH}/pulse`) {
      pulseServed += 1
      const spend = spendSummary()
      return jsonResponse({
        ok: true,
        now: Date.now(),
        signedIn: cached.doc?.signedIn ?? false,
        primary: cached.doc?.primary ?? null,
        art: { vat: hasVatArt, girl: hasGirlArt, continuous: hasContinuousArt },
        live: liveForDisplay(),
        spend,
        render: { at: lastRenderAt, count: renderCount },
      })
    }

    if (url.pathname !== `${ROUTE_PATH}/state`) {
      return jsonResponse({ ok: false, error: 'not-found' }, 404)
    }

    const force = url.searchParams.get('refresh') === '1'
    const fresh = Date.now() - cached.at < BALANCE_TTL_MS
    if (!force && fresh && cached.doc !== null) {
      stateServed += 1
      lastStateAt = Date.now()
      return jsonResponse({ ...cached.doc, cached: true })
    }

    let doc
    try {
      doc = await readState()
    } catch {
      return jsonResponse({ ok: false, error: 'state-build-failed' }, 500)
    }

    /*
     * A transient account failure must not blank the panel. Keep serving the last
     * good figures and mark them stale, so the user still sees the balance they had.
     */
    const transient =
      doc.error === 'balance-request-failed' ||
      doc.error === 'balance-unavailable' ||
      doc.error === 'account-state-unavailable' ||
      doc.error === 'account-service-unavailable'

    if (doc.primary === null && transient && cached.doc !== null && cached.doc.primary !== null) {
      doc = {
        ...cached.doc,
        now: Date.now(),
        error: doc.error,
        stale: true,
        live: liveForDisplay(),
        spend: spendSummary(),
      }
    }

    if (doc.error === null) {
      cached = { at: Date.now(), doc }
    }
    stateServed += 1
    lastStateAt = Date.now()
    return jsonResponse({ ...doc, cached: false })
  }

  /**
   * Node `req`/`res` adapter, used when the installed DSH only accepts the older
   * `{ handler }` route form (the `{ resource }` form is newer). Same logic, same
   * responses — only the transport shape differs.
   */
  async function nodeHandler(req, res) {
    let request
    try {
      const origin = `http://${req.headers.host ?? '127.0.0.1'}`
      const headers = new Headers()
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') headers.set(key, value)
        else if (Array.isArray(value)) headers.set(key, value.join(', '))
      }
      request = new Request(new URL(req.url ?? '/', origin), { method: req.method ?? 'GET', headers })
    } catch {
      res.statusCode = 400
      res.end('bad-request')
      return
    }

    let response
    try {
      response = await handle(request, undefined)
    } catch {
      res.statusCode = 500
      res.end('handler-failed')
      return
    }

    const body = Buffer.from(await response.arrayBuffer())
    for (const [key, value] of response.headers) res.setHeader(key, value)
    res.statusCode = response.status
    res.end(body)
  }

  /**
   * Register one route, preferring the `resource` form and falling back to the
   * Node `handler` form on an engine that predates it.
   */
  function registerRoute(path) {
    try {
      return webServer.register({ kind: 'exact', path, resource: handle })
    } catch {
      return webServer.register({ kind: 'exact', path, handler: nodeHandler })
    }
  }

  /*
   * Every route is registered as EXACT.
   *
   * A single prefix route at `/api/rice-bowl` is ambiguous: the shared `/api`
   * bridge is itself a prefix, and DSH 0.2.1 does not resolve that collision the
   * way 0.2.2 does, so the bridge swallowed every request and answered 401.
   * Exact routes are the highest-priority match in every version, so no ordering
   * or longest-prefix rule can shadow them.
   */
  const EXACT_ROUTES = [
    `${ROUTE_PATH}/state`,
    `${ROUTE_PATH}/pulse`,
    `${ROUTE_PATH}/ping`,
    `${ROUTE_PATH}/diag`,
    `${ROUTE_PATH}/asset/error`,
    ...CACHED_ASSET_KEYS.map((key) => `${ASSET_PREFIX}${key}.webp`),
  ]

  ctx.effect(() => {
    const disposers = EXACT_ROUTES.map((path) => registerRoute(path))
    return () => {
      for (const dispose of disposers) dispose()
    }
  })

  /*
   * Hand each authenticated page render a fresh token. The injection is stored as
   * a page global; the Client half reads it once and sends it back on every call.
   */
  ctx.effect(() =>
    ctx.on('webserver/index-inject', (table, peer) => {
      if (peer?.principal?.kind !== 'owner') return
      table.push({ kind: 'global', name: '__RICE_BOWL_TOKEN__', value: issueToken() })
    }),
  )

  ctx.effect(() => {
    let alive = true
    void loadLedger().then((loaded) => {
      if (alive) ledger = loaded
    })

    const off = ctx.on('session/event', (session, event) => {
      if (ledger === null) return
      if (event?.type !== 'assistant/message') return
      const usage = event.data?.usage
      if (usage === undefined || usage === null) return
      const model = event.data?.message?.source?.model
      record(usage, model, Number(event.time) || Date.now())
    })

    return () => {
      alive = false
      off?.()
      if (saveTimer !== null) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      void flushLedger()
    }
  })
}
