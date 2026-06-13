import { marketTarget, MARKET_MODULE } from '@omnicurve/types'

/**
 * On-chain references for the published `continuum` Move package (Sui edition).
 *
 * The old EVM build imported ABIs and proxy addresses here. On Sui there are no
 * ABIs — callers build PTBs against fully-qualified `package::module::function`
 * targets and read shared objects by id. These come from env (with the live
 * testnet deployment as the fallback) so a redeploy only needs new env values.
 */
export const PACKAGE_ID =
  (import.meta.env.VITE_PACKAGE_ID as string) ??
  '0x8c80c6ea53152d99206fccf8b1fb18a302ea9acf68f19e0fd5664bb0339ac599'

export const REGISTRY_ID =
  (import.meta.env.VITE_REGISTRY_ID as string) ??
  '0x2080474707e00e222decf87a8a544a9bcfbe3295facaf39bc6bc900887609e1c'

export const COLLATERAL_TYPE =
  (import.meta.env.VITE_COLLATERAL_TYPE as string) ??
  `${PACKAGE_ID}::mock_usdc::MOCK_USDC`

/** The shared `Clock` object — required by every resolution entry function. */
export const CLOCK_ID = '0x6'

/** Build a `package::market::<name>` Move-call target. */
export const target = (name: string) => marketTarget(PACKAGE_ID, name)

export { MARKET_MODULE }
