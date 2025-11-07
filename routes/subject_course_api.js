const express = require('express');
const router = express.Router();
const db = require('../config/db_conn');

// GET all subject_course entries
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM subject_course');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching subject_course:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET one subject_course by ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      'SELECT * FROM subject_course WHERE sub_cou_id = $1',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Subject course not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching subject_course by ID:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST - Add new subject_course
router.post('/', async (req, res) => {
  const {
    sub_cou_id,
    sub_cou_mast_id,
    sub_cou_mast_sub_id,
    sub_cou_sem_no,
    sub_cou_iselective,
    sub_cou_electivegroupid,
    sub_cou_islab,
    sub_cou_isaactive
  } = req.body;

  if (!sub_cou_id || !sub_cou_mast_id || !sub_cou_mast_sub_id) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const query = `
      INSERT INTO subject_course (
        sub_cou_id, sub_cou_mast_id, sub_cou_mast_sub_id,
        sub_cou_sem_no, sub_cou_iselective, sub_cou_electivegroupid,
        sub_cou_islab, sub_cou_isaactive, createdat, updatedat
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
    `;
    await db.query(query, [
      sub_cou_id,
      sub_cou_mast_id,
      sub_cou_mast_sub_id,
      sub_cou_sem_no,
      sub_cou_iselective,
      sub_cou_electivegroupid,
      sub_cou_islab,
      sub_cou_isaactive
    ]);
    res.status(201).json({ message: 'Subject course added successfully' });
  } catch (err) {
    console.error('Error adding subject_course:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// PUT - Update existing subject_course
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const {
    sub_cou_mast_id,
    sub_cou_mast_sub_id,
    sub_cou_sem_no,
    sub_cou_iselective,
    sub_cou_electivegroupid,
    sub_cou_islab,
    sub_cou_isaactive
  } = req.body;

  try {
    const query = `
      UPDATE subject_course SET
        sub_cou_mast_id = $1,
        sub_cou_mast_sub_id = $2,
        sub_cou_sem_no = $3,
        sub_cou_iselective = $4,
        sub_cou_electivegroupid = $5,
        sub_cou_islab = $6,
        sub_cou_isaactive = $7,
        updatedat = NOW()
      WHERE sub_cou_id = $8
    `;
    const result = await db.query(query, [
      sub_cou_mast_id,
      sub_cou_mast_sub_id,
      sub_cou_sem_no,
      sub_cou_iselective,
      sub_cou_electivegroupid,
      sub_cou_islab,
      sub_cou_isaactive,
      id
    ]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Subject course not found' });
    }

    res.json({ message: 'Subject course updated successfully' });
  } catch (err) {
    console.error('Error updating subject_course:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// DELETE subject_course
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      'DELETE FROM subject_course WHERE sub_cou_id = $1',
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Subject course not found' });
    }

    res.json({ message: 'Subject course deleted successfully' });
  } catch (err) {
    console.error('Error deleting subject_course:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
