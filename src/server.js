'use strict';

// ─── Node 16 Compatibility Polyfill ──────────────────────────────────────────
// @supabase/supabase-js and @modelcontextprotocol/sdk require fetch/Headers
// globals that are only natively available in Node 18+.
// When running on Node 16 (e.g. during local dev on older machines),
// we polyfill them from Node's built-in `undici` module.
if (!globalThis.fetch) {
  const { fetch, Headers, Request, Response } = require('undici');
  globalThis.fetch    = fetch;
  globalThis.Headers  = Headers;
  globalThis.Request  = Request;
  globalThis.Response = Response;
}

require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');

const { createMcpServer }  = require('./mcpServer');
const { requireApiKey }    = require('./lib/authMiddleware');

// ─── Validate required env vars on startup ────────────────────────────────
const REQUIRED_VARS = ['MCP_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
if (missing.length) {
  console.error(`[startup] Missing required environment variables: ${missing.join(', ')}`);
  console.error('[startup] Copy .env.example to .env and fill in the values.');
  process.exit(1);
}

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const NODE_ENV = process.env.NODE_ENV ?? 'development';

// ─── Express App ─────────────────────────────────────────────────────────
const app = express();

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // MCP Inspector needs this off
}));

// CORS — allow MCP Inspector (localhost) and any configured origins
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)
  .concat([
    'http://localhost:5173',  // Vite dev server (frontend)
    'http://localhost:3000',  // React dev server
    'http://localhost:6274',  // MCP Inspector default port
    'http://127.0.0.1:6274',
  ]);

app.use(cors({
  origin: (origin, cb) => {
    // Allow non-browser clients (curl, Postman, Inspector CLI)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not permitted`));
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id'],
  exposedHeaders: ['Mcp-Session-Id'],
  credentials: true,
}));

// Parse JSON body for all non-MCP routes
app.use((req, res, next) => {
  // The MCP endpoint will have its body parsed by the transport
  // so we apply json() to all other routes
  if (req.path !== '/mcp') {
    return express.json({ limit: '1mb' })(req, res, next);
  }
  express.json({ limit: '1mb' })(req, res, next);
});

// ─── Health Check ─────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    server: 'voyage-mcp-server',
    version: '1.0.0',
    environment: NODE_ENV,
    timestamp: new Date().toISOString(),
    tools_endpoint: `http://localhost:${PORT}/mcp`,
  });
});

// ─── MCP Endpoint ─────────────────────────────────────────────────────────
//
// Uses StreamableHTTPServerTransport in **stateless mode** (sessionIdGenerator: undefined).
// Each request creates its own short-lived transport + server connection.
// This makes the server horizontally scalable with no sticky sessions needed.
//
// Supports:
//   POST /mcp   — JSON-RPC requests (tools/list, tools/call, initialize, etc.)
//   GET  /mcp   — SSE stream (for server-sent notifications, supported by Inspector)
//   DELETE /mcp — Session termination (gracefully handled in stateless mode)
//
app.all('/mcp', requireApiKey, async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    // Stateless: no session IDs — every request is self-contained
    sessionIdGenerator: undefined,
    // Return JSON responses instead of SSE when client requests it
    enableJsonResponse: true,
  });

  const server = createMcpServer();

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[MCP] Unhandled error during request handling:', err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  } finally {
    // Clean up transport after each stateless request
    res.on('finish', () => {
      transport.close().catch(() => {});
    });
  }
});

// ─── 404 ──────────────────────────────────────────────────────────────────
app.use('*', (req, res) => {
  res.status(404).json({
    error: `Route ${req.method} ${req.originalUrl} not found`,
    hint: 'The MCP endpoint is at POST /mcp',
  });
});

// ─── Start ────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║          VibeVoyage MCP Server v1.0.0                ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  🚀 Server running at:    http://localhost:${PORT}`);
  console.log(`  📡 MCP endpoint:         http://localhost:${PORT}/mcp`);
  console.log(`  ❤️  Health check:         http://localhost:${PORT}/health`);
  console.log(`  🌐 Environment:          ${NODE_ENV}`);
  console.log('');
  console.log('  Tools registered:');
  console.log('    • list_feedback          • get_feedback_by_id');
  console.log('    • get_feedback_summary   • list_error_logs');
  console.log('    • get_error_summary      • get_analytics_overview');
  console.log('    • get_feedback_trends    • delete_feedback');
  console.log('    • delete_error_log       • purge_old_error_logs');
  console.log('');
  console.log('  To inspect with MCP Inspector:');
  console.log(`  npx @modelcontextprotocol/inspector http://localhost:${PORT}/mcp`);
  console.log('  (Use Authorization: Bearer <MCP_API_KEY> in inspector headers)');
  console.log('');
});

module.exports = app;
