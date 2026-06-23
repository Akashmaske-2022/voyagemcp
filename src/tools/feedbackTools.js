'use strict';

const { z } = require('zod');
const { supabaseAdmin } = require('../lib/supabaseAdmin');

/**
 * Register all feedback-related MCP tools on the given McpServer instance.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
function registerFeedbackTools(server) {
  // ─────────────────────────────────────────────────────────────────────────
  // list_feedback
  // ─────────────────────────────────────────────────────────────────────────
  server.tool(
    'list_feedback',
    'List recent feedback submissions from users. Supports pagination and optional filtering by category.',
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
      category: z
        .enum(['UI/UX', 'Bug', 'Feature Request', 'Other'])
        .optional()
        .describe('Filter by feedback category'),
      min_rating: z
        .number()
        .int()
        .min(1)
        .max(5)
        .optional()
        .describe('Only return feedback with rating >= this value'),
    },
    async ({ limit = 20, offset = 0, category, min_rating }) => {
      let query = supabaseAdmin
        .from('feedback')
        .select('id, user_id, message, rating, category, created_at')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (category) {
        query = query.eq('category', category);
      }
      if (min_rating !== undefined) {
        query = query.gte('rating', min_rating);
      }

      const { data, error } = await query;

      if (error) {
        return {
          content: [{ type: 'text', text: `Error fetching feedback: ${error.message}` }],
          isError: true,
        };
      }

      const summary = data.length === 0
        ? 'No feedback records found matching the criteria.'
        : `Found ${data.length} feedback record(s):`;

      const rows = data
        .map(
          (r) =>
            `• [${r.id}] ⭐${r.rating ?? 'N/A'} | ${r.category ?? 'Uncategorized'} | ${r.created_at.slice(0, 10)}\n  "${r.message}"`
        )
        .join('\n\n');

      return {
        content: [{ type: 'text', text: `${summary}\n\n${rows}`.trim() }],
      };
    }
  );

  // ─────────────────────────────────────────────────────────────────────────
  // get_feedback_by_id
  // ─────────────────────────────────────────────────────────────────────────
  server.tool(
    'get_feedback_by_id',
    'Fetch a single feedback record by its UUID.',
    {
      id: z.string().uuid().describe('The UUID of the feedback record to retrieve'),
    },
    async ({ id }) => {
      const { data, error } = await supabaseAdmin
        .from('feedback')
        .select('id, user_id, message, rating, category, created_at')
        .eq('id', id)
        .single();

      if (error) {
        return {
          content: [
            {
              type: 'text',
              text: error.code === 'PGRST116'
                ? `No feedback found with id: ${id}`
                : `Error: ${error.message}`,
            },
          ],
          isError: error.code !== 'PGRST116',
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: [
              `Feedback ID: ${data.id}`,
              `User ID:     ${data.user_id ?? 'anonymous'}`,
              `Rating:      ⭐ ${data.rating ?? 'N/A'} / 5`,
              `Category:    ${data.category ?? 'Uncategorized'}`,
              `Submitted:   ${data.created_at}`,
              `Message:\n  "${data.message}"`,
            ].join('\n'),
          },
        ],
      };
    }
  );

  // ─────────────────────────────────────────────────────────────────────────
  // get_feedback_summary
  // ─────────────────────────────────────────────────────────────────────────
  server.tool(
    'get_feedback_summary',
    'Get an aggregate summary of user feedback: total count, average rating, and breakdown by category. Optionally filter by a date range.',
    {
      since: z
        .string()
        .optional()
        .describe('ISO date string (e.g. 2024-01-01) — only include feedback after this date'),
    },
    async ({ since }) => {
      let query = supabaseAdmin
        .from('feedback')
        .select('rating, category');

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
          content: [{ type: 'text', text: 'No feedback data found for the given filter.' }],
        };
      }

      const total = data.length;
      const rated = data.filter((r) => r.rating !== null);
      const avgRating = rated.length
        ? (rated.reduce((sum, r) => sum + r.rating, 0) / rated.length).toFixed(2)
        : 'N/A';

      // Category breakdown
      const breakdown = data.reduce((acc, r) => {
        const key = r.category ?? 'Uncategorized';
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {});

      const categoryLines = Object.entries(breakdown)
        .sort(([, a], [, b]) => b - a)
        .map(([cat, count]) => `  • ${cat}: ${count} (${((count / total) * 100).toFixed(1)}%)`)
        .join('\n');

      const text = [
        `📊 Feedback Summary${since ? ` (since ${since})` : ''}`,
        `─────────────────────────────`,
        `Total responses: ${total}`,
        `Average rating:  ⭐ ${avgRating} / 5 (from ${rated.length} rated)`,
        ``,
        `By Category:`,
        categoryLines,
      ].join('\n');

      return { content: [{ type: 'text', text }] };
    }
  );
}

module.exports = { registerFeedbackTools };
