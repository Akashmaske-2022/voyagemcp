'use strict';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');

const { registerFeedbackTools } = require('./tools/feedbackTools');
const { registerErrorLogTools }  = require('./tools/errorLogTools');
const { registerAnalyticsTools } = require('./tools/analyticsTools');
const { registerAdminTools }     = require('./tools/adminTools');

/**
 * Create and configure the MCP server instance with all tools registered.
 * This function returns a ready-to-connect McpServer.
 */
function createMcpServer() {
  const server = new McpServer({
    name: 'voyage-mcp-server',
    version: '1.0.0',
  });

  // ── Register tool groups ─────────────────────────────────────────────────
  registerFeedbackTools(server);   // list_feedback, get_feedback_by_id, get_feedback_summary
  registerErrorLogTools(server);   // list_error_logs, get_error_summary
  registerAnalyticsTools(server);  // get_analytics_overview, get_feedback_trends
  registerAdminTools(server);      // delete_feedback, delete_error_log, purge_old_error_logs

  return server;
}

module.exports = { createMcpServer };
