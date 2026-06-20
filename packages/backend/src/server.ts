import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { config } from './config';
import healthRoutes from './routes/health';
import marketRoutes from './routes/marketRoutes';
import userRoutes from './routes/userRoutes';
import apiDocsRoutes from './routes/apiDocs';
import oracleRoutes from './routes/oracleRoutes';
import { errorHandler } from './middlewares/errorHandler';
import { apiLimiter } from './middlewares/rateLimiter';
import { initializeSocket } from './sockets/socketManager';
import { startChainWatcher } from './services/chainService';
import { startResolutionWorker } from './services/oracle/oracleService';

const app = express();

// CORS allowlist — set CORS_ORIGINS as a comma-separated list in .env for production.
// Falls back to localhost dev origins when the var is absent.
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost:3000', 'http://localhost:5173'];

// Middlewares
app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server requests (no origin) and listed origins
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin "${origin}" not allowed`));
    }
  },
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-owner-address'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting — 100 req/min per IP on all /api routes
app.use('/api', apiLimiter);

// Routes
app.use('/api', healthRoutes);
app.use('/api/markets', marketRoutes);
app.use('/api/users', userRoutes);
app.use('/api/oracle', oracleRoutes);
app.use('/api/docs', apiDocsRoutes);

// Global Error Handler
app.use(errorHandler);

const httpServer = createServer(app);
initializeSocket(httpServer);

// Store unwatch functions for graceful shutdown
let unwatchers: (() => void)[] = [];

httpServer.listen(config.PORT, () => {
  console.log(`Server is running on port ${config.PORT}`);

  // Start the on-chain event watcher
  startChainWatcher()
    .then((fns) => {
      unwatchers.push(...fns);
      console.log('⛓️  Chain watcher started successfully');
    })
    .catch((err) => {
      console.error('⚠️  Chain watcher failed to start:', err);
    });

  // Start the AI oracle resolution worker (no-op unless ORACLE_ENABLED=true).
  const stopOracle = startResolutionWorker();
  unwatchers.push(stopOracle);
});

// Graceful shutdown
const shutdown = () => {
  console.log('\n🛑 Shutting down...');
  unwatchers.forEach((unwatch) => unwatch());
  httpServer.close(() => process.exit(0));
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
