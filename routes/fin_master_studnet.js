// routes/fin_master_studnet.js
const express = require('express');
const cors = require('cors');
const router = express.Router();
const pool = require('../config/db_conn');

router.use(cors());
router.use(express.json());

// GET: all rows (optional filters: ?stream=...&current_semester=...)
router.get('/', async (req, res) => {
  try {
    const { stream, current_semester } = req.query;
    const where = [];
    const vals = [];

    if (stream) {
      vals.push(stream);
      where.push(`stream = $${vals.length}`);
    }
    if (current_semester) {
      vals.push(Number(current_semester));
      where.push(`current_semester = $${vals.length}`);
    }

    const sql = `
      SELECT
        stuid, name, scholarship_fee, total_semesters, current_semester,
        admission_date, stream, program_fee, createdat, updatedat,
        sem1, sem2, sem3, sem4, sem5, sem6, sem7, sem8, sem9, sem10
      FROM public.fin_master_student
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY stuid ASC
    `;
    const result = await pool.query(sql, vals);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /fin_master_studnet error:', err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// GET: one row by stuid
router.get('/:stuid', async (req, res) => {
  try {
    const { stuid } = req.params;
    const result = await pool.query(
      `
      SELECT
        stuid, name, scholarship_fee, total_semesters, current_semester,
        admission_date, stream, program_fee, createdat, updatedat,
        sem1, sem2, sem3, sem4, sem5, sem6, sem7, sem8, sem9, sem10
      FROM public.fin_master_student
      WHERE stuid = $1
      `,
      [stuid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /fin_master_studnet/:stuid error:', err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// POST: UPSERT (insert or update by stuid)
router.post('/upsert', async (req, res) => {
  try {
    const {
      stuid,
      name,
      scholarship_fee = 0,
      total_semesters = null,
      current_semester = null,
      admission_date = null, // ISO string or null
      stream = null,
      program_fee = 0,
      sem1 = 0,
      sem2 = 0,
      sem3 = 0,
      sem4 = 0,
      sem5 = 0,
      sem6 = 0,
      sem7 = 0,
      sem8 = 0,
      sem9 = 0,
      sem10 = 0
    } = req.body;

    if (!stuid || !name) {
      return res.status(400).json({ error: 'stuid and name are required' });
    }

    const sql = `
      INSERT INTO public.fin_master_student (
        stuid, name, scholarship_fee, total_semesters, current_semester,
        admission_date, stream, program_fee,
        sem1, sem2, sem3, sem4, sem5, sem6, sem7, sem8, sem9, sem10
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,
        $9,$10,$11,$12,$13,$14,$15,$16,$17,$18
      )
      ON CONFLICT (stuid)
      DO UPDATE SET
        name = EXCLUDED.name,
        scholarship_fee = EXCLUDED.scholarship_fee,
        total_semesters = EXCLUDED.total_semesters,
        current_semester = EXCLUDED.current_semester,
        admission_date = EXCLUDED.admission_date,
        stream = EXCLUDED.stream,
        program_fee = EXCLUDED.program_fee,
        sem1 = EXCLUDED.sem1,
        sem2 = EXCLUDED.sem2,
        sem3 = EXCLUDED.sem3,
        sem4 = EXCLUDED.sem4,
        sem5 = EXCLUDED.sem5,
        sem6 = EXCLUDED.sem6,
        sem7 = EXCLUDED.sem7,
        sem8 = EXCLUDED.sem8,
        sem9 = EXCLUDED.sem9,
        sem10 = EXCLUDED.sem10,
        updatedat = now()
      RETURNING *;
    `;

    const vals = [
      stuid,
      name,
      scholarship_fee,
      total_semesters,
      current_semester,
      admission_date,
      stream,
      program_fee,
      sem1,
      sem2,
      sem3,
      sem4,
      sem5,
      sem6,
      sem7,
      sem8,
      sem9,
      sem10
    ];

    const result = await pool.query(sql, vals);
    res.json({ message: 'Upsert successful', data: result.rows[0] });
  } catch (err) {
    console.error('POST /fin_master_studnet/upsert error:', err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// DELETE: by stuid
router.delete('/:stuid', async (req, res) => {
  try {
    const { stuid } = req.params;
    const result = await pool.query(
      'DELETE FROM public.fin_master_student WHERE stuid = $1 RETURNING stuid',
      [stuid]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }
    res.json({ message: 'Deleted', stuid });
  } catch (err) {
    console.error('DELETE /fin_master_studnet/:stuid error:', err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

module.exports = router;