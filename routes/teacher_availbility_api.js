const express = require('express');
const router = express.Router();
const db = require('../config/db_conn');

// ✅ GET all teacher availability records
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM public.teacher_availbility ORDER BY avldate DESC');
    res.status(200).json({ data: result.rows });
  } catch (err) {
    console.error('Error fetching availability:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ POST a new teacher availability
router.post('/', async (req, res) => {
  const {
    teaacheravlid,
    teacherid,
    avldate,
    slottime,
    avlflafr
  } = req.body;

  if (!teaacheravlid || !teacherid || !avldate || !slottime) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const result = await db.query(
      `INSERT INTO public.teacher_availbility (
        teaacheravlid, teacherid, avldate, slottime, avlflafr, createdat, updatedat
      ) VALUES (
        $1, $2, $3, $4, $5, NOW(), NOW()
      ) RETURNING teaacheravlid`,
      [teaacheravlid, teacherid, avldate, slottime, avlflafr === true || avlflafr === 'true']
    );

    res.status(201).json({ message: 'Availability added', id: result.rows[0].teaacheravlid });
  } catch (err) {
    console.error('Error inserting availability:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ PUT update availability
router.put('/:teaacheravlid', async (req, res) => {
  const { teaacheravlid } = req.params;
  const {
    teacherid,
    avldate,
    slottime,
    avlflafr
  } = req.body;

  try {
    const result = await db.query(
      `UPDATE public.teacher_availbility SET
        teacherid = $1,
        avldate = $2,
        slottime = $3,
        avlflafr = $4,
        updatedat = NOW()
      WHERE teaacheravlid = $5
      RETURNING teaacheravlid`,
      [teacherid, avldate, slottime, avlflafr === true || avlflafr === 'true', teaacheravlid]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Availability not found' });
    }

    res.status(200).json({ message: 'Availability updated', id: result.rows[0].teaacheravlid });
  } catch (err) {
    console.error('Error updating availability:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ DELETE a teacher availability entry
router.delete('/:teaacheravlid', async (req, res) => {
  const { teaacheravlid } = req.params;

  try {
    const result = await db.query(
      'DELETE FROM public.teacher_availbility WHERE teaacheravlid = $1 RETURNING teaacheravlid',
      [teaacheravlid]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Availability not found' });
    }

    res.status(200).json({ message: 'Availability deleted', id: result.rows[0].teaacheravlid });
  } catch (err) {
    console.error('Error deleting availability:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
