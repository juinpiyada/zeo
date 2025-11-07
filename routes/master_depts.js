// File: backend/routes/master_depts.js
// Handles CRUD operations for college departments

const express = require('express');
const router = express.Router();
const db = require('../config/db_conn');

// ✅ GET all departments
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM college_depts ORDER BY createdat DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching departments:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ✅ GET only department IDs (for selector)
router.get('/selector', async (req, res) => {
  try {
    const result = await db.query('SELECT collegedeptid FROM college_depts ORDER BY collegedeptid');
    res.json(result.rows); // returns [{collegedeptid: '...'}, ...]
  } catch (err) {
    console.error('Error fetching department IDs:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ✅ GET department by ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query('SELECT * FROM college_depts WHERE collegedeptid = $1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Department not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching department:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ✅ POST create department
router.post('/', async (req, res) => {
  const {
    collegedeptid, collegeid, colldept_code, collegedeptdesc,
    colldepthod, colldepteaail, colldeptphno
  } = req.body;

  const createdat = new Date();
  const updatedat = new Date();

  try {
    await db.query(`
      INSERT INTO college_depts (
        collegedeptid, collegeid, colldept_code, collegedeptdesc,
        colldepthod, colldepteaail, colldeptphno, collegedeptcreatedon, createdat, updatedat
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, NOW(), $8, $9
      )
    `, [
      collegedeptid, collegeid, colldept_code, collegedeptdesc,
      colldepthod, colldepteaail, colldeptphno, createdat, updatedat
    ]);

    res.status(201).json({ message: 'Department added successfully' });
  } catch (err) {
    console.error('Error adding department:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ✅ PUT update department
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const {
    collegeid, colldept_code, collegedeptdesc,
    colldepthod, colldepteaail, colldeptphno
  } = req.body;

  const updatedat = new Date();

  try {
    await db.query(`
      UPDATE college_depts SET
        collegeid = $1,
        colldept_code = $2,
        collegedeptdesc = $3,
        colldepthod = $4,
        colldepteaail = $5,
        colldeptphno = $6,
        updatedat = $7
      WHERE collegedeptid = $8
    `, [
      collegeid, colldept_code, collegedeptdesc,
      colldepthod, colldepteaail, colldeptphno, updatedat, id
    ]);

    res.json({ message: 'Department updated successfully' });
  } catch (err) {
    console.error('Error updating department:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ✅ DELETE department
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM college_depts WHERE collegedeptid = $1', [id]);
    res.json({ message: 'Department deleted successfully' });
  } catch (err) {
    console.error('Error deleting department:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;