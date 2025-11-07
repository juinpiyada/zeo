// routes/student_sem_progress.js
const express = require('express');
const router = express.Router();
const db = require('../config/db_conn');
const multer = require('multer');
const { parse } = require('csv-parse/sync');

const upload = multer({ storage: multer.memoryStorage() });

/* ------------------------------------------------------------------ */
/* CONFIG: target AY table                                             */
/* ------------------------------------------------------------------ */
const TABLE = 'public.ay_2025_2026';

/* ------------------------------------------------------------------ */
/* Column definition (order matters for CSV and INSERT/UPSERT)         */
/* Includes cgpa, remarks, scholrshipfees                              */
/* ------------------------------------------------------------------ */
const COLS = [
  'stuid',              // PK + FK to student_master(stuid)
  'role',
  'department',
  'factor_all_sem',     // jsonb string (e.g., {"1":1.0,"2":0.8})
  'present_factor',
  'sem1','sem2','sem3','sem4','sem5','sem6','sem7','sem8','sem9','sem10',
  'admission_date',
  'stuname',
  'created_at',
  'updated_at',
  // New fields in AY table
  'cgpa',               // numeric(4,2) with DB CHECK (0..10)
  'remarks',            // boolean
  'scholrshipfees'      // numeric(12,2) (spelling preserved)
];

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */
const norm = (v, col) => {
  if (v === undefined || v === null || v === '') return null;

  // Booleans
  if (col === 'remarks') {
    if (typeof v === 'boolean') return v;
    const s = String(v).trim().toLowerCase();
    if (['true','t','1','yes','y'].includes(s)) return true;
    if (['false','f','0','no','n'].includes(s)) return false;
    return null;
  }

  // Numerics
  if (
    col === 'cgpa' ||
    col === 'scholrshipfees' ||
    col === 'present_factor' ||
    /^sem\d+$/.test(col)
  ) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // JSONB
  if (col === 'factor_all_sem' && typeof v === 'object' && v !== null) {
    return JSON.stringify(v);
  }

  // Timestamps: pass as string; DB will validate/parse
  if (col === 'admission_date' || col === 'created_at' || col === 'updated_at') {
    const s = String(v).trim();
    return s === '' ? null : s;
  }

  // Default string
  return String(v).trim();
};

function buildBulkInsert(rows) {
  const placeholders = [];
  const values = [];
  let i = 1;
  rows.forEach((row) => {
    const rowPH = [];
    COLS.forEach((col) => {
      rowPH.push(`$${i++}`);
      values.push(norm(row[col], col));
    });
    placeholders.push(`(${rowPH.join(',')})`);
  });

  const text = `
    INSERT INTO ${TABLE} (${COLS.join(',')})
    VALUES
      ${placeholders.join(',')}
    ON CONFLICT (stuid) DO NOTHING
  `;
  return { text, values };
}

function buildUpdateSet(body) {
  const set = [];
  const values = [];
  let idx = 1;

  COLS.forEach((col) => {
    if (col === 'stuid') return; // key handled separately
    if (Object.prototype.hasOwnProperty.call(body, col)) {
      set.push(`${col} = $${idx++}`);
      values.push(norm(body[col], col));
    }
  });

  // If client didn't pass updated_at, auto-set it to NOW()
  if (!Object.prototype.hasOwnProperty.call(body, 'updated_at')) {
    set.push(`updated_at = NOW()`);
  }

  return { set, values, nextIndex: idx };
}

function validateHeaders(headers) {
  const incoming = headers.map((h) => String(h || '').trim().toLowerCase());
  const required = COLS.map((c) => c.toLowerCase());
  const missing = required.filter((c) => !incoming.includes(c));
  return { ok: missing.length === 0, missing };
}

/* ------------------------------------------------------------------ */
/* BULK CSV INSERT: multipart "file", raw text/csv, or body.csv string */
/* ------------------------------------------------------------------ */
router.post('/bulk', upload.single('file'), async (req, res) => {
  try {
    let csvBuffer;
    if (req.file?.buffer) csvBuffer = req.file.buffer;
    else if (req.is('text/csv') && req.body) csvBuffer = Buffer.from(String(req.body));
    else if (typeof req.body?.csv === 'string') csvBuffer = Buffer.from(req.body.csv, 'utf8');
    else {
      return res.status(400).json({
        error: 'CSV not provided. Upload as multipart/form-data "file", raw text/csv, or body.csv string.',
      });
    }

    const records = parse(csvBuffer, { columns: true, skip_empty_lines: true, trim: true });
    if (!records.length) return res.status(400).json({ error: 'CSV contains no data rows.' });

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
      const slice = records.slice(start, start + CHUNK).map((r) => {
        const obj = {};
        COLS.forEach((c) => (obj[c] = r[c]));
        return obj;
      });
      const { text, values } = buildBulkInsert(slice);
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
    console.error('AY /bulk error:', err);
    return res.status(500).json({ error: 'Internal server error during bulk insert.' });
  }
});

/* ------------------------------------------------------------------ */
/* BULK UPSERT by stuid                                                */
/* ------------------------------------------------------------------ */
router.post('/bulk-upsert', upload.single('file'), async (req, res) => {
  try {
    let csvBuffer;
    if (req.file?.buffer) csvBuffer = req.file.buffer;
    else if (req.is('text/csv') && req.body) csvBuffer = Buffer.from(String(req.body));
    else if (typeof req.body?.csv === 'string') csvBuffer = Buffer.from(req.body.csv, 'utf8');
    else {
      return res.status(400).json({
        error: 'CSV not provided. Upload as multipart/form-data "file", raw text/csv, or body.csv string.',
      });
    }

    const records = parse(csvBuffer, { columns: true, skip_empty_lines: true, trim: true });
    if (!records.length) return res.status(400).json({ error: 'CSV contains no data rows.' });

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
        const rowVals = COLS.map((c) => norm(r[c], c));
        values.push(...rowVals);
        placeholders.push(`(${COLS.map(() => `$${i++}`).join(',')})`);
      });

      const setCols = COLS
        .filter((c) => c !== 'stuid')
        .map((c) => (c === 'updated_at' ? `updated_at = NOW()` : `${c} = EXCLUDED.${c}`));

      const text = `
        INSERT INTO ${TABLE} (${COLS.join(',')})
        VALUES ${placeholders.join(',')}
        ON CONFLICT (stuid) DO UPDATE SET
          ${setCols.join(', ')}
      `;

      const result = await db.query(text, values);
      affectedTotal += result.rowCount || 0;
    }

    await db.query('COMMIT');
    return res.json({ message: 'Bulk upsert completed.', affected_rows: affectedTotal });
  } catch (err) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    console.error('AY /bulk-upsert error:', err);
    return res.status(500).json({ error: 'Internal server error during bulk upsert.' });
  }
});

/* ------------------------------------------------------------------ */
/* CREATE one (JSON body)                                              */
/* ------------------------------------------------------------------ */
router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const missing = ['stuid'].filter((c) => !Object.prototype.hasOwnProperty.call(body, c));
    if (missing.length) return res.status(400).json({ error: 'Missing required fields', missing });

    // Optional soft validation aligned with DB rules
    if (body.cgpa !== undefined) {
      const cg = Number(body.cgpa);
      if (Number.isFinite(cg) && (cg < 0 || cg > 10)) {
        return res.status(400).json({ error: 'cgpa must be between 0 and 10' });
      }
    }

    const values = COLS.map((c) => norm(body[c], c));
    const placeholders = COLS.map((_, i) => `$${i + 1}`);

    const text = `
      INSERT INTO ${TABLE} (${COLS.join(',')})
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
    console.error('AY create error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ------------------------------------------------------------------ */
/* LIST with search + paging                                           */
/* /student-sem-progress?q=term&limit=50&offset=0                      */
/* ------------------------------------------------------------------ */
router.get('/', async (req, res) => {
  try {
    const { q, limit = 50, offset = 0 } = req.query;
    const where = [];
    const params = [];
    let i = 1;

    if (q) {
      where.push(`(stuid ILIKE $${i} OR stuname ILIKE $${i} OR department ILIKE $${i})`);
      params.push(`%${q}%`);
      i++;
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const listSql = `
      SELECT *
      FROM ${TABLE}
      ${whereSql}
      ORDER BY created_at DESC NULLS LAST
      LIMIT $${i++} OFFSET $${i++}
    `;
    params.push(Number(limit), Number(offset));

    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM ${TABLE}
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
    console.error('AY list error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ------------------------------------------------------------------ */
/* READ one                                                            */
/* ------------------------------------------------------------------ */
router.get('/:stuid', async (req, res) => {
  try {
    const { stuid } = req.params;
    const result = await db.query(
      `SELECT * FROM ${TABLE} WHERE stuid = $1 LIMIT 1`,
      [stuid]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Row not found' });
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('AY read error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ------------------------------------------------------------------ */
/* UPDATE (partial)                                                    */
/* ------------------------------------------------------------------ */
router.put('/:stuid', async (req, res) => {
  try {
    const { stuid } = req.params;

    if (req.body?.cgpa !== undefined) {
      const cg = Number(req.body.cgpa);
      if (Number.isFinite(cg) && (cg < 0 || cg > 10)) {
        return res.status(400).json({ error: 'cgpa must be between 0 and 10' });
      }
    }

    const { set, values, nextIndex } = buildUpdateSet(req.body || {});
    if (set.length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided.' });
    }
    const text = `
      UPDATE ${TABLE}
      SET ${set.join(', ')}
      WHERE stuid = $${nextIndex}
      RETURNING *
    `;
    const result = await db.query(text, [...values, stuid]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Row not found' });
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('AY update error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ------------------------------------------------------------------ */
/* DELETE                                                              */
/* ------------------------------------------------------------------ */
router.delete('/:stuid', async (req, res) => {
  try {
    const { stuid } = req.params;
    const result = await db.query(
      `DELETE FROM ${TABLE} WHERE stuid = $1`,
      [stuid]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Row not found' });
    return res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('AY delete error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
