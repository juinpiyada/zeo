const express = require('express');
const router = express.Router();
const db = require('../config/db_conn');

// ✅ GET all classrooms
router.get('/', async (req, res) => {
  try {
    const result = await db.query(`SELECT * FROM public.college_classroom ORDER BY createdat DESC`);
    return res.status(200).json({ classrooms: result.rows });
  } catch (err) {
    console.error('Error fetching classrooms:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ GET classroom by ID
router.get('/:classroomid', async (req, res) => {
  const { classroomid } = req.params;
  try {
    const result = await db.query(`SELECT * FROM public.college_classroom WHERE classroomid = $1`, [classroomid]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Classroom not found' });
    }
    return res.status(200).json({ classroom: result.rows[0] });
  } catch (err) {
    console.error('Error fetching classroom:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ POST: Add new classroom
router.post('/', async (req, res) => {
  const {
    classroomid,
    classroomcollege,
    classroomdept,
    classroomcode,
    classroomname,
    classroomtype,
    classroomcapacity,
    classroomisavailable,
    classroomprojector,
    classfloornumber,
    classroomlat,
    classroomlong,
    classroomloc
  } = req.body;

  if (!classroomid || !classroomname) {
    return res.status(400).json({ error: 'Classroom ID and Name are required' });
  }

  try {
    const result = await db.query(
      `INSERT INTO public.college_classroom (
        classroomid, classroomcollege, classroomdept, classroomcode,
        classroomname, classroomtype, classroomcapacity, classroomisavailable,
        classroomprojector, classfloornumber, classroomlat, classroomlong,
        classroomloc, createdat, updatedat
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, NOW(), NOW()
      ) RETURNING *`,
      [
        classroomid,
        classroomcollege,
        classroomdept,
        classroomcode,
        classroomname,
        classroomtype,
        classroomcapacity,
        classroomisavailable,
        classroomprojector,
        classfloornumber,
        classroomlat,
        classroomlong,
        classroomloc
      ]
    );
    return res.status(201).json({ message: 'Classroom added', classroom: result.rows[0] });
  } catch (err) {
    console.error('Error adding classroom:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// ✅ PUT: Update classroom by ID
router.put('/:classroomid', async (req, res) => {
  const { classroomid } = req.params;
  const {
    classroomcollege,
    classroomdept,
    classroomcode,
    classroomname,
    classroomtype,
    classroomcapacity,
    classroomisavailable,
    classroomprojector,
    classfloornumber,
    classroomlat,
    classroomlong,
    classroomloc
  } = req.body;

  try {
    const result = await db.query(
      `UPDATE public.college_classroom SET
        classroomcollege = $1,
        classroomdept = $2,
        classroomcode = $3,
        classroomname = $4,
        classroomtype = $5,
        classroomcapacity = $6,
        classroomisavailable = $7,
        classroomprojector = $8,
        classfloornumber = $9,
        classroomlat = $10,
        classroomlong = $11,
        classroomloc = $12,
        updatedat = NOW()
      WHERE classroomid = $13
      RETURNING *`,
      [
        classroomcollege,
        classroomdept,
        classroomcode,
        classroomname,
        classroomtype,
        classroomcapacity,
        classroomisavailable,
        classroomprojector,
        classfloornumber,
        classroomlat,
        classroomlong,
        classroomloc,
        classroomid
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Classroom not found' });
    }

    return res.status(200).json({ message: 'Classroom updated', classroom: result.rows[0] });
  } catch (err) {
    console.error('Error updating classroom:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ DELETE: Remove classroom by ID
router.delete('/:classroomid', async (req, res) => {
  const { classroomid } = req.params;

  try {
    const result = await db.query(
      `DELETE FROM public.college_classroom WHERE classroomid = $1 RETURNING *`,
      [classroomid]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Classroom not found' });
    }

    return res.status(200).json({ message: 'Classroom deleted', classroom: result.rows[0] });
  } catch (err) {
    console.error('Error deleting classroom:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
