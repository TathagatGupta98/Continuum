import { Slider } from '@/components/ui/Slider'
import { Input } from '@/components/ui/Input'
import { pYes, pNo } from '@/lib/math'

interface StrikeSliderProps {
  value: number
  min: number
  max: number
  mu: number
  sigma: number
  onChange: (v: number) => void
}

export function StrikeSlider({ value, min, max, mu, sigma, onChange }: StrikeSliderProps) {
  const py = pYes(value, mu, sigma)
  const pn = pNo(value, mu, sigma)

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3">
        <div className="flex-1">
          {/* Typed strikes are unrestricted (any price ≥ 0) — only the slider
              below is windowed to μ ± 3σ for comfortable dragging. */}
          <Input
            label="Strike Price"
            type="number"
            value={value}
            min={0}
            onChange={(e) => {
              const v = parseFloat(e.target.value)
              if (!isNaN(v)) onChange(Math.max(0, v))
            }}
            step={sigma / 10}
          />
        </div>
        <div className="flex gap-3 pb-2.5 text-xs font-mono">
          <span>
            <span className="text-[rgba(11,122,82,0.6)] text-[10px] uppercase tracking-wider">YES </span>
            <span className="text-[#0B7A52]">{(py * 100).toFixed(1)}%</span>
          </span>
          <span>
            <span className="text-[rgba(180,35,24,0.6)] text-[10px] uppercase tracking-wider">NO </span>
            <span className="text-[#B42318]">{(pn * 100).toFixed(1)}%</span>
          </span>
        </div>
      </div>
      <Slider
        value={value}
        min={min}
        max={max}
        step={(max - min) / 500}
        onChange={onChange}
      />
      <div className="flex justify-between text-[10px] font-mono text-[rgba(35,24,18,0.45)]">
        <span>{min.toLocaleString()}</span>
        <span>μ = {mu.toLocaleString()}</span>
        <span>{max.toLocaleString()}</span>
      </div>
    </div>
  )
}
