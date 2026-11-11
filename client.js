/**
 * Client half of the rice-bowl bundle.
 *
 * Renders a docked rice-vat card into the frame-wide overlay layer, anchored over
 * the sidebar foot. It reads one JSON document from the Host route and polls a
 * cheap pulse; it never sees a credential.
 *
 * Artwork is a four-tier vat (overflow / full / low / empty) plus four poses.
 * See ASSETS-SPEC.md and assets/ATTRIBUTION.md.
 */

window.__ModuleLoader__.load({
  id: 'dsh-rice-vat',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect } = React

    const STATE_URL = '/api/rice-bowl/state'
    const PULSE_URL = '/api/rice-bowl/pulse'
    const ASSET_BASE = '/api/rice-bowl/asset'
    const STATE_MS = 60_000
    const PULSE_MS = 1_500
    const EAT_MS = 4_600

    /** Tiers mirror the Host's `tierFor`; artwork exists for each. */
    const TIERS = ['overflow', 'full', 'low', 'empty']

    const BOOT_TOKEN =
      typeof window !== 'undefined' && typeof window.__RICE_BOWL_TOKEN__ === 'string'
        ? window.__RICE_BOWL_TOKEN__
        : ''
    const AUTH_HEADERS =
      BOOT_TOKEN === ''
        ? { accept: 'application/json' }
        : { accept: 'application/json', 'x-rice-bowl-token': BOOT_TOKEN }

    /**
     * Artwork version. Asset responses are cached for a day, so this must be bumped
     * whenever a file under assets/ changes, or the browser keeps the old image.
     */
    const ASSET_V = 'v4'

    function asset(key) {
      return `${ASSET_BASE}/${key}.webp?v=${ASSET_V}`
    }

    /* ------------------------------------------------------------------ */
    /* Data                                                                */
    /* ------------------------------------------------------------------ */

    let lastEatAt = 0
    let eatTimer = null

    function useQuota() {
      const [doc, setDoc] = useState(null)
      const [spend, setSpend] = useState(null)
      const [live, setLive] = useState(null)
      const [failed, setFailed] = useState(false)
      const [eating, setEating] = useState(false)

      useEffect(() => {
        let alive = true

        fetch('/api/rice-bowl/ping', { cache: 'no-store', headers: AUTH_HEADERS }).catch(() => {})

        async function loadState() {
          try {
            const response = await fetch(STATE_URL, {
              headers: AUTH_HEADERS,
              cache: 'no-store',
            })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const body = await response.json()
            if (!alive) return
            setDoc(body)
            if (body.spend) setSpend(body.spend)
            if (body.live) setLive(body.live)
            setFailed(false)
          } catch {
            if (alive) setFailed(true)
          }
        }

        loadState()
        const timer = setInterval(loadState, STATE_MS)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [])

      useEffect(() => {
        let alive = true

        async function pulse() {
          try {
            const response = await fetch(PULSE_URL, { headers: AUTH_HEADERS, cache: 'no-store' })
            if (!response.ok) return
            const body = await response.json()
            if (!alive) return
            if (body.spend) setSpend(body.spend)
            if (body.live) setLive(body.live)

            const marker = body.spend?.recentAt
            if (typeof marker === 'number' && marker > lastEatAt) {
              lastEatAt = marker
              setEating(true)
              if (eatTimer !== null) clearTimeout(eatTimer)
              eatTimer = setTimeout(() => setEating(false), EAT_MS)
            }
          } catch {
            /* a missed pulse is not worth surfacing */
          }
        }

        pulse()
        const timer = setInterval(pulse, PULSE_MS)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [])

      return { doc, spend, live, failed, eating }
    }

    /* ------------------------------------------------------------------ */
    /* Artwork                                                             */
    /* ------------------------------------------------------------------ */

    /**
     * Vat rendering.
     *
     * `overflow` / `low` / `empty` use the painted frames. The wide middle band
     * (¥6–¥100) has no painted frame, so it composites the empty vat with the
     * package's rice-surface overlay, masked by the vat's opening and shifted down
     * as the balance falls — a continuous rice level with zero extra artwork.
     */
    function Vat({ tier, fill, continuous }) {
      if (continuous === true && tier === 'full' && typeof fill === 'number') {
        const t = Math.max(0, Math.min(1, fill))
        const shift = Math.round((1 - t) * 1905) / 100 /* 19.05% = opening height */
        return h(
          'div',
          { className: 'rb-vat' },
          h('img', { className: 'rb-vat__layer is-on', src: asset('vat-empty'), alt: '', draggable: false }),
          h(
            'div',
            { className: 'rb-vat__rice-clip' },
            h('img', {
              className: 'rb-vat__rice',
              src: asset('vat-rice-overlay'),
              alt: '',
              draggable: false,
              style: { transform: `translateY(${shift}%)` },
            }),
          ),
        )
      }

      return h(
        'div',
        { className: 'rb-vat' },
        ...TIERS.map((name) =>
          h('img', {
            key: name,
            className: `rb-vat__layer rb-vat__layer--${name}${name === tier ? ' is-on' : ''}`,
            src: asset(`vat-${name}`),
            alt: '',
            draggable: false,
          }),
        ),
      )
    }

    /**
     * Grains thrown out of the bowl while she eats.
     *
     * Anchored to the bowl's rice surface inside `girl-eat`, measured on the
     * shared 512×525 canvas: the rice band sits around x 24–77%, y 36–44%.
     */
    function BowlSplash() {
      return h(
        'span',
        { className: 'rb-splash', 'aria-hidden': true },
        [0, 1, 2, 3, 4, 5, 6].map((i) => h('i', { key: i, className: `rb-splash__grain rb-splash__grain--${i}` })),
      )
    }

    /** Hand-authored SVG mascot, used when the sprite for this state is missing. */
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
        empty
          ? h('text', { x: 78, y: 32, fontSize: 12, fill: '#7fb6e8', fontWeight: 700 }, 'z')
          : null,
      )
    }

    const GIRL_FOR = {
      idle: 'girl-idle',
      eat: 'girl-eat',
      low: 'girl-low',
      sleep: 'girl-sleep',
    }

    /** Picks the pose from the mood and the live eating flag. */
    function Girl({ mood, eating, available }) {
      const name = eating ? GIRL_FOR.eat : mood === 'empty' ? GIRL_FOR.sleep : mood === 'low' ? GIRL_FOR.low : GIRL_FOR.idle
      const [broken, setBroken] = useState(false)

      if (available !== true || broken) return h(WhaleGirlFallback, { mood })

      const cls = eating ? 'eating' : mood === 'empty' ? 'empty' : mood === 'low' ? 'worried' : 'idle'
      return h('img', {
        key: name,
        className: `rb-girl rb-girl--${cls}`,
        src: asset(name),
        alt: '鲸鱼娘',
        draggable: false,
        onError: () => setBroken(true),
      })
    }

    /** Plain SVG vat, used only when the vat artwork is missing or fails to load. */
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

    /**
     * Stage layout.
     *
     * Normally the vat and the girl stand side by side. When the vat is empty she
     * sleeps ON the vat: both sprites share one canvas registration, so she only
     * needs a fixed lift (see ASSETS-SPEC / manifest) to rest on the rim.
     */
    function Scene({ tier, mood, eating, girlArt, vatArt, continuousArt, fill }) {
      const vat = vatArt === true ? h(Vat, { tier, fill, continuous: continuousArt }) : h(VatFallback, { tier })

      if (mood === 'empty' && !eating) {
        return h(
          'div',
          { className: 'rb-scene rb-scene--empty' },
          h(
            'div',
            { className: 'rb-drape-box' },
            h(
              'div',
              { className: 'rb-vat-box rb-vat-box--drape' },
              vatArt === true ? h(Vat, { tier: 'empty', fill: 0, continuous: false }) : vat,
            ),
            h(Girl, { mood: 'empty', eating: false, available: girlArt }),
          ),
        )
      }

      return h(
        'div',
        { className: 'rb-scene' },
        h('div', { className: 'rb-vat-box' }, vat),
        h(
          'div',
          { className: 'rb-girl-box' },
          h(Girl, { mood, eating, available: girlArt }),
          eating ? h(BowlSplash) : null,
        ),
      )
    }

    /* ------------------------------------------------------------------ */
    /* Panel                                                               */
    /* ------------------------------------------------------------------ */

    const FULL_AT = 100
    const LOW_AT = 6

    function moodFor(primary, signIn) {
      if (!signIn) return 'empty'
      if (primary === null || primary === undefined) return 'empty'
      if (primary.balance <= 0) return 'empty'
      if (primary.balance < LOW_AT) return 'low'
      if (primary.balance <= FULL_AT) return 'ok'
      return 'full'
    }

    function tierFor(balance) {
      if (typeof balance !== 'number' || !Number.isFinite(balance) || balance <= 0) return 'empty'
      if (balance <= LOW_AT) return 'low'
      if (balance <= FULL_AT) return 'full'
      return 'overflow'
    }

    /**
     * One-line hint for the sign plate: what the VAT currently shows, not what the
     * girl is doing. `fill` only refines the wide 6–100 band so the words stay true
     * as the rice drains.
     */
    function hintFor({ eating, stale, mood, tier, fill }) {
      if (eating) return '正在炫米...'
      if (stale === true) return '信号不稳'
      if (mood === 'empty') return '没有米了，晕碳中'
      if (tier === 'overflow') return '米缸溢出来了'
      if (mood === 'low') return '米缸见底了'
      if (fill >= 0.7) return '米缸满满'
      if (fill >= 0.3) return '米缸过半'
      return '米缸见底了'
    }

    function formatMoney(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      return value.toFixed(2)
    }

    function formatSmall(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      if (value > 0 && value < 0.01) return '<0.01'
      return value.toFixed(2)
    }

    const styles = {
      root: { position: 'fixed', left: 8, bottom: 56, width: 236, pointerEvents: 'auto', zIndex: 40 },
    }

    function RiceBowlCard() {
      const { doc, spend, live, failed, eating } = useQuota()
      const [collapsed, setCollapsed] = useState(false)

      const signIn = doc !== null && doc.signedIn === true
      const primary = doc?.primary ?? null
      const mood = moodFor(primary, signIn)
      const today = spend?.today
      const total = spend?.total

      const liveNow = live ?? doc?.live ?? null
      const shownBalance =
        typeof liveNow?.balance === 'number' ? liveNow.balance : primary === null ? null : primary.balance
      const tier = typeof liveNow?.tier === 'string' ? liveNow.tier : tierFor(shownBalance)
      const girlArt = doc?.art?.girl === true
      const continuousArt = doc?.art?.continuous === true
      const fill =
        shownBalance === null ? 0 : Math.max(0, Math.min(1, (shownBalance - LOW_AT) / (FULL_AT - LOW_AT)))

      if (collapsed) {
        return h(
          'div',
          { className: 'rb-root rb-root--collapsed', style: styles.root },
          h('style', null, CSS),
          h(
            'button',
            { type: 'button', className: 'rb-pill', title: '展开米缸', onClick: () => setCollapsed(false) },
            h('span', { className: `rb-pill__grain${eating ? ' rb-pill__grain--eat' : ''}` }),
            h(
              'span',
              { className: 'rb-pill__amount' },
              signIn && shownBalance !== null ? `¥${formatMoney(shownBalance)}` : '—',
            ),
          ),
        )
      }

      return h(
        'div',
        { className: 'rb-root', style: styles.root },
        h('style', null, CSS),
        h(
          'div',
          { className: `rb-card${eating ? ' rb-card--eating' : ''}` },
          h(
            'div',
            { className: 'rb-head' },
            h('span', { className: 'rb-title' }, '米缸'),
            h(
              'button',
              { type: 'button', className: 'rb-collapse', title: '收起', onClick: () => setCollapsed(true) },
              '—',
            ),
          ),
          h(Scene, { tier, mood, eating, girlArt, vatArt: doc?.art?.vat === true, continuousArt, fill }),
          h(
            'div',
            { className: 'rb-amount' },
            signIn && shownBalance !== null
              ? [
                  h('span', { key: 'c', className: 'rb-amount__currency' }, primary?.currency === 'USD' ? '$' : '¥'),
                  h('span', { key: 'v', className: 'rb-amount__value' }, formatMoney(shownBalance)),
                ]
              : h('span', { key: 'n', className: 'rb-amount__value rb-amount__value--dim' }, '—'),
          ),
          h(
            'div',
            { className: 'rb-sub' },
            !signIn
              ? failed
                ? '面板数据读取失败'
                : '未登录 DeepSeek 账户'
              : primary
                ? `充值 ${formatMoney(primary.recharge)} · 赠金 ${formatMoney(primary.bonus)}`
                : '余额不可用',
          ),
          h(
            'div',
            { className: 'rb-stats' },
            h(
              'div',
              { className: 'rb-stat' },
              h('span', { className: 'rb-stat__label' }, '今日炫米'),
              h('span', { className: 'rb-stat__value' }, typeof today === 'number' ? `¥${formatSmall(today)}` : '—'),
            ),
            h(
              'div',
              { className: 'rb-stat' },
              h('span', { className: 'rb-stat__label' }, '累计炫米'),
              h('span', { className: 'rb-stat__value' }, typeof total === 'number' ? `¥${formatSmall(total)}` : '—'),
            ),
          ),
          h(
            'div',
            { className: 'rb-board-row' },
            h(
              'div',
              { className: 'rb-board-slot' },
              h(
                'div',
                { className: `rb-board${spend?.period === 'offPeak' ? ' rb-board--sale' : ''}` },
                h('span', { className: 'rb-board__ruffle' }),
                h(
                  'span',
                  { className: 'rb-board__body' },
                  h('span', { className: 'rb-board__label' }, '当前米价'),
                  h('span', { className: 'rb-board__value' }, spend === null ? '—' : spend.period === 'offPeak' ? '减半' : '原价'),
                ),
              ),
            ),
            h(
              'div',
              { className: 'rb-bubble-slot' },
              h(
                'div',
                { className: 'rb-bubble' },
                h('span', { className: 'rb-bubble__gloss' }),
                h(
                  'span',
                  { className: 'rb-bubble__text' },
                  hintFor({ eating, stale: doc?.stale === true, mood, tier, fill }),
                ),
              ),
            ),
          ),
        ),
      )
    }

    const CSS = `
.rb-root { box-sizing: border-box; font-family: inherit; }
.rb-card {
  background: var(--dsw-alias-bg-layer-1, #1b1f2a);
  border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.12));
  border-radius: 12px;
  padding: 8px 10px 7px;
  box-shadow: 0 8px 24px rgba(0,0,0,.28);
  color: var(--dsw-alias-label-primary, #e8ecf5);
  transition: box-shadow .3s ease, border-color .3s ease;
}
.rb-card--eating { border-color: rgba(90,150,255,.55); box-shadow: 0 8px 28px rgba(60,120,255,.28); }

.rb-head { display:flex; align-items:center; justify-content:space-between; }
.rb-title { font-size: 11px; letter-spacing:2px; color: var(--dsw-alias-label-secondary, #9aa4b8); }
.rb-collapse {
  border:none; background:transparent; cursor:pointer; line-height:1;
  color: var(--dsw-alias-label-secondary, #9aa4b8); font-size:13px; padding:0 2px;
}
.rb-collapse:hover { color: var(--dsw-alias-label-primary, #e8ecf5); }

.rb-scene { display:flex; align-items:flex-end; justify-content:center; gap:0; margin:2px 0 3px; min-height:110px; }
.rb-vat-box { width:110px; height:113px; flex:0 0 auto; }
.rb-girl-box { position:relative; width:112px; height:115px; flex:0 0 auto; margin-left:-4px; }

.rb-vat { position:relative; width:100%; height:100%; }
.rb-vat__layer {
  position:absolute; inset:0; width:100%; height:100%; object-fit:contain;
  opacity:0; transition: opacity .55s ease;
  user-select:none; -webkit-user-drag:none; pointer-events:none;
}
.rb-vat__layer.is-on { opacity:1; }
.rb-vat__rice-clip {
  position:absolute; inset:0; overflow:hidden;
  -webkit-mask: url('${asset('vat-rice-mask')}') center / 100% 100% no-repeat;
  mask: url('${asset('vat-rice-mask')}') center / 100% 100% no-repeat;
}
.rb-vat__rice {
  position:absolute; inset:0; width:100%; height:100%; object-fit:contain;
  pointer-events:none;
  transition: transform .9s cubic-bezier(.22,1,.36,1);
}

.rb-girl {
  display:block; width:100%; height:100%; object-fit:contain;
  transform-origin: 50% 92%;
  user-select:none; -webkit-user-drag:none; pointer-events:none;
}
.rb-girl--idle { animation: rb-bob 3.4s ease-in-out infinite; }
.rb-girl--worried { animation: rb-tremble 2.6s ease-in-out infinite; }
/* eating is an animated WebP (16 frames, 4.6s); the sprite supplies its own motion */

/* empty state: she lies across the vat, head on the rim */
.rb-scene--empty { justify-content:center; }
.rb-drape-box { position:relative; width:136px; height:140px; }
.rb-vat-box--drape { position:absolute; inset:0; width:100%; height:100%; }
.rb-drape-box .rb-girl { position:absolute; inset:0; width:100%; height:100%; transform:translateY(-52%); }
.rb-drape-box .rb-girl--idle,
.rb-drape-box .rb-girl--empty { animation: rb-sleep 4.8s ease-in-out infinite; }

/* grains thrown out of the bowl while she eats */
.rb-splash { position:absolute; inset:0; pointer-events:none; z-index:2; }
.rb-splash__grain {
  position:absolute; top:38%; width:3px; height:4px; border-radius:50% 50% 45% 45%;
  background:#fffdf6; opacity:0; box-shadow:0 0 2px rgba(255,255,255,.7);
  animation: rb-flick 1.1s linear infinite;
}
.rb-splash__grain--0 { left:30%; animation-delay:0s }
.rb-splash__grain--1 { left:37%; animation-delay:.14s }
.rb-splash__grain--2 { left:45%; animation-delay:.05s }
.rb-splash__grain--3 { left:52%; animation-delay:.2s }
.rb-splash__grain--4 { left:59%; animation-delay:.09s }
.rb-splash__grain--5 { left:66%; animation-delay:.25s }
.rb-splash__grain--6 { left:42%; animation-delay:.3s }

.rb-amount { display:flex; align-items:baseline; gap:2px; justify-content:center; }
.rb-amount__currency { font-size:12px; color: var(--dsw-alias-label-secondary, #9aa4b8); }
.rb-amount__value { font-size:22px; font-weight:600; letter-spacing:.5px; font-variant-numeric: tabular-nums; }
.rb-amount__value--dim { color: var(--dsw-alias-label-secondary, #9aa4b8); }
.rb-sub { text-align:center; font-size:10px; color: var(--dsw-alias-label-secondary, #9aa4b8); margin-top:1px; }

.rb-stats { display:flex; gap:6px; margin-top:6px; }
.rb-stat {
  flex:1; display:flex; flex-direction:column; align-items:center; gap:1px;
  background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,.04));
  border-radius:7px; padding:4px 2px;
}
.rb-stat__label { font-size:9px; color: var(--dsw-alias-label-secondary, #9aa4b8); }
.rb-stat__value { font-size:11px; font-weight:500; font-variant-numeric: tabular-nums; }

.rb-board-row { display:flex; align-items:stretch; gap:6px; margin-top:8px; }
.rb-board-slot { flex:1 1 0; min-width:0; display:flex; align-items:center; justify-content:center; }
.rb-bubble-slot { flex:1 1 0; min-width:0; display:flex; align-items:center; }
.rb-board {
  position:relative; display:inline-flex; transform:rotate(-1.6deg);
  border-radius:6px; padding:3px 9px 3px 8px;
  background:linear-gradient(180deg,#8a5a34,#6b4226);
  border:1px solid #4a2c18;
  box-shadow:0 2px 6px rgba(0,0,0,.35);
  transition: background .4s ease, box-shadow .4s ease;
}
.rb-board--sale {
  background:linear-gradient(180deg,#b4552f,#8a3a1f);
  box-shadow:0 0 12px rgba(235,130,70,.45), 0 2px 6px rgba(0,0,0,.35);
}
.rb-board__ruffle {
  position:absolute; top:-2.5px; left:50%; width:5px; height:5px; margin-left:-2.5px;
  border-radius:50%; background:#3a2413;
}
.rb-board__body { display:flex; align-items:baseline; gap:6px; }
.rb-board__label { font-size:9px; letter-spacing:1px; color:#f0d8bd; }
.rb-board__value { font-size:12px; font-weight:700; color:#fff4e4; }
.rb-board--sale .rb-board__value { color:#ffd9a0; }
/* A glossy hint plate, not a speech bubble: no tail, flat gloss band. */
.rb-bubble {
  position:relative; width:100%; box-sizing:border-box;
  padding:6px 6px;
  border-radius:10px;
  background:linear-gradient(165deg,#ffffff 0%,#e8f3ff 46%,#b6d8f8 100%);
  border:1px solid rgba(255,255,255,.95);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.98),
    inset 0 -2px 7px rgba(70,130,200,.22),
    0 2px 8px rgba(25,65,135,.35);
  color:#123862;
  font-size:9px; font-weight:600; line-height:1.2; text-align:center; letter-spacing:.2px;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  animation: rb-floaty 4.6s ease-in-out infinite;
}
.rb-bubble__gloss {
  position:absolute; left:5px; right:5px; top:2px; height:42%;
  border-radius:8px 8px 12px 12px;
  background:linear-gradient(180deg, rgba(255,255,255,.55), rgba(255,255,255,0));
  pointer-events:none;
}
.rb-bubble__text { position:relative; z-index:1; display:block; }
@keyframes rb-floaty { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-1.5px) } }

.rb-root--collapsed { width:auto; }
.rb-pill {
  display:flex; align-items:center; gap:5px; cursor:pointer;
  background: var(--dsw-alias-bg-layer-1, #1b1f2a);
  border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.12));
  border-radius: 999px; padding: 3px 9px 3px 4px;
  color: var(--dsw-alias-label-primary, #e8ecf5); font-family: inherit;
}
.rb-pill__grain {
  width:9px; height:12px; border-radius:50% 50% 45% 45%;
  background: linear-gradient(180deg,#fffdf6,#e6d9b8); display:inline-block;
}
.rb-pill__grain--eat { animation: rb-bob .5s ease-in-out infinite; }
.rb-pill__amount { font-size:11px; font-variant-numeric: tabular-nums; }

@keyframes rb-flick {
  0% { opacity:0; transform: translate(0,0) scale(.8) }
  18% { opacity:1 }
  60% { opacity:.9; transform: translate(var(--dx, 6px), -14px) scale(1) }
  100% { opacity:0; transform: translate(var(--dx, 6px), -24px) scale(.7) }
}
.rb-splash__grain--0 { --dx:-10px } .rb-splash__grain--1 { --dx:-6px }
.rb-splash__grain--2 { --dx:-2px }  .rb-splash__grain--3 { --dx:3px }
.rb-splash__grain--4 { --dx:7px }   .rb-splash__grain--5 { --dx:11px }
.rb-splash__grain--6 { --dx:-4px }

@keyframes rb-bob { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-2px)} }
@keyframes rb-tremble { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-1px)} 75%{transform:translateX(1px)} }
@keyframes rb-sleep { 0%,100%{transform:translateY(-52%) rotate(-.6deg)} 50%{transform:translateY(-52%) rotate(-1.4deg)} }

@media (prefers-reduced-motion: reduce) {
  .rb-vat__layer, .rb-girl, .rb-splash__grain, .rb-pill__grain, .rb-bubble { animation: none !important; }
}
`

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() =>
          ctx.slots.inject('shell.overlay', () =>
            ctx.slots.register({ name: 'shell.overlay', id: 'rice-bowl', order: 900 }, RiceBowlCard),
          ),
        )
      },
    }
  },
})
