import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, useScroll, useSpring, useTransform, MotionValue } from 'framer-motion'
import { GaussianChart } from '@/components/market/GaussianChart'
import { Slider } from '@/components/ui/Slider'
import { pYes, pNo } from '@/lib/math'

/* ════════════════════════════════════════════════════════════════════════
   Stage geometry — fixed viewBox, illustrative ETH-price domain
   (prior μ=3500 σ=800; the verified on-chain trade: 2 USDC YES @ 3000
   moved μ 3500 → 3358 and σ 800 → 714).
   ════════════════════════════════════════════════════════════════════════ */

const VB_W = 1000
const VB_H = 560
const PLOT = { left: 70, right: 70, top: 70, bottom: 90 }
const PW = VB_W - PLOT.left - PLOT.right
const PH = VB_H - PLOT.top - PLOT.bottom
const BASE_Y = VB_H - PLOT.bottom
const DOMAIN: [number, number] = [600, 6400]
const PEAK = 0.86

const BET_X = 3000
const FINAL_X = 3200
const PRIOR_MU = 3500
const PRIOR_SIGMA = 800

const xToPx = (x: number) => PLOT.left + ((x - DOMAIN[0]) / (DOMAIN[1] - DOMAIN[0])) * PW
const yToPx = (v: number) => BASE_Y - v * PH

const bell = (x: number, mu: number, sigma: number) => {
  const z = (x - mu) / sigma
  return Math.exp(-0.5 * z * z)
}

function linePath(mu: number, sigma: number, peak: number): string {
  const n = 120
  let d = ''
  for (let i = 0; i <= n; i++) {
    const x = DOMAIN[0] + ((DOMAIN[1] - DOMAIN[0]) * i) / n
    d += `${i === 0 ? 'M' : 'L'}${xToPx(x).toFixed(1)},${yToPx(bell(x, mu, sigma) * peak).toFixed(1)}`
  }
  return d
}

function areaPath(mu: number, sigma: number, peak: number, from: number, to: number): string {
  const lo = Math.max(DOMAIN[0], Math.min(from, to))
  const hi = Math.min(DOMAIN[1], Math.max(from, to))
  if (hi - lo < 1) return ''
  const n = 80
  let d = `M${xToPx(lo).toFixed(1)},${BASE_Y}`
  for (let i = 0; i <= n; i++) {
    const x = lo + ((hi - lo) * i) / n
    d += `L${xToPx(x).toFixed(1)},${yToPx(bell(x, mu, sigma) * peak).toFixed(1)}`
  }
  return d + `L${xToPx(hi).toFixed(1)},${BASE_Y}Z`
}

const X_TICKS = [1000, 2000, 3000, 4000, 5000, 6000]

/* ── Fragmented binary pools (chapter 01) ───────────────────────────────── */

const FRAGMENTS = [
  { x: 2300, h: 0.3 },
  { x: 2900, h: 0.48 },
  { x: 3500, h: 0.58 },
  { x: 4100, h: 0.46 },
  { x: 4700, h: 0.34 },
  { x: 5300, h: 0.24 },
  { x: 5900, h: 0.18 },
]

function FragmentBar({ t, x, h, i }: { t: MotionValue<number>; x: number; h: number; i: number }) {
  const inS = 0.02 + i * 0.013
  const opacity = useTransform(t, [inS, inS + 0.035, 0.115, 0.165], [0, 1, 1, 0])
  const y = useTransform(t, [inS, inS + 0.05], [18, 0])
  const py = pYes(x, PRIOR_MU, PRIOR_SIGMA)
  const total = h * PH
  const noH = total * (1 - py)
  const yesH = total * py
  const bx = xToPx(x) - 18

  return (
    <motion.g style={{ opacity, y }}>
      <rect
        x={bx} y={BASE_Y - noH} width={36} height={noH}
        fill="rgba(180,35,24,0.25)" stroke="rgba(180,35,24,0.55)" strokeWidth={1}
      />
      <rect
        x={bx} y={BASE_Y - noH - 3 - yesH} width={36} height={yesH}
        fill="rgba(11,122,82,0.25)" stroke="rgba(11,122,82,0.55)" strokeWidth={1}
      />
      <text
        x={bx + 18} y={BASE_Y - noH - yesH - 12} textAnchor="middle"
        fontSize={10} fontFamily="'JetBrains Mono', monospace" fill="var(--chart-tick-text)"
      >
        Y/N
      </text>
    </motion.g>
  )
}

/* ── Crossfading caption (one per chapter) ──────────────────────────────── */

function Caption({
  t, win, num, title, children, foot,
}: {
  t: MotionValue<number>
  win: [number, number, number, number]
  num: string
  title: string
  children: React.ReactNode
  foot?: string
}) {
  const opacity = useTransform(t, win, [0, 1, 1, 0])
  const y = useTransform(t, win, [28, 0, 0, -18])

  return (
    <motion.div
      style={{ opacity, y, background: '#FDF8EE', boxShadow: '0 10px 32px rgba(62,44,30,0.14)' }}
      className="absolute left-4 right-4 bottom-6 sm:left-10 sm:right-auto sm:bottom-10 sm:max-w-md border border-[rgba(62,44,30,0.18)] rounded p-5 sm:p-6 pointer-events-none"
    >
      <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-[#C8102E] mb-2">
        {num}
      </p>
      <h3 className="font-display font-700 text-lg sm:text-xl mb-2 text-[#231812]">
        {title}
      </h3>
      <p className="font-serif text-sm sm:text-[15px] leading-relaxed text-[rgba(35,24,18,0.85)]">
        {children}
      </p>
      {foot && (
        <p className="font-mono text-[10px] leading-relaxed mt-3 pt-3 border-t border-[rgba(62,44,30,0.14)] text-[rgba(35,24,18,0.62)]">
          {foot}
        </p>
      )}
    </motion.div>
  )
}

/* ════════════════════════════════════════════════════════════════════════
   The pinned scroll story — six chapters on one morphing Gaussian stage
   ════════════════════════════════════════════════════════════════════════ */

function ScrollStory() {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  // Wheel/trackpad scrolling arrives in discrete steps; driving the whole
  // stage straight from it makes every chapter jump a frame at a time. A
  // critically-damped spring turns those steps into a continuous glide —
  // every transform below inherits the smoothing for free.
  const t = useSpring(scrollYProgress, { stiffness: 110, damping: 28, restDelta: 0.0001 })

  /* — curve state, scroll-driven — */
  const mu = useTransform(t, [0, 0.66, 0.745, 1], [PRIOR_MU, PRIOR_MU, 3358, 3358])
  const sigma = useTransform(
    t,
    [0, 0.24, 0.3, 0.36, 0.41, 0.66, 0.745, 1],
    [PRIOR_SIGMA, PRIOR_SIGMA, 1150, 580, PRIOR_SIGMA, PRIOR_SIGMA, 714, 714],
  )
  const peak = useTransform(t, [0.115, 0.2], [0, PEAK])
  const curveOpacity = useTransform(t, [0.115, 0.19], [0, 1])

  const strike = useTransform(t, [0.43, 0.545, 0.565, 0.615], [1300, 5300, 5300, BET_X])
  const strikeOpacity = useTransform(t, [0.4, 0.44], [0, 1])

  /* — derived SVG paths — */
  const curveD = useTransform([mu, sigma, peak], (v: number[]) => linePath(v[0], v[1], v[2]))
  const noAreaD = useTransform([mu, sigma, peak, strike], (v: number[]) =>
    areaPath(v[0], v[1], v[2], DOMAIN[0], v[3]),
  )
  const yesAreaD = useTransform([mu, sigma, peak, strike], (v: number[]) =>
    areaPath(v[0], v[1], v[2], v[3], DOMAIN[1]),
  )

  /* — markers — */
  const muPx = useTransform(mu, xToPx)
  const strikePx = useTransform(strike, xToPx)
  const muLineO = useTransform(t, [0.19, 0.23], [0, 1])
  const sigmaIndO = useTransform(t, [0.24, 0.27, 0.385, 0.415], [0, 1, 1, 0])
  const sigmaX1 = useTransform([mu, sigma], (v: number[]) => xToPx(v[0] - v[1]))
  const sigmaX2 = useTransform([mu, sigma], (v: number[]) => xToPx(v[0] + v[1]))

  /* — the bet (chapter 05) — */
  const betR = useTransform(t, [0.625, 0.655], [0, 7])
  const ringR = useTransform(t, [0.625, 0.7], [4, 30])
  const ringO = useTransform(t, [0.62, 0.632, 0.7], [0, 0.7, 0])
  const betLabelO = useTransform(t, [0.63, 0.665], [0, 1])
  const betCy = useTransform([mu, sigma], (v: number[]) => yToPx(bell(BET_X, v[0], v[1]) * PEAK))
  const curveChipO = useTransform(t, [0.7, 0.755, 0.8, 0.84], [0, 1, 1, 0])

  /* — settlement (chapter 06) — */
  const finalO = useTransform(t, [0.8, 0.85], [0, 1])
  const verdictO = useTransform(t, [0.86, 0.92], [0, 1])
  const verdictY = useTransform(t, [0.86, 0.92], [12, 0])

  /* — HUD readouts — */
  const hudO = useTransform(t, [0.19, 0.23], [0, 1])
  const muText = useTransform(mu, (v) => Math.round(v).toLocaleString())
  const sigmaText = useTransform(sigma, (v) => Math.round(v).toLocaleString())
  const strikeText = useTransform(strike, (v) => Math.round(v).toLocaleString())
  const pYesText = useTransform([strike, mu, sigma], (v: number[]) =>
    `${(pYes(v[0], v[1], v[2]) * 100).toFixed(1)}%`,
  )
  const pNoText = useTransform([strike, mu, sigma], (v: number[]) =>
    `${(pNo(v[0], v[1], v[2]) * 100).toFixed(1)}%`,
  )

  const phaseText = useTransform(t, (v): string => {
    if (v < 0.15) return '01 — FRAGMENTATION'
    if (v < 0.24) return '02 — THE COLLAPSE'
    if (v < 0.4) return '03 — BELIEF, DRAWN'
    if (v < 0.62) return '04 — PRICE = AREA'
    if (v < 0.79) return '05 — SKIN IN THE GAME'
    return '06 — REALITY SETTLES'
  })

  return (
    <div ref={ref} className="relative h-[620vh]">
      <div className="sticky top-14 h-[calc(100vh-3.5rem)] overflow-hidden flex items-start justify-center lg:justify-end px-1 lg:pr-12">
        {/* the stage — top-aligned and right-shifted on desktop so the
            caption card (bottom-left) never covers the curve */}
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="xMidYMid meet"
          className="w-full max-w-6xl h-[78%] mt-4 px-2"
        >
          {/* baseline + ticks */}
          <line x1={PLOT.left} x2={VB_W - PLOT.right} y1={BASE_Y} y2={BASE_Y} stroke="var(--chart-axis)" strokeWidth={1} />
          {X_TICKS.map((v) => (
            <g key={v}>
              <line x1={xToPx(v)} x2={xToPx(v)} y1={BASE_Y} y2={BASE_Y + 5} stroke="var(--chart-axis)" strokeWidth={1} />
              <text
                x={xToPx(v)} y={BASE_Y + 22} textAnchor="middle"
                fontSize={11} fontFamily="'JetBrains Mono', monospace" fill="var(--chart-tick-text)"
              >
                ${v / 1000}k
              </text>
            </g>
          ))}

          {/* chapter 01 — fragmented binary pools */}
          {FRAGMENTS.map((f, i) => (
            <FragmentBar key={f.x} t={t} x={f.x} h={f.h} i={i} />
          ))}

          {/* YES / NO areas (appear with the strike) */}
          <motion.path d={noAreaD} style={{ opacity: strikeOpacity }} fill="rgba(180,35,24,0.13)" />
          <motion.path d={yesAreaD} style={{ opacity: strikeOpacity }} fill="rgba(11,122,82,0.13)" />

          {/* the omni-curve */}
          <motion.path
            d={curveD}
            style={{ opacity: curveOpacity, filter: 'drop-shadow(0 0 7px rgba(200,16,46,0.45))' }}
            fill="none"
            stroke="var(--chart-curve)"
            strokeWidth={2.5}
          />

          {/* μ marker */}
          <motion.line
            x1={muPx} x2={muPx} y1={92} y2={BASE_Y}
            style={{ opacity: muLineO }}
            stroke="rgba(200,16,46,0.55)" strokeWidth={1} strokeDasharray="4 3"
          />
          <motion.text
            x={muPx} dx={7} y={104}
            style={{ opacity: muLineO }}
            fontSize={13} fontFamily="'JetBrains Mono', monospace" fill="#C8102E"
          >
            μ
          </motion.text>

          {/* ±σ ruler (chapter 03) */}
          <motion.g style={{ opacity: sigmaIndO }}>
            <motion.line x1={sigmaX1} x2={sigmaX2} y1={300} y2={300} stroke="#C8102E" strokeWidth={1} strokeDasharray="2 3" />
            <motion.line x1={sigmaX1} x2={sigmaX1} y1={293} y2={307} stroke="#C8102E" strokeWidth={1} />
            <motion.line x1={sigmaX2} x2={sigmaX2} y1={293} y2={307} stroke="#C8102E" strokeWidth={1} />
            <motion.text
              x={muPx} y={290} textAnchor="middle"
              fontSize={11} fontFamily="'JetBrains Mono', monospace" fill="#C8102E"
            >
              ±σ
            </motion.text>
          </motion.g>

          {/* strike line (chapter 04 onward) */}
          <motion.line
            x1={strikePx} x2={strikePx} y1={90} y2={BASE_Y}
            style={{ opacity: strikeOpacity }}
            stroke="#C8102E" strokeWidth={1.5}
          />
          <motion.text
            x={strikePx} dx={-8} y={120} textAnchor="end"
            style={{ opacity: strikeOpacity }}
            fontSize={11} fontFamily="'JetBrains Mono', monospace" fill="var(--accent-no)"
          >
            NO ←
          </motion.text>
          <motion.text
            x={strikePx} dx={8} y={120}
            style={{ opacity: strikeOpacity }}
            fontSize={11} fontFamily="'JetBrains Mono', monospace" fill="var(--accent-yes)"
          >
            → YES
          </motion.text>

          {/* the bet lands (chapter 05) — dot glued to the curve at its strike */}
          <motion.circle
            cx={xToPx(BET_X)} cy={betCy} r={ringR}
            style={{ opacity: ringO }}
            fill="none" stroke="var(--accent-yes)" strokeWidth={1.5}
          />
          <motion.circle
            cx={xToPx(BET_X)} cy={betCy} r={betR}
            style={{ opacity: betLabelO }}
            fill="var(--accent-yes)"
          />
          <motion.text
            x={xToPx(BET_X)} dx={-10} y={170} textAnchor="end"
            style={{ opacity: betLabelO }}
            fontSize={11} fontFamily="'JetBrains Mono', monospace" fill="var(--accent-yes)"
          >
            +2 USDC · YES @ $3,000
          </motion.text>

          {/* settlement — observed final price, not μ (chapter 06) */}
          <motion.g style={{ opacity: finalO }}>
            <line
              x1={xToPx(FINAL_X)} x2={xToPx(FINAL_X)} y1={80} y2={BASE_Y}
              stroke="#0E7490" strokeWidth={1.5} strokeDasharray="2 3"
            />
            <text
              x={xToPx(FINAL_X)} dx={6} y={92}
              fontSize={11} fontFamily="'JetBrains Mono', monospace" fill="#0E7490"
            >
              final_price $3,200
            </text>
          </motion.g>
        </svg>

        {/* phase indicator — top left */}
        <div
          className="absolute top-5 left-4 sm:left-10 pointer-events-none rounded px-3.5 py-2.5 border border-[rgba(62,44,30,0.16)]"
          style={{ background: 'rgba(253,248,238,0.94)', boxShadow: '0 6px 20px rgba(62,44,30,0.10)' }}
        >
          <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-[rgba(35,24,18,0.60)]">
            How it works
          </p>
          <motion.p className="font-mono text-xs tracking-[0.2em] uppercase text-[#C8102E] mt-1.5">
            {phaseText}
          </motion.p>
        </div>

        {/* live HUD — top right */}
        <motion.div
          style={{ opacity: hudO, background: '#FDF8EE', boxShadow: '0 6px 20px rgba(62,44,30,0.10)' }}
          className="absolute top-5 right-4 sm:right-10 hidden sm:block border border-[rgba(62,44,30,0.18)] rounded px-4 py-3 font-mono text-xs pointer-events-none"
        >
          <div className="flex items-center gap-3 justify-between">
            <span className="text-[color:var(--text-subtle)]">μ</span>
            <motion.span className="text-[#C8102E]">{muText}</motion.span>
          </div>
          <div className="flex items-center gap-3 justify-between mt-1">
            <span className="text-[color:var(--text-subtle)]">σ</span>
            <motion.span className="text-[#C8102E]">{sigmaText}</motion.span>
          </div>
          <motion.div style={{ opacity: strikeOpacity }}>
            <div className="flex items-center gap-3 justify-between mt-2 pt-2 border-t border-[color:var(--border-dim)]">
              <span className="text-[color:var(--text-subtle)]">strike</span>
              <motion.span className="text-[color:var(--text-primary)]">{strikeText}</motion.span>
            </div>
            <div className="flex items-center gap-3 justify-between mt-1">
              <span className="text-[color:var(--text-subtle)]">P(YES)</span>
              <motion.span className="text-[color:var(--accent-yes)]">{pYesText}</motion.span>
            </div>
            <div className="flex items-center gap-3 justify-between mt-1">
              <span className="text-[color:var(--text-subtle)]">P(NO)</span>
              <motion.span className="text-[color:var(--accent-no)]">{pNoText}</motion.span>
            </div>
          </motion.div>
        </motion.div>

        {/* event chips — top center */}
        <motion.div
          style={{ opacity: curveChipO }}
          className="absolute top-16 sm:top-5 left-1/2 -translate-x-1/2 border border-[rgba(200,16,46,0.45)] bg-[rgba(200,16,46,0.10)] rounded px-3 py-1.5 font-mono text-[10px] tracking-[0.15em] uppercase text-[#C8102E] whitespace-nowrap pointer-events-none"
        >
          CurveUpdated · μ 3,500→3,358 · σ 800→714
        </motion.div>
        <motion.div
          style={{ opacity: verdictO, y: verdictY }}
          className="absolute top-16 sm:top-5 left-1/2 -translate-x-1/2 border border-[rgba(11,122,82,0.45)] bg-[rgba(11,122,82,0.10)] rounded px-3 py-1.5 font-mono text-[10px] tracking-[0.15em] uppercase text-[color:var(--accent-yes)] whitespace-nowrap pointer-events-none"
        >
          final 3,200 ≥ strike 3,000 → YES pays $1/token
        </motion.div>

        {/* scroll progress rail */}
        <div className="absolute right-1.5 sm:right-3 top-[12%] bottom-[12%] w-px bg-[color:var(--border-dim)]">
          <motion.div
            style={{ scaleY: t, transformOrigin: 'top' }}
            className="absolute inset-0 bg-[#C8102E]"
          />
        </div>

        {/* captions */}
        <Caption t={t} win={[0.02, 0.05, 0.115, 0.145]} num="01 / 06" title="Fragmentation">
          Today's prediction markets ask the same question over and over. Will ETH clear $2k?
          $3k? $4k? Every strike is its own yes/no pool — its own order book, its own thin
          slice of capital.
        </Caption>
        <Caption t={t} win={[0.15, 0.18, 0.21, 0.24]} num="02 / 06" title="The collapse">
          Continuum collapses every strike into one pool, governed by a single Gaussian
          curve. Liquidity is never fragmented again: one curve prices every outcome at once.
        </Caption>
        <Caption t={t} win={[0.25, 0.28, 0.37, 0.4]} num="03 / 06" title="Belief, drawn">
          The bell is the market's belief about one continuous outcome. μ is the consensus;
          σ is its uncertainty — wide when the market is unsure, tight as conviction builds.
        </Caption>
        <Caption t={t} win={[0.43, 0.46, 0.59, 0.62]} num="04 / 06" title="Price = area">
          Choose any strike x — not just a listed one. YES costs the area under the curve to
          the right of x; NO costs the area to the left. P(YES) = 1 − Φ((x−μ)/σ), computed
          entirely on-chain.
        </Caption>
        <Caption
          t={t}
          win={[0.645, 0.675, 0.765, 0.79]}
          num="05 / 06"
          title="Skin in the game"
          foot="Verified on-chain: this exact 2 USDC trade moved a live market on Sui testnet."
        >
          Every bet folds its stake into the curve — a stake-weighted average of all strikes.
          Bettors move μ and σ; liquidity providers never can. Moving the market always costs
          capital at risk: manipulation-resistant by construction.
        </Caption>
        <Caption t={t} win={[0.815, 0.845, 0.96, 0.995]} num="06 / 06" title="Reality settles">
          μ is belief, never the verdict. The market settles against the observed final
          price: a YES at strike x pays $1 per token iff final ≥ x. Dragging the curve
          around can't change who wins.
        </Caption>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════
   Hero — self-drawing curve + invitation to scroll
   ════════════════════════════════════════════════════════════════════════ */

const HERO_CURVE = (() => {
  let d = ''
  for (let i = 0; i <= 100; i++) {
    const x = 20 + (680 * i) / 100
    const z = (x - 360) / 100
    const y = 198 - 168 * Math.exp(-0.5 * z * z)
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }
  return d
})()

function Hero() {
  return (
    <section className="relative min-h-[calc(100vh-3.5rem)] flex flex-col items-center justify-center px-6 overflow-hidden">
      <motion.p
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="font-mono text-[10px] sm:text-xs tracking-[0.4em] uppercase text-[#C8102E] mb-6"
      >
        Protocol Documentation
      </motion.p>

      {/* Editorial headline — each line unmasks with a stagger. Lines stay
          centered so the hero keeps its symmetric composition with the
          curve and scroll cue below. */}
      <h1
        className="font-display font-800 tracking-tight leading-[0.98] text-center text-[color:var(--text-primary)]"
        style={{ fontSize: 'clamp(2.8rem, 7.5vw, 5.6rem)' }}
      >
        <MaskLines
          delay={0.15}
          lines={[
            'The market',
            'is a',
            <span key="l3" className="text-[#C8102E]">curve.</span>,
          ]}
        />
      </h1>

      <motion.p
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="font-serif italic text-base sm:text-lg max-w-lg text-center leading-relaxed mt-6 text-[color:var(--text-muted)]"
      >
        One Gaussian replaces a thousand binary pools. Scroll — and the protocol
        will explain itself.
      </motion.p>

      <svg viewBox="0 0 720 220" className="w-full max-w-2xl mt-10" fill="none">
        <motion.path
          d={HERO_CURVE}
          stroke="var(--chart-curve)"
          strokeWidth={2.5}
          style={{ filter: 'drop-shadow(0 0 7px rgba(200,16,46,0.45))' }}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ delay: 0.5, duration: 1.8, ease: 'easeInOut' }}
        />
        <motion.g
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2.1, duration: 0.6 }}
        >
          <line x1={360} x2={360} y1={34} y2={198} stroke="rgba(200,16,46,0.5)" strokeWidth={1} strokeDasharray="4 3" />
          <text x={368} y={46} fontSize={13} fontFamily="'JetBrains Mono', monospace" fill="#C8102E">μ</text>
          <line x1={20} x2={700} y1={198} y2={198} stroke="var(--chart-axis)" strokeWidth={1} />
        </motion.g>
      </svg>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2.4, duration: 0.8 }}
        className="absolute bottom-8 flex flex-col items-center gap-2"
      >
        <span className="font-mono text-[10px] tracking-[0.35em] uppercase text-[color:var(--text-subtle)]">
          Scroll
        </span>
        <motion.span
          animate={{ y: [0, 7, 0] }}
          transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
          className="block w-px h-8 bg-[#C8102E]"
        />
      </motion.div>
    </section>
  )
}

/* ════════════════════════════════════════════════════════════════════════
   Below the story — reveal-on-scroll reference sections
   ════════════════════════════════════════════════════════════════════════ */

function Reveal({ children, delay = 0, className = '' }: {
  children: React.ReactNode
  delay?: number
  className?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 26 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ delay, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

/* Editorial line-mask reveal: each line rises out of an overflow-hidden
   wrapper, staggered — type appears to be unmasked rather than faded in.
   The in-view trigger MUST live on the (unclipped) container: the lines
   start fully clipped by the mask, so observing them directly would never
   report an intersection and the reveal would never fire. */
const maskLineVariant = {
  hidden: { y: '112%' },
  show: { y: '0%', transition: { duration: 0.85, ease: [0.22, 1, 0.36, 1] as const } },
}

function MaskLines({ lines, className = '', lineClassName = '', delay = 0 }: {
  lines: React.ReactNode[]
  className?: string
  lineClassName?: string
  delay?: number
}) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '-70px' }}
      custom={delay}
      variants={{
        hidden: {},
        show: (d: number) => ({ transition: { staggerChildren: 0.09, delayChildren: d } }),
      }}
    >
      {lines.map((l, i) => (
        <span key={i} className="block overflow-hidden">
          <motion.span variants={maskLineVariant} className={`block ${lineClassName}`}>
            {l}
          </motion.span>
        </span>
      ))}
    </motion.div>
  )
}

function SectionHead({ num, title, sub }: { num: string; title: string; sub?: string }) {
  return (
    <div className="mb-10">
      <Reveal>
        <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-[#C8102E] mb-3">{num}</p>
      </Reveal>
      <MaskLines
        lines={[title]}
        delay={0.05}
        className="font-display font-800 text-3xl sm:text-4xl tracking-tight text-[color:var(--text-primary)]"
      />
      {sub && (
        <Reveal delay={0.18}>
          <p className="font-serif italic text-base mt-3 max-w-xl text-[color:var(--text-muted)]">{sub}</p>
        </Reveal>
      )}
    </div>
  )
}

/* ── Stats wall — giant serif numerals in columns that drift at different
      speeds while the section scrolls through the viewport. ─────────────── */

const STAT_COLUMNS: { v: string; label: string }[][] = [
  [
    { v: '1', label: 'curve per market — every strike priced from one pool' },
    { v: '∞', label: 'strikes — any continuous x, not a listed menu' },
  ],
  [
    { v: '1%', label: 'fee on every trade, streamed pro-rata to LPs' },
    { v: '$1', label: 'per winning token, redeemed at settlement' },
  ],
  [
    { v: '24h', label: 'timelock between resolution proposal and finality' },
    { v: '10⁻⁷', label: 'max error of the on-chain erf approximation' },
  ],
]

function StatCell({ v, label }: { v: string; label: string }) {
  return (
    <div className="border-t border-[rgba(62,44,30,0.18)] pt-5 pb-14">
      <p
        className="font-serif text-[#C8102E] leading-none"
        style={{ fontSize: 'clamp(4rem, 8.5vw, 7.5rem)' }}
      >
        {v}
      </p>
      <p className="font-mono text-[11px] leading-relaxed mt-5 max-w-[26ch] text-[rgba(35,24,18,0.62)]">
        {label}
      </p>
    </div>
  )
}

function StatsWall() {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  // three columns, three speeds — the multi-rate drift is the whole effect.
  // Offsets stay modest so the section never opens with a hollow band that
  // reads as broken padding.
  const y0 = useTransform(scrollYProgress, [0, 1], [30, -40])
  const y1 = useTransform(scrollYProgress, [0, 1], [80, -90])
  const y2 = useTransform(scrollYProgress, [0, 1], [130, -60])

  return (
    <section ref={ref} className="max-w-6xl mx-auto px-4 sm:px-6 pt-32 pb-16 overflow-visible">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-x-10 items-start">
        <motion.div style={{ y: y0 }}>
          <Reveal>
            <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-[#C8102E] mb-3">
              06½ / The protocol, in numbers
            </p>
            <p className="font-serif text-[15px] leading-relaxed text-[rgba(35,24,18,0.8)] max-w-[30ch] mb-14">
              A single Gaussian carries the whole market. Everything else the protocol does
              reduces to a handful of constants.
            </p>
          </Reveal>
          {STAT_COLUMNS[0].map((s) => <StatCell key={s.v} {...s} />)}
        </motion.div>
        <motion.div style={{ y: y1 }} className="md:pt-24">
          {STAT_COLUMNS[1].map((s) => <StatCell key={s.v} {...s} />)}
        </motion.div>
        <motion.div style={{ y: y2 }} className="md:pt-48">
          {STAT_COLUMNS[2].map((s) => <StatCell key={s.v} {...s} />)}
        </motion.div>
      </div>
    </section>
  )
}

/* ── Lifecycle fan — the four resolution steps spread into a tilted arc as
      the section scrolls into view. ──────────────────────────────────────── */

const FAN_ANGLES = [-9, -3, 3, 9]

function LifecycleFan() {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 0.9', 'start 0.35'] })
  const spread = useSpring(scrollYProgress, { stiffness: 90, damping: 24 })

  return (
    <div ref={ref} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {LIFECYCLE.map((s, i) => (
        <FanCard key={s.fn} step={s} i={i} spread={spread} />
      ))}
    </div>
  )
}

function FanCard({ step, i, spread }: {
  step: (typeof LIFECYCLE)[number]
  i: number
  spread: MotionValue<number>
}) {
  const angle = FAN_ANGLES[i] ?? 0
  // edges of the fan sit lower, like cards splayed in a hand
  const arcDrop = Math.abs(angle) * 2.4
  const rotate = useTransform(spread, [0, 1], [0, angle])
  const y = useTransform(spread, [0, 1], [70, arcDrop])
  const opacity = useTransform(spread, [0, 0.25 + i * 0.12, 0.55 + i * 0.12], [0, 0, 1])

  return (
    <motion.div style={{ rotate, y, opacity, transformOrigin: 'bottom center' }}>
      <div
        className="border border-[color:var(--border-dim)] rounded p-5 h-full relative"
        style={{ background: 'var(--bg-surface)', boxShadow: '0 14px 36px rgba(62,44,30,0.12)' }}
      >
        <span className="font-mono text-[10px] text-[color:var(--text-subtle)]">
          STEP 0{i + 1}
        </span>
        <p className="font-mono text-[13px] text-[#C8102E] mt-2 break-all">{step.fn}()</p>
        <p className="font-display font-600 text-sm mt-2 text-[color:var(--text-primary)]">
          {step.title}
        </p>
        <p className="font-serif text-[13px] leading-relaxed mt-2 text-[color:var(--text-muted)]">
          {step.desc}
        </p>
      </div>
    </motion.div>
  )
}

/* ── 07 — interactive playground ────────────────────────────────────────── */

function Playground() {
  const mu = PRIOR_MU
  const sigma = PRIOR_SIGMA
  const [strike, setStrike] = useState(BET_X)

  const py = pYes(strike, mu, sigma)
  const pn = pNo(strike, mu, sigma)
  const stake = 100
  const yesTokens = py > 0.001 ? (stake * 0.99) / py : 0

  return (
    <Reveal>
      <div
        className="border border-[color:var(--border-dim)] rounded p-5 sm:p-7 space-y-5"
        style={{ background: 'var(--bg-surface)' }}
      >
        <GaussianChart mu={mu} sigma={sigma} strikeX={strike} height={230} />
        <Slider
          value={strike}
          min={mu - 3 * sigma}
          max={mu + 3 * sigma}
          step={10}
          onChange={setStrike}
          label="Strike price"
          displayValue={`$${strike.toLocaleString()}`}
        />
        <div className="grid grid-cols-2 gap-4 text-center">
          <div className="border border-[rgba(11,122,82,0.3)] bg-[rgba(11,122,82,0.07)] rounded p-4">
            <p className="text-[10px] font-mono tracking-[0.25em] uppercase mb-1 text-[color:var(--accent-yes)] opacity-70">
              P(YES)
            </p>
            <p className="font-mono text-2xl text-[color:var(--accent-yes)]">{(py * 100).toFixed(2)}%</p>
            <p className="text-[11px] font-mono mt-1 text-[color:var(--text-subtle)]">
              1 − Φ((x−μ)/σ)
            </p>
          </div>
          <div className="border border-[rgba(180,35,24,0.3)] bg-[rgba(180,35,24,0.07)] rounded p-4">
            <p className="text-[10px] font-mono tracking-[0.25em] uppercase mb-1 text-[color:var(--accent-no)] opacity-70">
              P(NO)
            </p>
            <p className="font-mono text-2xl text-[color:var(--accent-no)]">{(pn * 100).toFixed(2)}%</p>
            <p className="text-[11px] font-mono mt-1 text-[color:var(--text-subtle)]">
              Φ((x−μ)/σ)
            </p>
          </div>
        </div>
        <p className="font-mono text-xs text-center pt-1 text-[color:var(--text-subtle)]">
          $100 on YES @ ${strike.toLocaleString()} → ~{yesTokens.toFixed(1)} tokens (after 1% fee)
          → pays <span className="text-[color:var(--accent-yes)]">${yesTokens.toFixed(2)}</span> if
          final ≥ strike
        </p>
      </div>
    </Reveal>
  )
}

/* ── 08 — the math ──────────────────────────────────────────────────────── */

const MATH_PLATES = [
  {
    label: 'Pricing',
    lines: ['P_YES(x) = 1 − Φ((x − μ) / σ)', 'P_NO(x)  =     Φ((x − μ) / σ)'],
    note: 'Probability is area under the Gaussian. Any continuous strike gets an instant, mathematically derived price.',
  },
  {
    label: 'The curve',
    lines: ['μ = Σ wᵢ·xᵢ / Σ wᵢ', 'σ = √( Σ wᵢ·xᵢ² / Σ wᵢ − μ² )'],
    note: 'Each bet contributes weight wᵢ (its net stake) at strike xᵢ. The owner’s seed is just a prior with virtual weight that dilutes as real bets arrive.',
  },
  {
    label: 'On-chain stack',
    lines: ['erf ≈ Abramowitz–Stegun (err < 1.5e−7)', 'eˣ = 18-term Taylor · √ = Newton'],
    note: 'All of it in WAD (1e18) fixed-point — ~11 significant digits, computed on-chain in Sui Move (signed-magnitude Fp over u256). No oracle does the math for us.',
  },
  {
    label: 'Fees',
    lines: ['pending = shares × accFeePerShare', '          − rewardDebt'],
    note: '1% of every trade flows to LPs through a MasterChef-style accumulator — O(1) distribution no matter how many providers.',
  },
]

/* ── 09 — display heading: huge type overlapping a red chevron that drifts
      on scroll, after the reference site's "Private Equity" slides ───────── */

function RolesHead() {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const shapeY = useTransform(scrollYProgress, [0, 1], [50, -50])
  const shapeX = useTransform(scrollYProgress, [0, 1], [30, -30])

  return (
    <div ref={ref} className="relative mb-14 py-6">
      {/* the red chevron — parallaxes against the type above it */}
      <motion.div
        aria-hidden
        style={{ y: shapeY, x: shapeX }}
        className="absolute right-[2%] top-[2%] w-[44%] h-[78%] bg-[#C8102E] opacity-90 skew-x-[-16deg] pointer-events-none"
      />
      <div className="relative">
        <Reveal>
          <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-[#C8102E] mb-4">
            09 / Two roles
          </p>
        </Reveal>
        <h2
          className="font-display font-800 tracking-tight leading-[1.02] text-[color:var(--text-primary)]"
          style={{ fontSize: 'clamp(2.4rem, 6vw, 4.6rem)' }}
        >
          <MaskLines
            lines={[
              'Bettors steer.',
              <span key="l2" className="pl-[16%]">LPs underwrite.</span>,
            ]}
          />
        </h2>
        <Reveal delay={0.2}>
          <p className="font-serif italic text-base mt-5 max-w-xl text-[color:var(--text-muted)]">
            The separation is the security model: only capital at risk on a position can move
            the curve.
          </p>
        </Reveal>
      </div>
    </div>
  )
}

/* ── 10 — resolution lifecycle ──────────────────────────────────────────── */

const LIFECYCLE = [
  {
    fn: 'set_final_price',
    title: 'Record reality',
    desc: 'The owner records the externally observed outcome. μ never settles anything — the real number does.',
  },
  {
    fn: 'propose_resolution',
    title: 'Open the window',
    desc: 'A resolution proposal starts a 24-hour timelock — a dispute window anyone can inspect.',
  },
  {
    fn: 'execute_resolution',
    title: 'Finalize',
    desc: 'After the timelock, the market resolves. Trading and liquidity operations stop.',
  },
  {
    fn: 'claim_winnings',
    title: 'Redeem',
    desc: 'Winners pull $1 per token. release_losing_collateral frees the LP capital locked behind losing bets.',
  },
]

/* ════════════════════════════════════════════════════════════════════════
   12 — Future: a multi-agent AI oracle for resolution
   A second pinned scroll story. The same morphing-stage technique as the
   protocol story above, but here the stage is the resolution *pipeline* from
   Kota, "Design and Evaluation of Multi-Agent AI Oracle Systems for
   Prediction Market Resolution" (arXiv:2605.30802): question → evidence →
   debate → consensus → confidence threshold → set_final_price.
   ════════════════════════════════════════════════════════════════════════ */

const ORACLE_AGENTS = [
  { x: 215, label: 'model α', verdict: 'YES · 0.91', tone: 'yes' as const },
  { x: 405, label: 'model β', verdict: 'YES · 0.88', tone: 'yes' as const },
  { x: 595, label: 'model γ', verdict: 'ABSTAIN', tone: 'mute' as const },
  { x: 785, label: 'model δ', verdict: 'YES · 0.95', tone: 'yes' as const },
]

const O_AGENT_Y = 255
const O_AGENT_W = 132
const O_AGENT_H = 58
const O_Q_CY = 78
const O_CONS_CX = 500
const O_CONS_CY = 418
const O_CONS_W = 232
const O_CONS_H = 64
const O_BAR_X = 360
const O_BAR_W = 280
const O_BAR_Y = 496
const O_TAU = 0.75

const oAgentTop = O_AGENT_Y - O_AGENT_H / 2
const oAgentBot = O_AGENT_Y + O_AGENT_H / 2
const oConsTop = O_CONS_CY - O_CONS_H / 2

/* one agent: a labelled verdict card that rises in, its verdict revealed
   only once the debate phase resolves */
function OracleAgent({
  t, agent, i,
}: {
  t: MotionValue<number>
  agent: (typeof ORACLE_AGENTS)[number]
  i: number
}) {
  const inS = 0.33 + i * 0.025
  const opacity = useTransform(t, [inS, inS + 0.05], [0, 1])
  const y = useTransform(t, [inS, inS + 0.06], [16, 0])
  const verdictO = useTransform(t, [0.45, 0.51], [0, 1])
  const tone = agent.tone === 'yes' ? 'var(--accent-yes)' : 'var(--text-subtle)'
  const left = agent.x - O_AGENT_W / 2

  return (
    <motion.g style={{ opacity, y }}>
      <rect
        x={left} y={oAgentTop} width={O_AGENT_W} height={O_AGENT_H} rx={4}
        fill="var(--bg-surface)" stroke="rgba(62,44,30,0.30)" strokeWidth={1}
      />
      <text
        x={agent.x} y={oAgentTop + 23} textAnchor="middle"
        fontSize={12} fontFamily="'JetBrains Mono', monospace" fill="var(--text-primary)"
      >
        {agent.label}
      </text>
      <motion.text
        x={agent.x} y={oAgentTop + 43} textAnchor="middle"
        style={{ opacity: verdictO }}
        fontSize={12} fontFamily="'JetBrains Mono', monospace" fill={tone}
      >
        {agent.verdict}
      </motion.text>
    </motion.g>
  )
}

function OracleScroll() {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const t = useSpring(scrollYProgress, { stiffness: 110, damping: 28, restDelta: 0.0001 })

  /* — phase reveals — */
  const qO = useTransform(t, [0.02, 0.08], [0, 1])
  const qY = useTransform(t, [0.02, 0.09], [14, 0])
  const evO = useTransform(t, [0.17, 0.27, 0.5, 0.56], [0, 1, 1, 0])
  const debO = useTransform(t, [0.34, 0.4, 0.52, 0.57], [0, 1, 1, 0])
  const consEdgeO = useTransform(t, [0.54, 0.63], [0, 1])
  const consNodeO = useTransform(t, [0.6, 0.66], [0, 1])
  const consNodeY = useTransform(t, [0.6, 0.66], [14, 0])
  const consValO = useTransform(t, [0.62, 0.68], [0, 1])
  const barO = useTransform(t, [0.68, 0.72], [0, 1])
  const fillW = useTransform(t, [0.7, 0.82], [0, 0.92 * O_BAR_W])
  const resolveO = useTransform(t, [0.8, 0.85], [0, 1])
  const outO = useTransform(t, [0.86, 0.92], [0, 1])
  const outY = useTransform(t, [0.86, 0.92], [12, 0])

  const phaseText = useTransform(t, (v): string => {
    if (v < 0.15) return 'A — QUESTION INTAKE'
    if (v < 0.32) return 'B — EVIDENCE GATHERING'
    if (v < 0.52) return 'C — MULTI-AGENT DELIBERATION'
    if (v < 0.68) return 'D — CONSENSUS AGGREGATION'
    if (v < 0.84) return 'E — CONFIDENCE THRESHOLD'
    return 'F — RESOLUTION OUTPUT'
  })

  const tauX = O_BAR_X + O_TAU * O_BAR_W

  return (
    <div ref={ref} className="relative h-[560vh]">
      <div className="sticky top-14 h-[calc(100vh-3.5rem)] overflow-hidden flex items-start justify-center lg:justify-end px-1 lg:pr-12">
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="xMidYMid meet"
          className="w-full max-w-6xl h-[82%] mt-4 px-2"
        >
          {/* evidence — fan of retrieval lines from the question to each agent */}
          <motion.g style={{ opacity: evO }}>
            {ORACLE_AGENTS.map((a) => (
              <line
                key={a.x}
                x1={O_CONS_CX} y1={O_Q_CY + 26} x2={a.x} y2={oAgentTop - 4}
                stroke="rgba(62,44,30,0.30)" strokeWidth={1} strokeDasharray="3 4"
              />
            ))}
            <text
              x={O_CONS_CX} y={O_Q_CY + 52} textAnchor="middle"
              fontSize={10} fontFamily="'JetBrains Mono', monospace" fill="var(--text-subtle)"
            >
              retrieve · fact-check
            </text>
          </motion.g>

          {/* debate — agents argue with one another */}
          <motion.g style={{ opacity: debO }}>
            {[[0, 1], [1, 2], [2, 3], [0, 2], [1, 3]].map(([a, b]) => (
              <line
                key={`${a}-${b}`}
                x1={ORACLE_AGENTS[a].x} y1={O_AGENT_Y}
                x2={ORACLE_AGENTS[b].x} y2={O_AGENT_Y}
                stroke="#C8102E" strokeWidth={1} strokeDasharray="2 4" opacity={0.55}
              />
            ))}
          </motion.g>

          {/* consensus edges — agent verdicts flow into the aggregator */}
          <motion.g style={{ opacity: consEdgeO }}>
            {ORACLE_AGENTS.map((a) => (
              <line
                key={a.x}
                x1={a.x} y1={oAgentBot} x2={O_CONS_CX} y2={oConsTop - 4}
                stroke="rgba(62,44,30,0.30)" strokeWidth={1}
              />
            ))}
          </motion.g>

          {/* question node */}
          <motion.g style={{ opacity: qO, y: qY }}>
            <rect
              x={O_CONS_CX - 195} y={O_Q_CY - 26} width={390} height={52} rx={4}
              fill="#FDF8EE" stroke="rgba(200,16,46,0.45)" strokeWidth={1}
            />
            <text
              x={O_CONS_CX} y={O_Q_CY - 4} textAnchor="middle"
              fontSize={10} fontFamily="'JetBrains Mono', monospace" fill="#C8102E"
            >
              QUESTION
            </text>
            <text
              x={O_CONS_CX} y={O_Q_CY + 14} textAnchor="middle"
              fontSize={13} fontFamily="'JetBrains Mono', monospace" fill="var(--text-primary)"
            >
              Did ETH close ≥ $3,000 on 2026-12-31?
            </text>
          </motion.g>

          {/* agents */}
          {ORACLE_AGENTS.map((a, i) => (
            <OracleAgent key={a.x} t={t} agent={a} i={i} />
          ))}

          {/* consensus node */}
          <motion.g style={{ opacity: consNodeO, y: consNodeY }}>
            <rect
              x={O_CONS_CX - O_CONS_W / 2} y={oConsTop} width={O_CONS_W} height={O_CONS_H} rx={4}
              fill="var(--bg-surface)" stroke="rgba(200,16,46,0.5)" strokeWidth={1.5}
            />
            <text
              x={O_CONS_CX} y={oConsTop + 22} textAnchor="middle"
              fontSize={10} fontFamily="'JetBrains Mono', monospace" fill="#C8102E"
            >
              WEIGHTED CONSENSUS
            </text>
            <motion.text
              x={O_CONS_CX} y={oConsTop + 46} textAnchor="middle"
              style={{ opacity: consValO }}
              fontSize={14} fontFamily="'JetBrains Mono', monospace" fill="var(--text-primary)"
            >
              final_price ≈ $3,200
            </motion.text>
          </motion.g>

          {/* confidence bar + threshold */}
          <motion.g style={{ opacity: barO }}>
            <text
              x={O_BAR_X} y={O_BAR_Y - 10}
              fontSize={10} fontFamily="'JetBrains Mono', monospace" fill="var(--text-subtle)"
            >
              aggregate confidence
            </text>
            <rect x={O_BAR_X} y={O_BAR_Y} width={O_BAR_W} height={8} rx={4} fill="rgba(62,44,30,0.14)" />
            <motion.rect
              x={O_BAR_X} y={O_BAR_Y} width={fillW} height={8} rx={4}
              fill="var(--accent-yes)"
            />
            <line x1={tauX} x2={tauX} y1={O_BAR_Y - 6} y2={O_BAR_Y + 14} stroke="#C8102E" strokeWidth={1.5} />
            <text
              x={tauX} y={O_BAR_Y - 10} textAnchor="middle"
              fontSize={10} fontFamily="'JetBrains Mono', monospace" fill="#C8102E"
            >
              τ
            </text>
            <motion.text
              x={O_BAR_X + O_BAR_W} y={O_BAR_Y + 28} textAnchor="end"
              style={{ opacity: resolveO }}
              fontSize={11} fontFamily="'JetBrains Mono', monospace" fill="var(--accent-yes)"
            >
              0.92 ≥ τ 0.75 → RESOLVE  (else ABSTAIN)
            </motion.text>
          </motion.g>

          {/* resolution output — the owner records the one real-world number */}
          <motion.g style={{ opacity: outO, y: outY }}>
            <text
              x={O_CONS_CX} y={552} textAnchor="middle"
              fontSize={12} fontFamily="'JetBrains Mono', monospace" fill="#0E7490"
            >
              market::set_final_price($3,200) → YES pays $1 / token
            </text>
          </motion.g>
        </svg>

        {/* phase indicator — top left */}
        <div
          className="absolute top-5 left-4 sm:left-10 pointer-events-none rounded px-3.5 py-2.5 border border-[rgba(62,44,30,0.16)]"
          style={{ background: 'rgba(253,248,238,0.94)', boxShadow: '0 6px 20px rgba(62,44,30,0.10)' }}
        >
          <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-[rgba(35,24,18,0.60)]">
            Multi-agent · AI oracle
          </p>
          <motion.p className="font-mono text-xs tracking-[0.2em] uppercase text-[#C8102E] mt-1.5">
            {phaseText}
          </motion.p>
        </div>

        {/* scroll progress rail */}
        <div className="absolute right-1.5 sm:right-3 top-[12%] bottom-[12%] w-px bg-[color:var(--border-dim)]">
          <motion.div
            style={{ scaleY: t, transformOrigin: 'top' }}
            className="absolute inset-0 bg-[#C8102E]"
          />
        </div>

        {/* captions — crux on top, a verbatim line from the paper underneath */}
        <Caption
          t={t} win={[0.02, 0.05, 0.12, 0.15]} num="A / 06" title="Why not one model"
          foot="“Single AI models are prone to hallucinations, sycophancy, and systematic biases that undermine oracle reliability.”"
        >
          Price markets settle on Pyth — but news, sports, and elections have no feed. The answer
          isn't a single source or a single LLM; it's a panel of diverse models, because a lone
          oracle fails in correlated, invisible ways.
        </Caption>
        <Caption t={t} win={[0.17, 0.2, 0.29, 0.32]} num="B / 06" title="Evidence, gathered">
          The market's question and resolution criteria become one normalized prompt. Each
          agent independently retrieves sources and fact-checks them — no single source can
          decide the outcome on its own.
        </Caption>
        <Caption
          t={t} win={[0.34, 0.37, 0.49, 0.52]} num="C / 06" title="Agents deliberate"
          foot="“Multiple AI agents debate competing resolutions, exposing errors through adversarial discussion.”"
        >
          Architecturally diverse models (α, β, γ, δ) argue competing resolutions and surface
          each other's mistakes. Disagreement is the feature — monoculture is the risk being
          defended against.
        </Caption>
        <Caption
          t={t} win={[0.54, 0.57, 0.65, 0.68]} num="D / 06" title="Consensus, weighted"
          foot="“Agent predictions are aggregated using weighted voting schemes that account for confidence calibration.”"
        >
          A confidence-weighted vote collapses every agent's verdict into exactly one
          candidate number — the single `final_price` settlement actually needs.
        </Caption>
        <Caption
          t={t} win={[0.7, 0.73, 0.81, 0.84]} num="E / 06" title="Know when to abstain"
          foot="“Confidence thresholds enable oracles to abstain when uncertainty exceeds acceptable bounds.”"
        >
          If aggregate confidence clears the threshold τ, the price resolves. If it doesn't,
          the oracle writes nothing — degrading gracefully to the 24-hour timelock and human
          dispute path rather than guessing.
        </Caption>
        <Caption
          t={t} win={[0.86, 0.89, 0.97, 0.995]} num="F / 06" title="One number, on-chain"
          foot="Plugs into propose_resolution → execute_resolution; settlement math (Section 1.4) is untouched."
        >
          The accepted price is written via `set_final_price`, and the existing per-position
          rule pays $1 per winning token. The AI never touches μ, σ, or pricing — belief and
          settlement stay cleanly separated.
        </Caption>
      </div>
    </div>
  )
}

const ORACLE_TENETS = [
  {
    label: 'Redundancy',
    quote: '“Multiple independent models reduce single-point failures.”',
    note: 'A panel, not a feed — no single model can mis-resolve a market on its own.',
  },
  {
    label: 'Adversarial debate',
    quote: '“Agents present arguments and counterarguments to improve collective accuracy.”',
    note: "Agents challenge each other's reasoning before any price is written on-chain.",
  },
  {
    label: 'Calibrated voting',
    quote: '“Aggregated using weighted voting schemes that account for confidence calibration.”',
    note: 'Well-calibrated, confident agents carry more weight in the final number.',
  },
  {
    label: 'Selective abstention',
    quote: '“Oracles abstain when uncertainty exceeds acceptable bounds.”',
    note: 'Below τ the oracle stays silent and the 24h dispute window keeps control.',
  },
]

/* ════════════════════════════════════════════════════════════════════════
   11 — Pyth: trustless on-chain settlement for price markets
   A pinned scroll story. A live BTC/USD tape freezes at the market's close,
   then flows Hermes → Wormhole VAA → resolve_with_pyth into one on-chain
   final_price. Numbers are the verified testnet run (final_price ≈
   $63,779.06, feed 0xf9c0…ea31b, MAX_PRICE_AGE_SECS = 60).
   ════════════════════════════════════════════════════════════════════════ */

const PY_GATE_X = 720
const PY_TAPE_Y = 150
const PY_TAPE_FROM = 90
const PY_TAPE_TO = 910

const pythTapeY = (x: number) =>
  PY_TAPE_Y - 30 * Math.sin((x - PY_TAPE_FROM) / 58) - 13 * Math.sin((x - PY_TAPE_FROM) / 17)

const PYTH_TAPE_D = (() => {
  let d = ''
  for (let i = 0; i <= 160; i++) {
    const x = PY_TAPE_FROM + ((PY_TAPE_TO - PY_TAPE_FROM) * i) / 160
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${pythTapeY(x).toFixed(1)}`
  }
  return d
})()

const PYTH_STEPS = [
  { x: 215, top: 'Hermes · beta', bot: 'pull update' },
  { x: 405, top: 'Wormhole VAA', bot: 'guardians ✓' },
  { x: 595, top: 'feed id ✓', bot: 'age ≤ 60s' },
  { x: 785, top: 'price·10^expo', bot: '→ signed WAD' },
]
const PY_STEP_Y = 372
const PY_STEP_W = 152
const PY_STEP_H = 60

function PythStep({ t, step, i }: {
  t: MotionValue<number>
  step: (typeof PYTH_STEPS)[number]
  i: number
}) {
  const inS = 0.42 + i * 0.085
  const opacity = useTransform(t, [inS, inS + 0.05], [0.16, 1])
  const y = useTransform(t, [inS, inS + 0.06], [12, 0])
  const left = step.x - PY_STEP_W / 2
  const top = PY_STEP_Y - PY_STEP_H / 2

  return (
    <motion.g style={{ opacity, y }}>
      <rect
        x={left} y={top} width={PY_STEP_W} height={PY_STEP_H} rx={4}
        fill="var(--bg-surface)" stroke="rgba(14,116,144,0.5)" strokeWidth={1}
      />
      <text
        x={step.x} y={top + 25} textAnchor="middle"
        fontSize={12} fontFamily="'JetBrains Mono', monospace" fill="var(--text-primary)"
      >
        {step.top}
      </text>
      <text
        x={step.x} y={top + 44} textAnchor="middle"
        fontSize={11} fontFamily="'JetBrains Mono', monospace" fill="#0E7490"
      >
        {step.bot}
      </text>
    </motion.g>
  )
}

function PythScroll() {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const t = useSpring(scrollYProgress, { stiffness: 110, damping: 28, restDelta: 0.0001 })

  // the tape draws itself in, a scrubber rides it, then freezes at the close gate
  const tapeLen = useTransform(t, [0.04, 0.26], [0, 1])
  const scrubX = useTransform(t, [0.08, 0.3, 1], [PY_TAPE_FROM, PY_GATE_X, PY_GATE_X])
  const scrubY = useTransform(scrubX, (x) => pythTapeY(x))
  const priceLabelY = useTransform(scrubY, (v) => v - 16)
  const scrubO = useTransform(t, [0.06, 0.12], [0, 1])
  const priceText = useTransform(scrubX, (x) =>
    `$${Math.round(63600 + (PY_TAPE_Y - pythTapeY(x)) * 7).toLocaleString()}`,
  )
  const liveO = useTransform(t, [0.06, 0.12, 0.3, 0.36], [0, 1, 1, 0])

  // gate (resolves_at) + frozen snapshot
  const gateO = useTransform(t, [0.22, 0.3], [0, 1])
  const snapO = useTransform(t, [0.3, 0.36], [0, 1])
  const snapText = useTransform(t, [0.3, 0.36], [0, 1])

  // verification chain guide + drop from snapshot
  const dropLen = useTransform(t, [0.36, 0.44], [0, 1])
  const chainLen = useTransform(t, [0.44, 0.8], [0, 1])

  // settled output
  const outO = useTransform(t, [0.82, 0.88], [0, 1])
  const outY = useTransform(t, [0.82, 0.88], [14, 0])

  const phaseText = useTransform(t, (v): string => {
    if (v < 0.18) return 'A — A BOUND PRICE FEED'
    if (v < 0.34) return 'B — THE MARKET CLOSES'
    if (v < 0.58) return 'C — PULL A FRESH PRICE'
    if (v < 0.8) return 'D — VERIFY ON-CHAIN'
    return 'E — ONE FINAL PRICE'
  })

  return (
    <div ref={ref} className="relative h-[520vh]">
      <div className="sticky top-14 h-[calc(100vh-3.5rem)] overflow-hidden flex items-start justify-center lg:justify-end px-1 lg:pr-12">
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="xMidYMid meet"
          className="w-full max-w-6xl h-[82%] mt-4 px-2"
        >
          {/* feed label */}
          <text
            x={PY_TAPE_FROM} y={70}
            fontSize={11} fontFamily="'JetBrains Mono', monospace" fill="var(--text-subtle)"
          >
            Pyth · BTC/USD · 0xf9c0…ea31b
          </text>
          <motion.circle cx={PY_TAPE_FROM + 232} cy={66} r={4} fill="#0E7490" style={{ opacity: liveO }} />
          <motion.text
            x={PY_TAPE_FROM + 242} y={70}
            style={{ opacity: liveO }}
            fontSize={11} fontFamily="'JetBrains Mono', monospace" fill="#0E7490"
          >
            LIVE
          </motion.text>

          {/* the live price tape */}
          <motion.path
            d={PYTH_TAPE_D}
            style={{ pathLength: tapeLen }}
            fill="none" stroke="#0E7490" strokeWidth={2}
          />

          {/* scrubber + travelling price readout */}
          <motion.circle cx={scrubX} cy={scrubY} r={5} fill="#0E7490" style={{ opacity: scrubO }} />
          <motion.text
            x={scrubX} y={priceLabelY} textAnchor="middle"
            style={{ opacity: liveO }}
            fontSize={12} fontFamily="'JetBrains Mono', monospace" fill="#0E7490"
          >
            {priceText}
          </motion.text>

          {/* resolves_at gate */}
          <motion.g style={{ opacity: gateO }}>
            <line
              x1={PY_GATE_X} x2={PY_GATE_X} y1={92} y2={300}
              stroke="#C8102E" strokeWidth={1.5} strokeDasharray="4 3"
            />
            <text
              x={PY_GATE_X} dx={8} y={106}
              fontSize={11} fontFamily="'JetBrains Mono', monospace" fill="#C8102E"
            >
              resolves_at — market closes
            </text>
          </motion.g>

          {/* frozen snapshot */}
          <motion.circle
            cx={PY_GATE_X} cy={pythTapeY(PY_GATE_X)} r={7}
            style={{ opacity: snapO }}
            fill="none" stroke="#0E7490" strokeWidth={2}
          />
          <motion.text
            x={PY_GATE_X} dx={12} y={pythTapeY(PY_GATE_X) - 4}
            style={{ opacity: snapText }}
            fontSize={12} fontFamily="'JetBrains Mono', monospace" fill="#0E7490"
          >
            snapshot
          </motion.text>

          {/* drop from snapshot into the verification chain */}
          <motion.line
            x1={PY_GATE_X} x2={215} y1={pythTapeY(PY_GATE_X) + 8} y2={PY_STEP_Y - PY_STEP_H / 2 - 6}
            style={{ pathLength: dropLen }}
            stroke="rgba(14,116,144,0.4)" strokeWidth={1} strokeDasharray="3 4"
          />
          {/* chain guide behind the steps */}
          <motion.line
            x1={215} x2={785} y1={PY_STEP_Y} y2={PY_STEP_Y}
            style={{ pathLength: chainLen }}
            stroke="rgba(14,116,144,0.35)" strokeWidth={1}
          />

          {PYTH_STEPS.map((s, i) => (
            <PythStep key={s.x} t={t} step={s} i={i} />
          ))}

          {/* arrow down to the settled output */}
          <motion.line
            x1={785} x2={500} y1={PY_STEP_Y + PY_STEP_H / 2 + 4} y2={476}
            style={{ opacity: outO }}
            stroke="rgba(14,116,144,0.4)" strokeWidth={1}
          />

          {/* settled output */}
          <motion.g style={{ opacity: outO, y: outY }}>
            <rect
              x={500 - 150} y={478} width={300} height={56} rx={4}
              fill="var(--bg-surface)" stroke="rgba(14,116,144,0.6)" strokeWidth={1.5}
            />
            <text
              x={500} y={500} textAnchor="middle"
              fontSize={10} fontFamily="'JetBrains Mono', monospace" fill="#0E7490"
            >
              market::resolve_with_pyth — permissionless
            </text>
            <text
              x={500} y={522} textAnchor="middle"
              fontSize={14} fontFamily="'JetBrains Mono', monospace" fill="var(--text-primary)"
            >
              final_price ≈ $63,779.06
            </text>
          </motion.g>
        </svg>

        {/* phase indicator */}
        <div
          className="absolute top-5 left-4 sm:left-10 pointer-events-none rounded px-3.5 py-2.5 border border-[rgba(62,44,30,0.16)]"
          style={{ background: 'rgba(253,248,238,0.94)', boxShadow: '0 6px 20px rgba(62,44,30,0.10)' }}
        >
          <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-[rgba(35,24,18,0.60)]">
            Live · Pyth on-chain
          </p>
          <motion.p className="font-mono text-xs tracking-[0.2em] uppercase text-[#0E7490] mt-1.5">
            {phaseText}
          </motion.p>
        </div>

        {/* scroll progress rail */}
        <div className="absolute right-1.5 sm:right-3 top-[12%] bottom-[12%] w-px bg-[color:var(--border-dim)]">
          <motion.div style={{ scaleY: t, transformOrigin: 'top' }} className="absolute inset-0 bg-[#0E7490]" />
        </div>

        {/* captions */}
        <Caption t={t} win={[0.02, 0.05, 0.15, 0.18]} num="A / 05" title="Bound at birth">
          Every price market is created with an immutable 32-byte Pyth feed id. BTC/USD here is
          <span className="font-mono"> 0xf9c0…ea31b</span>. The settlement source is fixed before a
          single bet lands — it can never be swapped under open positions.
        </Caption>
        <Caption t={t} win={[0.2, 0.23, 0.31, 0.34]} num="B / 05" title="Close, then anyone settles">
          Nothing resolves before the market's scheduled <span className="font-mono">resolves_at</span>.
          Once it passes the gate opens — and the call is permissionless. No owner, no trusted
          submitter, no human in the loop.
        </Caption>
        <Caption t={t} win={[0.36, 0.39, 0.55, 0.58]} num="C / 05" title="Pyth is a pull oracle">
          Prices don't sit on-chain waiting. The caller fetches a fresh signed price from the beta
          Hermes endpoint and refreshes the feed on Sui in the <em>same</em> transaction — so the
          on-chain read is never stale.
        </Caption>
        <Caption
          t={t} win={[0.6, 0.63, 0.77, 0.8]} num="D / 05" title="Verified, not trusted"
          foot="Asserts the feed id matches the bound one — BTC can't be settled against the ETH feed."
        >
          Wormhole guardians attest the update; <span className="font-mono">resolve_with_pyth</span>
          {' '}checks the price is under 60 seconds old, then converts Pyth's signed
          <span className="font-mono"> price · 10^expo</span> into the protocol's WAD final price.
        </Caption>
        <Caption
          t={t} win={[0.82, 0.85, 0.96, 0.995]} num="E / 05" title="One number, on-chain"
          foot="Verified live on Sui testnet — final_price ≈ $63,779.06, tx CBy9CYff…"
        >
          The final price is written and <span className="font-mono">MarketResolved</span> fires.
          Per-position payout is unchanged: a YES at strike x pays $1 per token iff final ≥ x.
          Fully trustless, end to end.
        </Caption>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════
   14 — Secondary market: tradeable Positions via Sui Kiosk
   A pinned scroll story. A held Position is listed in the seller's Kiosk,
   bought through the shared TransferPolicy<Position> (market-open rule), and
   transfers natively to the buyer while SUI flows back.
   ════════════════════════════════════════════════════════════════════════ */

const KIO_LANE_Y = 266
const KIO_SELLER_X = 135
const KIO_KIOSK_X = 420
const KIO_GATE_X = 640
const KIO_BUYER_X = 865

function KioskScroll() {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const t = useSpring(scrollYProgress, { stiffness: 110, damping: 28, restDelta: 0.0001 })

  const cardX = useTransform(t, [0.16, 0.28, 0.66, 0.78], [KIO_SELLER_X, KIO_KIOSK_X, KIO_KIOSK_X, KIO_BUYER_X])
  const cardLeft = useTransform(cardX, (x) => x - 66)
  const cardO = useTransform(t, [0.04, 0.1], [0, 1])

  const kioskO = useTransform(t, [0.16, 0.24], [0, 1])
  const tagO = useTransform(t, [0.2, 0.28, 0.66, 0.72], [0, 1, 1, 0])
  const buyerO = useTransform(t, [0.32, 0.4], [0, 1])
  const buyArrowO = useTransform(t, [0.34, 0.42, 0.62, 0.68], [0, 0.8, 0.8, 0])

  const gateO = useTransform(t, [0.46, 0.54], [0, 1])
  const stampO = useTransform(t, [0.5, 0.58], [0, 1])
  const stampScale = useTransform(t, [0.5, 0.58, 0.64], [0.6, 1.12, 1])

  const suiX = useTransform(t, [0.66, 0.82], [KIO_BUYER_X - 45, KIO_SELLER_X + 45])
  const suiO = useTransform(t, [0.66, 0.7, 0.82, 0.86], [0, 1, 1, 0])
  const soldO = useTransform(t, [0.78, 0.84], [0, 1])
  const recapO = useTransform(t, [0.85, 0.91], [0, 1])
  const recapY = useTransform(t, [0.85, 0.91], [12, 0])

  const phaseText = useTransform(t, (v): string => {
    if (v < 0.16) return 'A — A LOCKED BET'
    if (v < 0.32) return 'B — LIST IT IN A KIOSK'
    if (v < 0.46) return 'C — A BUYER ARRIVES'
    if (v < 0.64) return 'D — THE MARKET-OPEN RULE'
    if (v < 0.84) return 'E — OWNERSHIP TRANSFERS'
    return 'F — FROM BET TO INSTRUMENT'
  })

  return (
    <div ref={ref} className="relative h-[540vh]">
      <div className="sticky top-14 h-[calc(100vh-3.5rem)] overflow-hidden flex items-start justify-center lg:justify-end px-1 lg:pr-12">
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="xMidYMid meet"
          className="w-full max-w-6xl h-[82%] mt-4 px-2"
        >
          {/* seller wallet */}
          <g>
            <rect
              x={KIO_SELLER_X - 65} y={KIO_LANE_Y - 33} width={130} height={66} rx={4}
              fill="var(--bg-surface)" stroke="rgba(62,44,30,0.30)" strokeWidth={1}
            />
            <text
              x={KIO_SELLER_X} y={KIO_LANE_Y + 56} textAnchor="middle"
              fontSize={11} fontFamily="'JetBrains Mono', monospace" fill="var(--text-subtle)"
            >
              SELLER
            </text>
          </g>

          {/* buyer wallet */}
          <motion.g style={{ opacity: buyerO }}>
            <rect
              x={KIO_BUYER_X - 65} y={KIO_LANE_Y - 33} width={130} height={66} rx={4}
              fill="var(--bg-surface)" stroke="rgba(62,44,30,0.30)" strokeWidth={1}
            />
            <text
              x={KIO_BUYER_X} y={KIO_LANE_Y + 56} textAnchor="middle"
              fontSize={11} fontFamily="'JetBrains Mono', monospace" fill="var(--text-subtle)"
            >
              BUYER
            </text>
          </motion.g>

          {/* kiosk display case */}
          <motion.g style={{ opacity: kioskO }}>
            <rect
              x={KIO_KIOSK_X - 78} y={196} width={156} height={150} rx={5}
              fill="none" stroke="rgba(200,16,46,0.4)" strokeWidth={1.5}
            />
            <text
              x={KIO_KIOSK_X} y={336} textAnchor="middle"
              fontSize={10} fontFamily="'JetBrains Mono', monospace" fill="#C8102E"
            >
              KIOSK
            </text>
            {/* price tag */}
            <motion.g style={{ opacity: tagO }}>
              <rect
                x={KIO_KIOSK_X - 52} y={166} width={104} height={24} rx={3}
                fill="rgba(200,16,46,0.10)" stroke="rgba(200,16,46,0.45)" strokeWidth={1}
              />
              <text
                x={KIO_KIOSK_X} y={182} textAnchor="middle"
                fontSize={11} fontFamily="'JetBrains Mono', monospace" fill="#C8102E"
              >
                ask 4.20 SUI
              </text>
            </motion.g>
          </motion.g>

          {/* TransferPolicy gate */}
          <motion.g style={{ opacity: gateO }}>
            <rect
              x={KIO_GATE_X - 54} y={178} width={108} height={184} rx={4}
              fill="rgba(11,122,82,0.06)" stroke="rgba(11,122,82,0.45)" strokeWidth={1}
              strokeDasharray="4 3"
            />
            <text
              x={KIO_GATE_X} y={384} textAnchor="middle"
              fontSize={9.5} fontFamily="'JetBrains Mono', monospace" fill="var(--accent-yes)"
            >
              TransferPolicy
            </text>
            <text
              x={KIO_GATE_X} y={398} textAnchor="middle"
              fontSize={9.5} fontFamily="'JetBrains Mono', monospace" fill="var(--accent-yes)"
            >
              &lt;Position&gt;
            </text>
            {/* stamp */}
            <motion.g style={{ opacity: stampO, scale: stampScale, transformBox: 'fill-box', transformOrigin: 'center' }}>
              <circle cx={KIO_GATE_X} cy={210} r={24} fill="none" stroke="var(--accent-yes)" strokeWidth={2} />
              <text
                x={KIO_GATE_X} y={216} textAnchor="middle"
                fontSize={20} fontFamily="'JetBrains Mono', monospace" fill="var(--accent-yes)"
              >
                ✓
              </text>
              <text
                x={KIO_GATE_X} y={252} textAnchor="middle"
                fontSize={10} fontFamily="'JetBrains Mono', monospace" fill="var(--accent-yes)"
              >
                market-open
              </text>
            </motion.g>
          </motion.g>

          {/* buyer → kiosk intent arrow */}
          <motion.line
            x1={KIO_BUYER_X - 60} x2={KIO_KIOSK_X + 84} y1={KIO_LANE_Y - 50} y2={KIO_LANE_Y - 50}
            style={{ opacity: buyArrowO }}
            stroke="rgba(62,44,30,0.4)" strokeWidth={1} strokeDasharray="3 4"
          />

          {/* the Position card — travels seller → kiosk → buyer */}
          <motion.g style={{ x: cardLeft, opacity: cardO }}>
            <rect
              x={0} y={KIO_LANE_Y - 28} width={132} height={56} rx={4}
              fill="var(--bg-surface)" stroke="var(--accent-yes)" strokeWidth={1.5}
            />
            <text
              x={66} y={KIO_LANE_Y - 6} textAnchor="middle"
              fontSize={12} fontFamily="'JetBrains Mono', monospace" fill="var(--accent-yes)"
            >
              YES @ $3,000
            </text>
            <text
              x={66} y={KIO_LANE_Y + 14} textAnchor="middle"
              fontSize={10} fontFamily="'JetBrains Mono', monospace" fill="var(--text-subtle)"
            >
              Position · 8.4 tok
            </text>
          </motion.g>

          {/* SUI flowing buyer → seller */}
          <motion.g style={{ x: suiX, opacity: suiO }}>
            <circle cx={0} cy={KIO_LANE_Y + 96} r={15} fill="rgba(14,116,144,0.12)" stroke="#0E7490" strokeWidth={1.5} />
            <text x={0} y={KIO_LANE_Y + 100} textAnchor="middle" fontSize={11} fontFamily="'JetBrains Mono', monospace" fill="#0E7490">◎</text>
            <text x={0} y={KIO_LANE_Y + 124} textAnchor="middle" fontSize={10} fontFamily="'JetBrains Mono', monospace" fill="#0E7490">4.20 SUI</text>
          </motion.g>

          {/* sold confirmation */}
          <motion.text
            x={KIO_BUYER_X} y={KIO_LANE_Y - 50} textAnchor="middle"
            style={{ opacity: soldO }}
            fontSize={11} fontFamily="'JetBrains Mono', monospace" fill="var(--accent-yes)"
          >
            owned by buyer ✓
          </motion.text>

          {/* recap — the rule, stated */}
          <motion.g style={{ opacity: recapO, y: recapY }}>
            <text
              x={VB_W / 2} y={508} textAnchor="middle"
              fontSize={12} fontFamily="'JetBrains Mono', monospace" fill="var(--accent-yes)"
            >
              market open → tradeable ✓
            </text>
            <text
              x={VB_W / 2} y={530} textAnchor="middle"
              fontSize={12} fontFamily="'JetBrains Mono', monospace" fill="var(--accent-no)"
            >
              market resolved → listing blocked ✗
            </text>
          </motion.g>
        </svg>

        {/* phase indicator */}
        <div
          className="absolute top-5 left-4 sm:left-10 pointer-events-none rounded px-3.5 py-2.5 border border-[rgba(62,44,30,0.16)]"
          style={{ background: 'rgba(253,248,238,0.94)', boxShadow: '0 6px 20px rgba(62,44,30,0.10)' }}
        >
          <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-[rgba(35,24,18,0.60)]">
            Live · Secondary market
          </p>
          <motion.p className="font-mono text-xs tracking-[0.2em] uppercase text-[#C8102E] mt-1.5">
            {phaseText}
          </motion.p>
        </div>

        {/* scroll progress rail */}
        <div className="absolute right-1.5 sm:right-3 top-[12%] bottom-[12%] w-px bg-[color:var(--border-dim)]">
          <motion.div style={{ scaleY: t, transformOrigin: 'top' }} className="absolute inset-0 bg-[#C8102E]" />
        </div>

        {/* captions */}
        <Caption t={t} win={[0.02, 0.05, 0.14, 0.17]} num="A / 06" title="Stuck until settlement?">
          A Position is an owned object — a YES bet at $3,000. The curve only prices <em>new</em> bets;
          there's no "sell back to the AMM." Without a secondary market you'd be locked in until the
          market closes.
        </Caption>
        <Caption t={t} win={[0.18, 0.21, 0.3, 0.33]} num="B / 06" title="List it in a Kiosk">
          Place the Position in your Sui Kiosk and list it with an ask in SUI. Kiosk is a native Sui
          primitive — a self-custodied on-chain display case — so listing needs no bespoke marketplace
          contract at all.
        </Caption>
        <Caption t={t} win={[0.34, 0.37, 0.44, 0.47]} num="C / 06" title="Anyone can buy">
          The listing is discoverable across every market. A buyer pays the ask directly, pricing a
          specific strike-and-side — a number that can diverge from the curve's current price.
        </Caption>
        <Caption
          t={t} win={[0.5, 0.53, 0.62, 0.65]} num="D / 06" title="Guarded by policy"
          foot="TransferPolicy<Position> — shared at publish, carrying the market-open rule."
        >
          A purchase isn't final until the shared <span className="font-mono">TransferPolicy&lt;Position&gt;</span>
          {' '}confirms it. Its market-open rule means a Position can only change hands while its market is
          still live.
        </Caption>
        <Caption t={t} win={[0.66, 0.69, 0.78, 0.81]} num="E / 06" title="Native settlement">
          The Position transfers to the buyer and SUI flows to the seller — atomically, as owned objects
          move natively. No escrow, no wrapper token, no approval.
        </Caption>
        <Caption
          t={t} win={[0.84, 0.87, 0.96, 0.995]} num="F / 06" title="From bet to instrument"
          foot="A resolved market's positions can no longer be listed — the policy blocks it."
        >
          Positions become liquid: exit early, take profit before close, or post limit-order-like asks on
          a single outcome. Continuum gains an order-book layer the curve never had to grow itself.
        </Caption>
      </div>
    </div>
  )
}

/* ── 15 — Sui: the fast, modular substrate the whole protocol leans on ───── */

const SUI_FEATURES = [
  {
    label: 'Object-centric · parallel',
    body: 'Markets are shared objects; Positions are owned objects. Independent markets touch disjoint state, so Sui executes their transactions in parallel — no global mempool bottleneck.',
  },
  {
    label: 'Move 2024 · generics',
    body: 'Market<phantom T> is generic over the collateral coin. Real testnet USDC drops in with zero token wiring — and there is no ERC-20-style approval step.',
  },
  {
    label: 'Kiosk · TransferPolicy',
    body: 'The entire secondary market is a first-class Sui primitive, not a custom contract — on-chain listing, programmable transfer rules, and safe native transfer come built in.',
  },
  {
    label: 'Sub-second · low fee',
    body: 'Cheap, fast finality makes it affordable to run the full Gaussian engine — erf, exp, sqrt in WAD fixed-point — entirely on-chain, on every single trade.',
  },
  {
    label: 'Clock · on-chain time',
    body: 'The shared 0x6 Clock gates resolves_at and the 24-hour resolution timelock natively — verifiable on-chain time without trusting an external scheduler.',
  },
  {
    label: 'PTBs · atomic flows',
    body: 'Programmable Transaction Blocks chain steps into one signature: refresh a Pyth feed and resolve in a single tx; accept ownership, seed μ/σ, and add liquidity in another.',
  },
]

function SuiHead() {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const shapeY = useTransform(scrollYProgress, [0, 1], [-40, 60])
  const shapeX = useTransform(scrollYProgress, [0, 1], [-30, 30])

  return (
    <div ref={ref} className="relative mb-14 py-6">
      <motion.div
        aria-hidden
        style={{ y: shapeY, x: shapeX }}
        className="absolute left-[1%] top-[6%] w-[40%] h-[74%] bg-[#0E7490] opacity-90 skew-x-[14deg] pointer-events-none"
      />
      <div className="relative">
        <Reveal>
          <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-[#0E7490] mb-4">
            15 / Built on Sui
          </p>
        </Reveal>
        <h2
          className="font-display font-800 tracking-tight leading-[1.02] text-[color:var(--text-primary)]"
          style={{ fontSize: 'clamp(2.4rem, 6vw, 4.6rem)' }}
        >
          <MaskLines
            lines={[
              'Fast where it',
              <span key="l2" className="text-[#0E7490]">counts. Modular</span>,
              'where it matters.',
            ]}
          />
        </h2>
        <Reveal delay={0.2}>
          <p className="font-serif italic text-base mt-5 max-w-xl text-[color:var(--text-muted)]">
            Continuum isn't bolted onto Sui — it's composed from Sui's primitives. Each one removed a
            whole layer we'd have had to build by hand on an EVM chain.
          </p>
        </Reveal>
      </div>
    </div>
  )
}

export default function Docs() {
  return (
    <div className="overflow-x-clip">
      <Hero />
      <ScrollStory />

      {/* ── the protocol in numbers — multi-speed parallax columns ── */}
      <StatsWall />

      {/* ── 07 / TRY IT ── */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 pt-28 pb-8">
        <SectionHead
          num="07 / Try it"
          title="Run your own strike"
          sub="The same CDF the contracts compute on-chain, live under your cursor. Drag the strike across the curve."
        />
        <Playground />
      </section>

      {/* ── 08 / THE MATH ── */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 pt-28 pb-8">
        <SectionHead
          num="08 / The math"
          title="Four formulas, no oracle"
          sub="Everything the protocol believes and charges reduces to these."
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {MATH_PLATES.map((p, i) => (
            <Reveal key={p.label} delay={i * 0.08}>
              <div
                className="border border-[color:var(--border-dim)] rounded p-5 h-full"
                style={{ background: 'var(--bg-surface)' }}
              >
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-[#C8102E] mb-3">
                  {p.label}
                </p>
                <div className="font-mono text-[13px] leading-relaxed whitespace-pre text-[color:var(--text-primary)] overflow-x-auto">
                  {p.lines.map((l) => (
                    <p key={l}>{l}</p>
                  ))}
                </div>
                <p className="font-serif text-sm leading-relaxed mt-4 text-[color:var(--text-muted)]">
                  {p.note}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── 09 / TWO ROLES ── */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 pt-28 pb-8">
        <RolesHead />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Reveal>
            <div
              className="border rounded p-6 h-full border-[rgba(11,122,82,0.3)]"
              style={{ background: 'var(--bg-surface)' }}
            >
              <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-[color:var(--accent-yes)] mb-4">
                Traders
              </p>
              <ol className="space-y-3.5">
                {[
                  'Pick any strike and a side — YES (final ≥ x) or NO (final < x).',
                  'Stake USDC. You pay the probability: cheap when the curve disagrees with you.',
                  'Your stake folds into the curve — your conviction moves μ and σ.',
                  'If reality lands your side of the strike, redeem $1.00 per token.',
                ].map((s, i) => (
                  <li key={s} className="flex gap-3">
                    <span className="font-mono text-xs text-[color:var(--accent-yes)] mt-0.5 flex-shrink-0">
                      0{i + 1}
                    </span>
                    <span className="font-serif text-sm leading-relaxed text-[color:var(--text-muted)]">
                      {s}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </Reveal>
          <Reveal delay={0.1}>
            <div
              className="border rounded p-6 h-full border-[rgba(200,16,46,0.35)]"
              style={{ background: 'var(--bg-surface)' }}
            >
              <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-[#C8102E] mb-4">
                Liquidity providers
              </p>
              <ol className="space-y-3.5">
                {[
                  'Deposit USDC into the single pool; receive non-transferable LP shares.',
                  'Pure collateral underwriting — deposits never shift μ or σ, by construction.',
                  'Earn 1% of every trade across all strikes, pro-rata, claimable anytime.',
                  'After resolution, collateral locked behind losing bets returns to the pool.',
                ].map((s, i) => (
                  <li key={s} className="flex gap-3">
                    <span className="font-mono text-xs text-[#C8102E] mt-0.5 flex-shrink-0">
                      0{i + 1}
                    </span>
                    <span className="font-serif text-sm leading-relaxed text-[color:var(--text-muted)]">
                      {s}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── 10 / RESOLUTION ── */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 pt-28 pb-8">
        <SectionHead
          num="10 / Resolution"
          title="Settling against reality"
          sub="The manual baseline: pull-based claiming, with a timelock between proposal and finality. Two automated paths build on it — Pyth for price markets, an AI oracle for everything else."
        />
        <LifecycleFan />
      </section>

      {/* ── 11 / PYTH — trustless on-chain settlement ── */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 pt-28 pb-4">
        <SectionHead
          num="11 / On-chain settlement"
          title="Price markets settle trustlessly via Pyth"
          sub="A market bound to a Pyth feed needs no owner to resolve it. After it closes, anyone can read the feed on-chain — guarded by Wormhole, fresh to the second — and write the final price. Verified live on Sui testnet. Scroll the pipeline."
        />
      </section>
      <PythScroll />

      {/* ── 12 / AI ORACLE — multi-agent resolution for real-world events ── */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 pt-28 pb-4">
        <SectionHead
          num="12 / AI oracle"
          title="Real-world events, resolved by a panel"
          sub="News, sports, elections — outcomes with no price feed. Continuum runs a multi-agent LLM oracle that gathers evidence, votes with calibrated weights, and knows when to abstain to the timelock — after Kota, arXiv:2605.30802. Scroll the pipeline."
        />
      </section>
      <OracleScroll />

      {/* ── 12½ / FROM THE PAPER ── */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 pt-28 pb-8">
        <SectionHead
          num="12½ / From the paper"
          title="Why a panel, not a feed"
          sub="The design principles behind the AI oracle — each a one-line claim from the paper, mapped to what it buys Continuum."
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {ORACLE_TENETS.map((tn, i) => (
            <Reveal key={tn.label} delay={i * 0.08}>
              <div
                className="border border-[color:var(--border-dim)] rounded p-5 h-full"
                style={{ background: 'var(--bg-surface)' }}
              >
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-[#C8102E] mb-3">
                  {tn.label}
                </p>
                <p className="font-serif italic text-[15px] leading-relaxed text-[color:var(--text-primary)]">
                  {tn.quote}
                </p>
                <p className="font-serif text-sm leading-relaxed mt-3 text-[color:var(--text-muted)]">
                  {tn.note}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={0.2}>
          <p className="font-mono text-[11px] mt-8 text-[color:var(--text-subtle)]">
            Source —{' '}
            <a
              href="https://arxiv.org/pdf/2605.30802"
              target="_blank"
              rel="noreferrer"
              className="text-[#C8102E] hover:underline"
            >
              Kota, “Design and Evaluation of Multi-Agent AI Oracle Systems for Prediction
              Market Resolution” (arXiv:2605.30802)
            </a>
            . Resolution math (Section 1.4) is unchanged — the oracle only ever supplies a
            single <span className="text-[color:var(--text-primary)]">final_price</span>, or
            abstains.
          </p>
        </Reveal>
      </section>

      {/* ── 13 / ARCHITECTURE ── */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 pt-28 pb-8">
        <SectionHead
          num="13 / Architecture"
          title="One Move package, a shared object per market"
          sub="The whole protocol is a single Sui Move package. No proxies, no clones — every market is a shared on-chain object, and the Gaussian engine runs natively for near-zero gas."
        />
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-stretch">
          <Reveal className="md:col-span-2">
            <div className="h-full flex flex-col justify-center space-y-4">
              <p className="font-serif text-[15px] leading-relaxed text-[color:var(--text-muted)]">
                The contract is one <strong className="text-[color:var(--text-primary)]">Sui Move</strong>{' '}
                package. The AMM, Router, LP token, and Factory all collapse into a single{' '}
                <strong className="text-[color:var(--text-primary)]">market</strong> module — Sui has no{' '}
                <code>msg.sender</code> mappings or delegatecall, so there is nothing to proxy.
              </p>
              <p className="font-serif text-[15px] leading-relaxed text-[color:var(--text-muted)]">
                Each market is a shared{' '}
                <strong className="text-[color:var(--text-primary)]">Market&lt;T&gt;</strong> object that
                owns the collateral vault and curve. Bets mint owned{' '}
                <strong className="text-[color:var(--text-primary)]">Position</strong> objects; LPs are{' '}
                rows in a <strong className="text-[color:var(--text-primary)]">Table</strong>, non-transferable
                by construction. Collateral is any <code>Coin&lt;T&gt;</code> — no token wiring, no approvals.
              </p>
            </div>
          </Reveal>
          <Reveal delay={0.12} className="md:col-span-3">
            <div
              className="border border-[color:var(--border-dim)] rounded p-5 font-mono text-xs leading-loose text-[color:var(--text-muted)] overflow-x-auto"
              style={{ background: 'var(--bg-surface)' }}
            >
              <p className="text-[#C8102E]">continuum::market::create_market&lt;T&gt;()</p>
              <p className="pl-3">├─ shares a Market&lt;T&gt; object (collateral vault + curve)</p>
              <p className="pl-3">├─ buy_yes / buy_no ──mint──▶ owned Position objects</p>
              <p className="pl-3">├─ add_liquidity ──▶ LpAccount rows in Table&lt;address&gt;</p>
              <p className="pl-3">├─ registers the market in the shared Registry</p>
              <p className="pl-3">└─ ownership → market creator (two-step)</p>
            </div>
          </Reveal>
        </div>
        <Reveal delay={0.2}>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-8 font-mono text-[10px] tracking-[0.15em] uppercase text-[color:var(--text-subtle)]">
            <span>Sui Move</span>
            <span className="text-[#C8102E]">·</span>
            <span>Shared objects</span>
            <span className="text-[#C8102E]">·</span>
            <span>Generic Coin&lt;T&gt; collateral</span>
            <span className="text-[#C8102E]">·</span>
            <span>WAD fixed-point</span>
            <span className="text-[#C8102E]">·</span>
            <span>MasterChef fees</span>
            <span className="text-[#C8102E]">·</span>
            <span>Non-custodial</span>
          </div>
        </Reveal>
      </section>

      {/* ── 14 / SECONDARY MARKET — Kiosk ── */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 pt-28 pb-4">
        <SectionHead
          num="14 / Secondary market"
          title="Positions are tradeable, via Sui Kiosk"
          sub="A bet doesn't have to be held to settlement. Continuum lists Position objects on Sui's native Kiosk, gated by a shared TransferPolicy — so a YES at $3,000 can change hands while the market is still open. Scroll the trade."
        />
      </section>
      <KioskScroll />

      {/* ── 15 / BUILT ON SUI ── */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 pt-28 pb-8">
        <SuiHead />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {SUI_FEATURES.map((f, i) => (
            <Reveal key={f.label} delay={(i % 3) * 0.08}>
              <div
                className="border border-[color:var(--border-dim)] rounded p-5 h-full"
                style={{ background: 'var(--bg-surface)' }}
              >
                <p className="font-mono text-[10px] tracking-[0.22em] uppercase text-[#0E7490] mb-3">
                  {f.label}
                </p>
                <p className="font-serif text-sm leading-relaxed text-[color:var(--text-muted)]">
                  {f.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={0.16}>
          <div
            className="border border-[color:var(--border-dim)] rounded p-5 mt-4 font-mono text-xs leading-loose text-[color:var(--text-muted)] overflow-x-auto"
            style={{ background: 'var(--bg-surface)' }}
          >
            <p className="text-[#0E7490]">// one signature, all-or-nothing — the modular payoff</p>
            <p className="mt-1.5">PTB ① update_pyth_feed(hermes_vaa) ▸ resolve_with_pyth&lt;T&gt;()</p>
            <p>PTB ② accept_ownership ▸ set_distribution(μ,σ) ▸ add_liquidity&lt;T&gt;()</p>
            <p>PTB ③ kiosk::place ▸ kiosk::list(position, ask)</p>
          </div>
        </Reveal>
      </section>

      {/* ── closing CTA ── */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 pt-28 pb-16">
        <Reveal>
          <div
            className="border border-[color:var(--border-dim)] rounded px-6 py-14 sm:py-16 text-center relative overflow-hidden"
            style={{ background: 'var(--bg-surface)' }}
          >
            <svg
              viewBox="0 0 720 220"
              className="absolute inset-x-0 bottom-0 w-full opacity-[0.15] pointer-events-none"
              preserveAspectRatio="xMidYMax slice"
              fill="none"
            >
              <path d={HERO_CURVE} stroke="#C8102E" strokeWidth={2} />
            </svg>
            <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-[#C8102E] mb-4 relative">
              End of transmission
            </p>
            <h2 className="font-display font-800 text-3xl sm:text-4xl tracking-tight text-[color:var(--text-primary)] relative">
              Ready to price the future?
            </h2>
            <p className="font-serif italic text-base mt-4 max-w-md mx-auto text-[color:var(--text-muted)] relative">
              Continuum is live on Sui testnet — create a market and price any continuous outcome.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center mt-8 relative">
              <Link
                to="/markets"
                className="inline-flex items-center justify-center px-8 py-3.5 bg-[#c8102e] text-white font-display font-700 text-sm tracking-wider rounded hover:bg-[#a5001b] active:scale-[0.98] transition-all"
                style={{ boxShadow: '0 0 28px rgba(200,16,46,0.35)' }}
              >
                Enter Markets →
              </Link>
              <button
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                className="inline-flex items-center justify-center px-8 py-3.5 border border-[color:var(--border)] font-display font-600 text-sm tracking-wider rounded text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:border-[#C8102E] transition-all"
              >
                Replay the story ↑
              </button>
            </div>
          </div>
        </Reveal>
      </section>
    </div>
  )
}
