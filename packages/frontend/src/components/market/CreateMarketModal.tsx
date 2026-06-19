import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useCreateMarket } from '@/hooks/useCreateMarket'
import { formatTxError, isUserRejection } from '@/lib/errors'

const schema = z.object({
  title: z.string().min(4, 'Title must be at least 4 characters'),
  category: z.enum(['Crypto', 'Macro', 'Sports', 'Other']),
  // Any sigma is allowed — the only hard constraint is that the on-chain
  // `sigma_min_mag` is an unsigned magnitude, so it can't be negative.
  sigmaMin: z.coerce
    .number({ invalid_type_error: 'Enter a number' })
    .nonnegative('Sigma cannot be negative'),
  resolvesAt: z
    .string()
    .min(1, 'Resolution time is required')
    .refine((v) => {
      const t = new Date(v).getTime()
      return Number.isFinite(t) && t > Date.now()
    }, 'Resolution time must be in the future'),
})

type FormValues = z.infer<typeof schema>

/** Format a Date as a `datetime-local` value (`YYYY-MM-DDTHH:mm`) in local time. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

// Sensible default: 30 days out, and the earliest selectable time is now.
const DEFAULT_RESOLVES_AT = toLocalInput(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
const MIN_RESOLVES_AT = toLocalInput(new Date())

interface CreateMarketModalProps {
  open: boolean
  onClose: () => void
}

export function CreateMarketModal({ open, onClose }: CreateMarketModalProps) {
  const { step, create, reset, error } = useCreateMarket()
  // When set, we show the read-only review screen instead of the form, so the
  // user can confirm or go back and edit before the transaction is signed.
  const [review, setReview] = useState<FormValues | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { category: 'Crypto', sigmaMin: 1000, resolvesAt: DEFAULT_RESOLVES_AT },
  })

  const isSubmitting = step === 'submitting'

  // Step 1: validate the form, then move to the review screen (no tx yet).
  const onSubmit = (data: FormValues) => {
    reset()
    setReview(data)
  }

  // Step 2: the user confirmed on the review screen — fire the transaction.
  const onConfirm = async () => {
    if (!review) return
    await create(review.sigmaMin, new Date(review.resolvesAt).getTime(), {
      title: review.title,
      category: review.category,
    })
  }

  const handleClose = () => {
    reset()
    setReview(null)
    onClose()
  }

  const renderError = () =>
    error && (
      <p
        className={`text-xs font-mono rounded p-3 border ${
          isUserRejection(error)
            ? 'text-[rgba(35,24,18,0.6)] bg-[rgba(62,44,30,0.03)] border-[rgba(62,44,30,0.1)]'
            : 'text-[#B42318] bg-[rgba(180,35,24,0.08)] border-[rgba(180,35,24,0.2)]'
        }`}
      >
        {formatTxError(error)}
      </p>
    )

  return (
    <Modal open={open} onClose={handleClose} title="Create Market">
      {step === 'confirmed' ? (
        <div className="text-center space-y-4 py-4">
          <div className="w-12 h-12 rounded-full bg-[rgba(11,122,82,0.12)] border border-[rgba(11,122,82,0.3)] flex items-center justify-center mx-auto">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M4 10l5 5 7-8" stroke="#0B7A52" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div>
            <p className="font-display font-600 text-[#231812] mb-1">Market Created!</p>
            <p className="text-xs font-mono text-[rgba(35,24,18,0.45)]">
              Your market is live. You&apos;ll be redirected shortly.
            </p>
          </div>
        </div>
      ) : review ? (
        <div className="space-y-4">
          <p className="text-xs font-mono text-[rgba(35,24,18,0.55)]">
            Review your market parameters. Sigma and the resolution time are fixed at creation —
            go back to change anything before you deploy.
          </p>

          <div className="rounded border border-[rgba(62,44,30,0.1)] bg-[rgba(62,44,30,0.03)] divide-y divide-[rgba(62,44,30,0.08)]">
            <ReviewRow label="Title" value={review.title} />
            <ReviewRow label="Category" value={review.category} />
            <ReviewRow label="Minimum σ" value={String(review.sigmaMin)} mono />
            <ReviewRow
              label="Resolution Time"
              value={new Date(review.resolvesAt).toLocaleString()}
              mono
            />
          </div>

          {renderError()}

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="muted"
              onClick={() => setReview(null)}
              disabled={isSubmitting}
              className="flex-1"
            >
              Go Back
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={isSubmitting}
              onClick={onConfirm}
              className="flex-1"
            >
              Confirm &amp; Create
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Input
            label="Market Title"
            placeholder="Will BTC exceed $150k by end of 2025?"
            error={errors.title?.message}
            {...register('title')}
          />

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-display tracking-wider text-[rgba(35,24,18,0.45)] uppercase">
              Category
            </label>
            <select
              className="bg-[rgba(62,44,30,0.04)] border border-[rgba(62,44,30,0.08)] text-[#231812] text-sm rounded py-2.5 px-3 focus:outline-none focus:border-[rgba(200,16,46,0.5)] transition-colors"
              {...register('category')}
            >
              <option value="Crypto">Crypto</option>
              <option value="Macro">Macro</option>
              <option value="Sports">Sports</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <Input
            label="Minimum σ (Sigma)"
            type="number"
            step="any"
            placeholder="1000"
            error={errors.sigmaMin?.message}
            {...register('sigmaMin')}
          />
          <p className="text-xs font-mono text-[rgba(35,24,18,0.35)] -mt-2">
            Minimum standard deviation — prevents LP from setting unrealistically tight distributions.
          </p>

          <Input
            label="Resolution Time"
            type="datetime-local"
            min={MIN_RESOLVES_AT}
            error={errors.resolvesAt?.message}
            {...register('resolvesAt')}
          />
          <p className="text-xs font-mono text-[rgba(35,24,18,0.35)] -mt-2">
            Scheduled close — resolution functions can only be called after this time. Fixed at
            creation and cannot be changed later.
          </p>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="muted" onClick={handleClose} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" variant="primary" className="flex-1">
              Review
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}

function ReviewRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2.5">
      <span className="text-xs font-display tracking-wider text-[rgba(35,24,18,0.45)] uppercase shrink-0">
        {label}
      </span>
      <span
        className={`text-sm text-[#231812] text-right break-words ${
          mono ? 'font-mono' : 'font-display'
        }`}
      >
        {value}
      </span>
    </div>
  )
}
