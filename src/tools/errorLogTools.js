'use strict';

const { z } = require('zod');
const { supabaseAdmin } = require('../lib/supabaseAdmin');

/**
 * Register all error-log MCP tools on the given McpServer instance.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
function registerErrorLogTools(server) {
  // ─────────────────────────────────────────────────────────────────────────
  // list_error_logs
  // ─────────────────────────────────────────────────────────────────────────
  server.tool(
    'list_error_logs',
    'List recent server error log entries. Supports filtering by HTTP status code, endpoint, and date range.',
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .default(20)
        .describe('Number of rows to return (1–100, default 20)'),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .default(0)
        .describe('Rows to skip for pagination (default 0)'),
      status_code: z
        .number()
        .int()
        .optional()
        .describe('Filter by HTTP status code (e.g. 500, 404)'),
      endpoint: z
        .string()
        .optional()
        .describe('Filter by endpoint path (partial match, e.g. /api/chat)'),
      since: z
        .string()
        .optional()
        .describe('ISO date string — only include errors after this date (e.g. 2024-01-01)'),
    },
    async ({ limit = 20, offset = 0, status_code, endpoint, since }) => {
      let query = supabaseAdmin
        .from('error_logs')
        .select('id, user_id, endpoint, error_message, stack_trace, status_code, created_at')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (status_code !== undefined) {
        query = query.eq('status_code', status_code);
      }
      if (endpoint) {
        query = query.ilike('endpoint', `%${endpoint}%`);
      }
      if (since) {
        query = query.gte('created_at', since);
      }

      const { data, error } = await query;

      if (error) {
        return {
          content: [{ type: 'text', text: `Error fetching error logs: ${error.message}` }],
          isError: true,
        };
      }

      if (data.length === 0) {
        return {
          content: [{ type: 'text', text: 'No error log entries found matching the criteria.' }],
        };
      }

      const rows = data
        .map((r) =>
          [
            `• [${r.id}]`,
            `  Time:     ${r.created_at}`,
            `  Status:   ${r.status_code ?? 'N/A'}`,
            `  Endpoint: ${r.endpoint ?? 'unknown'}`,
            `  Error:    ${r.error_message ?? 'N/A'}`,
          ].join('\n')
        )
        .join('\n\n');

      return {
        content: [
          { type: 'text', text: `Found ${data.length} error log(s):\n\n${rows}` },
        ],
      };
    }
  );

  // ─────────────────────────────────────────────────────────────────────────
  // get_error_summary
  // ─────────────────────────────────────────────────────────────────────────
  server.tool(
    'get_error_summary',
    'Get an aggregate summary of server errors: total count, breakdown by HTTP status code, and top error-prone endpoints.',
    {
      since: z
        .string()
        .optional()
        .describe('ISO date string — only include errors after this date (e.g. 2024-01-01)'),
      top_n: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .default(5)
        .describe('How many top endpoints to show (default 5)'),
    },
    async ({ since, top_n = 5 }) => {
      let query = supabaseAdmin
        .from('error_logs')
        .select('status_code, endpoint, error_message');

      if (since) {
        query = query.gte('created_at', since);
      }

      const { data, error } = await query;

      if (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }

      if (data.length === 0) {
        return {
          content: [{ type: 'text', text: 'No error logs found for the given filter.' }],
        };
      }

      const total = data.length;

      // Group by status code
      const byStatus = data.reduce((acc, r) => {
        const key = String(r.status_code ?? 'unknown');
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {});

      // Group by endpoint
      const byEndpoint = data.reduce((acc, r) => {
        const key = r.endpoint ?? 'unknown';
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {});

      const statusLines = Object.entries(byStatus)
        .sort(([, a], [, b]) => b - a)
        .map(([code, count]) => `  • HTTP ${code}: ${count} errors`)
        .join('\n');

      const endpointLines = Object.entries(byEndpoint)
        .sort(([, a], [, b]) => b - a)
        .slice(0, top_n)
        .map(([ep, count]) => `  • ${ep}: ${count} errors`)
        .join('\n');

      const text = [
        `🚨 Error Log Summary${since ? ` (since ${since})` : ''}`,
        `─────────────────────────────`,
        `Total errors logged: ${total}`,
        ``,
        `By Status Code:`,
        statusLines,
        ``,
        `Top ${top_n} Error-Prone Endpoints:`,
        endpointLines,
      ].join('\n');

      return { content: [{ type: 'text', text }] };
    }
  );
}

module.exports = { registerErrorLogTools };
