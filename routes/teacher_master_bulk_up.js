const express = require('express');
const router = express.Router();
const db = require('../config/db_conn');
const multer = require('multer');
const { parse } = require('csv-parse/sync');

const upload = multer({ storage: multer.memoryStorage() });


const COLS = [
  'teacherid',
  'teacheruserid',
  'teachername',
  'teacheraddress',
  'teacheremailid',
  'teachermob1',
  'teachermob2',
  'teachergender',
  'teachercaste',
  'teacherdoj',
  'teacherdesig',
  'teachertype',
  'teachermaxweekhrs',
  'teachercollegeid',
  'teachervalid',
  'teacherparentname1',
  'teacherparentname2',
  'pancardno',
  'aadharno',
  'communication_address',
  'permanent_address',
  'teacherdob',
  'ismarried',
  'emergency_contact_name',
  'emergency_contact_address',
  'emergency_contact_phone',
  'createdat',
  'updatedat',
  'teacher_dept_id',
];

// normalize: empty -> null; trim strings
const norm = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === '') return null;
  return s;
};

// Build multi-row INSERT
function buildBulkInsert(rows) {
  const placeholders = [];
  const values = [];
  let i = 1;

  rows.forEach((row) => {
    const rowPh = [];
    COLS.forEach((col) => {
      rowPh.push(`$${i++}`);
      values.push(norm(row[col]));
    });
    placeholders.push(`(${rowPh.join(',')})`);
  });

  const text = `
    INSERT INTO public.master_teacher (
      ${COLS.join(',')}
    )
    VALUES
      ${placeholders.join(',')}
    ON CONFLICT (teacherid) DO NOTHING
  `;
  return { text, values };
}

// Build dynamic UPDATE SET
function buildUpdateSet(body) {
  const set = [];
  const values = [];
  let idx = 1;

  COLS.forEach((col) => {
    if (col === 'teacherid') return; // key handled separately
    if (Object.prototype.hasOwnProperty.call(body, col)) {
      set.push(`${col} = $${idx++}`);
      values.push(norm(body[col]));
    }
  });

  return { set, values, nextIndex: idx };
}

// Validate CSV headers
function validateHeaders(headers) {
  const incoming = headers.map((h) => String(h || '').trim().toLowerCase());
  const required = COLS.map((c) => c.toLowerCase());
  const missing = required.filter((c) => !incoming.includes(c));
  return { ok: missing.length === 0, missing };
}

/* ===================== BULK CSV INSERT (no file saved) =====================

Accepts:
- multipart/form-data with field name "file"
- raw "text/csv" body
- JSON body: { "csv": "header1,header2\n..." }

*/
router.post('/bulk', upload.single('file'), async (req, res) => {
  try {
    let csvBuffer;
    if (req.file?.buffer) {
      csvBuffer = req.file.buffer;
    } else if (req.is('text/csv') && req.body) {
      csvBuffer = Buffer.from(String(req.body));
    } else if (req.body && typeof req.body.csv === 'string') {
      csvBuffer = Buffer.from(req.body.csv, 'utf8');
    } else {
      return res.status(400).json({
        error:
          'CSV not provided. Upload as multipart/form-data "file", raw text/csv, or body.csv string.',
      });
    }

    const records = parse(csvBuffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
    if (!records.length) {
      return res.status(400).json({ error: 'CSV contains no data rows.' });
    }

    const { ok, missing } = validateHeaders(Object.keys(records[0]));
    if (!ok) {
      return res.status(400).json({
        error: 'CSV header missing required columns.',
        missing_columns: missing,
        required_order: COLS,
      });
    }

    const CHUNK = 500;
    let totalInserted = 0;

    await db.query('BEGIN');

    for (let start = 0; start < records.length; start += CHUNK) {
      const slice = records.slice(start, start + CHUNK);

      // map to exact column order
      const mapped = slice.map((r) => {
        const o = {};
        COLS.forEach((c) => (o[c] = r[c]));
        return o;
      });

      const { text, values } = buildBulkInsert(mapped);
      const result = await db.query(text, values);
      totalInserted += result.rowCount || 0;
    }

    await db.query('COMMIT');

    return res.json({
      message: 'Bulk insert completed (duplicates skipped).',
      total_rows: records.length,
      inserted_rows: totalInserted,
      skipped_or_conflicted: records.length - totalInserted,
    });
  } catch (err) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    console.error('Bulk insert error (master_teacher):', err);
    return res.status(500).json({ error: 'Internal server error during bulk insert.' });
  }
});

/* ===================== OPTIONAL: BULK UPSERT =====================

Insert or update on conflict(teacherid). Remove if not needed.

*/
router.post('/bulk-upsert', upload.single('file'), async (req, res) => {
  try {
    let csvBuffer;
    if (req.file?.buffer) {
      csvBuffer = req.file.buffer;
    } else if (req.is('text/csv') && req.body) {
      csvBuffer = Buffer.from(String(req.body));
    } else if (typeof req.body.csv === 'string') {
      csvBuffer = Buffer.from(req.body.csv, 'utf8');
    } else {
      return res.status(400).json({
        error:
          'CSV not provided. Upload as multipart/form-data "file", raw text/csv, or body.csv string.',
      });
    }

    const records = parse(csvBuffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
    if (!records.length) {
      return res.status(400).json({ error: 'CSV contains no data rows.' });
    }

    const { ok, missing } = validateHeaders(Object.keys(records[0]));
    if (!ok) {
      return res.status(400).json({
        error: 'CSV header missing required columns.',
        missing_columns: missing,
        required_order: COLS,
      });
    }

    const CHUNK = 250;
    let affectedTotal = 0;

    await db.query('BEGIN');

    for (let start = 0; start < records.length; start += CHUNK) {
      const slice = records.slice(start, start + CHUNK);

      const placeholders = [];
      const values = [];
      let i = 1;

      slice.forEach((r) => {
        const rowVals = COLS.map((c) => norm(r[c]));
        values.push(...rowVals);
        placeholders.push(`(${COLS.map(() => `$${i++}`).join(',')})`);
      });

      const setCols = COLS
        .filter((c) => c !== 'teacherid')
        .map((c) => `${c} = EXCLUDED.${c}`);

      const text = `
        INSERT INTO public.master_teacher (${COLS.join(',')})
        VALUES ${placeholders.join(',')}
        ON CONFLICT (teacherid) DO UPDATE SET
          ${setCols.join(', ')}
      `;

      const result = await db.query(text, values);
      affectedTotal += result.rowCount || 0;
    }

    await db.query('COMMIT');

    return res.json({
      message: 'Bulk upsert completed.',
      affected_rows: affectedTotal,
    });
  } catch (err) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    console.error('Bulk upsert error (master_teacher):', err);
    return res.status(500).json({ error: 'Internal server error during bulk upsert.' });
  }
});

/* ===================== CREATE ONE ===================== */
router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const missing = COLS.filter((c) => !Object.prototype.hasOwnProperty.call(body, c));
    if (missing.length) {
      return res.status(400).json({ error: 'Missing required fields', missing });
    }

    const values = COLS.map((c) => norm(body[c]));
    const placeholders = COLS.map((_, i) => `$${i + 1}`);

    const text = `
      INSERT INTO public.master_teacher (${COLS.join(',')})
      VALUES (${placeholders.join(',')})
      ON CONFLICT (teacherid) DO NOTHING
      RETURNING *
    `;
    const result = await db.query(text, values);
    if (result.rowCount === 0) {
      return res.status(409).json({ error: 'Duplicate teacherid; row not inserted.' });
    }
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create teacher error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ===================== LIST (search + pagination) ===================== */
// GET /?q=term&limit=50&offset=0
router.get('/', async (req, res) => {
  try {
    const { q, limit = 50, offset = 0 } = req.query;
    const where = [];
    const params = [];
    let i = 1;

    if (q) {
      where.push(
        `(teacherid ILIKE $${i} OR teachername ILIKE $${i} OR teacheremailid ILIKE $${i} OR teachermob1 ILIKE $${i})`
      );
      params.push(`%${q}%`);
      i++;
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const listSql = `
      SELECT * FROM public.master_teacher
      ${whereSql}
      ORDER BY createdat DESC NULLS LAST
      LIMIT $${i++} OFFSET $${i++}
    `;
    params.push(Number(limit), Number(offset));

    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM public.master_teacher
      ${whereSql}
    `;

    const [list, count] = await Promise.all([
      db.query(listSql, params),
      db.query(countSql, where.length ? [params[0]] : []),
    ]);

    return res.json({
      total: count.rows?.[0]?.total || 0,
      rows: list.rows,
    });
  } catch (err) {
    console.error('List teachers error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ===================== READ ONE ===================== */
router.get('/:teacherid', async (req, res) => {
  try {
    const { teacherid } = req.params;
    const result = await db.query(
      'SELECT * FROM public.master_teacher WHERE teacherid = $1 LIMIT 1',
      [teacherid]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Teacher not found' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('Get teacher error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ===================== UPDATE ONE (partial) ===================== */
router.put('/:teacherid', async (req, res) => {
  try {
    const { teacherid } = req.params;
    const { set, values, nextIndex } = buildUpdateSet(req.body || {});
    if (set.length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided.' });
    }
    const text = `
      UPDATE public.master_teacher
      SET ${set.join(', ')}
      WHERE teacherid = $${nextIndex}
      RETURNING *
    `;
    const result = await db.query(text, [...values, teacherid]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Teacher not found' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('Update teacher error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ===================== DELETE ONE ===================== */
router.delete('/:teacherid', async (req, res) => {
  try {
    const { teacherid } = req.params;
    const result = await db.query(
      'DELETE FROM public.master_teacher WHERE teacherid = $1',
      [teacherid]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Teacher not found' });
    }
    return res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Delete teacher error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
