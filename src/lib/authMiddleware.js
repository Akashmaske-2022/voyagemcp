'use strict';

/**
 * Bearer-token authentication middleware.
 *
 * Expects: Authorization: Bearer <MCP_API_KEY>
 *
 * Returns 401 if the token is missing or does not match MCP_API_KEY.
 * This protects the /mcp endpoint from unauthenticated callers.
 */
function requireApiKey(req, res, next) {
  const MCP_API_KEY = process.env.MCP_API_KEY;

  if (!MCP_API_KEY) {
    console.error('[authMiddleware] MCP_API_KEY is not configured in .env!');
    return res.status(500).json({ error: 'Server misconfiguration: MCP_API_KEY not set.' });
  }

  const authHeader = req.headers['authorization'] || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return res.status(401).json({
      error: 'Missing or malformed Authorization header. Expected: Bearer <token>',
    });
  }

  const providedKey = match[1];

  // Constant-time comparison to prevent timing attacks
  if (!timingSafeEqual(providedKey, MCP_API_KEY)) {
    return res.status(401).json({ error: 'Invalid API key.' });
  }

  next();
}

/**
 * Constant-time string comparison (no timing side-channel).
 */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  const { timingSafeEqual: cryptoEqual } = require('crypto');
  return cryptoEqual(Buffer.from(a), Buffer.from(b));
}

module.exports = { requireApiKey };
