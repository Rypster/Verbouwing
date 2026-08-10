import { getSql, ensureSchema } from '../../../lib/neon';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const token = searchParams.get('token');

    await ensureSchema();
    const sql = getSql();

    let rows;

    if (id && token) {
      // Specifiek project ophalen via ID en token
      rows = await sql`
        SELECT id, share_token, data, updated_at
        FROM projects
        WHERE id = ${id} AND share_token = ${token}
        LIMIT 1
      `;
    } else {
      // GEEN parameters meegegeven? Pak het meest recent bijgewerkte project als standaard!
      rows = await sql`
        SELECT id, share_token, data, updated_at
        FROM projects
        ORDER BY updated_at DESC
        LIMIT 1
      `;
    }

    if (!rows.length) {
      return Response.json({ error: 'Geen project gevonden' }, { status: 404 });
    }

    return Response.json({
      id: rows[0].id,
      token: rows[0].share_token,
      data: rows[0].data,
      updatedAt: rows[0].updated_at
    });
  } catch (e) {
    console.error('GET /api/project', e);
    return Response.json({ error: e.message || 'Serverfout' }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, token, data } = body || {};
    if (!id || !token || data === undefined) {
      return Response.json({ error: 'id, token en data verplicht' }, { status: 400 });
    }

    await ensureSchema();
    const sql = getSql();

    const existing = await sql`
      SELECT id FROM projects WHERE id = ${id} AND share_token = ${token} LIMIT 1
    `;
    if (!existing.length) {
      return Response.json({ error: 'Project niet gevonden of token ongeldig' }, { status: 404 });
    }

    const rows = await sql`
      UPDATE projects
      SET data = ${JSON.stringify(data)}::jsonb, updated_at = NOW()
      WHERE id = ${id} AND share_token = ${token}
      RETURNING updated_at
    `;

    return Response.json({ ok: true, updatedAt: rows[0]?.updated_at });
  } catch (e) {
    console.error('PUT /api/project', e);
    return Response.json({ error: e.message || 'Serverfout' }, { status: 500 });
  }
}
