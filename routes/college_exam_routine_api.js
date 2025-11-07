const express = require('express');
const router = express.Router();
const db = require('../config/db_conn');

// ✅ GET all exam routines
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM public.college_exam_routine ORDER BY createdat DESC');
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error fetching exam routines:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ GET a specific exam routine by ID
router.get('/:examid', async (req, res) => {
  const { examid } = req.params;
  try {
    const result = await db.query('SELECT * FROM public.college_exam_routine WHERE examid = $1', [examid]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Exam routine not found' });
    }
    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching exam routine:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ POST create new exam routine
router.post('/', async (req, res) => {
  const {
    examid,
    examofferid,
    examtermid,
    examtype,
    examtitle,
    examdate,
    examst_time,
    examen_time,
    examroomid,
    exammaxmarks,
    examwtpercentge,
    examcondby,
    examremarks
  } = req.body;

  try {
    const result = await db.query(
      `INSERT INTO public.college_exam_routine (
        examid, examofferid, examtermid, examtype, examtitle,
        examdate, examst_time, examen_time, examroomid,
        exammaxmarks, examwtpercentge, examcondby,
        examremarks, createdat, updatedat
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11, $12,
        $13, NOW(), NOW()
      ) RETURNING examid`,
      [
        examid, examofferid, examtermid, examtype, examtitle,
        examdate, examst_time, examen_time, examroomid,
        exammaxmarks, examwtpercentge, examcondby, examremarks
      ]
    );

    res.status(201).json({ message: 'Exam routine created', examid: result.rows[0].examid });
  } catch (err) {
    console.error('Error creating exam routine:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ PUT update exam routine
router.put('/:examid', async (req, res) => {
  const { examid } = req.params;
  const {
    examofferid,
    examtermid,
    examtype,
    examtitle,
    examdate,
    examst_time,
    examen_time,
    examroomid,
    exammaxmarks,
    examwtpercentge,
    examcondby,
    examremarks
  } = req.body;

  try {
    const result = await db.query(
      `UPDATE public.college_exam_routine SET
        examofferid = $1,
        examtermid = $2,
        examtype = $3,
        examtitle = $4,
        examdate = $5,
        examst_time = $6,
        examen_time = $7,
        examroomid = $8,
        exammaxmarks = $9,
        examwtpercentge = $10,
        examcondby = $11,
        examremarks = $12,
        updatedat = NOW()
      WHERE examid = $13 RETURNING examid`,
      [
        examofferid, examtermid, examtype, examtitle,
        examdate, examst_time, examen_time, examroomid,
        exammaxmarks, examwtpercentge, examcondby, examremarks,
        examid
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Exam routine not found' });
    }

    res.status(200).json({ message: 'Exam routine updated', examid: result.rows[0].examid });
  } catch (err) {
    console.error('Error updating exam routine:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ DELETE exam routine
router.delete('/:examid', async (req, res) => {
  const { examid } = req.params;

  try {
    const result = await db.query('DELETE FROM public.college_exam_routine WHERE examid = $1 RETURNING examid', [examid]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Exam routine not found' });
    }
    res.status(200).json({ message: 'Exam routine deleted', examid: result.rows[0].examid });
  } catch (err) {
    console.error('Error deleting exam routine:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
