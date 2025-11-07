// routes/exam_result_api.js
const express = require('express');
const router = express.Router();
const db = require('../config/db_conn');
const multer = require('multer');
const { parse } = require('csv-parse/sync');

const upload = multer({ storage: multer.memoryStorage() });

/* ===========================
 *  EXAM RESULT (existing)
 * ===========================
 */
const COLS = [
  'examresultid',
  'examresult_examid',
  'examstudentid',
  'exammarksobtained',
  'examgrade',
  'examremarks',
  'createdat',
  'updatedat',
  'examstudent_rollno',
  'examstudent_name',
  'examstudent_sem',
  'examtitle',
  'examstudent_program_id',
];

// normalize/trim; keep nulls for blanks
const norm = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === '') return null;
  return s;
};

function validateHeaders(headers) {
  const incoming = headers.map((h) => String(h || '').trim().toLowerCase());
  const required = COLS.map((c) => c.toLowerCase());
  const missing = required.filter((c) => !incoming.includes(c));
  return { ok: missing.length === 0, missing };
}

function buildBulkInsert(rows) {
  const placeholders = [];
  const values = [];
  let i = 1;

  rows.forEach((row) => {
    const rowVals = COLS.map((c) => norm(row[c]));
    values.push(...rowVals);
    placeholders.push(`(${COLS.map(() => `$${i++}`).join(',')})`);
  });

  const text = `
    INSERT INTO public.college_exam_result (${COLS.join(',')})
    VALUES ${placeholders.join(',')}
    ON CONFLICT (examresultid) DO NOTHING
  `;
  return { text, values };
}

function buildUpsertStatement(batch) {
  const placeholders = [];
  const values = [];
  let i = 1;

  batch.forEach((r) => {
    const rowVals = COLS.map((c) => norm(r[c]));
    values.push(...rowVals);
    placeholders.push(`(${COLS.map(() => `$${i++}`).join(',')})`);
  });

  const setCols = COLS.filter((c) => c !== 'examresultid')
    .map((c) => `${c} = EXCLUDED.${c}`);

  const text = `
    INSERT INTO public.college_exam_result (${COLS.join(',')})
    VALUES ${placeholders.join(',')}
    ON CONFLICT (examresultid) DO UPDATE SET
      ${setCols.join(', ')}
  `;
  return { text, values };
}

// ---- BULK INSERT (multipart/form-data "file", raw text/csv, or body.csv) ----
router.post('/bulk', upload.single('file'), async (req, res) => {
  try {
    let csvBuffer;
    if (req.file?.buffer) csvBuffer = req.file.buffer;
    else if (req.is('text/csv') && req.body) csvBuffer = Buffer.from(String(req.body));
    else if (typeof req.body?.csv === 'string') csvBuffer = Buffer.from(req.body.csv, 'utf8');
    else {
      return res.status(400).json({
        error:
          'CSV not provided. Upload as multipart/form-data "file", raw text/csv, or body.csv string.',
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
    let inserted = 0;

    await db.query('BEGIN');
    for (let start = 0; start < records.length; start += CHUNK) {
      const slice = records.slice(start, start + CHUNK).map((r) => {
        const obj = {};
        COLS.forEach((c) => (obj[c] = r[c]));
        return obj;
      });
      const { text, values } = buildBulkInsert(slice);
      const result = await db.query(text, values);
      inserted += result.rowCount || 0;
    }
    await db.query('COMMIT');

    return res.json({
      message: 'Bulk insert completed (duplicates skipped).',
      total_rows: records.length,
      inserted_rows: inserted,
      skipped_or_conflicted: records.length - inserted,
    });
  } catch (err) {
    try { await db.query('ROLLBACK'); } catch {}
    console.error('exam_result bulk error:', err);
    return res.status(500).json({ error: 'Internal server error during bulk insert.' });
  }
});

// ---- BULK UPSERT ----
router.post('/bulk-upsert', upload.single('file'), async (req, res) => {
  try {
    let csvBuffer;
    if (req.file?.buffer) csvBuffer = req.file.buffer;
    else if (req.is('text/csv') && req.body) csvBuffer = Buffer.from(String(req.body));
    else if (typeof req.body?.csv === 'string') csvBuffer = Buffer.from(req.body.csv, 'utf8');
    else {
      return res.status(400).json({
        error:
          'CSV not provided. Upload as multipart/form-data "file", raw text/csv, or body.csv string.',
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
    let affected = 0;

    await db.query('BEGIN');
    for (let start = 0; start < records.length; start += CHUNK) {
      const batch = records.slice(start, start + CHUNK);
      const { text, values } = buildUpsertStatement(batch);
      const result = await db.query(text, values);
      affected += result.rowCount || 0;
    }
    await db.query('COMMIT');

    return res.json({ message: 'Bulk upsert completed.', affected_rows: affected });
  } catch (err) {
    try { await db.query('ROLLBACK'); } catch {}
    console.error('exam_result upsert error:', err);
    return res.status(500).json({ error: 'Internal server error during bulk upsert.' });
  }
});

// ---- CREATE one (JSON body) ----
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
      INSERT INTO public.college_exam_result (${COLS.join(',')})
      VALUES (${placeholders.join(',')})
      ON CONFLICT (examresultid) DO NOTHING
      RETURNING *
    `;
    const result = await db.query(text, values);
    if (result.rowCount === 0) {
      return res.status(409).json({ error: 'Duplicate examresultid; row not inserted.' });
    }
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create exam_result error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- LIST (search + pagination) ----
// /?q=term&limit=50&offset=0  (search by id, student, examid, examtitle)
router.get('/', async (req, res) => {
  try {
    const { q, limit = 50, offset = 0 } = req.query;
    const where = [];
    const params = [];
    let i = 1;

    if (q) {
      where.push(
        `(examresultid ILIKE $${i} OR examresult_examid ILIKE $${i} OR examstudentid ILIKE $${i} OR examtitle ILIKE $${i})`
      );
      params.push(`%${q}%`);
      i++;
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const listSql = `
      SELECT *
      FROM public.college_exam_result
      ${whereSql}
      ORDER BY createdat DESC NULLS LAST
      LIMIT $${i++} OFFSET $${i++}
    `;
    params.push(Number(limit), Number(offset));

    const countSql = `SELECT COUNT(*)::int AS total FROM public.college_exam_result ${whereSql}`;

    const [list, count] = await Promise.all([
      db.query(listSql, params),
      db.query(countSql, where.length ? [params[0]] : []),
    ]);

    return res.json({ total: count.rows?.[0]?.total || 0, rows: list.rows });
  } catch (err) {
    console.error('List exam_result error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- READ one by examresultid ----
router.get('/:examresultid', async (req, res) => {
  try {
    const { examresultid } = req.params;
    const result = await db.query(
      'SELECT * FROM public.college_exam_result WHERE examresultid = $1 LIMIT 1',
      [examresultid]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Exam result not found' });
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('Get exam_result error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- UPDATE one (partial) ----
router.put('/:examresultid', async (req, res) => {
  try {
    const { examresultid } = req.params;
    const body = req.body || {};
    const set = [];
    const values = [];
    let idx = 1;

    COLS.forEach((c) => {
      if (c === 'examresultid') return; // key
      if (Object.prototype.hasOwnProperty.call(body, c)) {
        set.push(`${c} = $${idx++}`);
        values.push(norm(body[c]));
      }
    });

    if (!set.length) {
      return res.status(400).json({ error: 'No updatable fields provided.' });
    }

    const text = `
      UPDATE public.college_exam_result
      SET ${set.join(', ')}
      WHERE examresultid = $${idx}
      RETURNING *
    `;
    const result = await db.query(text, [...values, examresultid]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Exam result not found' });
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('Update exam_result error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- DELETE one ----
router.delete('/:examresultid', async (req, res) => {
  try {
    const { examresultid } = req.params;
    const result = await db.query(
      'DELETE FROM public.college_exam_result WHERE examresultid = $1',
      [examresultid]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Exam result not found' });
    return res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Delete exam_result error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ===================================================
 *  EXAM ROUTINE (manager) — aligned with ExamRoutine.jsx
 *  Base path (within this router): /exam-routine-manager
 *  Table expected: public.college_exam_routine
 *  Columns include JSX-linked fields: sem, section, program
 * ===================================================
 */
const ROUTINE_COLS = [
  'examid',
  'examofferid',
  'examtermid',
  'examtype',
  'examtitle',
  'examdate',
  'examst_time',
  'examen_time',
  'examroomid',
  'exammaxmarks',
  'examwtpercentge',
  'examcondby',
  'examremarks',
  // linked display fields (auto-filled from offering)
  'sem',
  'section',
  'program',
  'createdat',
  'updatedat',
];

// LIST all routines
router.get('/exam-routine-manager', async (_req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM public.college_exam_routine ORDER BY createdat DESC NULLS LAST'
    );
    // ExamRoutine.jsx accepts array or {routines: []}
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error fetching exam routines:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// READ one by examid
router.get('/exam-routine-manager/:examid', async (req, res) => {
  const { examid } = req.params;
  try {
    const result = await db.query(
      'SELECT * FROM public.college_exam_routine WHERE examid = $1 LIMIT 1',
      [examid]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Exam routine not found' });
    }
    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching exam routine:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// CREATE one
router.post('/exam-routine-manager', async (req, res) => {
  try {
    const body = req.body || {};
    // minimally require examid (your JSX pre-fills it)
    if (!body.examid) {
      return res.status(400).json({ error: 'Missing required field: examid' });
    }

    const colsToInsert = ROUTINE_COLS.filter((c) => c !== 'createdat' && c !== 'updatedat');
    const values = colsToInsert.map((c) => norm(body[c]));
    const placeholders = colsToInsert.map((_, i) => `$${i + 1}`);

    const text = `
      INSERT INTO public.college_exam_routine (${colsToInsert.join(',')}, createdat, updatedat)
      VALUES (${placeholders.join(',')}, NOW(), NOW())
      ON CONFLICT (examid) DO NOTHING
      RETURNING *
    `;
    const result = await db.query(text, values);

    if (result.rowCount === 0) {
      return res.status(409).json({ error: 'Duplicate examid; row not inserted.' });
    }
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating exam routine:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// UPDATE one (partial)
router.put('/exam-routine-manager/:examid', async (req, res) => {
  const { examid } = req.params;
  const body = req.body || {};
  try {
    const set = [];
    const values = [];
    let idx = 1;

    ROUTINE_COLS.forEach((c) => {
      if (c === 'examid' || c === 'createdat' || c === 'updatedat') return;
      if (Object.prototype.hasOwnProperty.call(body, c)) {
        set.push(`${c} = $${idx++}`);
        values.push(norm(body[c]));
      }
    });

    // always bump updatedat
    set.push(`updatedat = NOW()`);

    if (set.length === 1) { // only updatedat
      return res.status(400).json({ error: 'No updatable fields provided.' });
    }

    const text = `
      UPDATE public.college_exam_routine
      SET ${set.join(', ')}
      WHERE examid = $${idx}
      RETURNING *
    `;
    const result = await db.query(text, [...values, examid]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Exam routine not found' });
    }
    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Error updating exam routine:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE one (primary path used by JSX)
router.delete('/exam-routine-manager/:examid', async (req, res) => {
  const { examid } = req.params;
  try {
    const result = await db.query(
      'DELETE FROM public.college_exam_routine WHERE examid = $1 RETURNING examid',
      [examid]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Exam routine not found' });
    }
    return res.status(200).json({ message: 'Exam routine deleted', examid: result.rows[0].examid });
  } catch (err) {
    console.error('Error deleting exam routine:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE (fallbacks to match ExamRoutine.jsx deleteRoutineAPI)
router.delete('/exam-routine-manager/delete/:examid', async (req, res) => {
  const { examid } = req.params;
  try {
    const result = await db.query(
      'DELETE FROM public.college_exam_routine WHERE examid = $1 RETURNING examid',
      [examid]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Exam routine not found' });
    }
    return res.status(200).json({ message: 'Exam routine deleted', examid: result.rows[0].examid });
  } catch (err) {
    console.error('Error deleting exam routine:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/exam-routine-manager', async (req, res) => {
  const examid = req.body?.examid;
  if (!examid) return res.status(400).json({ error: 'examid is required in body' });
  try {
    const result = await db.query(
      'DELETE FROM public.college_exam_routine WHERE examid = $1 RETURNING examid',
      [examid]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Exam routine not found' });
    }
    return res.status(200).json({ message: 'Exam routine deleted', examid: result.rows[0].examid });
  } catch (err) {
    console.error('Error deleting exam routine:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/exam-routine-manager/delete', async (req, res) => {
  const examid = req.body?.examid;
  if (!examid) return res.status(400).json({ error: 'examid is required in body' });
  try {
    const result = await db.query(
      'DELETE FROM public.college_exam_routine WHERE examid = $1 RETURNING examid',
      [examid]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Exam routine not found' });
    }
    return res.status(200).json({ message: 'Exam routine deleted', examid: result.rows[0].examid });
  } catch (err) {
    console.error('Error deleting exam routine:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ===========================
 *  STUDENT MASTER (existing)
 * ===========================
 */

// Add new student
router.post('/students/add', async (req, res) => {
  const {
    stuid,
    stu_enrollmentnumber,
    stu_rollnumber,
    stu_regn_number,
    stuname,
    stuemailid,
    stumob1,
    stumob2,
    stucaste,
    stugender,
    studob,
    stucategory,
    stuadmissiondt,
    stu_course_id,
    stu_lat_entry,
    stu_curr_semester,
    stu_section,
    stuvalid,
    stuuserid,
    stuparentname,
    stuaddress,
    stuparentemailid,
    stuprentmob1,
    stuprentmob2,
    stuparentaddress,
    stu_inst_id,
  } = req.body;

  try {
    const result = await db.query(
      `INSERT INTO public.student_master (
        stuid, stu_enrollmentnumber, stu_rollnumber, stu_regn_number, stuname, 
        stuemailid, stumob1, stumob2, stucaste, stugender,
        studob, stucategory, stuadmissiondt, stu_course_id, stu_lat_entry,
        stu_curr_semester, stu_section, stuvalid, stuuserid, stuparentname,
        stuaddress, stuparentemailid, stuprentmob1, stuprentmob2, stuparentaddress,
        stu_inst_id, createdat, updatedat
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25,
        $26, NOW(), NOW()
      ) RETURNING *`,
      [
        stuid, stu_enrollmentnumber, stu_rollnumber, stu_regn_number, stuname,
        stuemailid, stumob1, stumob2, stucaste, stugender,
        studob, stucategory, stuadmissiondt, stu_course_id, stu_lat_entry,
        stu_curr_semester, stu_section, stuvalid, stuuserid, stuparentname,
        stuaddress, stuparentemailid, stuprentmob1, stuprentmob2, stuparentaddress,
        stu_inst_id,
      ]
    );

    res.status(201).json({ message: 'Student added successfully', student: result.rows[0] });
  } catch (error) {
    console.error('Add Student Error:', error);
    res.status(500).json({ error: 'Failed to add student' });
  }
});

// Update student
router.put('/students/update/:stuid', async (req, res) => {
  const { stuid } = req.params;
  const {
    stu_enrollmentnumber,
    stu_rollnumber,
    stu_regn_number,
    stuname,
    stuemailid,
    stumob1,
    stumob2,
    stucaste,
    stugender,
    studob,
    stucategory,
    stuadmissiondt,
    stu_course_id,
    stu_lat_entry,
    stu_curr_semester,
    stu_section,
    stuvalid,
    stuuserid,
    stuparentname,
    stuaddress,
    stuparentemailid,
    stuprentmob1,
    stuprentmob2,
    stuparentaddress,
    stu_inst_id,
  } = req.body;

  try {
    const result = await db.query(
      `UPDATE public.student_master SET
        stu_enrollmentnumber = $1, stu_rollnumber = $2, stu_regn_number = $3, stuname = $4,
        stuemailid = $5, stumob1 = $6, stumob2 = $7, stucaste = $8, stugender = $9,
        studob = $10, stucategory = $11, stuadmissiondt = $12, stu_course_id = $13, stu_lat_entry = $14,
        stu_curr_semester = $15, stu_section = $16, stuvalid = $17, stuuserid = $18, stuparentname = $19,
        stuaddress = $20, stuparentemailid = $21, stuprentmob1 = $22, stuprentmob2 = $23, stuparentaddress = $24,
        stu_inst_id = $25, updatedat = NOW()
      WHERE stuid = $26 RETURNING *`,
      [
        stu_enrollmentnumber, stu_rollnumber, stu_regn_number, stuname,
        stuemailid, stumob1, stumob2, stucaste, stugender,
        studob, stucategory, stuadmissiondt, stu_course_id, stu_lat_entry,
        stu_curr_semester, stu_section, stuvalid, stuuserid, stuparentname,
        stuaddress, stuparentemailid, stuprentmob1, stuprentmob2, stuparentaddress,
        stu_inst_id, stuid,
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    res.json({ message: 'Student updated successfully', student: result.rows[0] });
  } catch (error) {
    console.error('Update Student Error:', error);
    res.status(500).json({ error: 'Failed to update student' });
  }
});

// Delete student
router.delete('/students/delete/:stuid', async (req, res) => {
  const { stuid } = req.params;

  try {
    const result = await db.query(
      'DELETE FROM public.student_master WHERE stuid = $1 RETURNING *',
      [stuid]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    res.json({ message: 'Student deleted successfully', student: result.rows[0] });
  } catch (error) {
    console.error('Delete Student Error:', error);
    res.status(500).json({ error: 'Failed to delete student' });
  }
});

// Get all students
router.get('/students/list', async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM public.student_master ORDER BY createdat DESC`
    );
    res.json({ students: result.rows });
  } catch (error) {
    console.error('Fetch Students Error:', error);
    res.status(500).json({ error: 'Failed to fetch students' });
  }
});

// Get student by ID
router.get('/students/:stuid', async (req, res) => {
  const { stuid } = req.params;

  try {
    const result = await db.query(
      'SELECT * FROM public.student_master WHERE stuid = $1',
      [stuid]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    res.json({ student: result.rows[0] });
  } catch (error) {
    console.error('Fetch Student Error:', error);
    res.status(500).json({ error: 'Failed to fetch student' });
  }
});

module.exports = router;
