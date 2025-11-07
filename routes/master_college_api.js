// routes/master_college_api.js
const express = require('express');
const router = express.Router();
const db = require('../config/db_conn');

// ✅ Add College (with manual collegeid)
router.post('/add-college', async (req, res) => {
  const {
    collegeid,
    collegename,
    collegecode,
    collegeaddress,
    collegelocation,
    collegeaffialatedto,
    collegeuserid,
    collegegroupid,
    collegeurl,
    collegeemail,
    collegestatus,
    collegephone,
  } = req.body;

  if (!collegeid || !collegename) {
    return res.status(400).json({ error: 'collegeid and collegename are required' });
  }

  try {
    const result = await db.query(
      `INSERT INTO public.master_college (
        collegeid, collegename, collegecode, collegeaddress, collegelocation,
        collegeaffialatedto, collegeuserid, collegegroupid, collegeurl,
        collegeemail, collegestatus, collegephone, createdat, updatedat
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW()
      ) RETURNING collegeid`,
      [
        collegeid, collegename, collegecode, collegeaddress, collegelocation,
        collegeaffialatedto, collegeuserid, collegegroupid, collegeurl,
        collegeemail, collegestatus, collegephone
      ]
    );

    return res.status(201).json({
      message: 'College added successfully',
      collegeId: result.rows[0].collegeid
    });
  } catch (err) {
    console.error('Error during college insertion:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ View All Colleges
router.get('/view-colleges', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM public.master_college ORDER BY createdat DESC`
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'No colleges found' });
    }

    return res.status(200).json({ colleges: result.rows });
  } catch (err) {
    console.error('Error fetching college data:', err);
    return res.status(500).json({ error: 'Failed to fetch college data' });
  }
});

// ✅ Edit College by collegeid
router.put('/edit-college/:collegeid', async (req, res) => {
  const { collegeid } = req.params;
  const {
    collegename,
    collegecode,
    collegeaddress,
    collegelocation,
    collegeaffialatedto,
    collegeuserid,
    collegegroupid,
    collegeurl,
    collegeemail,
    collegestatus,
    collegephone,
  } = req.body;

  try {
    const result = await db.query(
      `UPDATE public.master_college SET
        collegename = $1,
        collegecode = $2,
        collegeaddress = $3,
        collegelocation = $4,
        collegeaffialatedto = $5,
        collegeuserid = $6,
        collegegroupid = $7,
        collegeurl = $8,
        collegeemail = $9,
        collegestatus = $10,
        collegephone = $11,
        updatedat = NOW()
      WHERE collegeid = $12
      RETURNING *`,
      [
        collegename, collegecode, collegeaddress, collegelocation,
        collegeaffialatedto, collegeuserid, collegegroupid, collegeurl,
        collegeemail, collegestatus, collegephone, collegeid
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'College not found' });
    }

    return res.status(200).json({
      message: 'College updated successfully',
      college: result.rows[0]
    });
  } catch (err) {
    console.error('Error updating college:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ Delete College by collegeid
router.delete('/delete-college/:collegeid', async (req, res) => {
  const { collegeid } = req.params;

  try {
    const result = await db.query(
      `DELETE FROM public.master_college WHERE collegeid = $1 RETURNING collegeid`,
      [collegeid]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'College not found' });
    }

    return res.status(200).json({
      message: 'College deleted successfully',
      collegeid: result.rows[0].collegeid
    });
  } catch (err) {
    console.error('Error deleting college:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
