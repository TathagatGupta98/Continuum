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
  '0x76ab321b6eebc96d730897da0360a650f9b0449128b3961014b20064c7ef7549'

export const REGISTRY_ID =
  (import.meta.env.VITE_REGISTRY_ID as string) ??
  '0xbc9655167e9a4b605dac143bf6153f9532e5dd2ebf70eecf51613c1e13138b23'

// Circle's official testnet USDC — anyone can fund it via faucet.circle.com or
// `sui client faucet --coin-type usdc`, no protocol-controlled mint required.
export const COLLATERAL_TYPE =
  (import.meta.env.VITE_COLLATERAL_TYPE as string) ??
  '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC'

/** The shared `Clock` object — required by every resolution entry function. */
export const CLOCK_ID = '0x6'

/** Build a `package::market::<name>` Move-call target. */
export const target = (name: string) => marketTarget(PACKAGE_ID, name)

export { MARKET_MODULE }
