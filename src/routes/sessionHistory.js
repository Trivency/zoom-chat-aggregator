import express from 'express';

/**
 * Read-only history endpoints for past (and current) sessions — the
 * "after-event report" + "past-session message browser" roadmap items.
 * Mounted under /api/sessions/:id/* behind the global requireAuth gate;
 * every query is scoped to req.org.id so one org can never read
 * another's history. Postgres is the source of truth here (the
 * in-memory ring buffer only holds the current session's tail), so
 * these routes require the database.
 */
export default function sessionHistoryRouter() {
  const router = express.Router();

  // Resolve the session and prove org ownership in one query. Returns
  // null when the id doesn't exist or belongs to another org (the
  // caller 404s either way — no existence oracle across orgs).
  async function findOwnedSession(db, orgId, sessionId) {
    const { rows } = await db.query(
      `SELECT id, name, started_at, ended_at
         FROM sessions
        WHERE id = $1 AND ($2::text IS NULL OR org_id = $2)`,
      [sessionId, orgId]
    );
    return rows[0] || null;
  }

  /**
   * Per-session statistics: headline totals, per-room breakdown, top
   * chatters, and message volume over time (5-minute buckets). One
   * round-trip per block, all index-friendly on idx_messages_session_id.
   */
  router.get('/:id/stats', async (req, res) => {
    const db = req.app.get('db');
    if (!db) return res.status(503).json({ error: 'Session history requires the database.' });
    try {
      const session = await findOwnedSession(db, req.org.id, req.params.id);
      if (!session) return res.status(404).json({ error: 'Session not found' });

      const [totals, byRoom, topSenders, timeline] = await Promise.all([
        db.query(
          `SELECT COUNT(*)                                          AS total,
                  COUNT(*) FILTER (WHERE type = 'chat')             AS chat,
                  COUNT(*) FILTER (WHERE type IN ('reply','broadcast','ai_reply')) AS outbound,
                  COUNT(*) FILTER (WHERE saved)                     AS saved,
                  COUNT(DISTINCT sender) FILTER (WHERE type = 'chat') AS unique_senders,
                  COUNT(DISTINCT room)                              AS rooms,
                  MIN(timestamp)                                    AS first_message_at,
                  MAX(timestamp)                                    AS last_message_at
             FROM messages
            WHERE session_id = $1 AND ($2::text IS NULL OR org_id = $2)`,
          [session.id, req.org.id]
        ),
        db.query(
          `SELECT room, MAX(room_color) AS room_color, COUNT(*) AS count
             FROM messages
            WHERE session_id = $1 AND ($2::text IS NULL OR org_id = $2)
            GROUP BY room
            ORDER BY count DESC`,
          [session.id, req.org.id]
        ),
        db.query(
          `SELECT sender, COUNT(*) AS count
             FROM messages
            WHERE session_id = $1 AND ($2::text IS NULL OR org_id = $2)
              AND type = 'chat'
            GROUP BY sender
            ORDER BY count DESC, sender ASC
            LIMIT 10`,
          [session.id, req.org.id]
        ),
        db.query(
          `SELECT to_timestamp(floor(extract(epoch FROM timestamp) / 300) * 300) AS bucket,
                  COUNT(*) AS count
             FROM messages
            WHERE session_id = $1 AND ($2::text IS NULL OR org_id = $2)
            GROUP BY bucket
            ORDER BY bucket ASC`,
          [session.id, req.org.id]
        ),
      ]);

      const t = totals.rows[0];
      res.json({
        session,
        totals: {
          total: Number(t.total),
          chat: Number(t.chat),
          outbound: Number(t.outbound),
          saved: Number(t.saved),
          uniqueSenders: Number(t.unique_senders),
          rooms: Number(t.rooms),
          firstMessageAt: t.first_message_at,
          lastMessageAt: t.last_message_at,
        },
        byRoom: byRoom.rows.map(r => ({
          room: r.room,
          roomColor: r.room_color,
          count: Number(r.count),
        })),
        topSenders: topSenders.rows.map(r => ({
          sender: r.sender,
          count: Number(r.count),
        })),
        timeline: timeline.rows.map(r => ({
          bucket: r.bucket,
          count: Number(r.count),
        })),
        bucketSeconds: 300,
      });
    } catch (err) {
      console.error(`GET /api/sessions/${req.params.id}/stats failed:`, err);
      res.status(500).json({ error: 'Failed to load session stats' });
    }
  });

  /**
   * Read-only page through a session's full chat log, newest-first with
   * a `before` timestamp cursor ("Load older" in the UI). Closes the
   * loop the roadmap called out: past sessions were previously only
   * readable via Postgres directly.
   */
  router.get('/:id/messages', async (req, res) => {
    const db = req.app.get('db');
    if (!db) return res.status(503).json({ error: 'Session history requires the database.' });

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);
    let before = null;
    if (req.query.before) {
      const parsed = new Date(String(req.query.before));
      if (isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'before must be a valid timestamp' });
      }
      before = parsed.toISOString();
    }

    try {
      const session = await findOwnedSession(db, req.org.id, req.params.id);
      if (!session) return res.status(404).json({ error: 'Session not found' });

      // Fetch one extra row to compute hasMore without a COUNT(*).
      const { rows } = await db.query(
        `SELECT id, timestamp, sender, room, room_color, meeting_id, content, type, saved, note
           FROM messages
          WHERE session_id = $1 AND ($2::text IS NULL OR org_id = $2)
            AND ($3::timestamptz IS NULL OR timestamp < $3)
          ORDER BY timestamp DESC
          LIMIT $4`,
        [session.id, req.org.id, before, limit + 1]
      );

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      res.json({
        session,
        hasMore,
        messages: page.map(r => ({
          id: r.id,
          sender: r.sender,
          content: r.content,
          room: r.room,
          roomColor: r.room_color,
          meetingId: r.meeting_id,
          timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : r.timestamp,
          type: r.type || 'chat',
          saved: r.saved === true,
          note: r.note || null,
        })),
      });
    } catch (err) {
      console.error(`GET /api/sessions/${req.params.id}/messages failed:`, err);
      res.status(500).json({ error: 'Failed to load session messages' });
    }
  });

  return router;
}
