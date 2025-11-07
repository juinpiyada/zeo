const express = require('express');
const router = express.Router();
const db = require('../config/db_conn');

// ✅ GET all course registrations
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM public.college_course_regis ORDER BY createdat DESC');
    res.status(200).json({ data: result.rows });
  } catch (err) {
    console.error('Error fetching course registrations:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ POST: Add a new course registration
router.post('/', async (req, res) => {
  const {
    course_regis_id,
    course_studentid,
    courseofferingid,
    courseterm,
    courseisterm,
    course_elec_groupid,
    courseenrollmentdt,
    coursefinalgrade,
    courseresultstatus,
    courseattper,
    coursestatus
  } = req.body;

  if (!course_regis_id || !course_studentid || !courseofferingid) {
    return res.status(400).json({ error: 'Required fields: course_regis_id, studentid, offeringid' });
  }

  try {
    const result = await db.query(
      `INSERT INTO public.college_course_regis (
        course_regis_id, course_studentid, courseofferingid, courseterm,
        courseisterm, course_elec_groupid, courseenrollmentdt,
        coursefinalgrade, courseresultstatus, courseattper,
        coursestatus, createdat, updatedat
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10,
        $11, NOW(), NOW()
      ) RETURNING course_regis_id`,
      [
        course_regis_id,
        course_studentid,
        courseofferingid,
        courseterm,
        courseisterm,
        course_elec_groupid,
        courseenrollmentdt,
        coursefinalgrade,
        courseresultstatus,
        courseattper,
        coursestatus
      ]
    );
    res.status(201).json({ message: 'Course registration added', id: result.rows[0].course_regis_id });
  } catch (err) {
    console.error('Error adding course registration:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ PUT: Update a course registration
router.put('/:course_regis_id', async (req, res) => {
  const { course_regis_id } = req.params;
  const {
    course_studentid,
    courseofferingid,
    courseterm,
    courseisterm,
    course_elec_groupid,
    courseenrollmentdt,
    coursefinalgrade,
    courseresultstatus,
    courseattper,
    coursestatus
  } = req.body;

  try {
    const result = await db.query(
      `UPDATE public.college_course_regis SET
        course_studentid = $1,
        courseofferingid = $2,
        courseterm = $3,
        courseisterm = $4,
        course_elec_groupid = $5,
        courseenrollmentdt = $6,
        coursefinalgrade = $7,
        courseresultstatus = $8,
        courseattper = $9,
        coursestatus = $10,
        updatedat = NOW()
      WHERE course_regis_id = $11
      RETURNING course_regis_id`,
      [
        course_studentid,
        courseofferingid,
        courseterm,
        courseisterm,
        course_elec_groupid,
        courseenrollmentdt,
        coursefinalgrade,
        courseresultstatus,
        courseattper,
        coursestatus,
        course_regis_id
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Course registration not found' });
    }

    res.status(200).json({ message: 'Course registration updated', id: result.rows[0].course_regis_id });
  } catch (err) {
    console.error('Error updating registration:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ DELETE: Remove a course registration
router.delete('/:course_regis_id', async (req, res) => {
  const { course_regis_id } = req.params;

  try {
    const result = await db.query(
      'DELETE FROM public.college_course_regis WHERE course_regis_id = $1 RETURNING course_regis_id',
      [course_regis_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Registration not found' });
    }

    res.status(200).json({ message: 'Course registration deleted', id: result.rows[0].course_regis_id });
  } catch (err) {
    console.error('Error deleting registration:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
