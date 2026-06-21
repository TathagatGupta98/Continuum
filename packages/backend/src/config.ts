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

// Treat an empty-string env var the same as "unset" so a blank value left in a
// PaaS dashboard (e.g. Render) doesn't bypass the zod default below.
const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

const envSchema = z.object({
  // ─── Server ───
  PORT: z
    .preprocess(emptyToUndefined, z.string().default('3001'))
    .transform(Number)
    .pipe(z.number().int().positive()),
  WS_PORT: z
    .preprocess(emptyToUndefined, z.string().default('3002'))
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
  // `the real testnet/mainnet USDC coin type, e.g. `0x..::usdc::USDC`.
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
  // Groq API key for the LLM ensemble (GroqCloud). Required when the oracle is
  // enabled; kept here so misconfig fails fast.
  GROQ_API_KEY: z.string().optional().default(''),
  // Groq API base URL (OpenAI-compatible endpoint). Override only for
  // proxies/mocks; when unset the groq-sdk default is used.
  GROQ_BASE_URL: z
    .string()
    .url({ message: 'GROQ_BASE_URL must be a valid URL' })
    .optional(),
  // Groq model used for evidence retrieval. Defaults to the agentic
  // `groq/compound-mini` system, which has built-in web search so the retriever
  // can browse for primary sources and return cited results. (The heavier
  // `groq/compound` injects full fetched pages and can exceed the free-tier
  // per-request token cap; `-mini` stays well within it.)
  ORACLE_RETRIEVAL_MODEL: z
    .string()
    .optional()
    .default('groq/compound-mini'),
  // Comma-separated Groq model ids forming the ensemble — the "sub-agents". Each
  // runs the same evidence packet independently and in parallel. Defaults to a
  // diverse, cross-family set to decorrelate errors (lower error correlation per
  // the paper). These four clear Groq's free-tier per-model TPM caps for a
  // typical evidence packet; add more ids (e.g. qwen/*) on a higher Groq tier to
  // scale the swarm and widen vendor diversity.
  ORACLE_MODELS: z
    .string()
    .optional()
    .default(
      'llama-3.3-70b-versatile,meta-llama/llama-4-scout-17b-16e-instruct,openai/gpt-oss-120b,openai/gpt-oss-20b',
    )
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

  // ─── Pyth on-chain price oracle (financial markets) ───
  // Markets created with a 32-byte `price_feed_id` settle trustlessly via
  // `market::resolve_with_pyth` instead of the LLM ensemble. The resolution
  // worker routes those to Pyth (permissionless on-chain read) and leaves
  // non-price markets to the AI oracle. On by default so the worker resolves
  // price markets even when the AI oracle (ORACLE_ENABLED) is off — but it still
  // only signs when ORACLE_SIGNER_KEY is set.
  PYTH_RESOLUTION_ENABLED: z
    .string()
    .optional()
    .default('true')
    .transform((s) => s === 'true' || s === '1'),
  // Pyth Sui `State` object id (Beta channel / testnet by default).
  PYTH_STATE_ID: z
    .string()
    .regex(SUI_HEX, 'PYTH_STATE_ID must be a 0x-prefixed Sui object id')
    .default('0x243759059f4c3111179da5878c12f68d612c21a8d54d85edc86164bb18be1c7c'),
  // Wormhole Sui `State` object id (Pyth's VAA-verification dependency).
  WORMHOLE_STATE_ID: z
    .string()
    .regex(SUI_HEX, 'WORMHOLE_STATE_ID must be a 0x-prefixed Sui object id')
    .default('0x31358d198147da50db32eda2562951d53973a0c0ad5ed738e9b17d88b213d790'),
  // Hermes REST endpoint serving signed Pyth price updates. Defaults to the BETA
  // channel to match the testnet Pyth/Wormhole defaults above (testnet uses a
  // different Wormhole guardian set + different feed ids than mainnet). On
  // mainnet, set this to https://hermes.pyth.network.
  HERMES_ENDPOINT: z
    .string()
    .url({ message: 'HERMES_ENDPOINT must be a valid URL' })
    .default('https://hermes-beta.pyth.network'),
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
