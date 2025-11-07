const express = require('express');
const router = express.Router();
const db = require('../config/db_conn');

// ✅ GET all demand letters
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM public.demand_letters ORDER BY created_at DESC');
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error fetching demand letters:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ GET single demand letter by ID
router.get('/:demand_id', async (req, res) => {
  const { demand_id } = req.params;
  try {
    const result = await db.query(
      'SELECT * FROM public.demand_letters WHERE demand_id = $1',
      [demand_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Demand letter not found' });
    }
    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching demand letter by ID:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ POST new demand letter record
router.post('/', async (req, res) => {
  const {
    student_id,
    course_id,
    fee_head,
    fee_amount,
    due_date,
    academic_year
  } = req.body;

  try {
    const result = await db.query(
      `INSERT INTO public.demand_letters (
        student_id, course_id, fee_head, fee_amount, due_date, academic_year, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, NOW(), NOW()
      ) RETURNING demand_id`,
      [
        student_id,
        course_id,
        fee_head,
        fee_amount,
        due_date,
        academic_year
      ]
    );
    res.status(201).json({ message: 'Demand letter created', demand_id: result.rows[0].demand_id });
  } catch (err) {
    console.error('Error creating demand letter:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ PUT update demand letter
router.put('/:demand_id', async (req, res) => {
  const { demand_id } = req.params;
  const {
    student_id,
    course_id,
    fee_head,
    fee_amount,
    due_date,
    academic_year
  } = req.body;

  try {
    const result = await db.query(
      `UPDATE public.demand_letters SET
        student_id = $1,
        course_id = $2,
        fee_head = $3,
        fee_amount = $4,
        due_date = $5,
        academic_year = $6,
        updated_at = NOW()
      WHERE demand_id = $7
      RETURNING demand_id`,
      [
        student_id,
        course_id,
        fee_head,
        fee_amount,
        due_date,
        academic_year,
        demand_id
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Demand letter not found' });
    }

    res.status(200).json({ message: 'Demand letter updated', demand_id: result.rows[0].demand_id });
  } catch (err) {
    console.error('Error updating demand letter:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ DELETE demand letter
router.delete('/:demand_id', async (req, res) => {
  const { demand_id } = req.params;

  try {
    const result = await db.query(
      'DELETE FROM public.demand_letters WHERE demand_id = $1 RETURNING demand_id',
      [demand_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Demand letter not found' });
    }

    res.status(200).json({ message: 'Demand letter deleted', demand_id: result.rows[0].demand_id });
  } catch (err) {
    console.error('Error deleting demand letter:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
