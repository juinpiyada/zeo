const express = require('express');
const router = express.Router();
const db = require('../config/db_conn');

// 1. GET all attendance records (newest first)
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM public.college_attendance ORDER BY attts DESC`
    );
    res.status(200).json({ attendances: result.rows });
  } catch (err) {
    console.error('Error fetching attendance:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 2. GET one attendance record by attid
router.get('/:attid', async (req, res) => {
  const { attid } = req.params;
  try {
    const result = await db.query(
      `SELECT * FROM public.college_attendance WHERE attid = $1`, [attid]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Attendance not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching attendance by attid:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 3. BULK SUBMIT Attendance - POST /api/college-attendance/submit
router.post('/submit', async (req, res) => {
  const attendanceList = req.body;
  if (!Array.isArray(attendanceList) || attendanceList.length === 0) {
    return res.status(400).json({ error: 'No attendance data received.' });
  }
  try {
    for (const record of attendanceList) {
      // Generate attid (UUID), fill all fields (use null if not present)
      await db.query(
        `INSERT INTO public.college_attendance 
          (attid, attuserid, attcourseid, attsubjectid, attlat, attlong, attts, attvalid, attvaliddesc, attclassid, attdeviceid, attmaarkedbyemployee, createdat, updatedat)
         VALUES (
           gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW()
         )`,
        [
          record.attuserid || record.stuid || null,
          record.attcourseid || null,
          record.attsubjectid || null,
          record.attlat || null,
          record.attlong || null,
          record.attts ? new Date(record.attts) : new Date(),
          typeof record.attvalid === "boolean" ? record.attvalid : (record.present === true ? true : false),
          record.attvaliddesc || null,
          record.attclassid || null,
          record.attdeviceid || null,
          record.attmaarkedbyemployee || record.teacherid || null
        ]
      );
    }
    res.json({ message: 'Attendance saved to database!' });
  } catch (err) {
    console.error('Error saving attendance:', err);
    res.status(500).json({ error: 'Failed to save attendance.' });
  }
});

// 4. DELETE attendance by attid
router.delete('/delete/:attid', async (req, res) => {
  const { attid } = req.params;
  try {
    const result = await db.query(
      `DELETE FROM public.college_attendance WHERE attid = $1`,
      [attid]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Attendance not found' });
    }
    res.json({ message: 'Attendance deleted successfully' });
  } catch (err) {
    console.error('Error deleting attendance:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
