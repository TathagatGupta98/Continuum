# Continuum Backend

Node.js / TypeScript API server for the Continuum prediction market protocol. Provides REST endpoints, real-time Socket.io updates, on-chain event watching via viem, and a Goldsky webhook receiver.

---

## Quick start

```bash
# 1. Copy env template and fill in values
cp .env.example .env

# 2. Install dependencies (from repo root)
pnpm install

# 3. Apply Prisma schema to your database
pnpm db:migrate

# 4. Seed markets from on-chain Factory state, then start the API
pnpm start
```

`pnpm start` runs `db:seed` then `start:api` sequentially. The server listens on `PORT` (default `3001`).

To start only the API (skip seeding):

```bash
pnpm start:api
```

---

## Environment variables

See [.env.example](.env.example) for the full list. Key vars:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `RPC_URL` | Arbitrum Sepolia JSON-RPC endpoint |
| `FACTORY_ADDRESS` | ContinuumFactory contract address |
| `DISTRIBUTION_AMM_ADDRESS` | AMM proxy for market #0 (used by chain watcher) |
| `ROUTER_ADDRESS` | Router proxy for market #0 |
| `CORS_ORIGINS` | Comma-separated allowed frontend origins (blank = localhost defaults) |
| `GOLDSKY_WEBHOOK_SECRET` | HMAC-SHA256 secret for Goldsky webhook verification |

---

## REST API

Base URL: `http://localhost:3001/api`

Rate limit: **100 requests / minute per IP** on all `/api/*` routes.

---

### Health

```bash
curl http://localhost:3001/api/health
# {"status":"OK","timestamp":"2026-06-09T10:00:00.000Z"}
```

---

### Markets

#### List markets

```bash
curl "http://localhost:3001/api/markets"
# Filter by category:
curl "http://localhost:3001/api/markets?category=crypto"
# Filter to markets with liquidity:
curl "http://localhost:3001/api/markets?active=true"
```

#### Get market detail

```bash
curl "http://localhost:3001/api/markets/0"
```

#### Price preview

Returns Gaussian CDF-derived prices and fee breakdown for the staker UI widget.

```bash
# Probability + fees for buying YES at strike 95000
curl "http://localhost:3001/api/markets/0/price?x=95000&direction=yes&stakeAmount=100"
# {
#   "success": true,
#   "data": {
#     "pYes": 0.6827,
#     "pNo": 0.3173,
#     "grossCostWad": 100,
#     "feeCostWad": 1,
#     "netStake": 99,
#     "tokensMinted": 145.01
#   }
# }
```

#### LP stats

Reads LP token balance and pending rewards on-chain for a given wallet.

```bash
curl "http://localhost:3001/api/markets/0/lp-stats?address=0xYourWalletAddress"
# {
#   "success": true,
#   "data": {
#     "marketId": "0",
#     "lpTokenBalance": 500.0,
#     "accFeePerShare": 0.002,
#     "rewardDebt": 0.8,
#     "pendingRewards": 0.2
#   }
# }
```

#### Settlement preview (owner only)

Determines the winning token given a final price vs the current μ. Does **not** send a chain transaction — the owner must call `settleByPrice` on-chain separately.

```bash
curl -X POST "http://localhost:3001/api/markets/0/settle" \
  -H "Content-Type: application/json" \
  -H "x-owner-address: 0xYourOwnerAddress" \
  -d '{"finalPrice": 96000}'
# {
#   "success": true,
#   "data": {
#     "marketId": "0",
#     "winningTokenId": "1",
#     "globalMu": 95000,
#     "finalPrice": 96000
#   }
# }
```

`winningTokenId`: `"1"` = YES won, `"0"` = NO won.

---

### Users

#### Portfolio

```bash
curl "http://localhost:3001/api/users/0xYourWalletAddress/portfolio"
# {
#   "success": true,
#   "data": {
#     "address": "0x...",
#     "positionCount": 2,
#     "positions": [
#       {
#         "positionId": "pos-1",
#         "marketId": "0",
#         "marketTitle": "Market #0",
#         "direction": "ABOVE",
#         "targetValueX": 95000,
#         "tokensMinted": 145.01,
#         "stakeAmount": 99,
#         "currentValue": 98.96,
#         "status": "active",
#         "market": { "currentMu": 95000, "currentSigma": 5000, ... }
#       }
#     ]
#   }
# }
```

---

### API docs

Machine-readable endpoint schema for frontend integration:

```bash
curl http://localhost:3001/api/docs
```

---

### Goldsky webhook

Receives on-chain event notifications from Goldsky. Protected by HMAC-SHA256 signature verification.

```bash
# MarketCreated — auto-upserts a new Market row
curl -X POST "http://localhost:3001/api/webhooks/goldsky" \
  -H "Content-Type: application/json" \
  -H "goldsky-webhook-signature: <hmac>" \
  -d '{
    "eventType": "MarketCreated",
    "data": {
      "marketId": "1",
      "ammAddress": "0x...",
      "routerAddress": "0x...",
      "lpTokenAddress": "0x...",
      "currentMu": 95000,
      "currentSigma": 5000,
      "sigmaMin": 1000
    }
  }'

# MarketResolved — sets isResolved + broadcasts to Socket.io room
curl -X POST "http://localhost:3001/api/webhooks/goldsky" \
  -H "Content-Type: application/json" \
  -H "goldsky-webhook-signature: <hmac>" \
  -d '{"eventType": "MarketResolved", "data": {"marketId": "0", "winningTokenId": "1"}}'

# LiquidityAdded
curl -X POST "http://localhost:3001/api/webhooks/goldsky" \
  -H "Content-Type: application/json" \
  -H "goldsky-webhook-signature: <hmac>" \
  -d '{
    "eventType": "LiquidityAdded",
    "data": {
      "marketId": "0",
      "userAddress": "0x...",
      "newMu": 95000,
      "newSigma": 5000,
      "addedLiquidity": 1000
    }
  }'

# StakePlaced (idempotent — duplicate positionId is a no-op)
curl -X POST "http://localhost:3001/api/webhooks/goldsky" \
  -H "Content-Type: application/json" \
  -H "goldsky-webhook-signature: <hmac>" \
  -d '{
    "eventType": "StakePlaced",
    "data": {
      "positionId": "pos-abc123",
      "marketId": "0",
      "userAddress": "0x...",
      "targetValueX": 95000,
      "isYes": true,
      "tokensMinted": 145.01,
      "stakeAmount": 100
    }
  }'
```

Unknown `eventType` values return `200 OK` (ignored) so Goldsky does not retry them.

---

## Socket.io

See [SOCKET_EVENTS.md](./SOCKET_EVENTS.md) for the full event reference.

Quick example:

```ts
import { io } from 'socket.io-client';
const socket = io('http://localhost:3001');

socket.emit('joinMarket', '0');         // subscribe + receive immediate state snapshot
socket.on('marketStateUpdated', console.log);
socket.on('marketResolved', console.log);

// Low-latency price preview (e.g. slider drag)
socket.emit('requestPrice', { marketId: '0', x: 95000, direction: 'yes' });
socket.on('priceUpdate', console.log);
```

---

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm start` | Seed DB from chain, then start API |
| `pnpm start:api` | Start API server only |
| `pnpm db:seed` | Seed markets from Factory on-chain |
| `pnpm db:migrate` | Apply Prisma schema to DB (`prisma db push`) |
| `pnpm start:indexer` | Start legacy Goldsky GraphQL polling client |
| `pnpm deploy:subgraph:amm` | Deploy Goldsky from-ABI subgraph |
