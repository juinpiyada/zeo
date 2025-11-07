// routes/student_master.js
const express = require('express');
const router = express.Router();
const db = require('../config/db_conn');
const multer = require('multer');
const { parse } = require('csv-parse/sync');

const upload = multer({ storage: multer.memoryStorage() });

// ---- Column definition (order matters) ----
const COLS = [
  'stuid',
  'stu_enrollmentnumber',
  'stu_rollnumber',
  'stu_regn_number',
  'stuname',
  'stuemailid',
  'stumob1',
  'stumob2',
  'stucaste',
  'stugender',
  'studob',
  'stucategory',
  'stuadmissiondt',
  'stu_course_id', 
  'stu_lat_entry',
  'stu_curr_semester',
  'stu_section',
  'stuvalid',
  'stuuserid',
  'stuparentname',
  'stuaddress',
  'stuparentemailid',
  'stuprentmob1',
  'stuprentmob2',
  'stuparentaddress',
  'stu_inst_id',
  'createdat',
  'updatedat',
];

// Utility: normalize empty strings to null; trim strings; keep booleans & numbers
const norm = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === '') return null;
  return s;
};

// Utility: build multi-row INSERT with placeholders
function buildBulkInsert(rows) {
  const placeholders = [];
  const values = [];
  let i = 1;
  rows.forEach((row) => {
    const rowPlaceholders = [];
    COLS.forEach((col) => {
      rowPlaceholders.push(`$${i++}`);
      values.push(norm(row[col]));
    });
    placeholders.push(`(${rowPlaceholders.join(',')})`);
  });

  const text = `
    INSERT INTO public.student_master (
      ${COLS.join(',')}
    )
    VALUES
      ${placeholders.join(',')}
    ON CONFLICT (stuid) DO NOTHING
  `;
  return { text, values };
}

// Utility: build dynamic UPDATE set clause
function buildUpdateSet(body) {
  const set = [];
  const values = [];
  let idx = 1;

  COLS.forEach((col) => {
    if (col === 'stuid') return; // key handled separately
    if (Object.prototype.hasOwnProperty.call(body, col)) {
      set.push(`${col} = $${idx++}`);
      values.push(norm(body[col]));
    }
  });

  return { set, values, nextIndex: idx };
}

// Validate headers
function validateHeaders(headers) {
  const incoming = headers.map((h) => String(h || '').trim().toLowerCase());
  const required = COLS.map((c) => c.toLowerCase());
  const missing = required.filter((c) => !incoming.includes(c));
  return { ok: missing.length === 0, missing };
}

// ---- BULK CSV INSERT (in-memory) ----
// Accepts: multipart/form-data with field name "file" (CSV), OR raw "text/csv" body
router.post('/bulk', upload.single('file'), async (req, res) => {
  try {
    let csvBuffer;
    if (req.file && req.file.buffer) {
      csvBuffer = req.file.buffer;
    } else if (req.is('text/csv') && req.body) {
      csvBuffer = Buffer.from(String(req.body));
    } else if (req.body && typeof req.body.csv === 'string') {
      // Optionally accept JSON { csv: "..." }
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

    // Header check
    const { ok, missing } = validateHeaders(Object.keys(records[0]));
    if (!ok) {
      return res.status(400).json({
        error: 'CSV header missing required columns.',
        missing_columns: missing,
        required_order: COLS,
      });
    }

    // Chunk inserts for safety (e.g., 500 rows per chunk)
    const CHUNK = 500;
    let totalInserted = 0;

    await db.query('BEGIN');

    for (let start = 0; start < records.length; start += CHUNK) {
      const slice = records.slice(start, start + CHUNK);
      // Ensure only defined columns are sent in correct order
      const mappedRows = slice.map((r) => {
        const obj = {};
        COLS.forEach((c) => (obj[c] = r[c]));
        return obj;
      });

      const { text, values } = buildBulkInsert(mappedRows);
      const result = await db.query(text, values);
      // result.rowCount counts attempted inserts; ON CONFLICT DO NOTHING will not increment for duplicates
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
    try {
      await db.query('ROLLBACK');
    } catch (_) {}
    console.error('Bulk insert error:', err);
    return res.status(500).json({ error: 'Internal server error during bulk insert.' });
  }
});

// ---- OPTIONAL: BULK UPSERT (update on conflict by stuid) ----
// Same CSV handling but with UPSERT; comment out if you don’t want it.
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

    // Build a single statement template for UPSERT
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

      const setCols = COLS.filter((c) => c !== 'stuid').map((c) => `${c} = EXCLUDED.${c}`);

      const text = `
        INSERT INTO public.student_master (${COLS.join(',')})
        VALUES ${placeholders.join(',')}
        ON CONFLICT (stuid) DO UPDATE SET
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
    try {
      await db.query('ROLLBACK');
    } catch (_) {}
    console.error('Bulk upsert error:', err);
    return res.status(500).json({ error: 'Internal server error during bulk upsert.' });
  }
});

// ---- CREATE one (JSON body) ----
router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    // Ensure all COLS exist (you may relax this if desired)
    const missing = COLS.filter((c) => !Object.prototype.hasOwnProperty.call(body, c));
    if (missing.length) {
      return res.status(400).json({ error: 'Missing required fields', missing });
    }

    const values = COLS.map((c) => norm(body[c]));
    const placeholders = COLS.map((_, i) => `$${i + 1}`);

    const text = `
      INSERT INTO public.student_master (${COLS.join(',')})
      VALUES (${placeholders.join(',')})
      ON CONFLICT (stuid) DO NOTHING
      RETURNING *
    `;

    const result = await db.query(text, values);
    if (result.rowCount === 0) {
      return res.status(409).json({ error: 'Duplicate stuid; row not inserted.' });
    }
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create student error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- LIST (basic pagination + optional filters) ----
// /?q=term&limit=50&offset=0
router.get('/', async (req, res) => {
  try {
    const { q, limit = 50, offset = 0 } = req.query;
    const where = [];
    const params = [];
    let i = 1;

    if (q) {
      where.push(
 `(stuid ILIKE $${i}
      OR stuname ILIKE $${i}
      OR stuemailid ILIKE $${i}
      OR stu_rollnumber ILIKE $${i}
      OR programdescription ILIKE $${i})`
      );
      params.push(`%${q}%`);
      i++;
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const listSql = `
      SELECT * FROM public.student_master
      ${whereSql}
      ORDER BY createdat DESC NULLS LAST
      LIMIT $${i++} OFFSET $${i++}
    `;
    params.push(Number(limit), Number(offset));

    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM public.student_master
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
    console.error('List students error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- READ one by stuid ----
router.get('/:stuid', async (req, res) => {
  try {
    const { stuid } = req.params;
    const result = await db.query(
      'SELECT * FROM public.student_master WHERE stuid = $1 LIMIT 1',
      [stuid]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('Get student error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- UPDATE one by stuid (partial) ----
router.put('/:stuid', async (req, res) => {
  try {
    const { stuid } = req.params;
    const { set, values, nextIndex } = buildUpdateSet(req.body || {});
    if (set.length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided.' });
    }
    const text = `
      UPDATE public.student_master
      SET ${set.join(', ')}
      WHERE stuid = $${nextIndex}
      RETURNING *
    `;
    const result = await db.query(text, [...values, stuid]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('Update student error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- DELETE one by stuid ----
router.delete('/:stuid', async (req, res) => {
  try {
    const { stuid } = req.params;
    const result = await db.query(
      'DELETE FROM public.student_master WHERE stuid = $1',
      [stuid]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    return res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Delete student error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;