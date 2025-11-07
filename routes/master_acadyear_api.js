const express = require('express');
const router = express.Router();
const db = require('../config/db_conn');// Your DB connection module

// Enable CORS (if not globally applied)
const cors = require('cors');
router.use(cors());

// ✅ GET all academic years
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM college_acad_year');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ GET by ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query('SELECT * FROM college_acad_year WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ POST - Add new academic year
router.post('/add', async (req, res) => {
  const {
    id, collegeid, collegedeptid, collegeacadyear,
    collegeacadyearsemester, collegeacadyearname,
    collegeacadyeartype, collegeacadyearstartdt,
    collegeacadyearenddt, collegeacadyeariscurrent,
    collegeacadyearstatus, createdat, updatedat
  } = req.body;

  try {
    const insertQuery = `
      INSERT INTO college_acad_year (
        id, collegeid, collegedeptid, collegeacadyear, collegeacadyearsemester,
        collegeacadyearname, collegeacadyeartype, collegeacadyearstartdt,
        collegeacadyearenddt, collegeacadyeariscurrent, collegeacadyearstatus,
        createdat, updatedat
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
      )
    `;
    await db.query(insertQuery, [
      id, collegeid, collegedeptid, collegeacadyear, collegeacadyearsemester,
      collegeacadyearname, collegeacadyeartype, collegeacadyearstartdt,
      collegeacadyearenddt, collegeacadyeariscurrent, collegeacadyearstatus,
      createdat, updatedat
    ]);
    res.status(201).json({ message: 'Academic year added' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ PUT - Update existing academic year
router.put('/update/:id', async (req, res) => {
  const { id } = req.params;
  const {
    collegeid, collegedeptid, collegeacadyear,
    collegeacadyearsemester, collegeacadyearname,
    collegeacadyeartype, collegeacadyearstartdt,
    collegeacadyearenddt, collegeacadyeariscurrent,
    collegeacadyearstatus, updatedat
  } = req.body;

  try {
    const updateQuery = `
      UPDATE college_acad_year SET
        collegeid = $1,
        collegedeptid = $2,
        collegeacadyear = $3,
        collegeacadyearsemester = $4,
        collegeacadyearname = $5,
        collegeacadyeartype = $6,
        collegeacadyearstartdt = $7,
        collegeacadyearenddt = $8,
        collegeacadyeariscurrent = $9,
        collegeacadyearstatus = $10,
        updatedat = $11
      WHERE id = $12
    `;
    await db.query(updateQuery, [
      collegeid, collegedeptid, collegeacadyear, collegeacadyearsemester,
      collegeacadyearname, collegeacadyeartype, collegeacadyearstartdt,
      collegeacadyearenddt, collegeacadyeariscurrent, collegeacadyearstatus,
      updatedat, id
    ]);
    res.json({ message: 'Academic year updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ DELETE
router.delete('/delete/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM college_acad_year WHERE id = $1', [id]);
    res.json({ message: 'Academic year deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
