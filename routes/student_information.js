// routes/student_information.js
const express = require('express');
const cors = require('cors');
const router = express.Router();
const pool = require('../config/db_conn'); // adjust path if needed

router.use(cors());
router.use(express.json());

/* ------------------------ helpers ------------------------ */
const VALID_SCALES = new Set(['PCT', 'CGPA']);

/** Turn "" into null so DB accepts nullable fields cleanly */
function nullifyEmpty(v) {
  return (v === '' || v === undefined) ? null : v;
}

/** Validate a (scale, value) pair:
 *  - PCT: 0..100
 *  - CGPA: 0..10
 *  - Any nulls skip validation (DB has checks too)
 */
function validateScalePair(scale, value, label) {
  const s = nullifyEmpty(scale);
  const val = value === '' || value === undefined ? null : Number(value);

  if (s && !VALID_SCALES.has(String(s))) {
    return `${label}: scale must be 'PCT' or 'CGPA'`;
  }
  if (s && val != null && !Number.isNaN(val)) {
    if (s === 'PCT' && !(val >= 0 && val <= 100)) {
      return `${label}: value must be between 0 and 100 for PCT`;
    }
    if (s === 'CGPA' && !(val >= 0 && val <= 10)) {
      return `${label}: value must be between 0 and 10 for CGPA`;
    }
  }
  return null;
}

/** Validate all scale/value pairs from body. Returns first error message or null. */
function validateBodyScales(body) {
  const checks = [
    ['class10_grade_scale', 'class10_gradepoint', 'Class 10'],
    ['class12_grade_scale', 'class12_gradepoint', 'Class 12'],
    ['diploma_overall_scale', 'diploma_overall_gradept', 'Diploma overall'],
    ['sem1_scale', 'sem1_gradepoint', 'Diploma Sem1'],
    ['sem2_scale', 'sem2_gradepoint', 'Diploma Sem2'],
    ['sem3_scale', 'sem3_gradepoint', 'Diploma Sem3'],
    ['sem4_scale', 'sem4_gradepoint', 'Diploma Sem4'],
    ['sem5_scale', 'sem5_gradepoint', 'Diploma Sem5'],
    ['sem6_scale', 'sem6_gradepoint', 'Diploma Sem6'],
  ];
  for (const [sKey, vKey, label] of checks) {
    const err = validateScalePair(body[sKey], body[vKey], label);
    if (err) return err;
  }
  return null;
}

/** Build an array of values in the exact order used by SQL (shared by add/update) */
function buildValues(body, includeTimestamps = true) {
  const now = new Date();

  return [
    // PK + foreign key to student_master
    nullifyEmpty(body.stuid),

    // ===== CLASS 10 =====
    nullifyEmpty(body.class10_board),
    nullifyEmpty(body.class10_year_of_passing),
    nullifyEmpty(body.class10_grade_scale),
    nullifyEmpty(body.class10_gradepoint),
    nullifyEmpty(body.class10_marks_total),

    // ===== CLASS 12 =====
    nullifyEmpty(body.class12_board),
    nullifyEmpty(body.class12_year_of_passing),
    nullifyEmpty(body.class12_grade_scale),
    nullifyEmpty(body.class12_gradepoint),
    nullifyEmpty(body.class12_marks_total),
    nullifyEmpty(body.class12_stream),

    // ===== DIPLOMA =====
    nullifyEmpty(body.diploma_board),
    nullifyEmpty(body.diploma_year_of_passing),
    nullifyEmpty(body.diploma_overall_scale),
    nullifyEmpty(body.diploma_overall_gradept),

    // Sem 1..6
    nullifyEmpty(body.sem1_scale),
    nullifyEmpty(body.sem1_gradepoint),
    nullifyEmpty(body.sem2_scale),
    nullifyEmpty(body.sem2_gradepoint),
    nullifyEmpty(body.sem3_scale),
    nullifyEmpty(body.sem3_gradepoint),
    nullifyEmpty(body.sem4_scale),
    nullifyEmpty(body.sem4_gradepoint),
    nullifyEmpty(body.sem5_scale),
    nullifyEmpty(body.sem5_gradepoint),
    nullifyEmpty(body.sem6_scale),
    nullifyEmpty(body.sem6_gradepoint),

    // timestamps
    ...(includeTimestamps ? [now, now] : [now]) // for INSERT: createdat, updatedat | for UPDATE: updatedat only
  ];
}

/* ------------------------ CREATE ------------------------ */
/**
 * Add new student_information row (one row per stuid)
 */
router.post('/add', async (req, res) => {
  try {
    if (!req.body.stuid) {
      return res.status(400).json({ error: 'stuid is required' });
    }

    const vErr = validateBodyScales(req.body);
    if (vErr) return res.status(400).json({ error: vErr });

    const vals = buildValues(req.body, true);

    const sql = `
      INSERT INTO public.student_information (
        stuid,
        class10_board, class10_year_of_passing, class10_grade_scale, class10_gradepoint, class10_marks_total,
        class12_board, class12_year_of_passing, class12_grade_scale, class12_gradepoint, class12_marks_total, class12_stream,
        diploma_board, diploma_year_of_passing, diploma_overall_scale, diploma_overall_gradept,
        sem1_scale, sem1_gradepoint, sem2_scale, sem2_gradepoint, sem3_scale, sem3_gradepoint,
        sem4_scale, sem4_gradepoint, sem5_scale, sem5_gradepoint, sem6_scale, sem6_gradepoint,
        createdat, updatedat
      ) VALUES (
        $1,
        $2,$3,$4,$5,$6,
        $7,$8,$9,$10,$11,$12,
        $13,$14,$15,$16,
        $17,$18,$19,$20,$21,$22,
        $23,$24,$25,$26,$27,$28,
        $29,$30
      )
      RETURNING *;
    `;

    const result = await pool.query(sql, vals);
    return res.status(201).json({
      message: 'student_information added successfully',
      student_information: result.rows[0]
    });
  } catch (error) {
    console.error('Add student_information Error:', error);
    if (error.code === '23503') {
      // FK violation: no matching student_master(stuid)
      return res.status(400).json({ error: 'Invalid stuid (foreign key not found in student_master)' });
    }
    if (error.code === '23505') {
      // unique violation on PK (stuid already exists)
      return res.status(409).json({ error: 'student_information for this stuid already exists' });
    }
    return res.status(500).json({ error: 'Failed to add student_information' });
  }
});

/* ------------------------ UPDATE ------------------------ */
/**
 * Update student_information by stuid
 */
router.put('/update/:stuid', async (req, res) => {
  const { stuid } = req.params;

  try {
    if (!stuid) return res.status(400).json({ error: 'stuid param is required' });

    const vErr = validateBodyScales(req.body);
    if (vErr) return res.status(400).json({ error: vErr });

    // NOTE: stuid (PK) is from params and will NOT be updated.
    const vals = [
      // class10...
      nullifyEmpty(req.body.class10_board),
      nullifyEmpty(req.body.class10_year_of_passing),
      nullifyEmpty(req.body.class10_grade_scale),
      nullifyEmpty(req.body.class10_gradepoint),
      nullifyEmpty(req.body.class10_marks_total),

      // class12...
      nullifyEmpty(req.body.class12_board),
      nullifyEmpty(req.body.class12_year_of_passing),
      nullifyEmpty(req.body.class12_grade_scale),
      nullifyEmpty(req.body.class12_gradepoint),
      nullifyEmpty(req.body.class12_marks_total),
      nullifyEmpty(req.body.class12_stream),

      // diploma...
      nullifyEmpty(req.body.diploma_board),
      nullifyEmpty(req.body.diploma_year_of_passing),
      nullifyEmpty(req.body.diploma_overall_scale),
      nullifyEmpty(req.body.diploma_overall_gradept),

      // sem 1..6
      nullifyEmpty(req.body.sem1_scale),
      nullifyEmpty(req.body.sem1_gradepoint),
      nullifyEmpty(req.body.sem2_scale),
      nullifyEmpty(req.body.sem2_gradepoint),
      nullifyEmpty(req.body.sem3_scale),
      nullifyEmpty(req.body.sem3_gradepoint),
      nullifyEmpty(req.body.sem4_scale),
      nullifyEmpty(req.body.sem4_gradepoint),
      nullifyEmpty(req.body.sem5_scale),
      nullifyEmpty(req.body.sem5_gradepoint),
      nullifyEmpty(req.body.sem6_scale),
      nullifyEmpty(req.body.sem6_gradepoint),

      // updatedat
      new Date(),

      // where stuid = ?
      stuid
    ];

    const sql = `
      UPDATE public.student_information SET
        class10_board = $1,
        class10_year_of_passing = $2,
        class10_grade_scale = $3,
        class10_gradepoint = $4,
        class10_marks_total = $5,

        class12_board = $6,
        class12_year_of_passing = $7,
        class12_grade_scale = $8,
        class12_gradepoint = $9,
        class12_marks_total = $10,
        class12_stream = $11,

        diploma_board = $12,
        diploma_year_of_passing = $13,
        diploma_overall_scale = $14,
        diploma_overall_gradept = $15,

        sem1_scale = $16,
        sem1_gradepoint = $17,
        sem2_scale = $18,
        sem2_gradepoint = $19,
        sem3_scale = $20,
        sem3_gradepoint = $21,
        sem4_scale = $22,
        sem4_gradepoint = $23,
        sem5_scale = $24,
        sem5_gradepoint = $25,
        sem6_scale = $26,
        sem6_gradepoint = $27,

        updatedat = $28
      WHERE stuid = $29
      RETURNING *;
    `;

    const result = await pool.query(sql, vals);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'student_information not found' });
    }
    return res.json({
      message: 'student_information updated successfully',
      student_information: result.rows[0]
    });
  } catch (error) {
    console.error('Update student_information Error:', error);
    return res.status(500).json({ error: 'Failed to update student_information' });
  }
});

/* ------------------------ DELETE ------------------------ */
/**
 * Delete student_information by stuid
 */
router.delete('/delete/:stuid', async (req, res) => {
  const { stuid } = req.params;
  try {
    const result = await pool.query(
      'DELETE FROM public.student_information WHERE stuid = $1 RETURNING *',
      [stuid]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'student_information not found' });
    }
    return res.json({
      message: 'student_information deleted successfully',
      student_information: result.rows[0]
    });
  } catch (error) {
    console.error('Delete student_information Error:', error);
    return res.status(500).json({ error: 'Failed to delete student_information' });
  }
});

/* ------------------------ READ (LIST) ------------------------ */
/**
 * Get all student_information rows
 */
router.get('/list', async (_req, res) => {
  try {
    const sql = `
      SELECT *
      FROM public.student_information
      ORDER BY COALESCE(updatedat, createdat) DESC;
    `;
    const result = await pool.query(sql);
    return res.json({ student_information: result.rows });
  } catch (error) {
    console.error('Fetch student_information list Error:', error);
    return res.status(500).json({ error: 'Failed to fetch student_information list' });
  }
});

/* ------------------------ READ (ONE) ------------------------ */
/**
 * Get one student_information by stuid
 */
router.get('/:stuid', async (req, res) => {
  const { stuid } = req.params;
  try {
    const result = await pool.query(
      'SELECT * FROM public.student_information WHERE stuid = $1',
      [stuid]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'student_information not found' });
    }
    return res.json({ student_information: result.rows[0] });
  } catch (error) {
    console.error('Fetch student_information Error:', error);
    return res.status(500).json({ error: 'Failed to fetch student_information' });
  }
});

module.exports = router;