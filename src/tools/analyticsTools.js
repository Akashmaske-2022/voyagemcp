'use strict';

const { z } = require('zod');
const { supabaseAdmin } = require('../lib/supabaseAdmin');

/**
 * Register all analytics/metrics MCP tools on the given McpServer instance.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
function registerAnalyticsTools(server) {
  // ─────────────────────────────────────────────────────────────────────────
  // get_analytics_overview
  // ─────────────────────────────────────────────────────────────────────────
  server.tool(
    'get_analytics_overview',
    'Get a high-level analytics snapshot of the VibeVoyage platform: total feedback, average rating, error counts, and recent activity. Perfect for a quick health check or admin dashboard summary.',
    {
      since: z
        .string()
        .optional()
        .describe('ISO date string to scope analytics (e.g. 2024-01-01). Defaults to all-time.'),
    },
    async ({ since }) => {
      // Run both queries in parallel for efficiency
      const [feedbackResult, errorResult] = await Promise.all([
        (() => {
          let q = supabaseAdmin.from('feedback').select('rating, category, created_at');
          if (since) q = q.gte('created_at', since);
          return q;
        })(),
        (() => {
          let q = supabaseAdmin.from('error_logs').select('status_code, created_at');
          if (since) q = q.gte('created_at', since);
          return q;
        })(),
      ]);

      const errors = [];
      if (feedbackResult.error) errors.push(`Feedback: ${feedbackResult.error.message}`);
      if (errorResult.error)   errors.push(`Errors: ${errorResult.error.message}`);
      if (errors.length) {
        return {
          content: [{ type: 'text', text: `Failed to fetch analytics:\n${errors.join('\n')}` }],
          isError: true,
        };
      }

      const feedback = feedbackResult.data;
      const errorLogs = errorResult.data;

      // Feedback metrics
      const totalFeedback = feedback.length;
      const rated = feedback.filter((r) => r.rating !== null);
      const avgRating = rated.length
        ? (rated.reduce((s, r) => s + r.rating, 0) / rated.length).toFixed(2)
        : 'N/A';

      const categoryBreakdown = feedback.reduce((acc, r) => {
        const k = r.category ?? 'Uncategorized';
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {});
      const topCategory = Object.entries(categoryBreakdown).sort(([, a], [, b]) => b - a)[0];

      // Error metrics
      const totalErrors = errorLogs.length;
      const serverErrors = errorLogs.filter((e) => (e.status_code ?? 0) >= 500).length;
      const clientErrors = errorLogs.filter(
        (e) => (e.status_code ?? 0) >= 400 && (e.status_code ?? 0) < 500
      ).length;

      // Recent activity (last 7 days)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const recentFeedback = feedback.filter((r) => r.created_at >= sevenDaysAgo).length;
      const recentErrors   = errorLogs.filter((e) => e.created_at >= sevenDaysAgo).length;

      const text = [
        `📈 VibeVoyage Analytics Overview${since ? ` (since ${since})` : ' (all-time)'}`,
        `══════════════════════════════════════`,
        ``,
        `💬 FEEDBACK`,
        `  Total submissions:  ${totalFeedback}`,
        `  Average rating:     ⭐ ${avgRating} / 5`,
        `  Rated responses:    ${rated.length}`,
        `  Top category:       ${topCategory ? `${topCategory[0]} (${topCategory[1]})` : 'N/A'}`,
        `  Last 7 days:        ${recentFeedback} new`,
        ``,
        `🚨 ERROR LOGS`,
        `  Total errors:       ${totalErrors}`,
        `  Server errors (5xx): ${serverErrors}`,
        `  Client errors (4xx): ${clientErrors}`,
        `  Last 7 days:         ${recentErrors} new`,
        ``,
        `🏥 HEALTH INDICATORS`,
        `  Error rate:         ${totalFeedback > 0 ? ((totalErrors / (totalFeedback + totalErrors)) * 100).toFixed(1) + '%' : 'N/A'}`,
        `  User satisfaction:  ${avgRating !== 'N/A' ? `${Math.round((parseFloat(avgRating) / 5) * 100)}% positive` : 'N/A'}`,
      ].join('\n');

      return { content: [{ type: 'text', text }] };
    }
  );

  // ─────────────────────────────────────────────────────────────────────────
  // get_feedback_trends
  // ─────────────────────────────────────────────────────────────────────────
  server.tool(
    'get_feedback_trends',
    'Analyze feedback trends over time — daily submission counts and average ratings for the last N days.',
    {
      days: z
        .number()
        .int()
        .min(1)
        .max(90)
        .optional()
        .default(30)
        .describe('Number of past days to analyze (1–90, default 30)'),
    },
    async ({ days = 30 }) => {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      const { data, error } = await supabaseAdmin
        .from('feedback')
        .select('rating, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: true });

      if (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }

      if (data.length === 0) {
        return {
          content: [
            { type: 'text', text: `No feedback in the last ${days} days.` },
          ],
        };
      }

      // Group by date (YYYY-MM-DD)
      const byDay = data.reduce((acc, r) => {
        const day = r.created_at.slice(0, 10);
        if (!acc[day]) acc[day] = { count: 0, ratingSum: 0, ratedCount: 0 };
        acc[day].count++;
        if (r.rating !== null) {
          acc[day].ratingSum += r.rating;
          acc[day].ratedCount++;
        }
        return acc;
      }, {});

      const trendLines = Object.entries(byDay)
        .map(([day, { count, ratingSum, ratedCount }]) => {
          const avg = ratedCount ? (ratingSum / ratedCount).toFixed(1) : '-';
          return `  ${day}: ${count} submission(s), avg ⭐ ${avg}`;
        })
        .join('\n');

      const text = [
        `📅 Feedback Trends — Last ${days} days`,
        `──────────────────────────────────────`,
        `Total: ${data.length} submissions`,
        ``,
        `Daily Breakdown:`,
        trendLines,
      ].join('\n');

      return { content: [{ type: 'text', text }] };
    }
  );
}

module.exports = { registerAnalyticsTools };
