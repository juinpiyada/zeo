// routes/master_subject_api.js
const express = require('express');
const cors = require('cors');
const router = express.Router();
const pool = require('../config/db_conn'); // pg Pool

router.use(cors());
router.use(express.json());

/** Generate next SUB_COU_ID_### within the same transaction */
async function getNextSubjectCourseId(client) {
  const q = `
    SELECT COALESCE(
      MAX(
        CAST(REGEXP_REPLACE(sub_cou_id, '^SUB_COU_ID_(\\d+)$', '\\1') AS INTEGER)
      ), 0
    ) AS max_num
    FROM public.subject_course
  `;
  const r = await client.query(q);
  const next = String((r.rows[0]?.max_num || 0) + 1).padStart(3, '0');
  return `SUB_COU_ID_${next}`;
}

/**
 * Try to find exactly one Program Setup (course) to link.
 * If "semester" is available on the subject payload, match courseid by suffix `_S0?NN`.
 * Fallback to the first course if no regex match is found.
 */
async function pickOneCourse(client, semesterMaybe) {
  // Normalize semester to integer if present
  let sem = null;
  if (semesterMaybe !== undefined && semesterMaybe !== null && semesterMaybe !== '') {
    const n = Number(semesterMaybe);
    sem = Number.isFinite(n) ? n : null;
  }

  if (sem !== null) {
    const padded = String(sem).padStart(2, '0');      // 2  -> "02"
    const rx = `_S0?${sem}$`;                         // matches _S2 or _S02
    const queryBySem = `
      SELECT courseid
      FROM public.master_course
      WHERE courseid ~ $1
      ORDER BY courseid ASC
      LIMIT 1
    `;
    const bySem = await client.query(queryBySem, [rx]);
    if (bySem.rowCount > 0) return bySem.rows[0].courseid;
  }

  // Fallback: just pick the first course
  const fallback = await client.query(
    `SELECT courseid FROM public.master_course ORDER BY courseid ASC LIMIT 1`
  );
  return fallback.rowCount > 0 ? fallback.rows[0].courseid : null;
}

/**
 * ➕ Add New Subject
 * Also auto-create ONE mapping in subject_course (not all)
 */
router.post('/add', async (req, res) => {
  const {
    subjectid,
    subjectcode,
    subjectdesc,
    subjectcredits,
    subjectlecturehrs,
    subjecttutorialhrs,
    subjectpracticalhrs,
    subjectcoursetype,
    subjectcategory,
    subjectdeptid,
    subjectactive,

    // If your form sends any of these, we'll use it to choose ONE Program/semester:
    subjectsemester,   // preferred
    semester,          // alt
    subjectsem         // alt
  } = req.body;

  if (!subjectid || !subjectdesc) {
    return res.status(400).json({ error: 'subjectid and subjectdesc are required' });
  }

  const createdat = new Date();
  const updatedat = new Date();
  const semNo = subjectsemester ?? semester ?? subjectsem ?? null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Insert Subject
    const insertSubjectSQL = `
      INSERT INTO public.master_subject (
        subjectid, subjectcode, subjectdesc, subjectcredits, subjectlecturehrs,
        subjecttutorialhrs, subjectpracticalhrs, subjectcoursetype, subjectcategory,
        subjectdeptid, subjectactive, createdat, updatedat
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,$9,
        $10,$11,$12,$13
      ) RETURNING *
    `;
    const subjectRes = await client.query(insertSubjectSQL, [
      subjectid, subjectcode, subjectdesc, subjectcredits, subjectlecturehrs,
      subjecttutorialhrs, subjectpracticalhrs, subjectcoursetype, subjectcategory,
      subjectdeptid, subjectactive, createdat, updatedat
    ]);

    // 2) Decide exactly ONE Program Setup (course) to link
    const chosenCourseId = await pickOneCourse(client, semNo);

    // If there is no course at all, commit subject insert and return gracefully
    if (!chosenCourseId) {
      await client.query('COMMIT');
      return res.status(201).json({
        message: 'Subject added successfully (no Program Setup found to auto-link).',
        subject: subjectRes.rows[0],
        linkedPrograms: 0
      });
    }

    // 3) Prevent duplicates: Skip if mapping already exists
    const exists = await client.query(
      `SELECT 1 FROM public.subject_course
       WHERE sub_cou_mast_id = $1 AND sub_cou_mast_sub_id = $2
       LIMIT 1`,
      [chosenCourseId, subjectid]
    );
    if (exists.rowCount === 0) {
      const newId = await getNextSubjectCourseId(client);

      const insertSC = `
        INSERT INTO public.subject_course (
          sub_cou_id,
          sub_cou_mast_id,
          sub_cou_mast_sub_id,
          sub_cou_sem_no,
          sub_cou_iselective,
          sub_cou_electivegroupid,
          sub_cou_islab,
          sub_cou_isaactive,
          createdat,
          updatedat
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `;

      await client.query(insertSC, [
        newId,                 // sub_cou_id
        chosenCourseId,        // sub_cou_mast_id  (Program Setup)
        subjectid,             // sub_cou_mast_sub_id (Subject)
        semNo ?? null,         // sub_cou_sem_no (use the subject's semester if provided)
        false,                 // sub_cou_iselective
        null,                  // sub_cou_electivegroupid
        false,                 // sub_cou_islab
        true,                  // sub_cou_isaactive
        createdat,
        updatedat
      ]);
    }

    await client.query('COMMIT');
    return res.status(201).json({
      message: 'Subject added successfully and auto-linked to ONE program setup',
      subject: subjectRes.rows[0],
      linkedPrograms: exists?.rowCount === 0 ? 1 : 0,
      programLinkedTo: chosenCourseId
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Add Subject (with single auto-link) Error:', error);
    return res.status(500).json({ error: 'Failed to add subject & link program' });
  } finally {
    client.release();
  }
});

/**
 * 📝 Update Subject by ID
 */
router.put('/update/:subjectid', async (req, res) => {
  const { subjectid } = req.params;
  const {
    subjectcode,
    subjectdesc,
    subjectcredits,
    subjectlecturehrs,
    subjecttutorialhrs,
    subjectpracticalhrs,
    subjectcoursetype,
    subjectcategory,
    subjectdeptid,
    subjectactive
  } = req.body;

  const updatedat = new Date();

  try {
    const result = await pool.query(
      `UPDATE public.master_subject SET
        subjectcode = $1,
        subjectdesc = $2,
        subjectcredits = $3,
        subjectlecturehrs = $4,
        subjecttutorialhrs = $5,
        subjectpracticalhrs = $6,
        subjectcoursetype = $7,
        subjectcategory = $8,
        subjectdeptid = $9,
        subjectactive = $10,
        updatedat = $11
      WHERE subjectid = $12 RETURNING *`,
      [
        subjectcode, subjectdesc, subjectcredits, subjectlecturehrs,
        subjecttutorialhrs, subjectpracticalhrs, subjectcoursetype,
        subjectcategory, subjectdeptid, subjectactive, updatedat, subjectid
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Subject not found' });
    }
    res.json({ message: 'Subject updated successfully', subject: result.rows[0] });
  } catch (error) {
    console.error('Update Subject Error:', error);
    res.status(500).json({ error: 'Failed to update subject' });
  }
});

/**
 * ❌ Delete Subject by ID
 */
router.delete('/delete/:subjectid', async (req, res) => {
  const { subjectid } = req.params;

  try {
    const result = await pool.query(
      'DELETE FROM public.master_subject WHERE subjectid = $1 RETURNING *',
      [subjectid]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Subject not found' });
    }

    res.json({ message: 'Subject deleted successfully', subject: result.rows[0] });
  } catch (error) {
    console.error('Delete Subject Error:', error);
    res.status(500).json({ error: 'Failed to delete subject' });
  }
});

/**
 * Subject list endpoints
 */
router.get('/st', async (_req, res) => {
  try {
    const r = await pool.query(
      'SELECT subjectid FROM public.master_subject ORDER BY subjectid ASC'
    );
    res.json(r.rows);
  } catch (e) {
    console.error('Fetch Subject ID List Error:', e);
    res.status(500).json({ error: 'Failed to fetch subject list for selector' });
  }
});

router.get('/list', async (_req, res) => {
  try {
    const r = await pool.query(
      'SELECT * FROM public.master_subject ORDER BY createdat DESC'
    );
    res.json({ subjects: r.rows });
  } catch (e) {
    console.error('Fetch Subjects Error:', e);
    res.status(500).json({ error: 'Failed to fetch subjects' });
  }
});

router.get('/:subjectid', async (req, res) => {
  const { subjectid } = req.params;
  try {
    const r = await pool.query(
      'SELECT * FROM public.master_subject WHERE subjectid = $1',
      [subjectid]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Subject not found' });
    res.json({ subject: r.rows[0] });
  } catch (e) {
    console.error('Fetch Subject Error:', e);
    res.status(500).json({ error: 'Failed to fetch subject' });
  }
});

module.exports = router;
