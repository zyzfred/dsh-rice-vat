import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const home = await mkdtemp(join(tmpdir(), 'rice-vat-state-'))
process.env.DSH_HOME = home

const { apply } = await import('../index.js')

const TZ = -new Date().getTimezoneOffset() * 60
function localDay(offsetDays) {
  const shifted = new Date(Date.now() + TZ * 1000)
  shifted.setUTCDate(shifted.getUTCDate() + offsetDays)
  return shifted.toISOString().slice(0, 10)
}
function unixAtLocalMidnight(day) {
  return Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000) - TZ
}
const today = localDay(0)
const yesterday = localDay(-1)
const twoDaysAgo = localDay(-2)

function json(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

const summary = {
  code: 0,
  data: {
    biz_code: 0,
    biz_data: {
      normal_wallets: [{ currency: 'CNY', balance: '94.83' }],
      bonus_wallets: [{ currency: 'CNY', balance: '4.28' }],
      total_costs: [{ currency: 'CNY', amount: '12.5' }],
    },
  },
}
const byKey = {
  code: 0,
  data: {
    biz_code: 0,
    biz_data: {
      data: {
        0: {
          currency: 'CNY',
          series: [{
            model: 'deepseek-flash',
            buckets: [
              { time: unixAtLocalMidnight(twoDaysAgo), cost: '3' },
              { time: unixAtLocalMidnight(yesterday), cost: '4' },
              { time: unixAtLocalMidnight(today), cost: '2' },
            ],
          }],
        },
      },
    },
  },
}

function fakeContext() {
  const state = { route: null, command: null }
  const disposer = () => () => {}
  const account = {
    getState: async () => ({ status: 'credential-stored', links: { usageUrl: 'https://platform.test/usage', topUpUrl: 'https://platform.test/top_up' } }),
    getBalance: async () => ({
      status: 'ready',
      value: [{ currency: 'CNY', balance: '94.83' }],
      bonusWallets: [{ currency: 'CNY', balance: '4.28' }],
    }),
    getPlatformSession: async () => ({ origin: 'https://platform.unit.test', token: 'unit-token', userId: null, requestHeaders: {} }),
  }
  const ctx = {
    get(name) {
      if (name === 'webServer') {
        return {
          register(route) {
            state.route = route
            return disposer()
          },
        }
      }
      if (name === 'deepseekAccount') return account
      return undefined
    },
    effect(fn) {
      const cleanup = fn()
      return typeof cleanup === 'function' ? cleanup : disposer()
    },
    on() {
      return disposer()
    },
    inject(names, callback) {
      callback({
        effect(fn) {
          const cleanup = fn()
          return typeof cleanup === 'function' ? cleanup : disposer()
        },
        commands: {
          register(definition) {
            state.command = definition
            return disposer()
          },
        },
      })
    },
  }
  return { ctx, state }
}

function fakeRequest(path) {
  return { url: path, method: 'GET', headers: { host: '127.0.0.1:9999' } }
}

function invoke(route, path) {
  return new Promise((resolve, reject) => {
    const res = {
      status: 0,
      headers: null,
      writeHead(status, headers) {
        this.status = status
        this.headers = headers
      },
      end(body) {
        resolve({ status: this.status, headers: this.headers, body: Buffer.isBuffer(body) ? body.toString('utf8') : String(body) })
      },
      on() {},
    }
    route.handler(fakeRequest(path), res).catch(reject)
  })
}

test('/state reads account-wide usage and never exposes the grant', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const path = new URL(String(url)).pathname
    if (path.endsWith('/users/get_user_summary')) return json(summary)
    if (path.endsWith('/usage/by_api_key/cost')) return json(byKey)
    return json({ code: 404 }, 404)
  }
  try {
    const { ctx, state } = fakeContext()
    apply(ctx)
    assert.ok(state.route, 'web route registered')
    const response = await invoke(state.route, '/api/rice-bowl/state')
    assert.equal(response.status, 200)
    const body = JSON.parse(response.body)
    assert.equal(body.ok, true)
    assert.equal(body.signedIn, true)
    assert.equal(body.primary.currency, 'CNY')
    assert.equal(body.spend.source, 'platform')
    assert.equal(body.spend.today, 2)
    assert.equal(body.spend.total, 12.5)
    assert.equal(body.spend.averageDaily, 3.5)
    assert.equal(body.spend.currency, 'CNY')
    assert.ok(body.spend.localToday === null || body.spend.localToday === 0)
    assert.equal(body.ui.visible, true)
    assert.equal(JSON.stringify(body).includes('unit-token'), false)
    assert.ok(state.command, 'command registered during apply')

    const off = await state.command.handler({ rawInput: 'off' })
    assert.equal(off.kind, 'success')
    const hidden = JSON.parse((await invoke(state.route, '/api/rice-bowl/pulse')).body)
    assert.equal(hidden.ok, true)
    assert.equal(hidden.ui.visible, false)
    assert.equal(hidden.spend.source, 'platform')
    assert.equal(hidden.spend.today, 2)

    const on = await state.command.handler({ rawInput: 'on' })
    assert.equal(on.kind, 'success')
    const shown = JSON.parse((await invoke(state.route, '/api/rice-bowl/pulse')).body)
    assert.equal(shown.ui.visible, true)
    assert.equal(shown.spend.total, 12.5)
  } finally {
    globalThis.fetch = originalFetch
    await rm(home, { recursive: true, force: true })
  }
})
