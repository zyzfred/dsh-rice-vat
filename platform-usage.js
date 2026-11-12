/**
 * Account-wide DeepSeek Platform usage.
 *
 * The DSH account service exposes the stored grant to Host code through
 * `getPlatformSession()`. That grant can read two Platform dashboard endpoints:
 *
 *   GET /api/v0/users/get_user_summary          -> normal/bonus wallets + total_costs
 *   GET /api/v0/usage/by_api_key/cost?start=…   -> daily cost buckets across every API key
 *   GET /api/v0/usage/cost?month=…&year=…       -> monthly fallback with daily cost rows
 *
 * These are dashboard endpoints, not public API endpoints; they can change. This
 * module treats them as best-effort: summary and usage are independent, and a
 * failure in one still returns the other. It never logs or returns the grant.
 *
 * The host uses this only to answer two questions:
 *   - How much has this *account* spent in total? (`total_costs`)
 *   - How much did this *account* spend today, and what is its recent daily pace?
 *
 * Everything is in the account's own currency. No currency conversion is done.
 */

const SUMMARY_PATH = '/api/v0/users/get_user_summary'
const BY_KEY_COST_PATH = '/api/v0/usage/by_api_key/cost'
const MONTHLY_COST_PATH = '/api/v0/usage/cost'
const DEFAULT_TIMEOUT_MS = 15_000
const DAY_SECONDS = 86_400
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])
/** Cost rows the monthly fallback may sum; PROMPT_TOKEN is an aggregate and would double-count. */
const COST_TYPES = new Set(['PROMPT_CACHE_HIT_TOKEN', 'PROMPT_CACHE_MISS_TOKEN', 'RESPONSE_TOKEN'])

/** Platform grant header. The account service uses this rather than Bearer. */
const GRANT_HEADER = 'x-dsh-auth-token'

/**
 * Auth strategy for the private dashboard endpoints.
 *
 * `x-dsh-auth-token` is the grant DSH already holds and is what Platform's own
 * dashboard calls use. Some deployments only accept a Bearer token for the
 * usage endpoints; we try the working mode first and remember it per origin.
 * Both modes are attempted at most once per request.
 */
const authModeByOrigin = new Map()

function rememberAuth(origin, mode) {
  if (mode === 'grant' || mode === 'bearer') authModeByOrigin.set(origin, mode)
}

function authModes(origin) {
  const remembered = authModeByOrigin.get(origin)
  return remembered === 'bearer' ? ['bearer', 'grant'] : ['grant', 'bearer']
}

/** True when a JSON envelope says the grant is rejected. */
function isAuthCode(code) {
  return code === 40002 || code === 40003
}

function round(value, digits = 6) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

/** Platform wallet/cost amounts are decimal strings; keep only finite numbers. */
function parseAmount(value) {
  if (value !== null && typeof value === 'object' && 'value' in value) return parseAmount(value.value)
  return toNumber(value)
}

function parseCurrency(value, fallback = 'CNY') {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : fallback
}

function localDateKey(unixSeconds, timezoneOffsetSeconds) {
  const shifted = (Number(unixSeconds) + Number(timezoneOffsetSeconds)) * 1000
  const date = new Date(shifted)
  if (!Number.isFinite(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}

function dateKeyAt(now, timezoneOffsetSeconds) {
  const shifted = new Date(Number(now) + Number(timezoneOffsetSeconds) * 1000)
  return Number.isFinite(shifted.getTime()) ? shifted.toISOString().slice(0, 10) : null
}

function startOfLocalDayUnix(now, timezoneOffsetSeconds) {
  const shifted = new Date(Number(now) + Number(timezoneOffsetSeconds) * 1000)
  shifted.setUTCHours(0, 0, 0, 0)
  return Math.floor(shifted.getTime() / 1000) - Number(timezoneOffsetSeconds)
}

/** Day keys for `count` full days ending yesterday, newest first. */
function fullDayKeys(now, timezoneOffsetSeconds, count) {
  const keys = []
  for (let index = 1; index <= count; index += 1) {
    const key = dateKeyAt(Number(now) - index * DAY_SECONDS * 1000, timezoneOffsetSeconds)
    if (key !== null) keys.push(key)
  }
  return keys
}

function daysBetween(a, b) {
  const start = Date.parse(`${a}T00:00:00Z`)
  const end = Date.parse(`${b}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0
  return Math.round((end - start) / DAY_SECONDS / 1000)
}

/**
 * Choose the account currency.
 *
 * Prefer the caller's primary wallet currency; otherwise use the first block
 * that actually has a cost or a wallet. A CNY/USD mismatch must not mix rows.
 */
function pickCurrency(preferred, candidates) {
  if (preferred) {
    const match = candidates.find((item) => item.currency === preferred)
    if (match) return preferred
  }
  return candidates.find((item) => typeof item.currency === 'string')?.currency ?? preferred ?? 'CNY'
}

function pickBlock(blocks, preferred) {
  if (!Array.isArray(blocks) || blocks.length === 0) return null
  if (preferred) {
    const match = blocks.find((block) => block?.currency === preferred)
    if (match) return match
  }
  return blocks.find((block) => block?.currency) ?? blocks[0]
}

/* -------------------------------------------------------------------------- */
/* Parsers                                                                    */
/* -------------------------------------------------------------------------- */

/** Parse `get_user_summary` into all `total_costs` rows. */
export function parseSummary(body) {
  const biz = body?.data?.biz_data
  if (!biz || typeof biz !== 'object') throw new Error('summary/no-biz-data')
  const rows = Array.isArray(biz.total_costs) ? biz.total_costs : []
  return rows
    .map((row) => ({
      currency: parseCurrency(row?.currency),
      amount: parseAmount(row?.amount),
    }))
    .filter((row) => row.amount !== null)
}

/**
 * Parse the by-API-key cost endpoint.
 *
 * `biz_data.data` has been observed both as an object keyed by numeric strings
 * and as an array. Each block has a currency and one series per API key/model;
 * each series has daily buckets whose `cost` is either a scalar or `{value}`.
 */
export function parseByKeyCost(body, options = {}) {
  const biz = body?.data?.biz_data
  const raw = biz?.data
  const blocks = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : []
  if (blocks.length === 0) throw new Error('usage/no-blocks')
  const preferred = options.preferredCurrency
  const block = pickBlock(blocks, preferred)
  if (!block) throw new Error('usage/no-block')
  const currency = parseCurrency(block.currency, preferred ?? 'CNY')
  const daily = new Map()
  for (const series of Array.isArray(block.series) ? block.series : []) {
    for (const bucket of Array.isArray(series?.buckets) ? series.buckets : []) {
      const time = toNumber(bucket?.time)
      const cost = parseAmount(bucket?.cost)
      if (time === null || cost === null) continue
      const key = localDateKey(time, options.timezoneOffsetSeconds ?? 0)
      if (key === null) continue
      daily.set(key, (daily.get(key) ?? 0) + cost)
    }
  }
  return { currency, daily }
}

/**
 * Parse the monthly fallback. `biz_data` is an array of currency blocks; each
 * block has daily rows of model usage where each non-REQUEST item is a cost.
 */
export function parseMonthlyCost(body, options = {}) {
  const biz = body?.data?.biz_data
  const blocks = Array.isArray(biz) ? biz : biz && typeof biz === 'object' ? [biz] : []
  if (blocks.length === 0) throw new Error('usage/no-monthly-blocks')
  const block = pickBlock(blocks, options.preferredCurrency)
  if (!block) throw new Error('usage/no-monthly-block')
  const currency = parseCurrency(block.currency, options.preferredCurrency ?? 'CNY')
  const daily = new Map()
  for (const day of Array.isArray(block.days) ? block.days : []) {
    const key = typeof day?.date === 'string' ? day.date : null
    if (key === null) continue
    let sum = 0
    for (const model of Array.isArray(day.data) ? day.data : []) {
      for (const item of Array.isArray(model?.usage) ? model.usage : []) {
        if (!COST_TYPES.has(String(item?.type ?? '').toUpperCase())) continue
        const cost = parseAmount(item?.amount)
        if (cost !== null) sum += cost
      }
    }
    daily.set(key, (daily.get(key) ?? 0) + sum)
  }
  return { currency, daily }
}

/** Sorted `{date, cost}` list for a Map. */
function dailyList(daily) {
  return [...daily.entries()]
    .map(([date, cost]) => ({ date, cost: round(cost) ?? 0 }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** Today's cost from a daily map; absent buckets mean zero. */
function todayCost(daily, now, timezoneOffsetSeconds) {
  const key = dateKeyAt(now, timezoneOffsetSeconds)
  return key === null ? 0 : round(daily.get(key) ?? 0, 6) ?? 0
}

/**
 * Average daily cost over full days (today excluded).
 *
 * Missing days count as zero, but only days after the first observed spend are
 * included so a brand-new account is not diluted by 30 empty days. Returns null
 * when there is no positive full-day spend to average.
 */
export function averageDailyCost(daily, options = {}) {
  const now = Number(options.now ?? Date.now())
  const timezoneOffsetSeconds = Number(options.timezoneOffsetSeconds ?? 0)
  const days = Math.max(1, Math.min(30, Number(options.days ?? 7)))
  const dated = dailyList(daily)
  if (dated.length === 0) return null
  if (!dated.some((row) => row.cost > 0)) return null
  const keys = fullDayKeys(now, timezoneOffsetSeconds, days)
  if (keys.length === 0) return null
  const yesterday = keys[0]
  /* Use the observed window start (which includes zero-spend buckets) rather
     than the first positive day, so a quiet week still lowers the daily pace. */
  const start = dated[0].date
  const coverage = Math.max(0, Math.min(keys.length, daysBetween(start, yesterday) + 1))
  if (coverage === 0) return null
  const considered = keys.slice(0, coverage)
  const sums = new Map(dated.map((row) => [row.date, row.cost]))
  const total = considered.reduce((sum, key) => sum + (sums.get(key) ?? 0), 0)
  if (total <= 0) return null
  return round(total / coverage, 6)
}

/** Whole days of runway; null when there is no usable average. */
export function estimateDays(balance, average) {
  if (typeof balance !== 'number' || !Number.isFinite(balance) || balance <= 0) return null
  if (typeof average !== 'number' || !Number.isFinite(average) || average <= 0) return null
  return Math.floor(balance / average)
}

/* -------------------------------------------------------------------------- */
/* Network                                                                    */
/* -------------------------------------------------------------------------- */

function isAllowedOrigin(origin) {
  try {
    const url = new URL(origin)
    if (url.protocol === 'https:') return true
    return url.protocol === 'http:' && LOOPBACK.has(url.hostname)
  } catch {
    return false
  }
}

function buildHeaders(session, mode, version, timezoneOffsetSeconds) {
  const headers = {
    ...(session.requestHeaders ?? {}),
    accept: 'application/json',
    'x-client-platform': 'web',
    'x-client-version': String(version ?? '0.0.0'),
    'x-client-locale': 'en_US',
    'x-client-timezone-offset': String(timezoneOffsetSeconds),
  }
  // The grant is provider-owned; deployment headers must not override it.
  delete headers[GRANT_HEADER]
  delete headers.authorization
  if (mode === 'bearer') headers.authorization = `Bearer ${session.token}`
  else headers[GRANT_HEADER] = session.token
  return headers
}

async function readJsonResponse(response) {
  const text = await response.text()
  if (text === '') return null
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('platform/invalid-json')
  }
}

function envelopeError(body) {
  if (!body || typeof body !== 'object') return null
  const top = toNumber(body.code)
  if (top !== null && top !== 0) return { code: top, stage: 'top' }
  const biz = toNumber(body.data?.biz_code)
  if (biz !== null && biz !== 0) return { code: biz, stage: 'biz' }
  return null
}

async function requestJson(url, session, options) {
  const modes = authModes(url.origin)
  let lastReason = 'platform/request-failed'
  for (const mode of modes) {
    let response
    try {
      response = await options.fetchImpl(url.href, {
        method: 'GET',
        headers: buildHeaders(session, mode, options.version, options.timezoneOffsetSeconds),
        signal: options.signal,
      })
    } catch (error) {
      lastReason = error?.name === 'AbortError' ? 'platform/timeout' : 'platform/network'
      continue
    }
    if (!response.ok) {
      if ((response.status === 401 || response.status === 403) && mode !== modes.at(-1)) {
        lastReason = `platform/http-${response.status}`
        continue
      }
      return { ok: false, reason: `platform/http-${response.status}` }
    }
    let body
    try {
      body = await readJsonResponse(response)
    } catch {
      return { ok: false, reason: 'platform/invalid-json' }
    }
    const error = envelopeError(body)
    if (error !== null) {
      if (isAuthCode(error.code) && mode !== modes.at(-1)) {
        lastReason = `platform/code-${error.code}`
        continue
      }
      return { ok: false, reason: isAuthCode(error.code) ? 'platform/auth' : `platform/code-${error.code}` }
    }
    rememberAuth(url.origin, mode)
    return { ok: true, body }
  }
  return { ok: false, reason: lastReason }
}

function timeoutSignal(timeoutMs) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs)
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  if (typeof timer.unref === 'function') timer.unref()
  return controller.signal
}

function usageWindow(now, timezoneOffsetSeconds) {
  const end = startOfLocalDayUnix(now, timezoneOffsetSeconds) + DAY_SECONDS
  const start = end - 30 * DAY_SECONDS
  return { start, end, tz: timezoneOffsetSeconds }
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Read account-wide spend from Platform.
 *
 * @param {object} options
 * @param {object} options.account - the `deepseekAccount` service.
 * @param {string} [options.preferredCurrency] - primary wallet currency.
 * @param {number} [options.now] - evaluation time.
 * @param {number} [options.timezoneOffsetSeconds] - local offset east of UTC.
 * @param {string} [options.version] - plugin version for the Platform client header.
 * @param {typeof fetch} [options.fetchImpl] - injectable fetch (tests).
 * @param {number} [options.timeoutMs] - per-request timeout.
 * @returns {Promise<object>} a stable aggregate; never includes the grant.
 */
export async function readAccountUsage(options) {
  const now = Number(options?.now ?? Date.now())
  const timezoneOffsetSeconds = Number(options?.timezoneOffsetSeconds ?? 0)
  const version = String(options?.version ?? '0.0.0')
  const fetchImpl = options?.fetchImpl ?? fetch
  const timeoutMs = Number(options?.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const base = { now, updatedAt: now, timezoneOffsetSeconds }

  let session
  try {
    if (typeof options?.account?.getPlatformSession !== 'function') {
      return { ok: false, reason: 'platform/session-unavailable', ...base }
    }
    session = await options.account.getPlatformSession()
  } catch {
    return { ok: false, reason: 'platform/session-error', ...base }
  }
  if (!session || typeof session.token !== 'string' || session.token === '' || typeof session.origin !== 'string') {
    return { ok: false, reason: 'platform/signed-out', ...base }
  }
  if (!isAllowedOrigin(session.origin)) {
    return { ok: false, reason: 'platform/origin-rejected', ...base }
  }

  const origin = new URL(session.origin).origin
  const signal = timeoutSignal(timeoutMs)
  const requestOptions = { fetchImpl, version, timezoneOffsetSeconds, signal }
  const summaryUrl = new URL(SUMMARY_PATH, origin)

  // Summary and the preferred by-key series are independent; run them together.
  // The monthly fallback is only requested when the preferred series fails.
  const summaryPromise = requestJson(summaryUrl, session, requestOptions)
  const window = usageWindow(now, timezoneOffsetSeconds)
  const byKeyUrl = new URL(BY_KEY_COST_PATH, origin)
  byKeyUrl.searchParams.set('start', String(window.start))
  byKeyUrl.searchParams.set('end', String(window.end))
  byKeyUrl.searchParams.set('tz', String(window.tz))
  const byKeyPromise = requestJson(byKeyUrl, session, requestOptions)

  const [summaryResult, byKeyResult] = await Promise.all([summaryPromise, byKeyPromise])
  const errors = []
  if (!summaryResult.ok) errors.push(summaryResult.reason)
  if (!byKeyResult.ok) errors.push(byKeyResult.reason)

  let summaryRows = []
  if (summaryResult.ok) {
    try {
      summaryRows = parseSummary(summaryResult.body)
    } catch (error) {
      errors.push(error.message)
    }
  }

  const preferred = options?.preferredCurrency ?? summaryRows[0]?.currency
  const month = new Date(now + timezoneOffsetSeconds * 1000)
  let usage = null
  if (byKeyResult.ok) {
    try {
      usage = parseByKeyCost(byKeyResult.body, { preferredCurrency: preferred, timezoneOffsetSeconds })
    } catch (error) {
      errors.push(error.message)
    }
  }
  if (usage === null) {
    const monthlyUrl = new URL(MONTHLY_COST_PATH, origin)
    monthlyUrl.searchParams.set('month', String(month.getUTCMonth() + 1))
    monthlyUrl.searchParams.set('year', String(month.getUTCFullYear()))
    const monthlyResult = await requestJson(monthlyUrl, session, requestOptions)
    if (monthlyResult.ok) {
      try {
        usage = parseMonthlyCost(monthlyResult.body, { preferredCurrency: preferred, timezoneOffsetSeconds })
      } catch (error) {
        errors.push(error.message)
      }
    } else {
      errors.push(monthlyResult.reason)
    }
  }

  const currency = pickCurrency(preferred, [
    ...summaryRows.map((row) => ({ currency: row.currency })),
    ...(usage ? [{ currency: usage.currency }] : []),
  ])
  const totalRow = summaryRows.find((row) => row.currency === currency) ?? null
  const total = totalRow?.amount ?? null
  const daily = usage ? dailyList(usage.daily) : []
  const average = usage ? averageDailyCost(usage.daily, { now, timezoneOffsetSeconds, days: 7 }) : null
  const today = usage ? todayCost(usage.daily, now, timezoneOffsetSeconds) : null
  const ok = total !== null || today !== null

  return {
    ok,
    reason: ok ? null : errors[0] ?? 'platform/unavailable',
    partial: ok && (total === null || today === null),
    currency,
    total,
    today,
    daily,
    averageDaily: average,
    daysLeft: estimateDays(
      typeof options?.balance === 'number' ? options.balance : null,
      average,
    ),
    source: 'platform',
    updatedAt: now,
    errors: [...new Set(errors)],
  }
}
