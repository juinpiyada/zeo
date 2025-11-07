// SMS-be/routes/course_offering_api.js
const express = require('express');
const cors = require('cors');
const router = express.Router();
const db = require('../config/db_conn'); // pg Pool

router.use(cors());
router.use(express.json());

/**
 * ---------- Helpers ----------
 */
function toIntOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * ✅ GET all course offerings
 *    (unchanged from your version)
 */
router.get('/', async (_req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM public.college_course_offering ORDER BY createdat DESC'
    );
    res.status(200).json({ offerings: result.rows });
  } catch (err) {
    console.error('Error fetching offerings:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * ✅ GET teachers filtered by department
 *    New route to support department-based teacher filtering
 */
router.get('/teachers-for-department', async (req, res) => {
  const { departmentid } = req.query;
  
  console.log('🏢 Fetching teachers for department:', departmentid);
  
  if (!departmentid) {
    return res.status(400).json({ error: 'departmentid query parameter is required' });
  }
  
  try {
    const result = await db.query(
      'SELECT * FROM public.master_teacher WHERE teacher_dept_id = $1 ORDER BY teachername, teacherid',
      [departmentid]
    );
    
    console.log(`✅ Found ${result.rowCount} teachers for department ${departmentid}`);
    res.status(200).json({ teachers: result.rows });
  } catch (err) {
    console.error('❌ Error fetching teachers for department:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * ✅ Create course offering
 *    (kept identical to your payload & columns)
 */
// ✅ Create course offering (fixed: no reassignment of const)
router.post('/', async (req, res) => {
  const {
    offerid,
    offer_programid,
    offer_courseid,
    offfer_term,        // NOTE: triple 'f' kept
    offer_facultyid,
    offer_semesterno,
    offer_section,
    offerislab,
    offer_capacity,
    offeriselective,
    offerelectgroupid,
    offerroom,
    offer_collegename,
    offerstatus
  } = req.body;

  console.log('📥 Course offering POST request:', {
    offerid,
    offer_programid,
    offer_courseid,
    offer_facultyid,
    offer_semesterno,
    offer_section,
    offer_capacity,
    offerroom,
    offer_collegename
  });

  if (!offerid) {
    return res.status(400).json({ error: 'offerid is required' });
  }

  // ---------- normalize (NO reassignment of consts) ----------
  const norm = (v) => {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s === '' ? null : s;
  };
  const toIntOrNull = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const subjId   = norm(offer_courseid);   // subject (FK -> master_subject.subjectid)
  const progId   = norm(offer_programid);  // course/program (FK -> master_course.courseid)
  const facId    = norm(offer_facultyid);  // teacher (FK -> master_teacher.teacherid) - can be null
  const termId   = norm(offfer_term);      // academic year (FK -> college_acad_year.id) - can be null
  const semNo    = toIntOrNull(offer_semesterno);
  const capacity = toIntOrNull(offer_capacity);
  const section  = norm(offer_section);
  const room     = norm(offerroom);
  const college  = norm(offer_collegename);
  const status   = norm(offerstatus) || 'ACTIVE';
  const isLab    = !!offerislab;
  const isElect  = !!offeriselective;
  const electGrp = norm(offerelectgroupid);

  // ---------- validations (only when non-null) ----------
  try {
    if (subjId) {
      const r = await db.query('SELECT 1 FROM master_subject WHERE subjectid = $1', [subjId]);
      if (r.rowCount === 0) return res.status(400).json({ error: `Subject ID '${subjId}' does not exist in master_subject table` });
    }
    if (progId) {
      const r = await db.query('SELECT 1 FROM master_course WHERE courseid = $1', [progId]);
      if (r.rowCount === 0) return res.status(400).json({ error: `Course ID '${progId}' does not exist in master_course table` });
    }
    if (facId) {
      const r = await db.query('SELECT 1 FROM master_teacher WHERE teacherid = $1', [facId]);
      if (r.rowCount === 0) return res.status(400).json({ error: `Teacher ID '${facId}' does not exist in master_teacher table` });
    }
    if (termId) {
      const r = await db.query('SELECT 1 FROM college_acad_year WHERE id = $1', [termId]);
      if (r.rowCount === 0) return res.status(400).json({ error: `Academic year ID '${termId}' does not exist in college_acad_year table` });
    }
  } catch (validationErr) {
    console.error('⚠️ Validation error:', validationErr.message);
    return res.status(500).json({ error: 'Database validation failed', details: validationErr.message });
  }

  // ---------- insert ----------
  try {
    const result = await db.query(
      `INSERT INTO public.college_course_offering (
        offerid, offer_programid, offer_courseid, offfer_term,
        offer_facultyid, offer_semesterno, offer_section, offerislab,
        offer_capacity, offeriselective, offerelectgroupid, offerroom,
        offer_collegename, offerstatus, createdat, updatedat
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8,
        $9, $10, $11, $12,
        $13, $14, NOW(), NOW()
      ) RETURNING offerid`,
      [
        offerid,
        progId,
        subjId,
        termId,
        facId,
        semNo,
        section,
        isLab,
        capacity,
        isElect,
        electGrp,
        room,
        college,
        status
      ]
    );

    console.log('✅ Course offering created successfully:', result.rows[0].offerid);
    return res.status(201).json({ message: 'Course offering created', offerid: result.rows[0].offerid });
  } catch (err) {
    console.error('❌ Error creating course offering:', err.message);
    console.error('SQL Error Details:', err.detail || 'No additional details');
    return res.status(500).json({
      error: 'Database error while creating course offering',
      details: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
  }
});


/**
 * ✅ Update course offering
 *    (unchanged apart from minor normalization)
 */
router.put('/:offerid', async (req, res) => {
  const { offerid } = req.params;
  const {
    offer_programid,
    offer_courseid,
    offfer_term,        // NOTE: kept original field name
    offer_facultyid,
    offer_semesterno,
    offer_section,
    offerislab,
    offer_capacity,
    offeriselective,
    offerelectgroupid,
    offerroom,
    offer_collegename,  // Added from frontend payload
    offerstatus
  } = req.body;

  console.log('📝 Course offering PUT request for:', offerid, {
    offer_programid,
    offer_courseid,
    offer_facultyid,
    offer_collegename
  });

  try {
    const result = await db.query(
      `UPDATE public.college_course_offering SET
        offer_programid = $1,
        offer_courseid = $2,
        offfer_term = $3,
        offer_facultyid = $4,
        offer_semesterno = $5,
        offer_section = $6,
        offerislab = $7,
        offer_capacity = $8,
        offeriselective = $9,
        offerelectgroupid = $10,
        offerroom = $11,
        offer_collegename = $12,
        offerstatus = $13,
        updatedat = NOW()
      WHERE offerid = $14
      RETURNING offerid`,
      [
        offer_programid,
        offer_courseid,
        offfer_term,
        offer_facultyid,
        toIntOrNull(offer_semesterno),
        offer_section,
        offerislab || false,
        toIntOrNull(offer_capacity),
        offeriselective || false,
        offerelectgroupid || null,
        offerroom || null,
        offer_collegename || null,
        offerstatus || 'ACTIVE',
        offerid
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Course offering not found' });
    }

    res
      .status(200)
      .json({ message: 'Course offering updated', offerid: result.rows[0].offerid });
  } catch (err) {
    console.error('Error updating course offering:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * ✅ Delete course offering
 *    (unchanged)
 */
router.delete('/:offerid', async (req, res) => {
  const { offerid } = req.params;

  try {
    const result = await db.query(
      'DELETE FROM public.college_course_offering WHERE offerid = $1 RETURNING offerid',
      [offerid]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Course offering not found' });
    }

    res
      .status(200)
      .json({ message: 'Course offering deleted', offerid: result.rows[0].offerid });
  } catch (err) {
    console.error('Error deleting course offering:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * 🔗 NEW: Get subjects mapped to a given COURSE (Program Setup) & (optional) SEMESTER
 * This “connects” offerings to the subject mapping created by master_subject_api.
 * - Uses public.subject_course (sub_cou_mast_id = courseid) JOIN public.master_subject
 * - If ?semester= is provided, it filters by sub_cou_sem_no = semester
 *
 * GET /subjects?courseid=COURSE123&_or_?semester=2
 */
router.get('/subjects', async (req, res) => {
  const { courseid } = req.query;
  const semester = toIntOrNull(req.query.semester);

  if (!courseid) {
    return res.status(400).json({ error: 'courseid query param is required' });
  }

  try {
    const sql = `
      SELECT
        sc.sub_cou_id,
        sc.sub_cou_mast_id AS courseid,
        sc.sub_cou_mast_sub_id AS subjectid,
        sc.sub_cou_sem_no,
        sc.sub_cou_iselective,
        sc.sub_cou_islab,
        ms.subjectcode,
        ms.subjectdesc,
        ms.subjectcredits,
        ms.subjectcategory,
        ms.subjectcoursetype
      FROM public.subject_course sc
      JOIN public.master_subject ms
        ON ms.subjectid = sc.sub_cou_mast_sub_id
      WHERE sc.sub_cou_mast_id = $1
        AND ($2::INT IS NULL OR sc.sub_cou_sem_no = $2)
      ORDER BY ms.subjectid ASC
    `;

    const r = await db.query(sql, [courseid, semester]);
    res.json({
      courseid,
      semester,
      count: r.rowCount,
      subjects: r.rows
    });
  } catch (err) {
    console.error('Error fetching subjects for course:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * 🔗 NEW: Get subjects for a specific OFFERING
 * Looks up the offering’s course & semester, then returns the mapped subjects from subject_course.
 *
 * GET /:offerid/subjects
 */
router.get('/:offerid/subjects', async (req, res) => {
  const { offerid } = req.params;

  try {
    // 1) Find the offering to get course + semester
    const offRes = await db.query(
      `SELECT offerid, offer_courseid, offer_semesterno
       FROM public.college_course_offering
       WHERE offerid = $1
       LIMIT 1`,
      [offerid]
    );

    if (offRes.rowCount === 0) {
      return res.status(404).json({ error: 'Course offering not found' });
    }

    const { offer_courseid: courseid, offer_semesterno: semNo } = offRes.rows[0];

    // 2) Fetch mapped subjects for that course + (optional) semester
    const sql = `
      SELECT
        sc.sub_cou_id,
        sc.sub_cou_mast_id AS courseid,
        sc.sub_cou_mast_sub_id AS subjectid,
        sc.sub_cou_sem_no,
        sc.sub_cou_iselective,
        sc.sub_cou_islab,
        ms.subjectcode,
        ms.subjectdesc,
        ms.subjectcredits,
        ms.subjectcategory,
        ms.subjectcoursetype
      FROM public.subject_course sc
      JOIN public.master_subject ms
        ON ms.subjectid = sc.sub_cou_mast_sub_id
      WHERE sc.sub_cou_mast_id = $1
        AND ($2::INT IS NULL OR sc.sub_cou_sem_no = $2)
      ORDER BY ms.subjectid ASC
    `;

    const subjRes = await db.query(sql, [courseid, toIntOrNull(semNo)]);

    return res.json({
      offerid,
      courseid,
      semester: toIntOrNull(semNo),
      count: subjRes.rowCount,
      subjects: subjRes.rows
    });
  } catch (err) {
    console.error('Error fetching subjects for offering:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * 🔗 NEW: Get teachers for a specific subject
 * Uses subject_teacher table to find teachers assigned to a subject
 * 
 * GET /teachers-for-subject?subjectid=SUBJECT123
 */
router.get('/teachers-for-subject', async (req, res) => {
  const { subjectid } = req.query;

  if (!subjectid) {
    return res.status(400).json({ error: 'subjectid query param is required' });
  }

  try {
    const sql = `
      SELECT DISTINCT
        t.teacherid,
        t.teachername,
        t.teacherdesig,
        t.teacheremailid,
        t.teachermob1,
        t.teachertype,
        t.teachermaxweekhrs,
        st.subteaid,
        st.subtea_acadyear,
        st.subcoll_acad_sem
      FROM public.master_teacher t
      INNER JOIN public.subject_teacher st
        ON t.teacherid = st.subtea_masid
      WHERE st.subcollegesubid = $1
        AND t.teachervalid = true
      ORDER BY t.teachername ASC
    `;

    const result = await db.query(sql, [subjectid]);
    
    console.log(`🎓 Found ${result.rowCount} teachers for subject ${subjectid}`);
    
    res.json({
      subjectid,
      count: result.rowCount,
      teachers: result.rows
    });
  } catch (err) {
    console.error('Error fetching teachers for subject:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * 🔗 NEW: Get teachers for a department (via subjects)
 * Gets all teachers who teach any subject in the specified department
 * 
 * GET /teachers-for-department?departmentid=DEPT123
 */
router.get('/teachers-for-department', async (req, res) => {
  const { departmentid } = req.query;

  if (!departmentid) {
    return res.status(400).json({ error: 'departmentid query param is required' });
  }

  try {
    const sql = `
      SELECT DISTINCT
        t.teacherid,
        t.teachername,
        t.teacherdesig,
        t.teacheremailid,
        t.teachermob1,
        t.teachertype,
        t.teachermaxweekhrs,
        COUNT(DISTINCT st.subcollegesubid) as subjects_taught
      FROM public.master_teacher t
      INNER JOIN public.subject_teacher st
        ON t.teacherid = st.subtea_masid
      INNER JOIN public.master_subject ms
        ON st.subcollegesubid = ms.subjectid
      WHERE ms.subjectdeptid = $1
        AND t.teachervalid = true
      GROUP BY t.teacherid, t.teachername, t.teacherdesig, t.teacheremailid, 
               t.teachermob1, t.teachertype, t.teachermaxweekhrs
      ORDER BY subjects_taught DESC, t.teachername ASC
    `;

    const result = await db.query(sql, [departmentid]);
    
    console.log(`🏢 Found ${result.rowCount} teachers for department ${departmentid}`);
    
    res.json({
      departmentid,
      count: result.rowCount,
      teachers: result.rows
    });
  } catch (err) {
    console.error('Error fetching teachers for department:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
