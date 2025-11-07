// routes/college_exam_result_api.js
const express = require('express');
const cors = require('cors');
const router = express.Router();
const db = require('../config/db_conn');

// Enable CORS for all routes in this router
router.use(cors());

// GET all exam results
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM public.college_exam_result ORDER BY createdat DESC');
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error fetching exam results:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET one exam result by examresultid
router.get('/:examresultid', async (req, res) => {
  const { examresultid } = req.params;
  try {
    const result = await db.query(
      'SELECT * FROM public.college_exam_result WHERE examresultid = $1',
      [examresultid]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Exam result not found' });
    }
    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching exam result:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST: Add a new exam result
router.post('/', async (req, res) => {
  const {
    examresultid,
    examresult_examid,
    examstudentid,
    exammarksobtained,
    examgrade,
    examremarks,
    createdat,
    updatedat
  } = req.body;

  try {
    await db.query(
      `INSERT INTO public.college_exam_result
        (examresultid, examresult_examid, examstudentid, exammarksobtained, examgrade, examremarks, createdat, updatedat)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        examresultid,
        examresult_examid,
        examstudentid,
        exammarksobtained,
        examgrade,
        examremarks,
        createdat,
        updatedat
      ]
    );
    res.status(201).json({ message: 'Exam result added successfully' });
  } catch (err) {
    console.error('Error adding exam result:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT: Update an exam result by examresultid
router.put('/:examresultid', async (req, res) => {
  const { examresultid } = req.params;
  const {
    examresult_examid,
    examstudentid,
    exammarksobtained,
    examgrade,
    examremarks,
    createdat,
    updatedat
  } = req.body;

  try {
    const result = await db.query(
      `UPDATE public.college_exam_result
       SET examresult_examid = $1,
           examstudentid = $2,
           exammarksobtained = $3,
           examgrade = $4,
           examremarks = $5,
           createdat = $6,
           updatedat = $7
       WHERE examresultid = $8`,
      [
        examresult_examid,
        examstudentid,
        exammarksobtained,
        examgrade,
        examremarks,
        createdat,
        updatedat,
        examresultid
      ]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Exam result not found' });
    }
    res.json({ message: 'Exam result updated successfully' });
  } catch (err) {
    console.error('Error updating exam result:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE: Delete an exam result by examresultid
router.delete('/:examresultid', async (req, res) => {
  const { examresultid } = req.params;
  try {
    const result = await db.query(
      'DELETE FROM public.college_exam_result WHERE examresultid = $1',
      [examresultid]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Exam result not found' });
    }
    res.json({ message: 'Exam result deleted successfully' });
  } catch (err) {
    console.error('Error deleting exam result:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
