import rateLimit from 'express-rate-limit';

/**
 * Global API rate limiter — 100 requests per minute per IP.
 */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 100,            // 100 requests per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Rate limit exceeded. Try again in 1 minute.' },
});
