const express = require('express');
const router = express.Router();
const db = require('../config/db_conn');

// ✅ GET all employee attendance records
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM public.employee_attendance ORDER BY attts_in DESC');
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error fetching employee attendance:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ GET single employee attendance BY ID
router.get('/:attid', async (req, res) => {
  const { attid } = req.params;
  try {
    const result = await db.query(
      'SELECT * FROM public.employee_attendance WHERE attid = $1',
      [attid]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Attendance not found' });
    }
    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching record:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ POST new employee attendance record
router.post('/', async (req, res) => {
  const {
    attid,
    attuserid,
    attcourseid,
    attsubjectid,
    attlat,
    attlong,
    attts_in,
    attts_out,
    attvalid,
    attvaliddesc,
    attclassid,
    attdeviceid,
    attmaarkedbyemployee
  } = req.body;

  try {
    const result = await db.query(
      `INSERT INTO public.employee_attendance (
        attid, attuserid, attcourseid, attsubjectid,
        attlat, attlong, attts_in, attts_out, attvalid,
        attvaliddesc, attclassid, attdeviceid, attmaarkedbyemployee,
        createdat, updatedat
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8, $9,
        $10, $11, $12, $13,
        NOW(), NOW()
      ) RETURNING attid`,
      [
        attid,
        attuserid,
        attcourseid,
        attsubjectid,
        attlat,
        attlong,
        attts_in,
        attts_out,
        attvalid,
        attvaliddesc,
        attclassid,
        attdeviceid,
        attmaarkedbyemployee
      ]
    );
    res.status(201).json({ message: 'Employee attendance added', attid: result.rows[0].attid });
  } catch (err) {
    console.error('Error inserting employee attendance:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ PUT update employee attendance
router.put('/:attid', async (req, res) => {
  const { attid } = req.params;
  const {
    attuserid,
    attcourseid,
    attsubjectid,
    attlat,
    attlong,
    attts_in,
    attts_out,
    attvalid,
    attvaliddesc,
    attclassid,
    attdeviceid,
    attmaarkedbyemployee
  } = req.body;

  try {
    const result = await db.query(
      `UPDATE public.employee_attendance SET
        attuserid = $1,
        attcourseid = $2,
        attsubjectid = $3,
        attlat = $4,
        attlong = $5,
        attts_in = $6,
        attts_out = $7,
        attvalid = $8,
        attvaliddesc = $9,
        attclassid = $10,
        attdeviceid = $11,
        attmaarkedbyemployee = $12,
        updatedat = NOW()
      WHERE attid = $13
      RETURNING attid`,
      [
        attuserid,
        attcourseid,
        attsubjectid,
        attlat,
        attlong,
        attts_in,
        attts_out,
        attvalid,
        attvaliddesc,
        attclassid,
        attdeviceid,
        attmaarkedbyemployee,
        attid
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Attendance record not found' });
    }

    res.status(200).json({ message: 'Employee attendance updated', attid: result.rows[0].attid });
  } catch (err) {
    console.error('Error updating employee attendance:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ DELETE employee attendance record
router.delete('/:attid', async (req, res) => {
  const { attid } = req.params;

  try {
    const result = await db.query(
      'DELETE FROM public.employee_attendance WHERE attid = $1 RETURNING attid',
      [attid]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Attendance record not found' });
    }

    res.status(200).json({ message: 'Employee attendance deleted', attid: result.rows[0].attid });
  } catch (err) {
    console.error('Error deleting record:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
