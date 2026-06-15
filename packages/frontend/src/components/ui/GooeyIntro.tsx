import { useEffect, useRef, useState } from 'react'

const TEXTS = ['Every outcome.', 'One curve.', 'OmniCurve']

const MORPH_TIME = 1.0   // seconds spent morphing between two texts
const COOLDOWN_TIME = 0.5 // seconds a text holds steady
const FINAL_HOLD = 1.0    // how long the last word stays before the reveal

interface GooeyIntroProps {
  onDone: () => void
}

/**
 * First-visit landing intro — SVG-threshold "gooey" text morphing
 * (blur + alpha-contrast technique). Words melt into each other,
 * ending on the wordmark, then the overlay melts away to reveal the hero.
 */
export function GooeyIntro({ onDone }: GooeyIntroProps) {
  const text1Ref = useRef<HTMLSpanElement>(null)
  const text2Ref = useRef<HTMLSpanElement>(null)
  const doneRef = useRef(false)
  const [leaving, setLeaving] = useState(false)

  // Stable across re-renders; onDone is captured once on mount intentionally.
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    const text1 = text1Ref.current
    const text2 = text2Ref.current
    if (!text1 || !text2) return

    let textIndex = 0
    let morph = 0
    let cooldown = COOLDOWN_TIME
    let lastTime = performance.now()
    let holdTimer = 0
    let rafId = 0

    text1.textContent = TEXTS[0]
    text2.textContent = TEXTS[1]
    text1.style.opacity = '100%'
    text2.style.opacity = '0%'

    const setMorph = (fraction: number) => {
      text2.style.filter = `blur(${Math.min(8 / fraction - 8, 100)}px)`
      text2.style.opacity = `${Math.pow(fraction, 0.4) * 100}%`
      const inv = 1 - fraction
      text1.style.filter = `blur(${Math.min(8 / inv - 8, 100)}px)`
      text1.style.opacity = `${Math.pow(inv, 0.4) * 100}%`
    }

    const finish = () => {
      if (doneRef.current) return
      doneRef.current = true
      setLeaving(true)
      // let the exit transition play before unmounting
      window.setTimeout(() => onDoneRef.current(), 700)
    }

    const frame = (now: number) => {
      const dt = (now - lastTime) / 1000
      lastTime = now

      const onLastText = textIndex >= TEXTS.length - 1

      if (onLastText && morph === 0) {
        // final word fully settled — hold, then leave
        holdTimer += dt
        if (holdTimer >= FINAL_HOLD) {
          finish()
          return
        }
      } else {
        cooldown -= dt
        if (cooldown <= 0) {
          if (morph === 0) {
            // beginning a new morph: advance the pair
            text1.textContent = TEXTS[textIndex]
            text2.textContent = TEXTS[textIndex + 1]
          }
          morph -= cooldown
          cooldown = 0
          let fraction = morph / MORPH_TIME
          if (fraction >= 1) {
            cooldown = COOLDOWN_TIME
            fraction = 1
            morph = 0
            textIndex++
            // settle cleanly on the new text
            text1.textContent = TEXTS[Math.min(textIndex, TEXTS.length - 1)]
            text1.style.filter = ''
            text1.style.opacity = '100%'
            text2.style.filter = ''
            text2.style.opacity = '0%'
          } else {
            setMorph(fraction)
          }
        }
      }

      rafId = requestAnimationFrame(frame)
    }

    rafId = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(rafId)
  }, [])

  const skip = () => {
    if (doneRef.current) return
    doneRef.current = true
    setLeaving(true)
    window.setTimeout(() => onDoneRef.current(), 450)
  }

  return (
    <div
      onClick={skip}
      className="fixed inset-0 z-[100] flex items-center justify-center cursor-pointer select-none"
      style={{
        backgroundColor: '#F4EEE1',
        backgroundImage:
          'linear-gradient(rgba(62,44,30,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(62,44,30,0.06) 1px, transparent 1px)',
        backgroundSize: '40px 40px',
        opacity: leaving ? 0 : 1,
        transform: leaving ? 'scale(1.04)' : 'scale(1)',
        transition: 'opacity 0.65s ease, transform 0.65s ease',
        pointerEvents: leaving ? 'none' : 'auto',
      }}
    >
      {/* alpha-threshold filter that makes the blurred texts "gooey" */}
      <svg className="absolute w-0 h-0" aria-hidden="true">
        <defs>
          <filter id="gooey-threshold">
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="1 0 0 0 0
                      0 1 0 0 0
                      0 0 1 0 0
                      0 0 0 255 -140"
            />
          </filter>
        </defs>
      </svg>

      <div
        className="relative w-full text-center px-6"
        style={{ filter: 'url(#gooey-threshold)', height: '14rem' }}
      >
        <span
          ref={text1Ref}
          className="absolute inset-x-0 font-display font-800 tracking-tight text-[#C8102E]"
          style={{ fontSize: 'clamp(2.4rem, 7vw, 6rem)', top: '50%', transform: 'translateY(-50%)' }}
        />
        <span
          ref={text2Ref}
          className="absolute inset-x-0 font-display font-800 tracking-tight text-[#C8102E]"
          style={{ fontSize: 'clamp(2.4rem, 7vw, 6rem)', top: '50%', transform: 'translateY(-50%)' }}
        />
      </div>

      <p className="absolute bottom-10 font-mono text-[10px] tracking-[0.35em] uppercase text-[rgba(35,24,18,0.45)]">
        Click to skip
      </p>
    </div>
  )
}
