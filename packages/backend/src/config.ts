import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

/**
 * Zod schema for all required environment variables.
 * Validates at import-time so the server fails fast on misconfiguration.
 *
 * Sui build: the EVM contract addresses (Factory/AMM/Router/USDC) are replaced by
 * the published package id, the shared `Registry` object id, and the collateral
 * coin type. Markets are discovered from the registry / `MarketCreated` events.
 */
const SUI_HEX = /^0x[a-fA-F0-9]{1,64}$/;

const envSchema = z.object({
  // ─── Server ───
  PORT: z
    .string()
    .default('3001')
    .transform(Number)
    .pipe(z.number().int().positive()),
  WS_PORT: z
    .string()
    .default('3002')
    .transform(Number)
    .pipe(z.number().int().positive()),

  // ─── Database ───
  DATABASE_URL: z.string().url({ message: 'DATABASE_URL must be a valid connection string' }),

  // ─── Sui RPC ───
  // Full node JSON-RPC URL. Defaults to the public testnet endpoint.
  SUI_RPC_URL: z
    .string()
    .url({ message: 'SUI_RPC_URL must be a valid URL' })
    .default('https://fullnode.testnet.sui.io:443'),

  // ─── Published package + registry ───
  // The `continuum` package id from `sui client publish`.
  PACKAGE_ID: z.string().regex(SUI_HEX, 'PACKAGE_ID must be a 0x-prefixed Sui object id'),
  // The shared `Registry` object id created at publish.
  REGISTRY_ID: z.string().regex(SUI_HEX, 'REGISTRY_ID must be a 0x-prefixed Sui object id'),
  // Fully-qualified collateral coin type used by markets, e.g.
  // `0x<pkg>::mock_usdc::MOCK_USDC` locally or the real USDC type on mainnet.
  COLLATERAL_TYPE: z.string().min(1).default(''),

  // ─── Event poller ───
  // Milliseconds between Sui event polls (Sui has no persistent ws event sub).
  EVENT_POLL_INTERVAL_MS: z
    .string()
    .default('4000')
    .transform(Number)
    .pipe(z.number().int().positive()),

  // ─── CORS ───
  CORS_ORIGINS: z.string().optional().default(''),

  // ─── Markets hidden from the app (stale/retired markets) ───
  // Comma-separated market ids. Excluded markets are skipped by the DB seed and
  // the chain watcher's registry reconciliation, so deleting their rows sticks.
  EXCLUDED_MARKET_IDS: z
    .string()
    .optional()
    .default('')
    .transform((s) => s.split(',').map((v) => v.trim()).filter(Boolean)),

  // ─── Owner (fallback when a market's on-chain owner can't be read) ───
  OWNER_ADDRESS: z
    .string()
    .regex(SUI_HEX, 'OWNER_ADDRESS must be a 0x-prefixed Sui address')
    .optional()
    .default('0x0'),

  // ─── Multi-agent AI oracle ───
  // Master switch for the resolution worker. Off by default so the server boots
  // (and existing deployments behave) without any oracle credentials configured.
  ORACLE_ENABLED: z
    .string()
    .optional()
    .default('false')
    .transform((s) => s === 'true' || s === '1'),
  // Anthropic API key for the LLM ensemble. The SDK also reads ANTHROPIC_API_KEY
  // from the environment directly; kept here so misconfig fails fast when enabled.
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  // Comma-separated Claude model ids forming the (diverse-tier) ensemble.
  ORACLE_MODELS: z
    .string()
    .optional()
    .default('claude-opus-4-8,claude-sonnet-4-6,claude-haiku-4-5')
    .transform((s) => s.split(',').map((v) => v.trim()).filter(Boolean)),
  // Milliseconds between resolution-worker passes (scans for closed markets).
  ORACLE_POLL_INTERVAL_MS: z
    .string()
    .default('60000')
    .transform(Number)
    .pipe(z.number().int().positive()),
  // Mean-confidence floor for auto-resolution (paper's 0.91 median operating point).
  ORACLE_CONFIDENCE_THRESHOLD: z
    .string()
    .default('0.91')
    .transform(Number)
    .pipe(z.number().min(0).max(1)),
  // Relative tolerance band (fraction) for scalar agreement across agents.
  // Agents "agree" when (max-min) ≤ tolerance · max(|aggregate|, 1).
  ORACLE_AGREEMENT_TOLERANCE: z
    .string()
    .default('0.02')
    .transform(Number)
    .pipe(z.number().positive()),
  // When true, an AUTO_RESOLVED decision is submitted on-chain via set_final_price.
  // When false, the oracle computes + records the decision but never signs.
  ORACLE_AUTO_SUBMIT: z
    .string()
    .optional()
    .default('false')
    .transform((s) => s === 'true' || s === '1'),
  // Owner keypair used to sign set_final_price. Sui bech32 (`suiprivkey1...`).
  // Required only when ORACLE_AUTO_SUBMIT is true.
  ORACLE_SIGNER_KEY: z.string().optional().default(''),
  // Max evidence sources gathered per market.
  ORACLE_MAX_SOURCES: z
    .string()
    .default('10')
    .transform(Number)
    .pipe(z.number().int().positive()),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.format());
  process.exit(1);
}

/**
 * Typed, validated configuration object.
 * Import this instead of reading `process.env` directly.
 */
export const config = parsed.data;
