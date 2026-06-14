/**
 * Turn a raw Sui wallet / transaction error into a short, human message.
 *
 * Two problems this solves:
 *  1. A user clicking "reject" in their wallet is NOT an error — we detect it and
 *     show a calm one-liner (callers can style it neutrally via `isUserRejection`).
 *  2. Move aborts surface as opaque `MoveAbort(... , <code>)` strings. We map the
 *     known abort codes from `continuum::market` to plain English.
 */

// Move abort codes emitted by `continuum::market` → friendly copy.
// Keyed by the `E*` constant value in market.move.
const KNOWN_ABORTS: Record<number, string> = {
  0: 'Your wallet is not authorized to perform this action.',
  1: 'The curve is locked — trading has already started.',
  2: 'Sigma is below the market minimum.',
  3: 'Enter an amount greater than zero.',
  4: 'Price rounds to zero at this strike — pick a strike closer to μ.',
  5: 'Stake is too small to mint any tokens.',
  6: 'Not enough liquidity in the pool to back this trade.',
  7: 'You are trying to withdraw more LP shares than you hold.',
  8: 'This market has not been resolved yet.',
  9: 'This market is already resolved.',
  10: 'This position did not win.',
  11: 'You have no winning tokens to claim here.',
  12: 'This position belongs to a different market.',
  13: 'That position won — losing collateral can only be released for losers.',
  14: 'Prior weight must be positive.',
  15: 'A resolution has already been proposed for this market.',
  16: 'No resolution has been proposed yet.',
  17: 'The resolution timelock is still active — try again after the window elapses.',
  18: 'The market has not reached its scheduled close time yet.',
  19: 'Invalid resolution time — it must be in the future.',
}

/** True when the failure is the user declining the signature in their wallet. */
export function isUserRejection(error: unknown): boolean {
  if (!error) return false
  const e = error as { code?: number | string; name?: string; message?: string }
  if (e.code === 4001) return true
  if (e.name === 'UserRejectedRequestError') return true
  const msg = `${e.name ?? ''} ${e.message ?? ''}`
  return /user rejected|user denied|rejected (the|from) (the )?request|rejection|cancel(l)?ed/i.test(msg)
}

/**
 * Extract the abort code from a Sui Move abort error message.
 * Sui surfaces aborts as e.g. `MoveAbort(MoveLocation { ... }, 6)` or
 * `... , function: 12, ... }, 6)`. The last integer in the abort tuple is the code.
 */
function extractAbortCode(error: unknown): number | null {
  const e = error as { message?: string }
  const msg = e?.message ?? String(error)
  // Match `MoveAbort(<location>, <code>)` — the code is the trailing integer.
  const m = msg.match(/MoveAbort\([\s\S]*?,\s*(\d+)\s*\)/)
  if (m) return Number(m[1])
  return null
}

/** Concise, user-facing message for any wallet / transaction error. */
export function formatTxError(error: unknown): string {
  if (!error) return 'Transaction failed.'
  if (isUserRejection(error)) return 'Transaction rejected in your wallet.'

  const e = error as { message?: string }
  const haystack = e.message ?? String(error)

  // Map a known Move abort to friendly copy.
  const code = extractAbortCode(error)
  if (code !== null && KNOWN_ABORTS[code]) return KNOWN_ABORTS[code]

  // Transient RPC / network failures — nothing failed on-chain.
  if (/429|rate limit|too many request/i.test(haystack)) {
    return 'The RPC node is rate-limiting requests — nothing failed on-chain. Wait a few seconds and try again.'
  }
  if (/fetch failed|timeout|network error|ECONNRESET|Failed to fetch/i.test(haystack)) {
    return 'Network hiccup talking to the Sui RPC node — your funds are safe. Try again.'
  }
  if (/insufficient.*gas|GasBalanceTooLow|No valid gas coins/i.test(haystack)) {
    return 'Not enough SUI to pay for gas — top up your wallet and try again.'
  }
  if (/No valid coins|insufficient.*balance|InsufficientCoinBalance/i.test(haystack)) {
    return 'Insufficient USDC balance for this transaction.'
  }

  const concise = haystack.split('\n')[0].trim()
  return concise.length > 160 ? `${concise.slice(0, 157)}…` : concise
}
