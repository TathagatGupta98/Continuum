import { getFullnodeUrl } from '@mysten/sui/client'
import { createNetworkConfig } from '@mysten/dapp-kit'

/**
 * Sui network configuration (replaces the old wagmi/Arbitrum config).
 *
 * Continuum is deployed to Sui testnet. `dapp-kit`'s `SuiClientProvider` is fed
 * the `networkConfig` below; the active network is chosen by `VITE_SUI_NETWORK`
 * (defaults to testnet). The published `continuum` package id, the shared
 * `Registry` object id, and the collateral coin type `T` come from env so the
 * frontend, backend indexer, and Move package all agree on one source of truth.
 */
export type SuiNetwork = 'testnet' | 'mainnet' | 'devnet' | 'localnet'

export const SUI_NETWORK = ((import.meta.env.VITE_SUI_NETWORK as string) ?? 'testnet') as SuiNetwork

const { networkConfig } = createNetworkConfig({
  localnet: { url: getFullnodeUrl('localnet') },
  devnet: { url: getFullnodeUrl('devnet') },
  testnet: { url: getFullnodeUrl('testnet') },
  mainnet: { url: getFullnodeUrl('mainnet') },
})

export { networkConfig }

/** SuiVision explorer base for the active network. */
export function explorerUrl(kind: 'txblock' | 'object' | 'account', id: string): string {
  const net = SUI_NETWORK === 'mainnet' ? '' : `${SUI_NETWORK}.`
  return `https://${net}suivision.xyz/${kind}/${id}`
}
