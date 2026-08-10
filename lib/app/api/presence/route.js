import { getSql, ensureSchema } from '../../../lib/neon';

const STALE_SECONDS = 45;

/**
 * Heartbeat: meld dat deze sessie online is voor een project.
 * Body: { projectId, sessionId }
 * Response: { othersOnline: number }
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { projectId, sessionId } = body || {};
    if (!projectId || !sessionId) {
      return Response.json({ error: 'projectId en sessionId verplicht' }, { status: 400 });
    }

    await ensureSchema();
    const sql = getSql();

    // Upsert eigen presence
    await sql`
      INSERT INTO presence (session_id, project_id, last_seen)
      VALUES (${sessionId}, ${projectId}, NOW())
      ON CONFLICT (session_id)
      DO UPDATE SET project_id = ${projectId}, last_seen = NOW()
    `;

    // Oude sessies opruimen
    await sql`
      DELETE FROM presence
      WHERE last_seen < NOW() - INTERVAL '2 minutes'
    `;

    // Anderen online (niet jezelf, recent gezien)
    const rows = await sql`
      SELECT COUNT(*)::int AS cnt
      FROM presence
      WHERE project_id = ${projectId}
        AND session_id <> ${sessionId}
        AND last_seen > NOW() - make_interval(secs => ${STALE_SECONDS})
    `;

    const othersOnline = rows[0]?.cnt ?? 0;
    return Response.json({ othersOnline });
  } catch (e) {
    console.error('POST /api/presence', e);
    return Response.json({ error: e.message || 'Serverfout' }, { status: 500 });
  }
}
