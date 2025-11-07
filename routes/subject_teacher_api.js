const express = require('express');
const cors = require('cors');
const pool = require('../config/db_conn'); // PostgreSQL Pool

const router = express.Router();

router.use(cors());
router.use(express.json());

// Helper to validate and parse dates
const isValidDate = (val) => {
  const date = new Date(val);
  return !isNaN(date.getTime()) ? date : null;
};

/**
 * Add a new subject_teacher record
 */
router.post('/', async (req, res) => {
  const {
    subteaid, subtea_masid, subcollegesubid, subtea_collegedesc,
    subtea_acadyear, subcoll_acad_sem, createdat, updatedat
  } = req.body;

  const now = new Date();

  try {
    const result = await pool.query(`
      INSERT INTO public.subject_teacher (
        subteaid, subtea_masid, subcollegesubid, subtea_collegedesc,
        subtea_acadyear, subcoll_acad_sem, createdat, updatedat
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8
      ) RETURNING subteaid
    `, [
      subteaid,
      subtea_masid || null,
      subcollegesubid || null,
      subtea_collegedesc || null,
      subtea_acadyear || null,
      subcoll_acad_sem || null,
      createdat || now,
      updatedat || now
    ]);

    res.status(201).json({ message: 'Subject Teacher added successfully', subteaid: result.rows[0].subteaid });
  } catch (err) {
    console.error('Error adding Subject Teacher:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * Update an existing subject_teacher record
 */
router.put('/:subteaid', async (req, res) => {
  const { subteaid } = req.params;
  const {
    subtea_masid, subcollegesubid, subtea_collegedesc,
    subtea_acadyear, subcoll_acad_sem, updatedat
  } = req.body;

  const updatedAt = updatedat || new Date();

  try {
    const result = await pool.query(`
      UPDATE public.subject_teacher SET
        subtea_masid = $1,
        subcollegesubid = $2,
        subtea_collegedesc = $3,
        subtea_acadyear = $4,
        subcoll_acad_sem = $5,
        updatedat = $6
      WHERE subteaid = $7
      RETURNING *`,
      [
        subtea_masid, subcollegesubid, subtea_collegedesc,
        subtea_acadyear, subcoll_acad_sem, updatedAt, subteaid
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Subject Teacher not found' });
    }

    res.json({ message: 'Subject Teacher updated successfully', subject_teacher: result.rows[0] });
  } catch (err) {
    console.error('Update Subject Teacher Error:', err);
    res.status(500).json({ error: 'Failed to update Subject Teacher' });
  }
});

/**
 * Delete a subject_teacher record
 */
router.delete('/:subteaid', async (req, res) => {
  const { subteaid } = req.params;

  try {
    const result = await pool.query(
      'DELETE FROM public.subject_teacher WHERE subteaid = $1 RETURNING *',
      [subteaid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Subject Teacher not found' });
    }

    res.json({ message: 'Subject Teacher deleted successfully', subject_teacher: result.rows[0] });
  } catch (err) {
    console.error('Delete Subject Teacher Error:', err);
    res.status(500).json({ error: 'Failed to delete Subject Teacher' });
  }
});

/**
 * Get all subject_teacher records
 */
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM public.subject_teacher ORDER BY createdat DESC');
    res.json({ subject_teachers: result.rows });
  } catch (err) {
    console.error('Fetch Subject Teachers Error:', err);
    res.status(500).json({ error: 'Failed to fetch Subject Teachers' });
  }
});

/**
 * Get subject_teacher by ID
 */
router.get('/:subteaid', async (req, res) => {
  const { subteaid } = req.params;

  try {
    const result = await pool.query(
      'SELECT * FROM public.subject_teacher WHERE subteaid = $1',
      [subteaid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Subject Teacher not found' });
    }

    res.json({ subject_teacher: result.rows[0] });
  } catch (err) {
    console.error('Fetch Subject Teacher Error:', err);
    res.status(500).json({ error: 'Failed to fetch Subject Teacher' });
  }
});

module.exports = router;