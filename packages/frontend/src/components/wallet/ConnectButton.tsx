import { useState } from 'react'
import { ConnectModal, useCurrentAccount, useDisconnectWallet } from '@mysten/dapp-kit'
import { Button } from '@/components/ui/Button'
import { shortAddr } from '@/lib/math'

/**
 * Wallet connect control (Sui edition — replaces the RainbowKit button).
 *
 * Disconnected: opens dapp-kit's `ConnectModal` to pick a Sui wallet.
 * Connected: shows the active address; clicking disconnects.
 */
export function ConnectButton() {
  const account = useCurrentAccount()
  const { mutate: disconnect } = useDisconnectWallet()
  const [open, setOpen] = useState(false)

  if (!account) {
    return (
      <ConnectModal
        open={open}
        onOpenChange={setOpen}
        trigger={
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            Connect Wallet
          </Button>
        }
      />
    )
  }

  return (
    <button
      onClick={() => disconnect()}
      title="Click to disconnect"
      className="flex items-center gap-2 px-3 py-2 rounded border border-[rgba(62,44,30,0.08)] bg-[rgba(62,44,30,0.04)] hover:bg-[rgba(62,44,30,0.07)] transition-colors text-sm"
    >
      <span className="w-2 h-2 rounded-full bg-[#0B7A52]" />
      <span className="font-mono text-[#231812] text-xs">{shortAddr(account.address)}</span>
    </button>
  )
}
