// routes/subjectElectiveRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../config/db_conn');

// GET all subject electives
router.get('/', async (req, res) => {
  try {
    const query = 'SELECT * FROM subject_elec ORDER BY createdat DESC';
    const result = await db.query(query);
    res.status(200).json({
      message: 'Subject electives fetched successfully',
      data: result.rows
    });
  } catch (error) {
    console.error('GET /subjectElective Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST new subject elective
router.post('/', async (req, res) => {
  try {
    const {
      sub_elec_id,
      sub_elec_mas_sub,
      sub_elec_semesterno,
      sub_elec_grp_code,
      sub_elec_grp_name,
      sub_elec_max_courseallowed,
      sub_elec_min_coursereqd,
      sub_elec_remarks
    } = req.body;

    if (!sub_elec_id || !sub_elec_mas_sub) {
      return res.status(400).json({ error: 'Required fields missing' });
    }

    const query = `
      INSERT INTO subject_elec (
        sub_elec_id, sub_elec_mas_sub, sub_elec_semesterno, sub_elec_grp_code,
        sub_elec_grp_name, sub_elec_max_courseallowed, sub_elec_min_coursereqd,
        sub_elec_remarks, createdat, updatedat
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
      RETURNING *
    `;
    const values = [
      sub_elec_id,
      sub_elec_mas_sub,
      sub_elec_semesterno,
      sub_elec_grp_code,
      sub_elec_grp_name,
      sub_elec_max_courseallowed,
      sub_elec_min_coursereqd,
      sub_elec_remarks
    ];
    const result = await db.query(query, values);
    res.status(201).json({
      message: 'Subject Elective created successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('POST /subjectElective Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// PUT update subject elective
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      sub_elec_mas_sub,
      sub_elec_semesterno,
      sub_elec_grp_code,
      sub_elec_grp_name,
      sub_elec_max_courseallowed,
      sub_elec_min_coursereqd,
      sub_elec_remarks
    } = req.body;

    const query = `
      UPDATE subject_elec SET
        sub_elec_mas_sub = $1,
        sub_elec_semesterno = $2,
        sub_elec_grp_code = $3,
        sub_elec_grp_name = $4,
        sub_elec_max_courseallowed = $5,
        sub_elec_min_coursereqd = $6,
        sub_elec_remarks = $7,
        updatedat = NOW()
      WHERE sub_elec_id = $8
      RETURNING *
    `;
    const values = [
      sub_elec_mas_sub,
      sub_elec_semesterno,
      sub_elec_grp_code,
      sub_elec_grp_name,
      sub_elec_max_courseallowed,
      sub_elec_min_coursereqd,
      sub_elec_remarks,
      id
    ];

    const result = await db.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Subject Elective not found' });
    }

    res.status(200).json({
      message: 'Subject Elective updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('PUT /subjectElective/:id Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// DELETE subject elective
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const query = 'DELETE FROM subject_elec WHERE sub_elec_id = $1 RETURNING *';
    const result = await db.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Subject Elective not found' });
    }

    res.status(200).json({
      message: 'Subject Elective deleted successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('DELETE /subjectElective/:id Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
