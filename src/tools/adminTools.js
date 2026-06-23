'use strict';

const { z } = require('zod');
const { supabaseAdmin } = require('../lib/supabaseAdmin');

/**
 * Register admin/CRUD MCP tools on the given McpServer instance.
 * These are destructive/mutating tools — use with caution.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
function registerAdminTools(server) {
  // ─────────────────────────────────────────────────────────────────────────
  // delete_feedback
  // ─────────────────────────────────────────────────────────────────────────
  server.tool(
    'delete_feedback',
    '⚠️ ADMIN: Hard-delete a feedback record by its UUID. This action is irreversible. Use only to remove spam, abusive content, or test records.',
    {
      id: z.string().uuid().describe('UUID of the feedback record to delete'),
      confirm: z
        .boolean()
        .describe('Must be true to confirm the deletion. Safety guard against accidental calls.'),
    },
    async ({ id, confirm }) => {
      if (!confirm) {
        return {
          content: [
            {
              type: 'text',
              text: `⛔ Deletion not confirmed. Set confirm: true to proceed with deleting feedback id: ${id}`,
            },
          ],
        };
      }

      // First verify the record exists
      const { data: existing, error: fetchError } = await supabaseAdmin
        .from('feedback')
        .select('id, message, rating, category')
        .eq('id', id)
        .single();

      if (fetchError) {
        return {
          content: [
            {
              type: 'text',
              text: fetchError.code === 'PGRST116'
                ? `No feedback found with id: ${id}`
                : `Error looking up record: ${fetchError.message}`,
            },
          ],
          isError: fetchError.code !== 'PGRST116',
        };
      }

      const { error: deleteError } = await supabaseAdmin
        .from('feedback')
        .delete()
        .eq('id', id);

      if (deleteError) {
        return {
          content: [{ type: 'text', text: `Failed to delete: ${deleteError.message}` }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: [
              `✅ Feedback record deleted.`,
              ``,
              `Deleted record details:`,
              `  ID:       ${existing.id}`,
              `  Rating:   ${existing.rating ?? 'N/A'}`,
              `  Category: ${existing.category ?? 'N/A'}`,
              `  Message:  "${existing.message}"`,
            ].join('\n'),
          },
        ],
      };
    }
  );

  // ─────────────────────────────────────────────────────────────────────────
  // delete_error_log
  // ─────────────────────────────────────────────────────────────────────────
  server.tool(
    'delete_error_log',
    '⚠️ ADMIN: Hard-delete a single error log entry by its UUID.',
    {
      id: z.string().uuid().describe('UUID of the error log entry to delete'),
      confirm: z.boolean().describe('Must be true to confirm deletion.'),
    },
    async ({ id, confirm }) => {
      if (!confirm) {
        return {
          content: [
            {
              type: 'text',
              text: `⛔ Deletion not confirmed. Set confirm: true to delete error log id: ${id}`,
            },
          ],
        };
      }

      const { error } = await supabaseAdmin
        .from('error_logs')
        .delete()
        .eq('id', id);

      if (error) {
        return {
          content: [{ type: 'text', text: `Failed to delete: ${error.message}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text', text: `✅ Error log entry ${id} deleted successfully.` }],
      };
    }
  );

  // ─────────────────────────────────────────────────────────────────────────
  // purge_old_error_logs
  // ─────────────────────────────────────────────────────────────────────────
  server.tool(
    'purge_old_error_logs',
    '⚠️ ADMIN: Bulk-delete error log entries older than N days. Useful for routine cleanup to keep the table lean. Returns count of deleted rows.',
    {
      older_than_days: z
        .number()
        .int()
        .min(1)
        .describe('Delete error logs older than this many days (e.g. 30 = delete anything older than 30 days)'),
      confirm: z.boolean().describe('Must be true to confirm the bulk deletion.'),
    },
    async ({ older_than_days, confirm }) => {
      if (!confirm) {
        return {
          content: [
            {
              type: 'text',
              text: `⛔ Purge not confirmed. Set confirm: true to delete error logs older than ${older_than_days} day(s).`,
            },
          ],
        };
      }

      const cutoff = new Date(
        Date.now() - older_than_days * 24 * 60 * 60 * 1000
      ).toISOString();

      const { error, count } = await supabaseAdmin
        .from('error_logs')
        .delete({ count: 'exact' })
        .lt('created_at', cutoff);

      if (error) {
        return {
          content: [{ type: 'text', text: `Failed to purge: ${error.message}` }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `✅ Purged ${count ?? 0} error log entries older than ${older_than_days} day(s) (before ${cutoff.slice(0, 10)}).`,
          },
        ],
      };
    }
  );
}

module.exports = { registerAdminTools };
