import { getSql, ensureSchema } from '../../../lib/neon';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const token = searchParams.get('token');
    if (!id || !token) {
      return Response.json({ error: 'id en token verplicht' }, { status: 400 });
    }

    await ensureSchema();
    const sql = getSql();
    const rows = await sql`
      SELECT id, data, updated_at
      FROM projects
      WHERE id = ${id} AND share_token = ${token}
      LIMIT 1
    `;

    if (!rows.length) {
      return Response.json({ error: 'Project niet gevonden' }, { status: 404 });
    }

    return Response.json({
      id: rows[0].id,
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
