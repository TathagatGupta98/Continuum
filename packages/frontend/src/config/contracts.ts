import { marketTarget, positionMarketTarget, MARKET_MODULE } from '@continuum/types'

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
  '0x2863e293480bbe7acaaea17839492ff4f887f4eca0008f8331ec3fc15b397b31'

export const REGISTRY_ID =
  (import.meta.env.VITE_REGISTRY_ID as string) ??
  '0xb17e6ec492a09bbff6f08fa74e950e3c4580e4ccf6bb11769f39acd38132bcdd'

// Circle's official testnet USDC — anyone can fund it via faucet.circle.com or
// `sui client faucet --coin-type usdc`, no protocol-controlled mint required.
export const COLLATERAL_TYPE =
  (import.meta.env.VITE_COLLATERAL_TYPE as string) ??
  '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC'

/** The shared `Clock` object — required by every resolution entry function. */
export const CLOCK_ID = '0x6'

/**
 * The shared `TransferPolicy<Position>` created at publish by
 * `position_market::init`. Required to confirm a Kiosk purchase of a `Position`
 * (it carries the market-open rule). The fallback is the live testnet policy;
 * override with `VITE_TRANSFER_POLICY_ID` on a redeploy.
 */
export const TRANSFER_POLICY_ID =
  (import.meta.env.VITE_TRANSFER_POLICY_ID as string) ??
  '0x3f5a208082982f916c2c37ceb4403f8be0347f18fce5c240c1b8d2aa5aa2dd93'

/** Sui framework Kiosk module + the canonical types we reference in PTBs. */
export const KIOSK_TYPE = '0x2::kiosk::Kiosk'
export const SUI_COIN_TYPE = '0x2::sui::SUI'
export const kioskTarget = (name: string) => `0x2::kiosk::${name}` as const

/** Build a `package::market::<name>` Move-call target. */
export const target = (name: string) => marketTarget(PACKAGE_ID, name)

/** Build a `package::position_market::<name>` Move-call target. */
export const positionTarget = (name: string) => positionMarketTarget(PACKAGE_ID, name)

export { MARKET_MODULE }
