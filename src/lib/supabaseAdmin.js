'use strict';

// ─── Node 16 Compatibility ────────────────────────────────────────────────────
// @supabase/supabase-js requires fetch globals (Node 18+) and WebSocket (Node 22+).
// Polyfill both for Node 16 local development.
if (!globalThis.fetch) {
  const { fetch, Headers, Request, Response } = require('undici');
  globalThis.fetch    = fetch;
  globalThis.Headers  = Headers;
  globalThis.Request  = Request;
  globalThis.Response = Response;
}
// Provide WebSocket for @supabase/realtime-js on Node < 22
if (!globalThis.WebSocket) {
  globalThis.WebSocket = require('ws');
}

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error(
    '[supabaseAdmin] SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env'
  );
}

/**
 * Service-role Supabase client.
 * Bypasses all RLS — use ONLY on the server, never expose to clients.
 *
 * Realtime is disabled: the MCP server only needs PostgREST (database)
 * access; no real-time subscriptions are required.
 */
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  realtime: {
    // Suppress realtime connection on startup (MCP server doesn't subscribe)
    timeout: 0,
  },
});

module.exports = { supabaseAdmin };
