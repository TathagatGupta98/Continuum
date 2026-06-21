import { Link } from 'react-router-dom'
import { useCurrentAccount, useCurrentWallet } from '@mysten/dapp-kit'
import { usePortfolio } from '@/hooks/usePortfolio'
import { useTheme } from '@/hooks/useTheme'
import { Badge } from '@/components/ui/Badge'
import { ConnectButton } from '@/components/wallet/ConnectButton'

const DARK = {
  walletCard:      'bg-[rgba(10,10,10,0.55)] backdrop-blur-md border-[rgba(255,255,255,0.10)]',
  walletLabel:     'text-[rgba(242,242,242,0.35)]',
  walletAddress:   'text-[#F2F2F2]',
  walletValue:     'text-[#C8102E]',
  sectionHeading:  'text-[#F2F2F2]',
  skeleton:        'bg-[rgba(10,10,10,0.50)]',
  emptyBorder:     'border-[rgba(255,255,255,0.08)]',
  emptyText:       'text-[rgba(242,242,242,0.35)]',
  emptyLink:       'text-[#C8102E]',
  tableBorder:     'border-[rgba(255,255,255,0.10)]',
  tableHead:       'border-[rgba(255,255,255,0.08)] bg-[rgba(62,44,30,0.35)]',
  tableHeadTxt:    'text-[rgba(242,242,242,0.35)]',
  tableRow:        'border-[rgba(255,255,255,0.05)] hover:bg-[rgba(253,248,238,0.04)]',
  cellLink:        'text-[#F2F2F2] hover:text-[#C8102E]',
  cellMuted:       'text-[rgba(242,242,242,0.6)]',
  cellData:        'text-[#C8102E]',
  tableWrap:       'bg-[rgba(10,10,10,0.50)] backdrop-blur-md',
  emptyWrap:       'bg-[rgba(10,10,10,0.40)] backdrop-blur-md',
} as const

const LIGHT = {
  walletCard:      'bg-[rgba(253,248,238,0.45)] backdrop-blur-md border-[rgba(62,44,30,0.10)]',
  walletLabel:     'text-[rgba(35,24,18,0.38)]',
  walletAddress:   'text-[#231812]',
  walletValue:     'text-[#C8102E]',
  sectionHeading:  'text-[#231812]',
  skeleton:        'bg-[rgba(253,248,238,0.40)]',
  emptyBorder:     'border-[rgba(62,44,30,0.12)]',
  emptyText:       'text-[rgba(35,24,18,0.38)]',
  emptyLink:       'text-[#C8102E]',
  tableBorder:     'border-[rgba(62,44,30,0.12)]',
  tableHead:       'border-[rgba(62,44,30,0.10)] bg-[rgba(253,248,238,0.30)]',
  tableHeadTxt:    'text-[rgba(35,24,18,0.38)]',
  tableRow:        'border-[rgba(62,44,30,0.06)] hover:bg-[rgba(253,248,238,0.25)]',
  cellLink:        'text-[#231812] hover:text-[#C8102E]',
  cellMuted:       'text-[rgba(35,24,18,0.6)]',
  cellData:        'text-[#C8102E]',
  tableWrap:       'bg-[rgba(253,248,238,0.40)] backdrop-blur-md',
  emptyWrap:       'bg-[rgba(253,248,238,0.30)] backdrop-blur-md',
} as const

export default function UserDashboard() {
  // connectionStatus is 'connecting' while dapp-kit restores the autoconnect
  // session — show skeletons until it settles so a connected wallet doesn't
  // flash the connect prompt before reconnection finishes.
  const address = useCurrentAccount()?.address
  const { connectionStatus } = useCurrentWallet()
  const { isDark } = useTheme()
  const T = isDark ? DARK : LIGHT
  const { data: portfolio, isLoading } = usePortfolio(address)

  if (!address && connectionStatus === 'connecting') {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className={`h-20 rounded animate-pulse transition-colors duration-300 ${T.skeleton}`} />
        ))}
      </div>
    )
  }

  if (!address) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <div className={`flex flex-col items-center gap-4 text-center py-20 border rounded transition-colors duration-300 ${T.emptyBorder} ${T.emptyWrap}`}>
          <p className={`font-mono text-sm transition-colors duration-300 ${T.emptyText}`}>
            Wallet not connected — connect your wallet to see your positions
          </p>
          <ConnectButton />
        </div>
      </div>
    )
  }

  const positions = portfolio?.positions ?? []
  const lpPositions = portfolio?.lpPositions ?? []
  const totalValue = portfolio?.totalValue ?? 0

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-10">
      {/* Wallet card */}
      <div className={`flex items-center justify-between p-6 border rounded transition-colors duration-300 ${T.walletCard}`}>
        <div>
          <p className={`text-xs font-display tracking-widest uppercase mb-1 transition-colors duration-300 ${T.walletLabel}`}>
            Wallet
          </p>
          <p className={`font-mono text-sm transition-colors duration-300 ${T.walletAddress}`}>{address}</p>
        </div>
        <div className="text-right">
          <p className={`text-xs font-display tracking-widest uppercase mb-1 transition-colors duration-300 ${T.walletLabel}`}>
            Portfolio Value
          </p>
          <p className={`font-mono text-2xl transition-colors duration-300 ${T.walletValue}`}>
            ${totalValue.toFixed(2)}
          </p>
        </div>
      </div>

      {/* Positions table */}
      <section>
        <h2 className={`font-display font-700 text-lg mb-4 transition-colors duration-300 ${T.sectionHeading}`}>Open Positions</h2>
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className={`h-14 rounded animate-pulse transition-colors duration-300 ${T.skeleton}`} />
            ))}
          </div>
        ) : positions.length === 0 ? (
          <div className={`text-center py-12 border rounded transition-colors duration-300 ${T.emptyBorder} ${T.emptyWrap}`}>
            <p className={`font-mono text-sm transition-colors duration-300 ${T.emptyText}`}>No open positions</p>
            <Link
              to="/markets"
              className={`inline-block mt-3 text-xs font-mono hover:underline transition-colors duration-200 ${T.emptyLink}`}
            >
              Explore Markets →
            </Link>
          </div>
        ) : (
          <div className={`border rounded overflow-hidden transition-colors duration-300 ${T.tableBorder} ${T.tableWrap}`}>
            <table className="w-full text-sm">
              <thead>
                <tr className={`border-b transition-colors duration-300 ${T.tableHead}`}>
                  {['Market', 'Direction', 'Strike', 'Tokens', 'Stake', 'Value', 'P&L', 'Result'].map((h) => (
                    <th
                      key={h}
                      className={`px-4 py-3 text-left text-[10px] font-display tracking-widest uppercase transition-colors duration-300 ${T.tableHeadTxt}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => {
                  const stakeUsd = pos.stakeAmount / 1e6
                  // P&L: realized once resolved (value − stake), unrealized while
                  // active. A loser's value is 0, so P&L = −stake.
                  const pnl = pos.currentValue - stakeUsd
                  const pnlUp = pnl >= 0
                  return (
                  <tr
                    key={pos.positionId}
                    className={`border-b transition-colors duration-200 ${T.tableRow}`}
                  >
                    <td className="px-4 py-3">
                      <Link
                        to={`/markets/${pos.marketId}`}
                        className={`font-display text-xs line-clamp-1 transition-colors duration-200 ${T.cellLink}`}
                      >
                        {pos.market?.title ?? `#${pos.marketId}`}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={pos.direction === 'ABOVE' ? 'yes' : 'no'}>
                        {pos.direction === 'ABOVE' ? 'YES' : 'NO'}
                      </Badge>
                    </td>
                    <td className={`px-4 py-3 font-mono text-xs transition-colors duration-300 ${T.cellMuted}`}>
                      {pos.targetValueX.toLocaleString()}
                    </td>
                    <td className={`px-4 py-3 font-mono text-xs transition-colors duration-300 ${T.cellMuted}`}>
                      {pos.tokensMinted.toFixed(2)}
                    </td>
                    <td className={`px-4 py-3 font-mono text-xs transition-colors duration-300 ${T.cellMuted}`}>
                      ${stakeUsd.toFixed(2)}
                    </td>
                    <td className={`px-4 py-3 font-mono text-xs transition-colors duration-300 ${T.cellData}`}>
                      ${pos.currentValue.toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`font-mono text-xs ${pnlUp ? 'text-[#0B7A52]' : 'text-[#B42318]'}`}>
                        {pnlUp ? '+' : '−'}${Math.abs(pnl).toFixed(2)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {pos.status === 'won' ? (
                        <Badge variant="yes">WON</Badge>
                      ) : pos.status === 'lost' ? (
                        <Badge variant="no">LOST</Badge>
                      ) : (
                        <Badge variant="live">Active</Badge>
                      )}
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* LP Positions table */}
      <section>
        <h2 className={`font-display font-700 text-lg mb-4 transition-colors duration-300 ${T.sectionHeading}`}>Liquidity Positions</h2>
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(2)].map((_, i) => (
              <div key={i} className={`h-14 rounded animate-pulse transition-colors duration-300 ${T.skeleton}`} />
            ))}
          </div>
        ) : lpPositions.length === 0 ? (
          <div className={`text-center py-12 border rounded transition-colors duration-300 ${T.emptyBorder} ${T.emptyWrap}`}>
            <p className={`font-mono text-sm transition-colors duration-300 ${T.emptyText}`}>No liquidity positions</p>
          </div>
        ) : (
          <div className={`border rounded overflow-hidden transition-colors duration-300 ${T.tableBorder} ${T.tableWrap}`}>
            <table className="w-full text-sm">
              <thead>
                <tr className={`border-b transition-colors duration-300 ${T.tableHead}`}>
                  {['Market', 'LP Balance', 'Pending Fees', 'Status'].map((h) => (
                    <th
                      key={h}
                      className={`px-4 py-3 text-left text-[10px] font-display tracking-widest uppercase transition-colors duration-300 ${T.tableHeadTxt}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lpPositions.map((lp) => (
                  <tr
                    key={lp.marketId}
                    className={`border-b transition-colors duration-200 ${T.tableRow}`}
                  >
                    <td className="px-4 py-3">
                      <Link
                        to={`/markets/${lp.marketId}`}
                        className={`font-display text-xs line-clamp-1 transition-colors duration-200 ${T.cellLink}`}
                      >
                        {lp.marketTitle ?? `#${lp.marketId}`}
                      </Link>
                    </td>
                    <td className={`px-4 py-3 font-mono text-xs transition-colors duration-300 ${T.cellMuted}`}>
                      {lp.lpBalance.toFixed(4)}
                    </td>
                    <td className={`px-4 py-3 font-mono text-xs transition-colors duration-300 ${T.cellData}`}>
                      ${lp.pendingRewards.toFixed(4)}
                    </td>
                    <td className="px-4 py-3">
                      {lp.market?.isResolved ? (
                        <Badge variant="resolved">Resolved</Badge>
                      ) : (
                        <Badge variant="live">Active</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
