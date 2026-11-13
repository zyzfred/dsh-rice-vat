/**
 * Client half of the rice-vat bundle.
 *
 * The panel is an ambient overlay: a compact rice-grain pill by default, a
 * character card when expanded. Both are draggable and resizable, remember their
 * last layout, and sit above the page. `/rice-vat off` hides the visual from the
 * Host side without touching billing.
 *
 * All visible copy is registered through the Client locale service (zh/en). The
 * account numbers come from the Host; the Client only formats them.
 */

window.__ModuleLoader__.load({
  id: 'dsh-rice-vat',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useMemo, useCallback } = React

    const STATE_URL = '/api/rice-bowl/state'
    const PULSE_URL = '/api/rice-bowl/pulse'
    const ASSET_BASE = '/api/rice-bowl/asset'
    const STATE_MS = 60_000
    const PULSE_MS = 1_500
    const EAT_MS = 4_600
    const BITE_MS = 2_200
    const STORE_KEY = 'rice-vat:ui:v2'
    const LANG_KEY = 'rice-vat:lang:session'
    const MIN_SCALE = 0.75
    const MAX_SCALE = 1.35
    const Z_INDEX = 2147483000
    const NS = 'rice.vat'

    /** Artwork version. Bump whenever assets/ changes; responses are cached for a day. */
    const ASSET_V = 'v4'

    const BOOT_TOKEN =
      typeof window !== 'undefined' && typeof window.__RICE_BOWL_TOKEN__ === 'string'
        ? window.__RICE_BOWL_TOKEN__
        : ''
    const AUTH_HEADERS =
      BOOT_TOKEN === ''
        ? { accept: 'application/json' }
        : { accept: 'application/json', 'x-rice-bowl-token': BOOT_TOKEN }

    function asset(key) {
      return `${ASSET_BASE}/${key}.webp?v=${ASSET_V}`
    }

    /* ------------------------------------------------------------------ */
    /* Dictionaries                                                        */
    /* ------------------------------------------------------------------ */

    const ZH = {
      title: '米缸',
      collapse: '收起',
      expand: '展开米缸',
      drag: '拖动',
      dragHint: '拖动卡片或药丸移动；右下角斜纹调整大小。',
      resize: '调整大小',
      resetLayout: '重置位置和大小',
      accountBalance: '账户余额',
      today: '今日炫米',
      total: '累积炫米',
      daysLeft: '还能吃',
      days: '{n} 天',
      lessThanDay: '<1 天',
      overDays: '999+ 天',
      paid: '本金',
      bonus: '赠金',
      details: '详情',
      hideDetails: '收起',
      ricePrice: '米价',
      priceLabel: '米价',
      peak: '高峰 · 原价',
      offPeak: '谷时 · 半价',
      statusFull: '满满',
      statusOverflow: '溢出来',
      statusLow: '见底',
      statusEmpty: '空缸',
      statusSignedOut: '还没开缸',
      statusError: '盖着布',
      statusLoading: '量米中',
      eating: '吃米中',
      loading: '正在量米…',
      signedOutHint: '登录后显示余额',
      errorHint: '数据没接上 · 重启 DSH 后生效',
      unavailable: '账号数据暂不可用',
      emptyHint: '米缸空了 · 她饿睡着了',
      lowHint: '米缸见底了',
      stale: '数据延迟',
      lastUpdated: '上次 {time}',
      retry: '重试',
      topUp: '去充值',
      usageDetails: '用量明细',
      dataSource: '账号数据 · DeepSeek Platform',
      lifetimeHint: '账号终身累计',
      todayHint: '账号今日消耗',
      daysHint: '按近 7 天日均 {avg} 估算',
      updated: '更新',
      updatedAt: '更新于 {time}',
      peakHours: '工作日 9:00–12:00、14:00–18:00 高峰',
      localEstimate: '本机估算（仅本应用）',
      localNote: '账号总额来自 Platform；本机账本仅驱动动画。',
      version: '版本 {version}',
      gaugeAria: '米位：余额 {balance}，下限 {low}，满缸 {full}',
      summaryAria: '账户余额 {balance}，今日炫米 {today}，累积炫米 {total}，还能吃 {days}',
      pillAria: '展开米缸，余额 {balance}，还能吃 {days}',
      priceAria: '米价：{price}。{hours}',
      detailsTitle: '米缸详情',
      language: '语言',
      languageZh: '中文',
      languageEn: 'English',
      languageHint: '冷启动：DSH 是中文就显示中文，否则显示 English；手动选择只影响米缸，本次会话有效。',
    }

    const EN = {
      title: 'Rice vat',
      collapse: 'Collapse',
      expand: 'Expand rice vat',
      drag: 'Drag',
      dragHint: 'Drag the card or pill to move; use the corner grip to resize.',
      resize: 'Resize',
      resetLayout: 'Reset position and size',
      accountBalance: 'Account balance',
      today: "Today's rice",
      total: 'All-time rice',
      daysLeft: 'Days left',
      days: '{n} days',
      lessThanDay: '<1 day',
      overDays: '999+ days',
      paid: 'Paid',
      bonus: 'Bonus',
      details: 'Details',
      hideDetails: 'Hide',
      ricePrice: 'Rice price',
      priceLabel: '',
      peak: 'Peak · 100%',
      offPeak: 'Off-peak · 50%',
      statusFull: 'Full',
      statusOverflow: 'Overflow',
      statusLow: 'Low',
      statusEmpty: 'Empty',
      statusSignedOut: 'Signed out',
      statusError: 'Covered',
      statusLoading: 'Measuring',
      eating: 'Eating',
      loading: 'Measuring rice…',
      signedOutHint: 'Sign in to see your balance',
      errorHint: 'Not connected · restart DSH',
      unavailable: 'Account data unavailable',
      emptyHint: 'The vat is empty · she fell asleep hungry',
      lowHint: 'The vat is nearly empty',
      stale: 'Data delayed',
      lastUpdated: 'Last {time}',
      retry: 'Retry',
      topUp: 'Top up',
      usageDetails: 'Usage details',
      dataSource: 'Account data · DeepSeek Platform',
      lifetimeHint: 'Lifetime account total',
      todayHint: 'Account spend today',
      daysHint: 'Estimated from the last 7-day average of {avg}',
      updated: 'Updated',
      updatedAt: 'Updated {time}',
      peakHours: 'Weekdays 9:00–12:00 and 14:00–18:00 are peak',
      localEstimate: 'Local estimate (this app only)',
      localNote: 'Account totals come from Platform; the local ledger only drives the animation.',
      version: 'Version {version}',
      gaugeAria: 'Rice level: balance {balance}, low {low}, full {full}',
      summaryAria: 'Account balance {balance}; today {today}; all-time {total}; days left {days}',
      pillAria: 'Expand rice vat; balance {balance}; days left {days}',
      priceAria: 'Rice price: {price}. {hours}',
      detailsTitle: 'Rice vat details',
      language: 'Language',
      languageZh: '中文',
      languageEn: 'English',
      languageHint: 'Cold start: Chinese when DSH is Chinese, English otherwise. A manual choice only affects the vat for this session.',
    }

    function makeFallbackT(dict) {
      return (key, params) => {
        let text = dict[key] ?? key
        if (params && typeof params === 'object') {
          for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value))
        }
        return text
      }
    }

    const ZH_T = makeFallbackT(ZH)
    const EN_T = makeFallbackT(EN)

    /* ------------------------------------------------------------------ */
    /* Formatting and state helpers                                        */
    /* ------------------------------------------------------------------ */

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

    function currencySymbol(currency) {
      if (currency === 'CNY') return '¥'
      if (currency === 'USD') return '$'
      return `${currency} `
    }

    function activeLanguage() {
      if (typeof document !== 'undefined' && document.documentElement?.lang) return document.documentElement.lang
      if (typeof navigator !== 'undefined' && navigator.language) return navigator.language
      return 'en'
    }

    function formatNumber(value, digits = 2) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      try {
        return new Intl.NumberFormat(activeLanguage(), {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        }).format(value)
      } catch {
        return value.toFixed(digits)
      }
    }

    function formatMoney(value, currency, digits = 2) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      return `${currencySymbol(currency)}${formatNumber(value, digits)}`
    }

    function formatSmall(value, currency) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      if (value > 0 && value < 0.001) return `<${currencySymbol(currency)}0.001`
      if (Math.abs(value) < 0.1) return formatMoney(value, currency, 3)
      return formatMoney(value, currency, 2)
    }

    function formatThreshold(value, currency) {
      return formatMoney(value, currency, 0)
    }

    function formatDays(value, t) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      if (value <= 0) return t('days', { n: 0 })
      if (value < 1) return t('lessThanDay')
      if (value > 999) return t('overDays')
      return t('days', { n: Math.floor(value) })
    }

    function formatClock(value, lang = activeLanguage()) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '—'
      try {
        return new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
      } catch {
        const date = new Date(value)
        return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
      }
    }

    function openExternal(url) {
      try {
        const target = new URL(String(url))
        const allowed =
          target.protocol === 'https:' ||
          (target.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname))
        if (!allowed) return
        window.open(target.href, '_blank', 'noopener,noreferrer')
      } catch {
        /* an invalid account link is ignored */
      }
    }

    function readStored() {
      try {
        const parsed = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null')
        return parsed !== null && typeof parsed === 'object' ? parsed : null
      } catch {
        return null
      }
    }

    function readSessionLanguage() {
      try {
        const value = sessionStorage.getItem(LANG_KEY)
        return value === 'zh' || value === 'en' ? value : null
      } catch {
        return null
      }
    }

    function writeSessionLanguage(value) {
      try {
        sessionStorage.setItem(LANG_KEY, value)
      } catch {
        /* a session override is best-effort */
      }
    }

    function writeStored(patch) {
      try {
        const current = readStored() ?? {}
        localStorage.setItem(STORE_KEY, JSON.stringify({ ...current, ...patch }))
      } catch {
        /* layout memory is best-effort */
      }
    }

    function storedPosition(value) {
      if (value === null || typeof value !== 'object') return null
      return Number.isFinite(value.x) && Number.isFinite(value.y) ? { x: value.x, y: value.y } : null
    }

    function useReducedMotion() {
      const [reduced, setReduced] = useState(
        () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
          && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      )
      useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
        const query = window.matchMedia('(prefers-reduced-motion: reduce)')
        const update = () => setReduced(query.matches)
        update()
        query.addEventListener?.('change', update)
        return () => query.removeEventListener?.('change', update)
      }, [])
      return reduced
    }

    /* ------------------------------------------------------------------ */
    /* Data                                                                */
    /* ------------------------------------------------------------------ */

    let lastEatAt = 0

    function useQuota() {
      const [doc, setDoc] = useState(null)
      const [spend, setSpend] = useState(null)
      const [live, setLive] = useState(null)
      const [visible, setVisible] = useState(true)
      const [failed, setFailed] = useState(false)
      const [lastOkAt, setLastOkAt] = useState(0)
      const [eating, setEating] = useState(false)
      const [bite, setBite] = useState(null)
      const [tick, setTick] = useState(() => Date.now())
      const retryRef = useRef(null)
      const eatTimer = useRef(null)
      const biteTimer = useRef(null)

      const applySpend = useCallback((next) => {
        if (!next || typeof next !== 'object') return
        setSpend(next)
        const marker = next.recentAt
        if (typeof marker === 'number' && marker > lastEatAt) {
          lastEatAt = marker
          setEating(true)
          const cost = typeof next.recentCny === 'number' ? next.recentCny : 0
          if (cost > 0) {
            setBite({ cny: cost, at: Date.now() })
            if (biteTimer.current !== null) clearTimeout(biteTimer.current)
            biteTimer.current = setTimeout(() => setBite(null), BITE_MS)
          }
          if (eatTimer.current !== null) clearTimeout(eatTimer.current)
          eatTimer.current = setTimeout(() => setEating(false), EAT_MS)
        }
      }, [])

      useEffect(() => {
        let alive = true
        let retry = null
        let backoff = 3_000

        async function loadState() {
          try {
            const response = await fetch(STATE_URL, { headers: AUTH_HEADERS, cache: 'no-store' })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const body = await response.json()
            if (!alive) return
            setDoc(body)
            setLive(body.live ?? null)
            applySpend(body.spend)
            setVisible(body.ui?.visible !== false)
            setFailed(false)
            setLastOkAt(Date.now())
            backoff = 3_000
            if (retry !== null) {
              clearTimeout(retry)
              retry = null
            }
          } catch {
            if (!alive) return
            setFailed(true)
            if (retry !== null) clearTimeout(retry)
            retry = setTimeout(loadState, backoff)
            backoff = Math.min(backoff * 2, 30_000)
          }
        }

        retryRef.current = () => {
          if (retry !== null) {
            clearTimeout(retry)
            retry = null
          }
          void loadState()
        }
        void loadState()
        const timer = setInterval(loadState, STATE_MS)
        return () => {
          alive = false
          clearInterval(timer)
          if (retry !== null) clearTimeout(retry)
        }
      }, [applySpend])

      useEffect(() => {
        let alive = true

        async function pulse() {
          try {
            const response = await fetch(PULSE_URL, { headers: AUTH_HEADERS, cache: 'no-store' })
            if (!response.ok) return
            const body = await response.json()
            if (!alive) return
            setSpend((current) => body.spend ?? current)
            if (body.spend !== undefined) applySpend(body.spend)
            setLive(body.live ?? null)
            setVisible(body.ui?.visible !== false)
            setLastOkAt(Date.now())
          } catch {
            /* a missed pulse is not worth surfacing; the stale clock handles it */
          }
        }

        void pulse()
        const timer = setInterval(pulse, PULSE_MS)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [applySpend])

      useEffect(() => {
        const timer = setInterval(() => setTick(Date.now()), 5_000)
        return () => clearInterval(timer)
      }, [])

      useEffect(
        () => () => {
          if (eatTimer.current !== null) clearTimeout(eatTimer.current)
          if (biteTimer.current !== null) clearTimeout(biteTimer.current)
        },
        [],
      )

      return {
        doc,
        spend,
        live,
        visible,
        failed,
        lastOkAt,
        eating,
        bite,
        tick,
        retry: () => retryRef.current?.(),
      }
    }

    /* ------------------------------------------------------------------ */
    /* Artwork                                                             */
    /* ------------------------------------------------------------------ */

    const TIERS = ['low', 'overflow', 'full']

    /**
     * One stable vat composition. The empty body is always underneath; the tier
     * layers crossfade over it, and the continuous rice surface is a separate
     * masked layer. This removes the hard DOM swap at ¥6 and ¥100.
     */
    function Vat({ tier, fill, continuous, available }) {
      const [failed, setFailed] = useState(0)
      const broken = failed >= 2
      const bust = failed === 1 ? '&r=1' : ''
      const fail = () => setFailed((current) => current + 1)
      if (!available || broken) return h(VatFallback, { tier })

      const riceFill = clamp(Number.isFinite(fill) ? fill : 0, 0.05, 1)
      const shift = Math.round((1 - riceFill) * 1905) / 100
      const showRice = continuous === true && tier === 'full'

      return h(
        'div',
        { className: 'rb-vat' },
        h('img', {
          className: 'rb-vat__base',
          src: asset('vat-empty') + bust,
          alt: '',
          draggable: false,
          onError: fail,
        }),
        h(
          'div',
          { className: `rb-vat__rice-clip${showRice ? ' is-on' : ''}`, 'aria-hidden': true },
          h('img', {
            className: 'rb-vat__rice',
            src: asset('vat-rice-overlay') + bust,
            alt: '',
            draggable: false,
            onError: fail,
            style: { transform: `translateY(${shift}%)` },
          }),
        ),
        ...TIERS.map((name) =>
          h('img', {
            key: name,
            className: `rb-vat__layer rb-vat__layer--${name}${tier === name && !showRice ? ' is-on' : ''}`,
            src: asset(`vat-${name}`) + bust,
            alt: '',
            draggable: false,
            onError: fail,
          }),
        ),
      )
    }

    /** Hand-authored SVG mascot, used only when the sprite for this state is missing. */
    function WhaleGirlFallback({ mood }) {
      const empty = mood === 'empty'
      return h(
        'svg',
        { viewBox: '0 0 96 108', width: '100%', height: '100%', 'aria-hidden': true },
        h('ellipse', { cx: 48, cy: 44, rx: 21, ry: 20, fill: '#ffe6d8' }),
        h('path', {
          d: 'M20 44 q0 -30 28 -30 q28 0 28 30 q0 24 -5 34 q-23 8 -46 0 q-5 -10 -5 -34 z',
          fill: '#1b4ba8',
        }),
        h('ellipse', { cx: 38, cy: 46, rx: 4.6, ry: 5.2, fill: '#12204a' }),
        h('ellipse', { cx: 58, cy: 46, rx: 4.6, ry: 5.2, fill: '#12204a' }),
        h('circle', { cx: 36.6, cy: 44, r: 1.7, fill: '#fff' }),
        h('circle', { cx: 56.6, cy: 44, r: 1.7, fill: '#fff' }),
        h('path', {
          d: 'M30 74 q18 -8 36 0 q6 13 2 26 q-20 6 -40 0 q-4 -13 2 -26 z',
          fill: '#2b62cf',
        }),
        empty ? h('text', { x: 78, y: 32, fontSize: 12, fill: '#7fb6e8', fontWeight: 700 }, 'z') : null,
      )
    }

    const GIRL_STILL = { 'girl-eat': 'girl-eat-still' }

    /**
     * Pose with a retry chain and a soft fade on every change:
     *   0 animated → 1 cache-busted → 2 still frame → 3 SVG fallback.
     */
    function Girl({ mood, eating, available, reduced }) {
      const name = eating ? 'girl-eat' : mood === 'empty' ? 'girl-sleep' : mood === 'low' ? 'girl-low' : 'girl-idle'
      const still = GIRL_STILL[name]
      const [step, setStep] = useState(0)

      useEffect(() => {
        setStep(0)
      }, [name])

      if (available !== true || step >= 3) return h(WhaleGirlFallback, { mood: mood === 'empty' ? 'empty' : 'ok' })

      const source = step >= 2 && still !== undefined ? still : name
      if (source === undefined) return h(WhaleGirlFallback, { mood })
      const useStill = reduced === true && name === 'girl-eat'
      const resolved = useStill ? still ?? source : source
      const src = step === 1 ? `${asset(resolved)}&r=1` : asset(resolved)
      const cls = eating ? 'eating' : mood === 'empty' ? 'empty' : mood === 'low' ? 'worried' : 'idle'

      return h(
        'div',
        { className: 'rb-girl-fade', key: `${src}:${step}` },
        h('img', {
          className: `rb-girl rb-girl--${cls}`,
          src,
          alt: '',
          'aria-hidden': true,
          draggable: false,
          onError: () => setStep((current) => (current >= 3 ? 3 : current + 1)),
        }),
      )
    }

    function BowlSplash({ reduced }) {
      if (reduced === true) return null
      return h(
        'span',
        { className: 'rb-splash', 'aria-hidden': true },
        [0, 1, 2].map((index) => h('i', { key: index, className: `rb-splash__grain rb-splash__grain--${index}` })),
      )
    }

    /**
     * Fixed stage with two crossfading layouts. The empty vat keeps the same
     * 110×113 footprint as the normal vat, so crossing ¥0 no longer scales it.
     */
    function Scene({ tier, mood, eating, girlArt, vatArt, continuousArt, fill, showEmpty, reduced, biteLabel, biteAt }) {
      const empty = showEmpty === true
      const normalVat = h(Vat, { tier, fill, continuous: continuousArt, available: vatArt })
      const emptyVat = h(Vat, { tier: 'empty', fill: 0, continuous: false, available: vatArt })

      return h(
        'div',
        { className: 'rb-stage' },
        h(
          'div',
          { className: `rb-scene${empty ? '' : ' is-on'}`, 'aria-hidden': true },
          h(
            'div',
            { className: 'rb-vat-box' },
            normalVat,
            biteLabel !== null
              ? h('span', { key: biteAt, className: 'rb-bite-float' }, biteLabel)
              : null,
          ),
          h(
            'div',
            { className: 'rb-girl-box' },
            h(Girl, { mood, eating, available: girlArt, reduced }),
            eating ? h(BowlSplash, { reduced }) : null,
          ),
        ),
        h(
          'div',
          { className: `rb-scene rb-scene--empty${empty ? ' is-on' : ''}`, 'aria-hidden': true },
          h(
            'div',
            { className: 'rb-drape-box' },
            h('div', { className: 'rb-vat-box rb-vat-box--drape' }, emptyVat),
            h(Girl, { mood: 'empty', eating: false, available: girlArt, reduced }),
          ),
        ),
      )
    }

    function VatFallback({ tier }) {
      const fill = tier === 'overflow' ? 1 : tier === 'full' ? 0.8 : tier === 'low' ? 0.07 : 0
      const travel = (1 - fill) * 78
      return h(
        'svg',
        { viewBox: '0 0 100 122', width: '100%', height: '100%', 'aria-hidden': true },
        h(
          'defs',
          null,
          h('clipPath', { id: 'rb-fb-inner' }, h('path', { d: 'M17 28 L83 28 L74 108 Q50 114 26 108 Z' })),
        ),
        h('path', { d: 'M12 24 L88 24 L78 110 Q50 118 22 110 Z', fill: '#21479f', stroke: '#0d1f52', strokeWidth: 1.5 }),
        h('path', { d: 'M17 28 L83 28 L74 108 Q50 114 26 108 Z', fill: '#0b1a45' }),
        h(
          'g',
          { clipPath: 'url(#rb-fb-inner)' },
          h('rect', { x: 0, y: 30 + travel, width: 100, height: 80, fill: '#fffdf6' }),
        ),
        h('ellipse', { cx: 50, cy: 24, rx: 38, ry: 7, fill: '#3d76e8', stroke: '#0d1f52', strokeWidth: 1.5 }),
        h('ellipse', { cx: 50, cy: 24, rx: 32, ry: 4.6, fill: '#0b1a45' }),
      )
    }

    /* ------------------------------------------------------------------ */
    /* Layout shell                                                         */
    /* ------------------------------------------------------------------ */

    /**
     * The DSH window chrome (macOS traffic lights / the Windows caption row /
     * the shell leading seat) owns the very top strip and does not forward
     * pointer events to the overlay. A 28px pill dropped at y=8 is therefore
     * completely ungrabbable: it sits inside the window drag region. Keep the
     * whole widget below that strip. The frame publishes the clearance; fall
     * back to the macOS 48px strip + 8px gap for web/older shells, and let
     * fullscreen reclaim the space.
     */
    let safeInsetCache = { at: 0, value: 56 }
    function topSafeInset() {
      if (typeof window === 'undefined' || typeof document === 'undefined') return 8
      const now = Date.now()
      if (now - safeInsetCache.at < 1_000) return safeInsetCache.value
      const html = document.documentElement
      if (html.hasAttribute('data-fullscreen')) {
        safeInsetCache = { at: now, value: 8 }
        return 8
      }
      let clearance = Number.NaN
      try {
        const style = getComputedStyle(html)
        clearance = Number.parseFloat(style.getPropertyValue('--dsh-frame-top-clearance'))
        if (!Number.isFinite(clearance)) clearance = Number.parseFloat(style.getPropertyValue('--dsh-windows-titlebar-height'))
      } catch {
        /* non-browser or restricted style access */
      }
      const value = Number.isFinite(clearance) && clearance > 0 ? Math.ceil(clearance + 8) : 56
      safeInsetCache = { at: now, value }
      return value
    }

    function clampPosition(x, y, scale, element) {
      if (typeof window === 'undefined') return { x, y }
      const width = (element?.offsetWidth ?? 244) * scale
      const height = (element?.offsetHeight ?? 260) * scale
      const minY = topSafeInset()
      const maxX = Math.max(8, window.innerWidth - width - 8)
      const maxY = Math.max(minY, window.innerHeight - height - 8)
      return { x: clamp(x, 8, maxX), y: clamp(y, minY, maxY) }
    }

    function ResizeGrip({ t, onPointerDown, onPointerMove, onPointerUp, onKeyDown, onReset }) {
      return h('div', {
        className: 'rb-resize',
        role: 'button',
        tabIndex: 0,
        title: t('resize'),
        'aria-label': t('resize'),
        'data-no-drag': true,
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onPointerCancel: onPointerUp,
        onKeyDown,
        onDoubleClick: onReset,
      })
    }

    function Dot({ tone, eating, stale }) {
      return h('i', {
        className: `rb-dot rb-dot--${tone}${eating ? ' is-eating' : ''}${stale ? ' is-stale' : ''}`,
        'aria-hidden': true,
      })
    }

    /* ------------------------------------------------------------------ */
    /* Panel                                                               */
    /* ------------------------------------------------------------------ */

    const FULL_AT = 100
    const LOW_AT = 6

    function tierFor(balance) {
      if (typeof balance !== 'number' || !Number.isFinite(balance) || balance <= 0) return 'empty'
      if (balance <= LOW_AT) return 'low'
      if (balance <= FULL_AT) return 'full'
      return 'overflow'
    }

    function RiceBowlCard({ t, locale }) {
      const stored = useMemo(readStored, [])
      const [manualLanguage, setManualLanguage] = useState(readSessionLanguage)

      const localeSnapshot = typeof locale?.getLocale === 'function' ? locale.getLocale() : null
      const dshActive = String(localeSnapshot?.active ?? activeLanguage()).toLowerCase()
      const autoLanguage = dshActive.startsWith('zh') ? 'zh' : 'en'
      const activeButton = manualLanguage ?? autoLanguage

      const autoT = typeof t === 'function' ? t : autoLanguage === 'zh' ? ZH_T : EN_T
      const tr = manualLanguage === null ? autoT : manualLanguage === 'zh' ? ZH_T : EN_T
      const formatLocale =
        manualLanguage === null ? autoLanguage : manualLanguage === 'zh' ? 'zh-CN' : 'en-US'

      const reduced = useReducedMotion()
      const { doc, spend, live, visible, failed, lastOkAt, eating, bite, tick, retry } = useQuota()

      function chooseLanguage(mode) {
        const next = mode === 'zh' ? 'zh' : 'en'
        setManualLanguage(next)
        writeSessionLanguage(next)
      }

      const [collapsed, setCollapsed] = useState(stored?.collapsed !== false)
      const [pos, setPos] = useState(() => storedPosition(stored?.pos))
      const [scale, setScale] = useState(() => clamp(Number.isFinite(stored?.scale) ? stored.scale : 1, MIN_SCALE, MAX_SCALE))
      const [detailsOpen, setDetailsOpen] = useState(false)

      const rootRef = useRef(null)
      const posRef = useRef(pos)
      const scaleRef = useRef(scale)
      const dragRef = useRef(null)
      const resizeRef = useRef(null)
      const suppressClickRef = useRef(false)

      useEffect(() => {
        posRef.current = pos
      }, [pos])

      useEffect(() => {
        scaleRef.current = scale
      }, [scale])

      /* First placement: bottom-left, clear of the sidebar foot. */
      useEffect(() => {
        if (pos !== null || doc === null) return undefined
        let second = 0
        const first = requestAnimationFrame(() => {
          second = requestAnimationFrame(() => {
            const element = rootRef.current
            if (!element) return
            const rect = element.getBoundingClientRect()
            setPos(clampPosition(12, window.innerHeight - rect.height - 56, scale, element))
          })
        })
        return () => {
          cancelAnimationFrame(first)
          if (second !== 0) cancelAnimationFrame(second)
        }
      }, [doc, pos, scale, visible])

      /* Keep the widget inside the viewport after expand/resize. */
      useEffect(() => {
        if (pos === null) return undefined
        const frame = requestAnimationFrame(() => {
          setPos((current) => (current === null ? current : clampPosition(current.x, current.y, scale, rootRef.current)))
        })
        return () => cancelAnimationFrame(frame)
      }, [doc, collapsed, detailsOpen, scale, visible])

      useEffect(() => {
        const onResize = () => {
          setPos((current) => (current === null ? current : clampPosition(current.x, current.y, scale, rootRef.current)))
        }
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
      }, [scale])

      useEffect(() => {
        writeStored({ collapsed })
      }, [collapsed])

      const persistLayout = useCallback((patch) => writeStored(patch), [])

      function beginDrag(event) {
        if (event.button !== undefined && event.button !== 0 && event.pointerType === 'mouse') return
        if (event.target?.closest?.('button, a, [data-no-drag]')) return
        const element = rootRef.current
        if (!element) return
        const rect = element.getBoundingClientRect()
        dragRef.current = {
          pointerId: event.pointerId,
          dx: event.clientX - rect.left,
          dy: event.clientY - rect.top,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
        }
        event.currentTarget.setPointerCapture?.(event.pointerId)
        event.preventDefault()
      }

      function moveDrag(event) {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== event.pointerId) return
        if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 3) return
        drag.moved = true
        const next = clampPosition(event.clientX - drag.dx, event.clientY - drag.dy, scale, rootRef.current)
        posRef.current = next
        setPos(next)
      }

      function endDrag(event) {
        const drag = dragRef.current
        if (!drag) return
        dragRef.current = null
        try {
          event.currentTarget.releasePointerCapture?.(event.pointerId)
        } catch {
          /* capture may already be gone */
        }
        if (drag.moved) {
          suppressClickRef.current = true
          setTimeout(() => {
            suppressClickRef.current = false
          }, 250)
          if (posRef.current !== null) persistLayout({ pos: posRef.current })
        } else if (collapsed) {
          /* Expand on a tap/click release. Doing it here works even if the
             platform suppresses the compatibility click after pointer capture. */
          setCollapsed(false)
          setDetailsOpen(false)
        }
      }

      function beginResize(event) {
        event.stopPropagation()
        event.preventDefault()
        const element = rootRef.current
        if (!element) return
        const rect = element.getBoundingClientRect()
        resizeRef.current = {
          pointerId: event.pointerId,
          startScale: scale,
          anchorX: rect.left,
          anchorY: rect.top,
          startDistance: Math.max(24, Math.hypot(event.clientX - rect.left, event.clientY - rect.top)),
        }
        event.currentTarget.setPointerCapture?.(event.pointerId)
      }

      function moveResize(event) {
        const resize = resizeRef.current
        if (!resize || resize.pointerId !== event.pointerId) return
        const distance = Math.hypot(event.clientX - resize.anchorX, event.clientY - resize.anchorY)
        const next = clamp(resize.startScale * (distance / resize.startDistance), MIN_SCALE, MAX_SCALE)
        scaleRef.current = next
        setScale(next)
      }

      function endResize(event) {
        const resize = resizeRef.current
        if (!resize) return
        resizeRef.current = null
        try {
          event.currentTarget.releasePointerCapture?.(event.pointerId)
        } catch {
          /* capture may already be gone */
        }
        persistLayout({ scale: scaleRef.current })
      }

      function resizeKey(event) {
        const step = event.shiftKey ? 0.1 : 0.05
        if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return
        event.preventDefault()
        const next = clamp(
          scale + (event.key === 'ArrowUp' || event.key === 'ArrowRight' ? step : -step),
          MIN_SCALE,
          MAX_SCALE,
        )
        setScale(next)
        persistLayout({ scale: next })
      }

      function resetLayout() {
        setScale(1)
        setPos(null)
        persistLayout({ scale: 1, pos: null })
      }

      function expandPill() {
        if (suppressClickRef.current) {
          suppressClickRef.current = false
          return
        }
        setCollapsed(false)
        setDetailsOpen(false)
      }

      function pillKeyDown(event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          setCollapsed(false)
        }
      }

      const loaded = doc !== null
      const signedIn = loaded && doc.signedIn === true
      const primary = doc?.primary ?? null
      const links = doc?.links ?? null
      const fullAt = Number(doc?.thresholds?.full) || FULL_AT
      const lowAt = Number(doc?.thresholds?.low) || LOW_AT
      const art = loaded ? doc.art ?? {} : { vat: true, girl: true, continuous: true }
      const liveNow = live ?? doc?.live ?? null
      const shownBalance =
        typeof liveNow?.balance === 'number' ? liveNow.balance : primary === null ? null : primary.balance
      const tier =
        typeof liveNow?.tier === 'string' ? liveNow.tier : shownBalance === null ? 'empty' : tierFor(shownBalance)
      const currency = primary?.currency ?? spend?.currency ?? 'CNY'
      const ratio =
        shownBalance === null ? 0 : clamp((shownBalance - lowAt) / Math.max(0.01, fullAt - lowAt), 0, 1)
      const riceFill = shownBalance !== null && shownBalance > 0 ? 0.05 + ratio * 0.95 : 0
      const stale =
        loaded &&
        signedIn &&
        primary !== null &&
        (doc?.stale === true || spend?.stale === true || failed === true || (lastOkAt > 0 && tick - lastOkAt > 30_000))
      const balanceUnavailable = signedIn && primary === null
      const signedOut = loaded && !signedIn
      const notReady = !loaded && failed
      const active = signedIn && primary !== null
      const status = notReady || balanceUnavailable
        ? 'error'
        : signedOut
          ? 'signedOut'
          : shownBalance === null
            ? 'error'
            : shownBalance <= 0
              ? 'empty'
              : shownBalance < lowAt
                ? 'low'
                : shownBalance > fullAt
                  ? 'overflow'
                  : 'full'
      const statusKind = status === 'signedOut' || status === 'error' ? 'muted' : status
      const statusText = {
        full: tr('statusFull'),
        overflow: tr('statusOverflow'),
        low: tr('statusLow'),
        empty: tr('statusEmpty'),
        signedOut: tr('statusSignedOut'),
        error: tr('statusError'),
      }[status]
      const today = active && spend?.source === 'platform' ? spend.today : null
      const total = active && spend?.source === 'platform' ? spend.total : null
      const average = active && spend?.source === 'platform' ? spend.averageDaily : null
      const daysLeft =
        typeof shownBalance === 'number' && typeof average === 'number' && average > 0
          ? Math.floor(shownBalance / average)
          : null
      const showEmpty = status === 'empty' && !eating
      const showStats = active
      const showGauge = active && shownBalance !== null
      const statusLabel = statusText
      const updatedAt = spend?.updatedAt ?? doc?.now ?? null
      const periodLabel = spend?.period === 'offPeak' ? tr('offPeak') : tr('peak')
      const priceLabel = tr('priceLabel')

      const rootStyle = {
        position: 'fixed',
        zIndex: Z_INDEX,
        left: pos === null ? 12 : pos.x,
        top: pos === null ? undefined : pos.y,
        bottom: pos === null ? 56 : undefined,
        pointerEvents: 'none',
      }
      const shellStyle = {
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
        pointerEvents: 'auto',
      }

      if (!visible) return null
      if (!loaded && !failed) return null

      const grip = h(ResizeGrip, {
        t: tr,
        onPointerDown: beginResize,
        onPointerMove: moveResize,
        onPointerUp: endResize,
        onKeyDown: resizeKey,
        onReset: () => {
          setScale(1)
          persistLayout({ scale: 1 })
        },
      })

      if (collapsed) {
        const pillDays = daysLeft === null ? '—' : formatDays(daysLeft, tr)
        const pillLabel = tr('pillAria', {
          balance: formatMoney(shownBalance, currency),
          days: pillDays,
        })
        return h(
          'div',
          { ref: rootRef, className: 'rb-root', style: rootStyle },
          h('style', null, CSS),
          h(
            'div',
            { className: 'rb-shell', style: shellStyle },
            h(
              'div',
              {
                className: `rb-pill${stale ? ' is-stale' : ''}${eating ? ' is-eating' : ''}`,
                role: 'button',
                tabIndex: 0,
                title: pillLabel,
                'aria-label': pillLabel,
                onClick: expandPill,
                onKeyDown: pillKeyDown,
                onPointerDown: beginDrag,
                onPointerMove: moveDrag,
                onPointerUp: endDrag,
                onPointerCancel: endDrag,
              },
              h('span', {
                className: `rb-pill__grain rb-pill__grain--${statusKind}${eating ? ' is-eating' : ''}`,
                'aria-hidden': true,
              }),
              h(
                'span',
                { className: 'rb-pill__amount' },
                signedIn && shownBalance !== null ? formatMoney(shownBalance, currency) : '—',
              ),
              h('span', { className: 'rb-pill__days' }, pillDays),
              stale ? h('i', { className: 'rb-pill__dot', 'aria-hidden': true }) : null,
            ),
            grip,
          ),
        )
      }

      const errorish = notReady || signedOut || balanceUnavailable
      const subText = notReady
        ? tr('errorHint')
        : balanceUnavailable
          ? tr('unavailable')
          : signedOut
            ? tr('signedOutHint')
            : stale
              ? `${tr('stale')} · ${tr('lastUpdated', { time: formatClock(updatedAt, formatLocale) })}`
              : status === 'empty'
                ? tr('emptyHint')
                : status === 'low'
                  ? tr('lowHint')
                  : active && spend?.source !== 'platform'
                    ? tr('unavailable')
                    : null

      return h(
        'div',
        { ref: rootRef, className: 'rb-root', style: rootStyle },
        h('style', null, CSS),
        h(
          'div',
          { className: 'rb-shell', style: shellStyle },
          h(
            'div',
            {
              className: `rb-card${errorish ? ' is-error' : ''}${stale ? ' is-stale' : ''}${eating ? ' is-eating' : ''}`,
              role: 'region',
              'aria-label': tr('title'),
              onPointerDown: beginDrag,
              onPointerMove: moveDrag,
              onPointerUp: endDrag,
              onPointerCancel: endDrag,
            },
            h(
              'div',
              {
                className: 'rb-head',
                title: tr('drag'),
              },
              h('span', { className: 'rb-title' }, tr('title')),
              !errorish
                ? h(
                    'span',
                    {
                      className: `rb-board${spend?.period === 'offPeak' ? ' is-sale' : ''}`,
                      title: tr('priceAria', { price: periodLabel, hours: tr('peakHours') }),
                    },
                    priceLabel !== ''
                      ? h('span', { className: 'rb-board__label' }, priceLabel)
                      : null,
                    h('span', { className: 'rb-board__value' }, periodLabel),
                  )
                : null,
              h(
                'span',
                { className: 'rb-status' },
                h(Dot, { tone: statusKind, eating, stale }),
                h('span', null, statusLabel),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'rb-chev',
                  title: tr('collapse'),
                  'aria-label': tr('collapse'),
                  'data-no-drag': true,
                  onClick: () => {
                    setDetailsOpen(false)
                    setCollapsed(true)
                  },
                },
                h(
                  'svg',
                  { viewBox: '0 0 12 12', width: 12, height: 12, fill: 'none', 'aria-hidden': true },
                  h('path', {
                    d: 'M2.5 4.5 6 8l3.5-3.5',
                    stroke: 'currentColor',
                    strokeWidth: 1.4,
                    strokeLinecap: 'round',
                    strokeLinejoin: 'round',
                  }),
                ),
              ),
            ),
            h(Scene, {
              tier: errorish ? 'empty' : tier,
              mood: showEmpty ? 'empty' : status === 'low' ? 'low' : errorish ? 'ok' : 'ok',
              eating,
              girlArt: art.girl === true,
              vatArt: art.vat === true,
              continuousArt: art.continuous === true,
              fill: riceFill,
              showEmpty,
              reduced,
              biteLabel: bite !== null && eating ? `−${formatSmall(bite.cny, currency)}` : null,
              biteAt: bite?.at ?? 0,
            }),
            h(
              'div',
              { className: 'rb-amount-block' },
              h('div', { className: 'rb-label' }, tr('accountBalance')),
              h(
                'div',
                { className: 'rb-amount-row' },
                h(
                  'div',
                  { className: 'rb-amount' },
                  signedIn && shownBalance !== null
                    ? [
                        h('span', { key: 'c', className: 'rb-cur' }, currencySymbol(currency)),
                        h('span', { key: 'v', className: 'rb-value' }, formatNumber(shownBalance, 2)),
                      ]
                    : h('span', { className: 'rb-value rb-value--dim' }, '—'),
                ),
                !errorish
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'rb-detail-link',
                        title: detailsOpen ? tr('hideDetails') : tr('details'),
                        'aria-expanded': detailsOpen,
                        'data-no-drag': true,
                        onClick: () => setDetailsOpen((current) => !current),
                      },
                      detailsOpen ? tr('hideDetails') : tr('details'),
                      h('span', { className: 'rb-detail-link__chev' }, detailsOpen ? '⌃' : '›'),
                    )
                  : null,
              ),
              h(
                'span',
                { className: 'rb-sr' },
                tr('summaryAria', {
                  balance: formatMoney(shownBalance, currency),
                  today: formatSmall(today, currency),
                  total: formatMoney(total, currency),
                  days: formatDays(daysLeft, tr),
                }),
              ),
            ),
            showGauge
              ? h(
                  'div',
                  {
                    className: 'rb-gauge',
                    role: 'img',
                    'aria-label': tr('gaugeAria', {
                      balance: formatMoney(shownBalance, currency),
                      low: formatThreshold(lowAt, currency),
                      full: formatThreshold(fullAt, currency),
                    }),
                  },
                  h(
                    'div',
                    { className: 'rb-track' },
                    h('div', { className: 'rb-fill', style: { width: `${Math.round(ratio * 1000) / 10}%` } }),
                    h('div', {
                      className: 'rb-marker',
                      style: { left: `calc(${Math.round(ratio * 1000) / 10}% - 3px)` },
                    }),
                  ),
                  h(
                    'div',
                    { className: 'rb-ticks' },
                    h('span', null, formatThreshold(lowAt, currency)),
                    h('span', null, formatThreshold(fullAt, currency)),
                  ),
                )
              : null,
            showStats
              ? h(
                  'div',
                  { className: 'rb-stats' },
                  h(
                    'div',
                    { className: 'rb-stat', title: tr('todayHint') },
                    h('span', { className: 'rb-stat__label' }, tr('today')),
                    h(
                      'span',
                      { className: `rb-stat__value${spend?.source !== 'platform' ? ' is-dim' : ''}` },
                      formatSmall(today, currency),
                    ),
                  ),
                  h(
                    'div',
                    { className: 'rb-stat', title: tr('lifetimeHint') },
                    h('span', { className: 'rb-stat__label' }, tr('total')),
                    h(
                      'span',
                      { className: `rb-stat__value${spend?.source !== 'platform' ? ' is-dim' : ''}` },
                      formatMoney(total, currency),
                    ),
                  ),
                  h(
                    'div',
                    {
                      className: 'rb-stat',
                      title: average === null ? tr('unavailable') : tr('daysHint', { avg: formatMoney(average, currency) }),
                    },
                    h('span', { className: 'rb-stat__label' }, tr('daysLeft')),
                    h('span', { className: 'rb-stat__value' }, formatDays(daysLeft, tr)),
                  ),
                )
              : null,
            subText !== null
              ? h(
                  'div',
                  { className: `rb-sub${stale || status === 'low' || status === 'empty' || (active && spend?.source !== 'platform') ? ' is-warn' : ''}` },
                  h('span', null, subText),
                  (stale || notReady || balanceUnavailable || (active && spend?.source !== 'platform')) && retry
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 'rb-link',
                          onClick: retry,
                          'data-no-drag': true,
                        },
                        tr('retry'),
                      )
                    : null,
                  status === 'empty' && links?.topUpUrl
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 'rb-link',
                          onClick: () => openExternal(links.topUpUrl),
                          'data-no-drag': true,
                        },
                        tr('topUp'),
                      )
                    : null,
                )
              : null,
            detailsOpen && !errorish
              ? h(
                  'div',
                  { className: 'rb-detail', role: 'group', 'aria-label': tr('detailsTitle') },
                  h(
                    'div',
                    { className: 'rb-detail__row' },
                    h('span', { className: 'rb-detail__label' }, tr('paid')),
                    h('span', { className: 'rb-detail__value' }, formatMoney(primary?.recharge, currency)),
                  ),
                  h(
                    'div',
                    { className: 'rb-detail__row' },
                    h('span', { className: 'rb-detail__label' }, tr('bonus')),
                    h('span', { className: 'rb-detail__value' }, formatMoney(primary?.bonus, currency)),
                  ),
                  h(
                    'div',
                    { className: 'rb-detail__row' },
                    h('span', { className: 'rb-detail__label' }, tr('ricePrice')),
                    h('span', { className: 'rb-detail__value' }, periodLabel),
                  ),
                  h(
                    'div',
                    { className: 'rb-detail__row' },
                    h('span', { className: 'rb-detail__label' }, tr('updated')),
                    h('span', { className: 'rb-detail__value' }, formatClock(updatedAt, formatLocale)),
                  ),
                  h(
                    'div',
                    { className: 'rb-detail__row rb-detail__row--lang' },
                    h('span', { className: 'rb-detail__label' }, tr('language')),
                    h(
                      'span',
                      { className: 'rb-lang', role: 'group', 'aria-label': tr('language') },
                      [
                        ['zh', tr('languageZh')],
                        ['en', tr('languageEn')],
                      ].map(([id, label]) =>
                        h(
                          'button',
                          {
                            key: id,
                            type: 'button',
                            className: `rb-lang__btn${activeButton === id ? ' is-active' : ''}`,
                            'aria-pressed': activeButton === id,
                            'data-no-drag': true,
                            onClick: () => chooseLanguage(id),
                          },
                          label,
                        ),
                      ),
                    ),
                  ),
                  h('div', { className: 'rb-detail__note' }, tr('languageHint')),
                  h(
                    'div',
                    { className: 'rb-detail__note' },
                    spend?.source === 'platform' ? tr('dataSource') : tr('unavailable'),
                  ),
                  h('div', { className: 'rb-detail__note' }, tr('peakHours')),
                  h('div', { className: 'rb-detail__note' }, tr('dragHint')),
                  spend?.source !== 'platform' && typeof spend?.localToday === 'number'
                    ? [
                        h(
                          'div',
                          { key: 'local', className: 'rb-detail__note' },
                          `${tr('localEstimate')} · ${formatSmall(spend.localToday, currency)} / ${formatMoney(spend.localTotal, currency)}`,
                        ),
                        h('div', { key: 'local-note', className: 'rb-detail__note' }, tr('localNote')),
                      ]
                    : null,
                  h(
                    'div',
                    { className: 'rb-detail__actions' },
                    links?.usageUrl
                      ? h(
                          'button',
                          {
                            type: 'button',
                            className: 'rb-action',
                            onClick: () => openExternal(links.usageUrl),
                            'data-no-drag': true,
                          },
                          tr('usageDetails'),
                        )
                      : null,
                    links?.topUpUrl
                      ? h(
                          'button',
                          {
                            type: 'button',
                            className: 'rb-action',
                            onClick: () => openExternal(links.topUpUrl),
                            'data-no-drag': true,
                          },
                          tr('topUp'),
                        )
                      : null,
                    h(
                      'button',
                      { type: 'button', className: 'rb-action', onClick: resetLayout, 'data-no-drag': true },
                      tr('resetLayout'),
                    ),
                  ),
                  h('div', { className: 'rb-detail__note' }, tr('version', { version: doc?.version ?? '—' })),
                )
              : null,
            grip,
          ),
        ),
      )
    }

    /* ------------------------------------------------------------------ */
    /* Styles                                                              */
    /* ------------------------------------------------------------------ */

    const CSS = `
.rb-root { box-sizing: border-box; font-family: inherit; }
.rb-root *, .rb-root *::before, .rb-root *::after { box-sizing: border-box; }
.rb-shell { transform-origin: top left; }

.rb-card {
  width: 244px;
  background: var(--dsw-alias-bg-layer-1, #1b1f2a);
  border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.12));
  border-radius: 14px;
  padding: 9px 10px 8px;
  box-shadow: 0 10px 30px rgba(0,0,0,.34);
  color: var(--dsw-alias-label-primary, #e8ecf5);
  position: relative;
  cursor: grab;
  transition: opacity .2s ease, border-color .2s ease;
}
.rb-card:active { cursor: grabbing; }
.rb-card button, .rb-card a, .rb-card .rb-link, .rb-card .rb-action { cursor: pointer; }
.rb-card .rb-resize { cursor: nwse-resize; }
.rb-card.is-stale { border-color: rgba(232,185,106,.42); }
.rb-card.is-stale .rb-value, .rb-card.is-stale .rb-stat__value { opacity: .62; }
.rb-card.is-error .rb-stage { opacity: .55; }

.rb-head {
  position: relative;
  display: flex; align-items: center; gap: 3px; height: 24px;
  cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none;
}
.rb-head:active { cursor: grabbing; }
.rb-title { flex: 0 0 auto; font-size: 10.5px; letter-spacing: 1.1px; color: var(--dsw-alias-label-secondary, #9aa4b8); white-space: nowrap; }
.rb-status { position: relative; z-index: 1; flex: 0 0 auto; margin-left: 2px; display: inline-flex; align-items: center; gap: 4px; font-size: 10px; color: var(--dsw-alias-label-secondary, #9aa4b8); white-space: nowrap; }
.rb-title + .rb-status { margin-left: auto; }
.rb-dot { width: 5px; height: 5px; border-radius: 50%; flex: 0 0 auto; background: #e8b96a; box-shadow: 0 0 6px rgba(232,185,106,.5); }
.rb-dot--full, .rb-dot--overflow { background: #e8b96a; }
.rb-dot--low { background: #e0a35c; box-shadow: 0 0 6px rgba(224,163,92,.6); }
.rb-dot--empty { background: #7d879c; box-shadow: none; }
.rb-dot--muted { background: #6d7890; box-shadow: none; }
.rb-dot.is-eating { animation: rb-dot .9s ease-in-out infinite; }
.rb-dot.is-stale { background: #e0a35c; box-shadow: 0 0 6px rgba(224,163,92,.55); }
.rb-chev {
  width: 24px; height: 24px; margin-right: -4px; border: none; border-radius: 6px;
  background: transparent; color: var(--dsw-alias-label-secondary, #9aa4b8);
  display: grid; place-items: center; cursor: pointer; padding: 0; flex: 0 0 auto;
}
.rb-chev:hover { background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,.06)); color: var(--dsw-alias-label-primary, #e8ecf5); }

.rb-stage { position: relative; height: 113px; margin: 4px 0 1px; }
.rb-scene {
  position: absolute; inset: 0; display: flex; align-items: flex-end; justify-content: center; gap: 0;
  opacity: 0; transition: opacity .28s ease; pointer-events: none;
}
.rb-scene.is-on { opacity: 1; }
.rb-vat-box { position: relative; width: 110px; height: 113px; flex: 0 0 auto; }
.rb-girl-box { position: relative; width: 112px; height: 115px; flex: 0 0 auto; margin-left: -4px; }
.rb-vat { position: relative; width: 100%; height: 100%; }
.rb-vat__base, .rb-vat__layer {
  position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain;
  user-select: none; -webkit-user-drag: none; pointer-events: none;
}
.rb-vat__layer { opacity: 0; transition: opacity .45s ease; }
.rb-vat__layer.is-on { opacity: 1; }
.rb-vat__rice-clip {
  position: absolute; inset: 0; overflow: hidden;
  opacity: 0; transition: opacity .45s ease;
  -webkit-mask: url('${asset('vat-rice-mask')}') center / 100% 100% no-repeat;
  mask: url('${asset('vat-rice-mask')}') center / 100% 100% no-repeat;
}
.rb-vat__rice-clip.is-on { opacity: 1; }
.rb-vat__rice {
  position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain;
  pointer-events: none;
  transition: transform .6s cubic-bezier(.22,1,.36,1);
}

.rb-girl-fade { position: absolute; inset: 0; animation: rb-pose-in .18s ease-out; }
.rb-girl {
  display: block; width: 100%; height: 100%; object-fit: contain;
  transform-origin: 50% 92%;
  user-select: none; -webkit-user-drag: none; pointer-events: none;
}
.rb-girl--idle { animation: rb-bob 3.4s ease-in-out infinite; }
.rb-girl--worried { animation: rb-tremble 3.8s ease-in-out infinite; }

.rb-scene--empty { justify-content: center; }
.rb-drape-box { position: relative; width: 110px; height: 113px; }
.rb-vat-box--drape { position: absolute; inset: 0; width: 100%; height: 100%; }
.rb-drape-box .rb-girl-fade { position: absolute; inset: 0; }
.rb-drape-box .rb-girl {
  position: absolute; inset: 0; width: 100%; height: 100%;
  transform: translateY(-52%);
}
.rb-drape-box .rb-girl--empty { animation: rb-sleep 4.8s ease-in-out infinite; }

.rb-splash { position: absolute; inset: 0; pointer-events: none; z-index: 2; }
.rb-splash__grain {
  position: absolute; top: 38%; width: 3px; height: 4px; border-radius: 50% 50% 45% 45%;
  background: #fffdf6; opacity: 0; box-shadow: 0 0 2px rgba(255,255,255,.7);
  animation: rb-flick 1s linear infinite;
}
.rb-splash__grain--0 { left: 34%; animation-delay: 0s; --dx: -7px; }
.rb-splash__grain--1 { left: 47%; animation-delay: .12s; --dx: 2px; }
.rb-splash__grain--2 { left: 58%; animation-delay: .06s; --dx: 8px; }

.rb-amount-block { text-align: center; position: relative; margin-top: 2px; }
.rb-label { font-size: 9px; letter-spacing: .7px; color: var(--dsw-alias-label-secondary, #9aa4b8); }
.rb-amount-row { position: relative; display: flex; align-items: center; justify-content: center; }
.rb-amount { display: inline-flex; align-items: baseline; justify-content: center; gap: 2px; min-width: 112px; max-width: 150px; }
.rb-detail-link {
  position: absolute; right: 0; top: 50%; transform: translateY(-50%);
  border: none; background: transparent; color: var(--dsw-alias-label-secondary, #9aa4b8);
  font: inherit; font-size: 9px; cursor: pointer; white-space: nowrap; padding: 2px 0;
  display: inline-flex; align-items: center; gap: 2px;
}
.rb-detail-link:hover { color: var(--dsw-alias-label-primary, #e8ecf5); }
.rb-detail-link__chev { font-size: 10px; line-height: 1; }
.rb-cur { font-size: 12px; color: var(--dsw-alias-label-secondary, #9aa4b8); }
.rb-value {
  font-size: 24px; font-weight: 600; letter-spacing: .2px; line-height: 1.15;
  font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary, #e8ecf5);
}
.rb-value--dim { color: var(--dsw-alias-label-secondary, #9aa4b8); }
.rb-bite-float {
  position: absolute; left: 50%; top: 38%; z-index: 5;
  transform: translate(-50%, -50%);
  font-size: 9px; line-height: 1.2; font-variant-numeric: tabular-nums; white-space: nowrap;
  color: #ffd9a0; background: rgba(18, 22, 32, .88);
  border: 1px solid rgba(232,185,106,.58); border-radius: 999px; padding: 2px 7px;
  box-shadow: 0 3px 10px rgba(0,0,0,.38), 0 0 8px rgba(232,185,106,.16);
  pointer-events: none;
  animation: rb-bite-rise 2.2s ease-out forwards;
}

.rb-gauge { margin: 7px 2px 0; }
.rb-track {
  position: relative; height: 4px; border-radius: 999px;
  background: rgba(127,138,163,.22);
  box-shadow:
    inset 0 0 0 1px rgba(255,255,255,.16),
    inset 0 1px 2px rgba(0,0,0,.35);
}
.rb-fill {
  position: absolute; inset: 0 auto 0 0; border-radius: 999px;
  background: linear-gradient(90deg, #d9c79e, #fffdf6);
  box-shadow:
    0 0 0 1px rgba(20,16,10,.55),
    0 0 8px rgba(255,248,225,.28);
  transition: width .6s cubic-bezier(.22,1,.36,1);
}
.rb-marker {
  position: absolute; top: -3px; width: 6px; height: 10px; border-radius: 50% 50% 45% 45%;
  background: linear-gradient(180deg, #fffdf6, #e9dcc0);
  box-shadow:
    0 0 0 1px rgba(20,16,10,.5),
    0 0 5px rgba(255,250,235,.65);
  transition: left .6s cubic-bezier(.22,1,.36,1);
}
.rb-ticks { display: flex; justify-content: space-between; margin-top: 4px; font-size: 8px; color: var(--dsw-alias-label-tertiary, #707b92); }
.rb-ticks span:last-child { text-align: right; }

/* Daylight legibility: the pale rice bar sits on a near-white card in light
   mode, so the groove gets an inset outline and the fill/marker get a dark rim
   plus a contact shadow instead of relying on a white glow. */
body:not([data-ds-dark-theme]) .rb-track {
  background: rgba(45,61,86,.14);
  box-shadow:
    inset 0 0 0 1px rgba(45,61,86,.24),
    inset 0 1px 2px rgba(45,61,86,.12);
}
body:not([data-ds-dark-theme]) .rb-fill {
  background: linear-gradient(90deg, #b8792a, #d99f43 55%, #efc677);
  box-shadow:
    0 0 0 1px rgba(74,45,11,.55),
    0 1px 2px rgba(74,45,11,.3),
    inset 0 1px 0 rgba(255,255,255,.35);
}
body:not([data-ds-dark-theme]) .rb-marker {
  background: linear-gradient(180deg, #f6cf85, #c4872f);
  box-shadow:
    0 0 0 1px rgba(74,45,11,.6),
    0 1px 2px rgba(74,45,11,.3);
}
body:not([data-ds-dark-theme]) .rb-dot {
  box-shadow:
    0 0 0 1px rgba(105,72,24,.32),
    0 0 6px rgba(232,185,106,.5);
}
body:not([data-ds-dark-theme]) .rb-dot--empty,
body:not([data-ds-dark-theme]) .rb-dot--muted { box-shadow: none; }
body:not([data-ds-dark-theme]) .rb-dot.is-stale {
  box-shadow:
    0 0 0 1px rgba(105,72,24,.32),
    0 0 6px rgba(224,163,92,.5);
}

.rb-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; margin-top: 7px; }
.rb-stat { display: flex; flex-direction: column; align-items: center; gap: 1px; min-width: 0; text-align: center; }
.rb-stat__label {
  font-size: 9px; color: var(--dsw-alias-label-secondary, #9aa4b8);
  max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.rb-stat__value {
  font-size: 11px; font-weight: 500; font-variant-numeric: tabular-nums;
  max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.rb-stat__value.is-dim { color: var(--dsw-alias-label-secondary, #9aa4b8); }

.rb-sub {
  margin-top: 5px; text-align: center; font-size: 9px; line-height: 1.45;
  color: var(--dsw-alias-label-secondary, #9aa4b8);
}
.rb-sub.is-warn { color: #e0a35c; }
.rb-link {
  border: none; background: transparent; color: inherit; font: inherit;
  text-decoration: underline; text-underline-offset: 2px; cursor: pointer; padding: 0 4px;
  margin-left: 2px;
}
.rb-link:focus-visible, .rb-detail-link:focus-visible, .rb-chev:focus-visible, .rb-action:focus-visible,
.rb-lang__btn:focus-visible, .rb-pill:focus-visible, .rb-resize:focus-visible {
  outline: 2px solid #f3e7c9; outline-offset: 2px;
}
body:not([data-ds-dark-theme]) .rb-link:focus-visible,
body:not([data-ds-dark-theme]) .rb-detail-link:focus-visible,
body:not([data-ds-dark-theme]) .rb-chev:focus-visible,
body:not([data-ds-dark-theme]) .rb-action:focus-visible,
body:not([data-ds-dark-theme]) .rb-lang__btn:focus-visible,
body:not([data-ds-dark-theme]) .rb-pill:focus-visible,
body:not([data-ds-dark-theme]) .rb-resize:focus-visible {
  outline-color: #8a5a1e;
}

/* Keep the price sign in the title cluster, 8px from the title (3px flex gap
   + 5px margin); the auto right margin keeps the status lamp and collapse
   control pinned to the right. This reads as one "米缸 + 米价" unit in both
   Chinese and English without ever covering the lamp. */
.rb-board {
  position: relative;
  display: inline-flex; align-items: center; justify-content: center; gap: 3px;
  flex: 0 1 auto; min-width: 0; max-width: 100%; margin: 0 auto 0 5px;
  box-sizing: border-box; padding: 3px 7px; text-align: center;
  transform: rotate(-1.2deg); border-radius: 5px;
  background: linear-gradient(180deg, #8a5a34, #6b4226);
  border: 1px solid #4a2c18; box-shadow: 0 2px 5px rgba(0,0,0,.3);
  overflow: hidden;
  transition: background .3s ease, box-shadow .3s ease;
}
.rb-board.is-sale {
  background: linear-gradient(180deg, #b4552f, #8a3a1f);
  box-shadow: 0 0 10px rgba(235,130,70,.34), 0 2px 5px rgba(0,0,0,.3);
}
.rb-board__label { flex: 0 0 auto; font-size: 9px; line-height: 1.1; letter-spacing: .2px; color: #f0d8bd; white-space: nowrap; }
.rb-board__value { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: 9px; line-height: 1.1; font-weight: 700; color: #fff4e4; white-space: nowrap; }
.rb-board.is-sale .rb-board__value { color: #ffd9a0; }

.rb-detail {
  margin-top: 7px; padding: 7px 8px; border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,.04));
  background: color-mix(in srgb, var(--dsw-alias-label-primary, #e8ecf5) 4%, transparent);
  border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.12));
  font-size: 9px; line-height: 1.55; color: var(--dsw-alias-label-secondary, #9aa4b8);
}
.rb-detail__row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.rb-detail__label { flex: 0 0 auto; }
.rb-detail__value { text-align: right; color: var(--dsw-alias-label-primary, #e8ecf5); font-variant-numeric: tabular-nums; }
.rb-detail__row--lang { flex-wrap: wrap; row-gap: 4px; min-height: 22px; }
.rb-lang { display: inline-flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 3px; flex: 0 0 auto; }
.rb-lang__btn {
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,140,160,.35));
  background: transparent; color: var(--dsw-alias-label-secondary, #9aa4b8);
  border-radius: 5px; padding: 3px 6px; font: inherit; font-size: 9px;
  line-height: 1.2; cursor: pointer;
}
.rb-lang__btn:hover { background: rgba(201,138,46,.12); color: var(--dsw-alias-label-primary, #e8ecf5); }
.rb-lang__btn.is-active {
  border-color: rgba(201,138,46,.68);
  background: rgba(201,138,46,.16);
  color: var(--dsw-alias-label-primary, #e8ecf5);
  font-weight: 600;
}
.rb-detail__note { margin-top: 4px; color: var(--dsw-alias-label-tertiary, #7f8aa3); }
.rb-detail__actions { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
.rb-action {
  border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.12));
  background: transparent; color: var(--dsw-alias-label-primary, #e8ecf5);
  border-radius: 6px; padding: 3px 6px; font: inherit; font-size: 9px; cursor: pointer;
}
.rb-action:hover { background: rgba(255,255,255,.06); }

.rb-sr {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
}

.rb-resize {
  position: absolute; right: 1px; bottom: 1px; width: 18px; height: 18px;
  cursor: nwse-resize; touch-action: none; opacity: .32;
  background:
    linear-gradient(135deg, transparent 48%, currentColor 49%, currentColor 55%, transparent 56%) 3px 3px / 8px 8px no-repeat,
    linear-gradient(135deg, transparent 48%, currentColor 49%, currentColor 55%, transparent 56%) 8px 8px / 8px 8px no-repeat;
  color: var(--dsw-alias-label-secondary, #9aa4b8);
}
.rb-resize:hover, .rb-resize:focus-visible { opacity: .85; }

.rb-pill {
  display: inline-flex; align-items: center; gap: 6px; max-width: 320px;
  padding: 5px 10px 5px 6px; border-radius: 999px;
  background: var(--dsw-alias-bg-layer-1, #1b1f2a);
  border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.12));
  color: var(--dsw-alias-label-primary, #e8ecf5);
  box-shadow: 0 6px 18px rgba(0,0,0,.3);
  cursor: grab; user-select: none; -webkit-user-select: none; touch-action: none;
  position: relative;
}
.rb-pill:active { cursor: grabbing; }
.rb-pill.is-stale { border-color: rgba(232,185,106,.42); }
.rb-pill__grain {
  width: 12px; height: 15px; flex: 0 0 auto; border-radius: 50% 50% 45% 45%;
  background: linear-gradient(180deg, #fffdf6, #e6d9b8);
  box-shadow: 0 0 0 2px rgba(232,185,106,.18);
}
.rb-pill__grain--low { box-shadow: 0 0 0 2px rgba(224,163,92,.55); background: linear-gradient(180deg,#f7e6c3,#dfc08a); }
.rb-pill__grain--empty, .rb-pill__grain--muted { opacity: .55; box-shadow: 0 0 0 2px rgba(150,160,180,.16); }
.rb-pill__grain.is-eating { animation: rb-bob .5s ease-in-out infinite; }
.rb-pill__amount { font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.rb-pill__days { font-size: 9px; color: var(--dsw-alias-label-secondary, #9aa4b8); white-space: nowrap; }
.rb-pill__dot { width: 5px; height: 5px; border-radius: 50%; background: #e0a35c; flex: 0 0 auto; }
.rb-pill .rb-resize { right: -3px; bottom: -3px; width: 16px; height: 16px; opacity: .25; }

.rb-card, .rb-pill { -webkit-tap-highlight-color: transparent; }
.rb-card button, .rb-pill { font-family: inherit; }

@keyframes rb-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-2px) } }
@keyframes rb-tremble { 0%,100% { transform: translateY(0) translateX(0) } 25% { transform: translateY(.5px) translateX(-1px) } 75% { transform: translateY(.5px) translateX(1px) } }
@keyframes rb-sleep { 0%,100% { transform: translateY(-52%) rotate(-.6deg) } 50% { transform: translateY(-52%) rotate(-1.4deg) } }
@keyframes rb-dot { 0%,100% { opacity: 1; transform: scale(1) } 50% { opacity: .45; transform: scale(.8) } }
@keyframes rb-pose-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes rb-bite-rise {
  0% { opacity: 0; transform: translate(-50%, -50%) translateY(6px) scale(.86) }
  14% { opacity: 1; transform: translate(-50%, -50%) translateY(0) scale(1) }
  72% { opacity: 1; transform: translate(-50%, -50%) translateY(-9px) scale(1) }
  100% { opacity: 0; transform: translate(-50%, -50%) translateY(-18px) scale(.97) }
}
@keyframes rb-flick {
  0% { opacity: 0; transform: translate(0,0) scale(.8) }
  18% { opacity: 1 }
  60% { opacity: .9; transform: translate(var(--dx, 6px), -14px) scale(1) }
  100% { opacity: 0; transform: translate(var(--dx, 6px), -24px) scale(.7) }
}

@media (prefers-reduced-motion: reduce) {
  .rb-vat__layer, .rb-vat__rice-clip, .rb-vat__rice, .rb-girl, .rb-girl-fade,
  .rb-splash__grain, .rb-pill__grain, .rb-dot, .rb-bite-float, .rb-fill, .rb-marker {
    animation: none !important;
    transition: none !important;
  }
  .rb-scene { transition: none !important; }
}
`

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'rice-vat: dictionaries')
        ctx.effect(() =>
          ctx.slots.inject('shell.overlay', () => {
            const bound = ctx.locale.bind(NS)
            const Panel = (props) =>
              h(RiceBowlCard, { ...props, t: typeof props.t === 'function' ? props.t : bound, locale: ctx.locale })
            return ctx.slots.register({ name: 'shell.overlay', id: 'rice-bowl', order: 900, locale: NS }, Panel)
          }),
        )
      },
    }
  },
})
