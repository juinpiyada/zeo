// routes/teacher.js
const express = require('express');
const router = express.Router();
const db = require('../config/db_conn'); // shared pg Pool client

// --- tiny helpers (optional) ---
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const AADHAAR_RE = /^[0-9]{12}$/;

function validateIds(pancardno, aadharno) {
  if (pancardno && !PAN_RE.test(pancardno)) {
    return 'Invalid PAN format. Expected 10 chars: AAAAA9999A';
  }
  if (aadharno && !AADHAAR_RE.test(aadharno)) {
    return 'Invalid Aadhaar format. Expected 12 digits.';
  }
  return null;
}

// ================================
// GET: all teachers
// ================================
router.get('/', async (_req, res) => {
  try {
    const result = await db.query('SELECT * FROM public.master_teacher ORDER BY teacherid');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching teachers:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ================================
// GET: only IDs (place BEFORE "/:id")
// ================================
router.get('/only/ids', async (_req, res) => {
  try {
    const result = await db.query('SELECT teacherid FROM public.master_teacher ORDER BY teacherid');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching teacher IDs:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ================================
// GET: teachers by department (place BEFORE "/:id")
// ================================
router.get('/by-department/:deptId', async (req, res) => {
  const { deptId } = req.params;
  try {
    const result = await db.query(
      'SELECT * FROM public.master_teacher WHERE teacher_dept_id = $1 ORDER BY teachername, teacherid',
      [deptId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching teachers by department:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});
// --- Add this to routes/master_teacher_api.js (or wherever your master teacher routes live) ---

/**
 * GET /api/teachers/next-id
 * Returns next teacherid like TECH_001, TECH_002 ...
 */
router.get('/next-id', async (_req, res) => {
  try {
    // Adjust the prefix & width to your convention (seen in screenshot as TECH_001)
    const PREFIX = 'TECH_';
    const PAD = 3;

    const q = `
      SELECT teacherid
      FROM public.master_teacher
      WHERE teacherid LIKE $1
      ORDER BY teacherid DESC
      LIMIT 1
    `;
    const { rows } = await db.query(q, [`${PREFIX}%`]);

    let nextNum = 1;
    if (rows.length) {
      const last = String(rows[0].teacherid || '');
      const m = last.match(/\d+$/);
      if (m) nextNum = parseInt(m[0], 10) + 1;
    }

    const nextId = PREFIX + String(nextNum).padStart(PAD, '0');
    res.json({ nextId });
  } catch (err) {
    console.error('next-id error:', err);
    res.status(500).json({ error: 'Failed to compute next teacher id' });
  }
});

// ================================
// GET: teacher by id
// ================================
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      'SELECT * FROM public.master_teacher WHERE teacherid = $1',
      [id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Teacher not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching teacher:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ================================
// POST: add/update teacher by PRIMARY KEY teacherid (+ auto-create/merge user)
// ================================
router.post('/', async (req, res) => {
  const {
    // identity & FK
    teacherid,
    teacheruserid, // optional from FE; we’ll normalize from email

    // core profile
    teachername,
    teacheraddress,
    teacheremailid,   // used as userid
    teachermob1,      // used as password
    teachermob2,
    teachergender,
    teachercaste,
    teacherdoj,
    teacherdesig,
    teachertype,
    teachermaxweekhrs,
    teachercollegeid,
    teachervalid,     // boolean

    // dept
    teacher_dept_id,

    // parents
    teacherparentname1,
    teacherparentname2,

    // IDs
    pancardno,
    aadharno,

    // addresses
    communication_address,
    permanent_address,

    // personal
    teacherdob,
    ismarried,

    // emergency
    emergency_contact_name,
    emergency_contact_address,
    emergency_contact_phone,

    // timestamps
    createdat,
    updatedat
  } = req.body;

  // basic validations same as before
  const idErr = validateIds(pancardno, aadharno);
  if (idErr) return res.status(400).json({ error: idErr });

  // userid from email/teacheruserid
  const normalizedUserid = String(teacheruserid || teacheremailid || '').trim();
  if (!normalizedUserid) {
    return res.status(400).json({ error: 'Email ID/User ID is required to create user' });
  }
  if (!teachermob1) {
    return res.status(400).json({ error: 'Mobile1 (Password) is required to create user' });
  }

  // IMPORTANT for PK-upsert: we must have a non-null teacherid.
  // Your UI already builds one like TECH_001; if not present, you can generate one here.
  const pkTeacherId = String(teacherid || '').trim();
  if (!pkTeacherId) {
    return res.status(400).json({ error: 'teacherid (primary key) is required' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // 1) Upsert/merge into master_user (same logic you had)
    await client.query(
      `
      INSERT INTO public.master_user (userid, userpwd, userroles, useractive, createdat, updatedat)
      VALUES ($1, $2, $3, TRUE, NOW(), NOW())
      ON CONFLICT (userid)
      DO UPDATE SET
        userpwd   = EXCLUDED.userpwd,
        userroles = (
          SELECT string_agg(DISTINCT r, ',')
          FROM unnest(
            regexp_split_to_array(
              trim(BOTH ',' FROM COALESCE(public.master_user.userroles, '') || ',' || EXCLUDED.userroles)
            , '\\s*,\\s*')
          ) t(r)
        ),
        useractive = TRUE,
        updatedat  = NOW()
      `,
      [normalizedUserid, String(teachermob1).trim(), 'TEACHER,USER']
    );

    // 2) UPSERT into master_teacher by PRIMARY KEY (teacherid)
    await client.query(
      `
      INSERT INTO public.master_teacher (
        teacherid, teacheruserid,
        teachername, teacheraddress, teacheremailid, teachermob1, teachermob2,
        teachergender, teachercaste, teacherdoj, teacherdesig, teachertype,
        teachermaxweekhrs, teachercollegeid, teachervalid,
        teacher_dept_id,
        teacherparentname1, teacherparentname2,
        pancardno, aadharno,
        communication_address, permanent_address,
        teacherdob, ismarried,
        emergency_contact_name, emergency_contact_address, emergency_contact_phone,
        createdat, updatedat
      )
      VALUES (
        $1,  $2,
        $3,  $4,  $5,  $6,  $7,
        $8,  $9,  $10, $11, $12,
        $13, $14, $15,
        $16,
        $17, $18,
        $19, $20,
        $21, $22,
        $23, $24,
        $25, $26, $27,
        COALESCE($28, now()), COALESCE($29, now())
      )
      ON CONFLICT ON CONSTRAINT master_teacher_pkey
      DO UPDATE SET
        teacheruserid = EXCLUDED.teacheruserid,
        teachername   = EXCLUDED.teachername,
        teacheraddress= EXCLUDED.teacheraddress,
        teacheremailid= EXCLUDED.teacheremailid,
        teachermob1   = EXCLUDED.teachermob1,
        teachermob2   = EXCLUDED.teachermob2,
        teachergender = EXCLUDED.teachergender,
        teachercaste  = EXCLUDED.teachercaste,
        teacherdoj    = EXCLUDED.teacherdoj,
        teacherdesig  = EXCLUDED.teacherdesig,
        teachertype   = EXCLUDED.teachertype,
        teachermaxweekhrs = EXCLUDED.teachermaxweekhrs,
        teachercollegeid  = EXCLUDED.teachercollegeid,
        teachervalid      = EXCLUDED.teachervalid,
        teacher_dept_id   = EXCLUDED.teacher_dept_id,
        teacherparentname1= EXCLUDED.teacherparentname1,
        teacherparentname2= EXCLUDED.teacherparentname2,
        pancardno         = EXCLUDED.pancardno,
        aadharno          = EXCLUDED.aadharno,
        communication_address = EXCLUDED.communication_address,
        permanent_address     = EXCLUDED.permanent_address,
        teacherdob        = EXCLUDED.teacherdob,
        ismarried         = EXCLUDED.ismarried,
        emergency_contact_name    = EXCLUDED.emergency_contact_name,
        emergency_contact_address = EXCLUDED.emergency_contact_address,
        emergency_contact_phone   = EXCLUDED.emergency_contact_phone,
        updatedat         = NOW()
      `,
      [
        pkTeacherId, normalizedUserid,
        teachername, teacheraddress, teacheremailid, teachermob1, teachermob2,
        teachergender, teachercaste, teacherdoj, teacherdesig, teachertype,
        teachermaxweekhrs, teachercollegeid, (teachervalid ?? true),
        teacher_dept_id,
        teacherparentname1, teacherparentname2,
        pancardno, aadharno,
        communication_address, permanent_address,
        teacherdob, ismarried,
        emergency_contact_name, emergency_contact_address, emergency_contact_phone,
        createdat, updatedat
      ]
    );

    await client.query('COMMIT');
    return res.status(201).json({ message: 'Teacher upserted + user synced', teacherid: pkTeacherId, userid: normalizedUserid });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error upserting teacher:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  } finally {
    client.release();
  }
});


// ================================
// PUT: update teacher (no user change here)
// ================================
router.put('/:id', async (req, res) => {
  const { id } = req.params;

  const {
    // identity & FK
    teacheruserid,

    // core profile
    teachername,
    teacheraddress,
    teacheremailid,
    teachermob1,
    teachermob2,
    teachergender,
    teachercaste,
    teacherdoj,
    teacherdesig,
    teachertype,
    teachermaxweekhrs,
    teachercollegeid,
    teachervalid,

    // NEW: department
    teacher_dept_id,

    // parents
    teacherparentname1,
    teacherparentname2,

    // IDs
    pancardno,
    aadharno,

    // addresses
    communication_address,
    permanent_address,

    // personal
    teacherdob,
    ismarried,

    // emergency contact
    emergency_contact_name,
    emergency_contact_address,
    emergency_contact_phone,

    // timestamps
    createdat,
    updatedat
  } = req.body;

  const idErr = validateIds(pancardno, aadharno);
  if (idErr) return res.status(400).json({ error: idErr });

  try {
    const result = await db.query(
      `
      UPDATE public.master_teacher SET
        teacheruserid = $1,
        teachername = $2,
        teacheraddress = $3,
        teacheremailid = $4,
        teachermob1 = $5,
        teachermob2 = $6,
        teachergender = $7,
        teachercaste = $8,
        teacherdoj = $9,
        teacherdesig = $10,
        teachertype = $11,
        teachermaxweekhrs = $12,
        teachercollegeid = $13,
        teachervalid = $14,
        teacher_dept_id = $15,
        teacherparentname1 = $16,
        teacherparentname2 = $17,
        pancardno = $18,
        aadharno = $19,
        communication_address = $20,
        permanent_address = $21,
        teacherdob = $22,
        ismarried = $23,
        emergency_contact_name = $24,
        emergency_contact_address = $25,
        emergency_contact_phone = $26,
        createdat = COALESCE($27, createdat),
        updatedat = COALESCE($28, now())
      WHERE teacherid = $29
      `,
      [
        teacheruserid,
        teachername,
        teacheraddress,
        teacheremailid,
        teachermob1,
        teachermob2,
        teachergender,
        teachercaste,
        teacherdoj,
        teacherdesig,
        teachertype,
        teachermaxweekhrs,
        teachercollegeid,
        teachervalid,
        teacher_dept_id,
        teacherparentname1,
        teacherparentname2,
        pancardno,
        aadharno,
        communication_address,
        permanent_address,
        teacherdob,
        ismarried,
        emergency_contact_name,
        emergency_contact_address,
        emergency_contact_phone,
        createdat,
        updatedat,
        id
      ]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: 'Teacher not found' });
    res.json({ message: 'Teacher updated successfully' });
  } catch (err) {
    console.error('Error updating teacher:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ================================
// DELETE: teacher by id
// ================================
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query('DELETE FROM public.master_teacher WHERE teacherid = $1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Teacher not found' });
    res.json({ message: 'Teacher deleted successfully' });
  } catch (err) {
    console.error('Error deleting teacher:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
