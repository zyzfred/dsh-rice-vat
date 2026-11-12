#!/usr/bin/env node
/**
 * Local iteration check for dsh-rice-vat.
 *
 * The plugin has two halves with different reload rules, so a change is only
 * "done" once the running Host is proven to serve the new code (`index.js`) and
 * the panel is proven to talk to it. This script is the cheap, headless half of
 * that proof: it reads the plugin's own diagnostics route, probes every artwork
 * asset the panel can ask for, and — when a page token is supplied — exercises
 * the two authenticated endpoints the panel actually polls.
 *
 * Usage:
 *   node scripts/dev-check.mjs                          # diag + assets
 *   node scripts/dev-check.mjs --token <page token>     # also /pulse and /state
 *   node scripts/dev-check.mjs --watch                  # poll, report reloads
 *   node scripts/dev-check.mjs --json                   # machine-readable
 *
 * The token is the value of `window.__RICE_BOWL_TOKEN__` in the page (DevTools
 * console). It is minted per rendered page and stored hashed on the Host, so it
 * cannot be recovered from disk; it is only needed for balance data.
 *
 * Environment: DSH_WEB_URL (default http://127.0.0.1:64152), RICE_BOWL_TOKEN.
 */

const ART_KEYS = [
  'vat-overflow',
  'vat-full',
  'vat-low',
  'vat-empty',
  'vat-rice-mask',
  'vat-rice-overlay',
  'girl-idle',
  'girl-eat',
  'girl-eat-still',
  'girl-low',
  'girl-sleep',
]

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = args[index + 1]
  return value === undefined || value.startsWith('--') ? true : value
}

const base = String(flag('url', process.env.DSH_WEB_URL ?? 'http://127.0.0.1:64152')).replace(/\/+$/, '')
const token = String(flag('token', process.env.RICE_BOWL_TOKEN ?? '')) || ''
const asJson = args.includes('--json')
const watchArg = flag('watch', false)
const watch = watchArg !== false
const watchSeconds = typeof watchArg === 'string' ? Number(watchArg) : 2
const intervalMs = (Number.isFinite(watchSeconds) && watchSeconds > 0 ? watchSeconds : 2) * 1000
const route = `${base}/api/rice-bowl`

const authHeaders = token === '' ? {} : { 'x-rice-bowl-token': token }

async function getJson(path) {
  const response = await fetch(`${route}${path}`, { headers: authHeaders, cache: 'no-store' })
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = { ok: false, error: `unparsable response (${response.status}): ${text.slice(0, 80)}` }
  }
  return { status: response.status, body }
}

async function probeAsset(key) {
  const response = await fetch(`${route}/asset/${key}`, { cache: 'no-store' })
  const bytes = new Uint8Array(await response.arrayBuffer()).byteLength
  return {
    key,
    status: response.status,
    type: response.headers.get('content-type') ?? '',
    bytes,
  }
}

function secondsSince(at) {
  if (!at) return null
  return Math.max(0, Math.round((Date.now() - at) / 1000))
}

async function check() {
  const diag = await getJson('/diag')
  const assets = await Promise.all(ART_KEYS.map(probeAsset))
  const pulse = token === '' ? null : await getJson('/pulse')
  const state = token === '' ? null : await getJson('/state')

  const problems = []
  if (diag.status !== 200 || diag.body.ok !== true) problems.push(`diag ${diag.status} ${diag.body.error ?? ''}`.trim())
  for (const asset of assets) {
    if (asset.status !== 200) problems.push(`asset ${asset.key} → ${asset.status}`)
    else if (!/^image\//.test(asset.type)) problems.push(`asset ${asset.key} → ${asset.type || 'no content-type'}`)
  }
  if (pulse !== null && (pulse.status !== 200 || pulse.body.ok !== true)) problems.push(`pulse ${pulse.status} ${pulse.body.error ?? ''}`.trim())
  if (state !== null && (state.status !== 200 || state.body.ok !== true)) problems.push(`state ${state.status} ${state.body.error ?? ''}`.trim())
  if (token !== '' && state !== null && state.body.ok === true && state.body.signedIn === false) problems.push('state reports signedIn=false')
  const usage = diag.body.usage ?? {}
  if (usage.lastError && usage.hasTotal !== true) problems.push(`account usage: ${usage.lastError}`)
  if (diag.body.commands && diag.body.commands.registered !== true) problems.push('/rice-vat command not registered')
  if (token !== '' && state !== null && state.body.ok === true && state.body.signedIn === true) {
    const source = state.body.spend?.source
    if (source !== 'platform') problems.push(`account usage source is ${source ?? 'missing'}`)
  }

  return { diag: diag.body, assets, pulse: pulse?.body ?? null, state: state?.body ?? null, problems }
}

function summarize(result) {
  const { diag, assets, pulse, state, problems } = result
  const lines = []
  lines.push(`route    ${route}`)
  lines.push(
    `diag     ok=${diag.ok} renders=${diag.renders} stateServed=${diag.stateServed} stateDenied=${diag.stateDenied} pulseServed=${diag.pulseServed} mintedTokens=${diag.mintedTokens}`,
  )
  const account = diag.account ?? {}
  lines.push(
    `account  signedIn=${account.signedIn} lastOk=${secondsSince(account.lastOkAt)}s ago lastError=${account.lastError ?? 'none'}`,
  )
  const usage = diag.usage ?? {}
  lines.push(
    `usage    source=${usage.source ?? '—'} today=${usage.hasToday === true} total=${usage.hasTotal === true} avg=${usage.hasAverage === true} daily=${usage.dailyCount ?? 0} stale=${usage.stale === true} lastError=${usage.lastError ?? 'none'}`,
  )
  const commands = diag.commands ?? {}
  lines.push(`command  /rice-vat registered=${commands.registered === true}`)
  if (diag.ui) lines.push(`ui       visible=${diag.ui.visible === true}`)
  const missing = assets.filter((asset) => asset.status !== 200)
  lines.push(`assets   ${assets.length - missing.length}/${assets.length} ok${missing.length ? ` — missing: ${missing.map((a) => a.key).join(', ')}` : ''}`)
  const errors = diag.assetErrors ?? {}
  const errorKeys = Object.keys(errors)
  if (errorKeys.length > 0) lines.push(`assetErr ${errorKeys.map((key) => `${key}×${errors[key]}`).join(' ')}`)
  if (diag.preview) lines.push(`preview  ${diag.preview}`)
  if (state !== null && state.ok === true) {
    const live = state.live ?? {}
    const spend = state.spend ?? {}
    lines.push(
      `state    v${state.version} signedIn=${state.signedIn} balance=${live.balance ?? '?'} ${live.currency ?? ''} tier=${live.tier ?? '?'} cached=${state.cached === true}`,
    )
    lines.push(
      `spend    source=${spend.source ?? '?'} today=${spend.today ?? '?'} ${spend.currency ?? ''} total=${spend.total ?? '?'} avg/day=${spend.averageDaily ?? '?'} period=${spend.period ?? '?'}`,
    )
    if (spend.updatedAt) lines.push(`usageAt  ${secondsSince(spend.updatedAt)}s ago`)
    if (spend.installedAt) lines.push(`ledger   local estimate: today=${spend.localToday ?? '?'} total=${spend.localTotal ?? '?'} installed ${secondsSince(spend.installedAt)}s ago`)
  } else if (state !== null) {
    lines.push(`state    refused (${state.error ?? 'unknown'}) — token rejected or expired`)
  }
  if (pulse !== null && pulse.ok === true) lines.push(`pulse    signedIn=${pulse.signedIn} art=${JSON.stringify(pulse.art)}`)
  if (token === '') lines.push('note     no token: /pulse and /state were not checked (pass --token <window.__RICE_BOWL_TOKEN__>)')
  lines.push(problems.length === 0 ? 'result   OK' : `result   FAIL — ${problems.join('; ')}`)
  return lines.join('\n')
}

const first = await check()
if (asJson) console.log(JSON.stringify(first, null, 2))
else console.log(summarize(first))

if (first.problems.length > 0) process.exitCode = 1

if (watch) {
  let previous = first.diag
  const tick = async () => {
    try {
      const next = await check()
      const reloaded =
        Number(next.diag.pulseServed ?? 0) < Number(previous.pulseServed ?? 0) ||
        Number(next.diag.stateServed ?? 0) < Number(previous.stateServed ?? 0) ||
        Number(next.diag.mintedTokens ?? 0) < Number(previous.mintedTokens ?? 0)
      const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false })
      const account = next.diag.account ?? {}
      const usage = next.diag.usage ?? {}
      console.log(
        `[${stamp}] ${reloaded ? '↻ reloaded  ' : '  polling   '}renders=${next.diag.renders} stateServed=${next.diag.stateServed} denied=${next.diag.stateDenied} lastOk=${secondsSince(account.lastOkAt)}s usage=${usage.source ?? '—'}/${usage.hasTotal === true ? 'total' : 'no-total'} cmd=${next.diag.commands?.registered === true} ${next.problems.length ? 'FAIL' : 'ok'}`,
      )
      previous = next.diag
    } catch (error) {
      console.log(`[watch] ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  setInterval(tick, intervalMs)
  console.log(`watching every ${intervalMs / 1000}s — Ctrl+C to stop`)
}
