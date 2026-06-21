import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import prisma from '../models/db';
import { calculatePricePreview } from '../services/mathService';

let io: Server;

// Mirrors the REST CORS allowlist in server.ts — same CORS_ORIGINS env var.
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost:3000', 'http://localhost:5173'];

export const initializeSocket = (server: HttpServer) => {
  io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket: Socket) => {
    console.log(`[Socket.io] Client connected: ${socket.id}`);

    // Join a market room and immediately receive current state snapshot
    socket.on('joinMarket', async (marketId: string) => {
      socket.join(marketId);
      console.log(`[Socket.io] Client ${socket.id} joined market: ${marketId}`);

      try {
        const market = await prisma.market.findUnique({ where: { marketId } });

        if (!market) {
          socket.emit('error', { message: `Market ${marketId} not found` });
          return;
        }

        // Emit current state only to this socket — others in the room are already up-to-date
        socket.emit('marketStateUpdated', {
          currentMu: market.currentMu,
          currentSigma: market.currentSigma,
          totalLiquidity: market.totalLiquidity,
          isResolved: market.isResolved,
          finalPrice: market.finalPrice,
        });
      } catch (err) {
        console.error(`[Socket.io] joinMarket snapshot error for market ${marketId}:`, err);
        socket.emit('error', { message: 'Failed to fetch market state' });
      }
    });

    socket.on('leaveMarket', (marketId: string) => {
      socket.leave(marketId);
      console.log(`[Socket.io] Client ${socket.id} left market: ${marketId}`);
    });

    // Low-latency price preview for drag interactions — emits back to this socket only
    socket.on('requestPrice', async (payload: { marketId: string; x: number; direction: string }) => {
      const { marketId, x, direction } = payload ?? {};

      if (!marketId || typeof x !== 'number' || !['yes', 'no'].includes(direction)) {
        socket.emit('priceUpdate', { error: 'Invalid payload: marketId (string), x (number), direction ("yes"|"no") required' });
        return;
      }

      try {
        const market = await prisma.market.findUnique({ where: { marketId } });

        if (!market) {
          socket.emit('priceUpdate', { error: `Market ${marketId} not found` });
          return;
        }

        const { pYes, pNo } = calculatePricePreview(x, direction as 'yes' | 'no', market.currentMu, market.currentSigma);

        socket.emit('priceUpdate', { marketId, x, direction, pYes, pNo });
      } catch (err) {
        console.error(`[Socket.io] requestPrice error for market ${marketId}:`, err);
        socket.emit('priceUpdate', { error: 'Failed to compute price' });
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Socket.io] Client disconnected: ${socket.id}`);
    });
  });

  return io;
};

/**
 * Broadcasts market state updates to all clients subscribed to the specific market's room
 */
export const broadcastMarketUpdate = (
  marketId: string,
  newData: { currentMu: number; currentSigma: number; totalLiquidity: number }
) => {
  if (io) {
    io.to(marketId).emit('marketStateUpdated', newData);
    // Global signal (all clients, not just the market room) so list views —
    // marketplace, dashboard — know to refetch after a stake or liquidity event.
    io.emit('marketsChanged', { marketId });
  } else {
    console.warn('[Socket.io] Socket server not initialized yet');
  }
};

/**
 * Broadcasts to ALL clients that a brand-new market was created on-chain.
 */
export const broadcastMarketCreated = (marketId: string) => {
  if (io) {
    io.emit('marketCreated', { marketId });
    io.emit('marketsChanged', { marketId });
  } else {
    console.warn('[Socket.io] Socket server not initialized yet');
  }
};

/**
 * Broadcasts a market resolution event to all clients in the market's room
 */
export const broadcastMarketResolved = (
  marketId: string,
  data: { winningTokenId: string }
) => {
  if (io) {
    io.to(marketId).emit('marketResolved', data);
  } else {
    console.warn('[Socket.io] Socket server not initialized yet');
  }
};
