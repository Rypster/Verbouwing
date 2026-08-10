import { getSql, ensureSchema, randomId } from '../../../../lib/neon';

/**
 * Maakt een nieuw deelbaar project aan.
 * Body (optioneel): { data: <project state> }
 */
export async function POST(request) {
  try {
    let data = {};
    try {
      const body = await request.json();
      if (body && body.data) data = body.data;
    } catch (_) {}

    await ensureSchema();
    const sql = getSql();
    const id = randomId(10);
    const shareToken = randomId(16);

    await sql`
      INSERT INTO projects (id, share_token, data, updated_at)
      VALUES (${id}, ${shareToken}, ${JSON.stringify(data)}::jsonb, NOW())
    `;

    return Response.json({ id, token: shareToken });
  } catch (e) {
    console.error('POST /api/project/create', e);
    return Response.json({ error: e.message || 'Serverfout' }, { status: 500 });
  }
}
