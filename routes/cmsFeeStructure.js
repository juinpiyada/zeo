// routes/cms_fee_structure.js
const express = require('express');
const router = express.Router();
const db = require('../config/db_conn');

// Toggle default cascade behavior here
// true = update students on POST by default (can be overridden with ?applyToStudents=false)
const APPLY_TO_STUDENTS_BY_DEFAULT = true;

// Match mode default:
// 'course'     -> update all with same stu_course_id (YOUR REQUESTED DEFAULT)
// 'course_sem' -> update only those with same stu_course_id AND semester
const CASCADE_MATCH_MODE_DEFAULT = 'course';

// Utility: safe integer 1..8
function normalizeSemesterNumber(v) {
  const n = Number(v);
  if (!Number.isInteger(n)) return null;
  if (n < 1 || n > 8) return null;
  return n;
}

router.get('/', async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM public.cms_fee_structure ORDER BY createdat DESC`
    );
    return res.status(200).json({ feeStructures: result.rows });
  } catch (err) {
    console.error('Error fetching fee structures:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `SELECT * FROM public.cms_fee_structure WHERE fee_struct_id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Fee Structure not found' });
    }
    return res.status(200).json({ feeStructure: result.rows[0] });
  } catch (err) {
    console.error('Error fetching fee structure:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req, res) => {
  const {
    fee_struct_id,
    fee_prg_id: rawPrgId,
    fee_acad_year,
    fee_semester_no: rawSem,
    fee_head,
    fee_amount,
    fee_is_mandatory,
    fee_due_dt,
    fee_remarks
  } = req.body;

  // optional overrides via query
  const applyToStudents =
    (typeof req.query.applyToStudents === 'string')
      ? req.query.applyToStudents.toLowerCase() === 'true'
      : APPLY_TO_STUDENTS_BY_DEFAULT;

  // match mode: 'course' (default) or 'course_sem'
  const matchMode = (req.query.matchMode || CASCADE_MATCH_MODE_DEFAULT).toLowerCase() === 'course_sem'
    ? 'course_sem'
    : 'course';

  if (!fee_struct_id || !rawPrgId || !fee_head) {
    return res.status(400).json({
      error: 'Required fields are missing (fee_struct_id, fee_prg_id, fee_head)'
    });
  }

  // Require a valid numeric semester (1..8) and normalize to int (we store it, even if we match by course only)
  const sem = normalizeSemesterNumber(rawSem);
  if (sem === null) {
    return res.status(400).json({ error: 'fee_semester_no must be an integer between 1 and 8' });
  }

  if (fee_amount === undefined || fee_amount === null || isNaN(Number(fee_amount))) {
    return res.status(400).json({ error: 'fee_amount must be a valid number' });
  }

  const amount = Number(fee_amount);
  const fee_prg_id = String(rawPrgId).trim(); // normalize whitespace

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // 1) Insert fee structure row (store semester as int)
    const insert = await client.query(
      `INSERT INTO public.cms_fee_structure (
        fee_struct_id, fee_prg_id, fee_acad_year, fee_semester_no,
        fee_head, fee_amount, fee_is_mandatory, fee_due_dt, fee_remarks,
        createdat, updatedat
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9, NOW(), NOW()
      ) RETURNING *`,
      [
        fee_struct_id,
        fee_prg_id,
        fee_acad_year,
        sem,
        fee_head,
        amount,
        (fee_is_mandatory ?? true),
        fee_due_dt,
        fee_remarks
      ]
    );

    // Pre-compute both match counts for transparency in the response
    const countCourseOnlyRes = await client.query(
      `SELECT COUNT(*)::int AS cnt
         FROM public.student_master
        WHERE UPPER(TRIM(stu_course_id)) = UPPER(TRIM($1))`,
      [fee_prg_id]
    );
    const matchedCourseOnly = countCourseOnlyRes.rows?.[0]?.cnt ?? 0;

    const countCourseSemRes = await client.query(
      `SELECT COUNT(*)::int AS cnt
         FROM public.student_master
        WHERE UPPER(TRIM(stu_course_id)) = UPPER(TRIM($1))
          AND (
            CASE
              WHEN stu_curr_semester ~ '^[0-9]+$' THEN stu_curr_semester::int
              ELSE NULL
            END
          ) = $2`,
      [fee_prg_id, sem]
    );
    const matchedCourseSem = countCourseSemRes.rows?.[0]?.cnt ?? 0;

    let updatedStudents = 0;

    if (applyToStudents) {
      if (matchMode === 'course') {
        // 2A) Cascade by COURSE ONLY (requested default)
        const upd = await client.query(
          `UPDATE public.student_master
              SET seemfees = COALESCE(seemfees, 0)::numeric + $1::numeric,
                  updatedat = NOW()
            WHERE UPPER(TRIM(stu_course_id)) = UPPER(TRIM($2))`,
          [amount, fee_prg_id]
        );
        updatedStudents = upd.rowCount;
      } else {
        // 2B) Cascade by COURSE + SEM (optional)
        const upd = await client.query(
          `UPDATE public.student_master
              SET seemfees = COALESCE(seemfees, 0)::numeric + $1::numeric,
                  updatedat = NOW()
            WHERE UPPER(TRIM(stu_course_id)) = UPPER(TRIM($2))
              AND (
                CASE
                  WHEN stu_curr_semester ~ '^[0-9]+$' THEN stu_curr_semester::int
                  ELSE NULL
                END
              ) = $3`,
          [amount, fee_prg_id, sem]
        );
        updatedStudents = upd.rowCount;
      }
    }

    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Fee Structure added',
      feeStructure: insert.rows[0],
      appliedToStudents: applyToStudents,
      matchMode,
      matchedCourseOnly,
      matchedCourseSem,
      updatedStudents
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error adding fee structure:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  } finally {
    client.release();
  }
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const {
    fee_prg_id,
    fee_acad_year,
    fee_semester_no,
    fee_head,
    fee_amount,
    fee_is_mandatory,
    fee_due_dt,
    fee_remarks
  } = req.body;

  // Optional: validate semester if present
  let semValue = fee_semester_no;
  if (semValue !== undefined && semValue !== null) {
    const sem = normalizeSemesterNumber(semValue);
    if (sem === null) {
      return res.status(400).json({ error: 'fee_semester_no must be an integer between 1 and 8 if provided' });
    }
    semValue = sem;
  }

  // Basic numeric check if present
  if (fee_amount !== undefined && fee_amount !== null && isNaN(Number(fee_amount))) {
    return res.status(400).json({ error: 'fee_amount must be a valid number if provided' });
  }

  try {
    const result = await db.query(
      `UPDATE public.cms_fee_structure SET
        fee_prg_id = $1,
        fee_acad_year = $2,
        fee_semester_no = $3,
        fee_head = $4,
        fee_amount = $5,
        fee_is_mandatory = $6,
        fee_due_dt = $7,
        fee_remarks = $8,
        updatedat = NOW()
      WHERE fee_struct_id = $9
      RETURNING *`,
      [
        fee_prg_id,
        fee_acad_year,
        (semValue === undefined || semValue === null) ? null : Number(semValue),
        fee_head,
        (fee_amount === undefined || fee_amount === null) ? null : Number(fee_amount),
        fee_is_mandatory,
        fee_due_dt,
        fee_remarks,
        id
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Fee Structure not found' });
    }

    // NOTE: PUT does not reconcile seemfees (to avoid complex deltas).

    return res.status(200).json({ message: 'Fee Structure updated', feeStructure: result.rows[0] });
  } catch (err) {
    console.error('Error updating fee structure:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await db.query(
      `DELETE FROM public.cms_fee_structure WHERE fee_struct_id = $1 RETURNING *`,
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Fee Structure not found' });
    }
    return res.status(200).json({ message: 'Fee Structure deleted', feeStructure: result.rows[0] });
  } catch (err) {
    console.error('Error deleting fee structure:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;