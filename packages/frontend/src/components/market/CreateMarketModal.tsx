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
  sigmaMin: z.coerce.number().positive('Must be greater than 0'),
})

type FormValues = z.infer<typeof schema>

interface CreateMarketModalProps {
  open: boolean
  onClose: () => void
}

export function CreateMarketModal({ open, onClose }: CreateMarketModalProps) {
  const { step, create, reset, error } = useCreateMarket()

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { category: 'Crypto', sigmaMin: 1000 },
  })

  const isSubmitting = step === 'submitting'

  const onSubmit = async (data: FormValues) => {
    await create(data.sigmaMin, { title: data.title, category: data.category })
  }

  const handleClose = () => {
    reset()
    onClose()
  }

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
            placeholder="1000"
            error={errors.sigmaMin?.message}
            {...register('sigmaMin')}
          />
          <p className="text-xs font-mono text-[rgba(35,24,18,0.35)] -mt-2">
            Minimum standard deviation — prevents LP from setting unrealistically tight distributions.
          </p>

          {error && (
            <p
              className={`text-xs font-mono rounded p-3 border ${
                isUserRejection(error)
                  ? 'text-[rgba(35,24,18,0.6)] bg-[rgba(62,44,30,0.03)] border-[rgba(62,44,30,0.1)]'
                  : 'text-[#B42318] bg-[rgba(180,35,24,0.08)] border-[rgba(180,35,24,0.2)]'
              }`}
            >
              {formatTxError(error)}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="muted" onClick={handleClose} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={isSubmitting} className="flex-1">
              Deploy Market
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
