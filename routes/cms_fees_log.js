// routes/student_master_api.js
const express = require('express');
const router = express.Router();
const db = require('../config/db_conn');

/**
 * student_master schema (excerpt)
 * - stuid (PK)
 * - stuname
 * - stu_course_id (FK -> master_course.courseid)
 * - semfees numeric(12,2) NOT NULL DEFAULT 0.00
 * - scholrshipfees numeric(12,2) NOT NULL DEFAULT 0.00
 * - seemfees numeric(12,2) DEFAULT 0.00
 * ...plus many other columns listed below
 */

const ALL_COLUMNS = [
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
  'semfees',
  'scholrshipfees',
  'seemfees',
];

const KEY_FIELDS = [
  'stuid',
  'stuname',
  'stu_course_id',
  'semfees',
  'scholrshipfees',
  'seemfees',
];

/* ----------------------- helpers ----------------------- */
function toNull(v) {
  return v === undefined || v === '' ? null : v;
}
function parseMoney(v, fallback = null) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Number(n.toFixed(2));
}
function buildInsertFromBody(body) {
  // Only include columns we know about and that are present in the body
  const cols = [];
  const vals = [];
  const params = [];

  ALL_COLUMNS.forEach((c) => {
    if (body[c] !== undefined) {
      cols.push(c);
      params.push(`$${params.length + 1}`);

      // normalize money fields
      if (c === 'semfees' || c === 'scholrshipfees' || c === 'seemfees') {
        vals.push(parseMoney(body[c]));
      } else {
        vals.push(body[c]);
      }
    }
  });

  // always set timestamps if not provided
  if (!cols.includes('createdat')) {
    cols.push('createdat');
    params.push('NOW()');
  }
  if (!cols.includes('updatedat')) {
    cols.push('updatedat');
    params.push('NOW()');
  }

  return {
    sql: `INSERT INTO public.student_master (${cols.join(', ')})
          VALUES (${params.join(', ')})
          RETURNING ${ALL_COLUMNS.join(', ')}`,
    values: vals,
  };
}
function buildUpdateFromBody(id, body) {
  const sets = [];
  const vals = [];
  let i = 0;

  ALL_COLUMNS.forEach((c) => {
    if (c === 'stuid') return; // primary key set in WHERE
    if (body[c] !== undefined) {
      sets.push(`${c} = $${++i}`);
      if (c === 'semfees' || c === 'scholrshipfees' || c === 'seemfees') {
        vals.push(parseMoney(body[c]));
      } else {
        vals.push(body[c]);
      }
    }
  });

  // Always update updatedat
  sets.push(`updatedat = NOW()`);

  return {
    sql: `
      UPDATE public.student_master
         SET ${sets.join(', ')}
       WHERE stuid = $${++i}
       RETURNING ${ALL_COLUMNS.join(', ')}
    `,
    values: [...vals, id],
  };
}

/* ----------------------- routes ----------------------- */

/**
 * GET /api/student-master
 * List students (all columns)
 * Query:
 *  - q: search in stuid, stuname (case-insensitive)
 *  - courseId: filter by stu_course_id (case-insensitive)
 *  - limit, offset: pagination (defaults 50, 0)
 */
router.get('/', async (req, res) => {
  const { q, courseId } = req.query;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const where = [];
  const vals = [];

  if (q) {
    vals.push(`%${q.trim().toLowerCase()}%`);
    where.push(`(LOWER(stuid) LIKE $${vals.length} OR LOWER(stuname) LIKE $${vals.length})`);
  }
  if (courseId) {
    vals.push(courseId.trim());
    where.push(`UPPER(TRIM(stu_course_id)) = UPPER(TRIM($${vals.length}))`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const result = await db.query(
      `
      SELECT ${ALL_COLUMNS.join(', ')}
        FROM public.student_master
        ${whereSql}
    ORDER BY COALESCE(updatedat, createdat) DESC NULLS LAST, stuname ASC
       LIMIT $${vals.length + 1}
      OFFSET $${vals.length + 2}
      `,
      [...vals, limit, offset]
    );
    return res.status(200).json({
      students: result.rows,
      limit,
      offset,
      count: result.rows.length,
    });
  } catch (err) {
    console.error('Error fetching students:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/student-master/basic
 * Focused list with only the key fields requested:
 *  stuid, stuname, stu_course_id, semfees, scholrshipfees, seemfees
 * Same filters and pagination as the main list.
 */
router.get('/basic', async (req, res) => {
  const { q, courseId } = req.query;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 1000);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const where = [];
  const vals = [];

  if (q) {
    vals.push(`%${q.trim().toLowerCase()}%`);
    where.push(`(LOWER(stuid) LIKE $${vals.length} OR LOWER(stuname) LIKE $${vals.length})`);
  }
  if (courseId) {
    vals.push(courseId.trim());
    where.push(`UPPER(TRIM(stu_course_id)) = UPPER(TRIM($${vals.length}))`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const result = await db.query(
      `
      SELECT ${KEY_FIELDS.join(', ')}
        FROM public.student_master
        ${whereSql}
    ORDER BY COALESCE(updatedat, createdat) DESC NULLS LAST, stuname ASC
       LIMIT $${vals.length + 1}
      OFFSET $${vals.length + 2}
      `,
      [...vals, limit, offset]
    );
    return res.status(200).json({
      students: result.rows,
      limit,
      offset,
      count: result.rows.length,
    });
  } catch (err) {
    console.error('Error fetching students (basic):', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/student-master/:id
 * Fetch a single student (all columns)
 */
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `SELECT ${ALL_COLUMNS.join(', ')} FROM public.student_master WHERE stuid = $1`,
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    return res.status(200).json({ student: result.rows[0] });
  } catch (err) {
    console.error('Error fetching student:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/student-master
 * Create a student. At minimum, require stuid, stuname, stu_course_id.
 * You can send any other columns; they will be included.
 */
router.post('/', async (req, res) => {
  const { stuid, stuname, stu_course_id } = req.body;

  if (!stuid || !stuname || !stu_course_id) {
    return res.status(400).json({
      error: 'stuid, stuname, and stu_course_id are required',
    });
  }

  // default numeric fields if not provided
  if (req.body.semfees === undefined) req.body.semfees = 0.0;
  if (req.body.scholrshipfees === undefined) req.body.scholrshipfees = 0.0;
  if (req.body.seemfees === undefined) req.body.seemfees = 0.0;

  try {
    const { sql, values } = buildInsertFromBody(req.body);
    const result = await db.query(sql, values);
    return res.status(201).json({
      message: 'Student created',
      student: result.rows[0],
    });
  } catch (err) {
    console.error('Error creating student:', err);
    // Unique/constraint surfaces nicely here too
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

/**
 * PUT /api/student-master/:id
 * Update a student. Body may contain any subset of columns.
 */
router.put('/:id', async (req, res) => {
  const { id } = req.params;

  // If explicitly provided, normalize the money fields
  if (req.body.semfees !== undefined) req.body.semfees = parseMoney(req.body.semfees);
  if (req.body.scholrshipfees !== undefined) req.body.scholrshipfees = parseMoney(req.body.scholrshipfees);
  if (req.body.seemfees !== undefined) req.body.seemfees = parseMoney(req.body.seemfees);

  try {
    const { sql, values } = buildUpdateFromBody(id, req.body);
    const result = await db.query(sql, values);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    return res.status(200).json({
      message: 'Student updated',
      student: result.rows[0],
    });
  } catch (err) {
    console.error('Error updating student:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

/**
 * DELETE /api/student-master/:id
 * Remove a student by stuid
 */
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const del = await db.query(
      `DELETE FROM public.student_master WHERE stuid = $1 RETURNING ${ALL_COLUMNS.join(', ')}`,
      [id]
    );
    if (del.rowCount === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    return res.status(200).json({
      message: 'Student deleted',
      student: del.rows[0],
    });
  } catch (err) {
    console.error('Error deleting student:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
