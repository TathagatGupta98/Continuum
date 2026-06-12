# OmniCurve Socket.io Events

Connect to `http://localhost:3001` (or the deployed server URL) using any Socket.io v4 client.

---

## Client → Server

### `joinMarket`

Subscribe to real-time updates for a specific market. The server immediately emits a `marketStateUpdated` snapshot to the joining socket so the UI does not need to wait for the next on-chain event.

```ts
socket.emit('joinMarket', marketId: string)
```

**Response (to this socket only):** [`marketStateUpdated`](#marketstateupdated)

---

### `leaveMarket`

Unsubscribe from a market room.

```ts
socket.emit('leaveMarket', marketId: string)
```

No response event.

---

### `requestPrice`

Request a low-latency price preview for a given strike and direction. Designed for drag interactions where the frontend needs rapid recalculation without HTTP round-trips. The server reads mu/sigma from Prisma (kept fresh by the chain watcher) and computes the Gaussian CDF off-chain.

```ts
socket.emit('requestPrice', {
  marketId: string,   // e.g. "0"
  x: number,          // strike price in WAD float (e.g. 95000.0 for BTC price)
  direction: 'yes' | 'no',
})
```

**Response (to this socket only):** [`priceUpdate`](#priceupdate)

---

## Server → Client

### `marketStateUpdated`

Broadcast to all sockets in a market's room when on-chain state changes (trade executed, liquidity added/removed, curve updated). Also sent directly to a socket immediately after `joinMarket`.

**Targets:** All sockets in room `marketId`  
**Triggers:** `CurveUpdated`, `LiquidityAdded`, `LiquidityRemoved`, `TradeExecuted` chain events; also `joinMarket`

```ts
{
  currentMu: number,        // Gaussian mean, WAD float
  currentSigma: number,     // Gaussian std dev, WAD float
  totalLiquidity: number,   // Available liquidity, WAD float
  isResolved: boolean,      // True once market is settled
  winningTokenId: string | null,  // "1" = YES, "2" = NO, null if unresolved
}
```

---

### `marketResolved`

Broadcast to all sockets in a market's room when the AMM emits a `MarketResolved` on-chain event.

**Targets:** All sockets in room `marketId`  
**Triggers:** `MarketResolved` chain event on the AMM

```ts
{
  winningTokenId: string,  // "1" = YES won, "2" = NO won
}
```

---

### `marketsChanged`

Broadcast to **all connected sockets** (no room required) whenever any market's
state changes on-chain — a market is created, a stake is placed, or liquidity is
added/removed — after the backend has updated the DB. Intended as a refetch
signal for list views (marketplace, dashboard): invalidate your `markets` /
`market` / `portfolio` queries when this fires.

**Targets:** All connected sockets
**Triggers:** `MarketCreated` (Factory), `CurveUpdated`, `LiquidityAdded`, `LiquidityRemoved` (AMM), `TradeExecuted` (Router), and Goldsky webhook events

```ts
{
  marketId: string,  // the market that changed
}
```

---

### `marketCreated`

Broadcast to **all connected sockets** when the Factory emits `MarketCreated`
and the new market has been inserted into the DB (also accompanied by a
`marketsChanged` emit).

**Targets:** All connected sockets
**Triggers:** `MarketCreated` chain event on the Factory

```ts
{
  marketId: string,  // id of the newly created market
}
```

---

### `priceUpdate`

Response to a `requestPrice` event. Sent only to the requesting socket.

**Targets:** Requesting socket only

```ts
// Success
{
  marketId: string,
  x: number,
  direction: 'yes' | 'no',
  pYes: number,   // probability YES wins at strike x (0–1)
  pNo: number,    // probability NO wins at strike x (0–1)
}

// Error
{
  error: string,
}
```

---

### `error`

Sent to a socket when a client-emitted event fails (e.g. `joinMarket` with an unknown market ID).

**Targets:** Requesting socket only

```ts
{
  message: string,
}
```

---

## Example (browser / Node client)

```ts
import { io } from 'socket.io-client';

const socket = io('http://localhost:3001');

// Join market and receive immediate snapshot
socket.emit('joinMarket', '0');

socket.on('marketStateUpdated', (state) => {
  console.log('mu:', state.currentMu, 'sigma:', state.currentSigma);
});

socket.on('marketResolved', ({ winningTokenId }) => {
  console.log('Winner:', winningTokenId === '1' ? 'YES' : 'NO');
});

// Low-latency price preview (e.g. on slider drag)
socket.emit('requestPrice', { marketId: '0', x: 95000, direction: 'yes' });

socket.on('priceUpdate', ({ pYes, pNo }) => {
  console.log(`P(YES)=${pYes.toFixed(4)}  P(NO)=${pNo.toFixed(4)}`);
});
```
