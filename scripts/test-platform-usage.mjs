import assert from 'node:assert/strict'
import test from 'node:test'

import {
  averageDailyCost,
  estimateDays,
  parseByKeyCost,
  parseMonthlyCost,
  parseSummary,
  readAccountUsage,
} from '../platform-usage.js'

const TZ = 8 * 3600
const NOW = Date.parse('2026-11-12T12:00:00Z') // 20:00 in +08:00

function unixForLocalDay(day) {
  return Math.floor(Date.parse(`${day}T00:00:00+08:00`) / 1000)
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function summaryBody(total = '12.5') {
  return {
    code: 0,
    data: {
      biz_code: 0,
      biz_data: {
        normal_wallets: [{ currency: 'CNY', balance: '99.11' }],
        bonus_wallets: [{ currency: 'CNY', balance: '4.28' }],
        total_costs: [{ currency: 'CNY', amount: total }],
      },
    },
  }
}

function byKeyBody(rows = [
  { day: '2026-11-10', cost: '2' },
  { day: '2026-11-11', cost: '4' },
  { day: '2026-11-12', cost: '2' },
]) {
  return {
    code: 0,
    data: {
      biz_code: 0,
      biz_data: {
        data: {
          0: {
            currency: 'CNY',
            series: [
              {
                api_key: { name: 'test' },
                model: 'deepseek-flash',
                buckets: rows.map((row) => ({
                  time: unixForLocalDay(row.day),
                  cost: row.cost,
                })),
              },
            ],
          },
        },
      },
    },
  }
}

function monthlyBody() {
  return {
    code: 0,
    data: {
      biz_code: 0,
      biz_data: [
        {
          currency: 'CNY',
          total: [],
          days: [
            {
              date: '2026-11-11',
              data: [
                {
                  model: 'deepseek-flash',
                  usage: [
                    { type: 'PROMPT_TOKEN', amount: '99' },
                    { type: 'PROMPT_CACHE_HIT_TOKEN', amount: '1.5' },
                    { type: 'RESPONSE_TOKEN', amount: '2.5' },
                    { type: 'REQUEST', amount: '3' },
                  ],
                },
              ],
            },
            {
              date: '2026-11-12',
              data: [
                {
                  model: 'deepseek-flash',
                  usage: [
                    { type: 'PROMPT_CACHE_MISS_TOKEN', amount: '0.75' },
                    { type: 'REQUEST', amount: '1' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  }
}

test('parseSummary keeps every total_costs row', () => {
  const rows = parseSummary(summaryBody('12.5'))
  assert.deepEqual(rows, [{ currency: 'CNY', amount: 12.5 }])
})

test('parseByKeyCost accepts object-keyed data and scalar buckets', () => {
  const parsed = parseByKeyCost(byKeyBody(), { preferredCurrency: 'CNY', timezoneOffsetSeconds: TZ })
  assert.equal(parsed.currency, 'CNY')
  assert.equal(parsed.daily.get('2026-11-10'), 2)
  assert.equal(parsed.daily.get('2026-11-11'), 4)
  assert.equal(parsed.daily.get('2026-11-12'), 2)
})

test('parseByKeyCost merges series and accepts { value } costs', () => {
  const body = {
    code: 0,
    data: {
      biz_code: 0,
      biz_data: {
        data: {
          a: {
            currency: 'CNY',
            series: [
              { buckets: [{ time: unixForLocalDay('2026-11-12'), cost: { value: '1.25' } }] },
              { buckets: [{ time: unixForLocalDay('2026-11-12'), cost: '0.75' }] },
            ],
          },
        },
      },
    },
  }
  const parsed = parseByKeyCost(body, { timezoneOffsetSeconds: TZ })
  assert.equal(parsed.daily.get('2026-11-12'), 2)
})

test('parseMonthlyCost sums non-REQUEST rows', () => {
  const parsed = parseMonthlyCost(monthlyBody(), { timezoneOffsetSeconds: TZ })
  assert.equal(parsed.currency, 'CNY')
  assert.equal(parsed.daily.get('2026-11-11'), 4)
  assert.equal(parsed.daily.get('2026-11-12'), 0.75)
})

test('averageDailyCost uses the observed window and excludes today', () => {
  const daily = new Map([
    ['2026-11-10', 2],
    ['2026-11-11', 4],
    ['2026-11-12', 99],
  ])
  assert.equal(averageDailyCost(daily, { now: NOW, timezoneOffsetSeconds: TZ }), 3)
})

test('averageDailyCost counts zero-spend days inside the observed window', () => {
  const daily = new Map([
    ['2026-11-05', 7],
    ['2026-11-06', 0],
    ['2026-11-07', 0],
    ['2026-11-08', 0],
    ['2026-11-09', 0],
    ['2026-11-10', 0],
    ['2026-11-11', 0],
    ['2026-11-12', 99],
  ])
  assert.equal(averageDailyCost(daily, { now: NOW, timezoneOffsetSeconds: TZ }), 1)
})

test('averageDailyCost returns null when there is no full-day spend', () => {
  assert.equal(averageDailyCost(new Map([['2026-11-12', 2]]), { now: NOW, timezoneOffsetSeconds: TZ }), null)
  assert.equal(averageDailyCost(new Map(), { now: NOW, timezoneOffsetSeconds: TZ }), null)
})

test('estimateDays floors runway and rejects missing data', () => {
  assert.equal(estimateDays(10, 3), 3)
  assert.equal(estimateDays(2, 3), 0)
  assert.equal(estimateDays(0, 3), null)
  assert.equal(estimateDays(10, 0), null)
})

function platformAccount(origin, token = 'secret-token') {
  return {
    getPlatformSession: async () => ({
      origin,
      token,
      userId: null,
      requestHeaders: { cookie: 'deployment=1' },
    }),
  }
}

function routeFetch(routes) {
  const calls = []
  const impl = async (url) => {
    const path = new URL(url).pathname
    calls.push(path)
    const handler = routes[path]
    if (!handler) return json({ code: 404, data: null }, 404)
    return handler(url)
  }
  impl.calls = calls
  return impl
}

test('readAccountUsage combines total_costs, today, and a 7-day average', async () => {
  const origin = 'https://platform.one.test'
  const fetchImpl = routeFetch({
    '/api/v0/users/get_user_summary': async () => json(summaryBody('12.5')),
    '/api/v0/usage/by_api_key/cost': async () => json(byKeyBody()),
  })
  const result = await readAccountUsage({
    account: platformAccount(origin),
    preferredCurrency: 'CNY',
    now: NOW,
    timezoneOffsetSeconds: TZ,
    version: '1.1.0',
    fetchImpl,
  })
  assert.equal(result.ok, true)
  assert.equal(result.currency, 'CNY')
  assert.equal(result.total, 12.5)
  assert.equal(result.today, 2)
  assert.equal(result.averageDaily, 3)
  assert.equal(result.daysLeft, null) // balance was not supplied
  assert.equal(result.source, 'platform')
  assert.equal(result.partial, false)
  assert.ok(fetchImpl.calls.every((path) => path.startsWith('/api/v0/')))
  assert.equal(JSON.stringify(result).includes('secret-token'), false)
})

test('readAccountUsage falls back to monthly cost when by-key fails', async () => {
  const origin = 'https://platform.two.test'
  const fetchImpl = routeFetch({
    '/api/v0/users/get_user_summary': async () => json(summaryBody('12.5')),
    '/api/v0/usage/by_api_key/cost': async () => json({ code: 500 }, 500),
    '/api/v0/usage/cost': async () => json(monthlyBody()),
  })
  const result = await readAccountUsage({
    account: platformAccount(origin),
    preferredCurrency: 'CNY',
    now: NOW,
    timezoneOffsetSeconds: TZ,
    version: '1.1.0',
    fetchImpl,
  })
  assert.equal(result.ok, true)
  assert.equal(result.total, 12.5)
  assert.equal(result.today, 0.75)
  assert.equal(result.averageDaily, 4)
  assert.equal(result.errors.includes('platform/http-500'), true)
})

test('readAccountUsage still returns total when usage is unavailable', async () => {
  const origin = 'https://platform.three.test'
  const fetchImpl = routeFetch({
    '/api/v0/users/get_user_summary': async () => json(summaryBody('12.5')),
    '/api/v0/usage/by_api_key/cost': async () => json({ code: 500 }, 500),
    '/api/v0/usage/cost': async () => json({ code: 500 }, 500),
  })
  const result = await readAccountUsage({
    account: platformAccount(origin),
    now: NOW,
    timezoneOffsetSeconds: TZ,
    fetchImpl,
  })
  assert.equal(result.ok, true)
  assert.equal(result.partial, true)
  assert.equal(result.total, 12.5)
  assert.equal(result.today, null)
  assert.equal(result.averageDaily, null)
})

test('readAccountUsage falls back to Bearer when the grant header is rejected', async () => {
  const origin = 'https://platform.four.test'
  let summaryCalls = 0
  const fetchImpl = routeFetch({
    '/api/v0/users/get_user_summary': async (url) => {
      summaryCalls += 1
      // First request uses x-dsh-auth-token; respond with a Platform auth code.
      return summaryCalls === 1 ? json({ code: 40003, data: null }) : json(summaryBody('12.5'))
    },
    '/api/v0/usage/by_api_key/cost': async () => json(byKeyBody()),
  })
  const result = await readAccountUsage({
    account: platformAccount(origin),
    now: NOW,
    timezoneOffsetSeconds: TZ,
    fetchImpl,
  })
  assert.equal(result.ok, true)
  assert.equal(result.total, 12.5)
  assert.equal(summaryCalls, 2)
})

test('readAccountUsage reports signed-out and missing-session states without requests', async () => {
  const noSession = await readAccountUsage({
    account: { getPlatformSession: async () => null },
    now: NOW,
    fetchImpl: async () => json({}),
  })
  assert.equal(noSession.ok, false)
  assert.equal(noSession.reason, 'platform/signed-out')

  const noMethod = await readAccountUsage({ account: {}, now: NOW, fetchImpl: async () => json({}) })
  assert.equal(noMethod.reason, 'platform/session-unavailable')
})

test('readAccountUsage rejects non-loopback http origins', async () => {
  const result = await readAccountUsage({
    account: platformAccount('http://example.com'),
    now: NOW,
    fetchImpl: async () => json({}),
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'platform/origin-rejected')
})
