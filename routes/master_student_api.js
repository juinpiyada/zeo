const express = require('express');
const cors = require('cors');
const router = express.Router();
const pool = require('../config/db_conn'); // Adjust path to your PostgreSQL pool

router.use(cors());
router.use(express.json());

// ========================= Helpers (common) =========================

// Extract integer from free-text semester like 'Sem 3' or '3'
function toIntSem(semText) {
  if (semText == null) return null;
  const onlyDigits = String(semText).replace(/[^0-9]/g, '');
  if (!onlyDigits) return null;
  const n = parseInt(onlyDigits, 10);
  return Number.isFinite(n) ? n : null;
}

// Infer total semesters from UI-driven program description (fallback to course id)
function inferTotalSemesters(text) {
  if (!text) return 8; // default UG fallback
  const t = String(text).toLowerCase();

  if (t.includes('diploma')) return 6;
  if (t.includes('btech') || t.includes('b.e')) return 8;
  if (t.includes('mtech') || t.includes('m.e')) return 4;
  if (t.includes('mca') || t.includes('mba')) return 4;
  if (t.includes('msc')) return 4;
  if (t.includes('bsc') || t.includes('bca')) return 6;

  return 8; // safe default
}
// === net payable helpers ===
function round2(n) {
  const x = Number(n || 0);
  return Math.max(0, Number(x.toFixed(2)));
}
function computeProgramFeeEffective({
  programdescription,
  stu_course_id,
  semfees = 0,
  sems = [],                 // [sem1..sem10] as numbers
  overrideProgramFee = null, // numeric or null
}) {
  // 1) infer total semesters from program text / fallback course id
  const stream = (programdescription && String(programdescription).trim()) ||
                 (stu_course_id && String(stu_course_id).trim()) ||
                 null;
  const totalSemesters = inferTotalSemesters(stream);

  // 2) use override > sum(sem1..sem10) > (semfees * totalSemesters)
  const semSum = sems.reduce((a,b)=>a + (Number(b)||0), 0);
  if (overrideProgramFee != null) return round2(overrideProgramFee);
  if (semSum > 0)                return round2(semSum);
  return round2((Number(semfees)||0) * (totalSemesters||0));
}

// === helpers to keep student_sem_progress in sync (role from stu_rollnumber) ===

// Create if missing; copy core fields + sem1..sem10 + cgpa/remarks/scholarship
async function ensureProgressRow(client, stuid) {
  await client.query(
    `
    INSERT INTO public.ay_2025_2026
      (stuid, stuname, admission_date, role, department, present_factor,
       sem1, sem2, sem3, sem4, sem5, sem6, sem7, sem8, sem9, sem10,
       cgpa, remarks, scholrshipfees,
       created_at, updated_at)
    SELECT
      s.stuid,
      s.stuname,
      s.stuadmissiondt,
      s.stu_rollnumber,                       -- role from roll number
      s.stu_course_id,                        -- department from course id
      NULLIF(s.stu_curr_semester,'')::numeric,

      /* seed sem1..sem10 from student_master */
      COALESCE(NULLIF(s.sem1::text,  '')::numeric, 0.00),
      COALESCE(NULLIF(s.sem2::text,  '')::numeric, 0.00),
      COALESCE(NULLIF(s.sem3::text,  '')::numeric, 0.00),
      COALESCE(NULLIF(s.sem4::text,  '')::numeric, 0.00),
      COALESCE(NULLIF(s.sem5::text,  '')::numeric, 0.00),
      COALESCE(NULLIF(s.sem6::text,  '')::numeric, 0.00),
      COALESCE(NULLIF(s.sem7::text,  '')::numeric, 0.00),
      COALESCE(NULLIF(s.sem8::text,  '')::numeric, 0.00),
      COALESCE(NULLIF(s.sem9::text,  '')::numeric, 0.00),
      COALESCE(NULLIF(s.sem10::text, '')::numeric, 0.00),

      COALESCE(NULLIF(s.cgpa::text,'' )::numeric, 0.00),
      COALESCE(s.remarks, false),
      COALESCE(NULLIF(s.scholrshipfees::text,'')::numeric, 0.00),

      now(), now()
    FROM public.student_master s
    WHERE s.stuid = $1
    ON CONFLICT (stuid) DO NOTHING
    `,
    [stuid]
  );
}

// Keep mirrored fields fresh (name, admission date, role, department, present_factor)
async function syncProgressMirror(client, stuid) {
  await client.query(
    `
    UPDATE public.ay_2025_2026 p
    SET stuname        = s.stuname,
        admission_date = s.stuadmissiondt,
        role           = s.stu_rollnumber,
        department     = s.stu_course_id,
        present_factor = NULLIF(s.stu_curr_semester,'')::numeric,

        /* sync sem1..sem10 */
        sem1  = COALESCE(NULLIF(s.sem1::text,  '')::numeric, p.sem1),
        sem2  = COALESCE(NULLIF(s.sem2::text,  '')::numeric, p.sem2),
        sem3  = COALESCE(NULLIF(s.sem3::text,  '')::numeric, p.sem3),
        sem4  = COALESCE(NULLIF(s.sem4::text,  '')::numeric, p.sem4),
        sem5  = COALESCE(NULLIF(s.sem5::text,  '')::numeric, p.sem5),
        sem6  = COALESCE(NULLIF(s.sem6::text,  '')::numeric, p.sem6),
        sem7  = COALESCE(NULLIF(s.sem7::text,  '')::numeric, p.sem7),
        sem8  = COALESCE(NULLIF(s.sem8::text,  '')::numeric, p.sem8),
        sem9  = COALESCE(NULLIF(s.sem9::text,  '')::numeric, p.sem9),
        sem10 = COALESCE(NULLIF(s.sem10::text, '')::numeric, p.sem10),

        cgpa           = COALESCE(NULLIF(s.cgpa::text,'')::numeric, p.cgpa),
        remarks        = COALESCE(s.remarks, p.remarks),
        scholrshipfees = COALESCE(NULLIF(s.scholrshipfees::text,'')::numeric, p.scholrshipfees),
        updated_at     = now()
    FROM public.student_master s
    WHERE s.stuid = p.stuid AND p.stuid = $1
    `,
    [stuid]
  );

  // (optional) keep present_factor aligned with current-sem mapped value if available
  await client.query(
    `
    WITH src AS (
      SELECT s.stuid, NULLIF(s.stu_curr_semester,'')::int AS semn
      FROM public.student_master s
      WHERE s.stuid = $1
    )
    UPDATE public.ay_2025_2026 p
    SET present_factor = COALESCE(
      CASE src.semn
        WHEN 1 THEN p.sem1 WHEN 2 THEN p.sem2 WHEN 3 THEN p.sem3 WHEN 4 THEN p.sem4 WHEN 5 THEN p.sem5
        WHEN 6 THEN p.sem6 WHEN 7 THEN p.sem7 WHEN 8 THEN p.sem8 WHEN 9 THEN p.sem9 WHEN 10 THEN p.sem10
      END, present_factor
    ),
    updated_at = now()
    FROM src
    WHERE p.stuid = src.stuid
    `,
    [stuid]
  );
}

// ========================= Finance Upsert Helper (UPDATED) =========================
//
// Upserts a row into public.fin_master_student based on student_master,
// copying sem1..sem10 amounts. program_fee is computed as:
//   - If overrideProgramFee is provided → program_fee = round(overrideProgramFee)
//   - Else if any sem1..sem10 sum to > 0 → program_fee = round(sum(sem1..sem10))
//   - Else → program_fee = round(semfees * total_semesters)
// Values are clamped to >= 0.
//
// If overrideTotalSemesters is provided (number), we force that value.
//
async function upsertFinanceRow(client, stuid, overrideTotalSemesters = null, overrideProgramFee = null) {
  // Pull source row (now including sem1..sem10)
  const { rows, rowCount } = await client.query(
    `
    SELECT
      stuname,
      scholrshipfees,
      programdescription,
      stu_course_id,
      stu_curr_semester,
      stuadmissiondt,
      semfees,
      createdat,
      COALESCE(sem1,  0.00) AS sem1,
      COALESCE(sem2,  0.00) AS sem2,
      COALESCE(sem3,  0.00) AS sem3,
      COALESCE(sem4,  0.00) AS sem4,
      COALESCE(sem5,  0.00) AS sem5,
      COALESCE(sem6,  0.00) AS sem6,
      COALESCE(sem7,  0.00) AS sem7,
      COALESCE(sem8,  0.00) AS sem8,
      COALESCE(sem9,  0.00) AS sem9,
      COALESCE(sem10, 0.00) AS sem10
    FROM public.student_master
    WHERE stuid = $1
    `,
    [stuid]
  );

  if (rowCount === 0) {
    throw new Error(`No student_master row found for stuid=${stuid}`);
  }

  const s = rows[0];

  const stream =
    (s.programdescription && String(s.programdescription).trim()) ||
    (s.stu_course_id && String(s.stu_course_id).trim()) ||
    null;

  const inferredTotal = inferTotalSemesters(stream);
  const totalSemesters = overrideTotalSemesters ?? inferredTotal;
  const currentSemester = toIntSem(s.stu_curr_semester);

  // Integer program fee fallback: round(semfees * total_semesters)
  const fallbackProgramFee = Math.max(
    0,
    Math.round((Number(s.semfees) || 0) * (totalSemesters || 0))
  );

  // Pre-compute in JS for INSERT values
  const semVals = [
    Number(s.sem1)  || 0, Number(s.sem2)  || 0, Number(s.sem3)  || 0, Number(s.sem4)  || 0, Number(s.sem5)  || 0,
    Number(s.sem6)  || 0, Number(s.sem7)  || 0, Number(s.sem8)  || 0, Number(s.sem9)  || 0, Number(s.sem10) || 0,
  ];
  const semSum = semVals.reduce((a, b) => a + b, 0);

  await client.query(
    `
    INSERT INTO public.fin_master_student AS f (
      stuid, name, scholarship_fee, total_semesters, current_semester,
      admission_date, stream, program_fee,
      sem1, sem2, sem3, sem4, sem5, sem6, sem7, sem8, sem9, sem10,
      createdat, updatedat
    )
    VALUES (
      $1,  $2,  $3,  $4,  $5,
      $6,  $7,
      /* initial program_fee: prefer explicit override, else sem-sum if >0, else fallback */
      GREATEST(0, ROUND(COALESCE($21, CASE WHEN $18 > 0 THEN $18 ELSE $8 END))::int),

      $9,  $10, $11, $12, $13, $14, $15, $16, $17, $18,
      COALESCE($19, now()), now()
    )
    ON CONFLICT (stuid) DO UPDATE
    SET
      name             = EXCLUDED.name,
      scholarship_fee  = EXCLUDED.scholarship_fee,
      total_semesters  = CASE
                           WHEN $20::smallint IS NOT NULL THEN $20::smallint
                           ELSE COALESCE(f.total_semesters, EXCLUDED.total_semesters)
                         END,
      current_semester = EXCLUDED.current_semester,
      admission_date   = EXCLUDED.admission_date,
      stream           = EXCLUDED.stream,

      /* Always mirror per-semester amounts */
      sem1  = EXCLUDED.sem1,
      sem2  = EXCLUDED.sem2,
      sem3  = EXCLUDED.sem3,
      sem4  = EXCLUDED.sem4,
      sem5  = EXCLUDED.sem5,
      sem6  = EXCLUDED.sem6,
      sem7  = EXCLUDED.sem7,
      sem8  = EXCLUDED.sem8,
      sem9  = EXCLUDED.sem9,
      sem10 = EXCLUDED.sem10,

      /* program_fee rule on UPDATE:
         - If explicit override is provided → use override
         - Else if incoming sem-sum > 0 → round(sum)
         - Else → round(semfees * (override or existing total_semesters))
      */
      program_fee = GREATEST(
        0,
        ROUND(
          COALESCE(
            $21,
            CASE
              WHEN (EXCLUDED.sem1 + EXCLUDED.sem2 + EXCLUDED.sem3 + EXCLUDED.sem4 + EXCLUDED.sem5
                    + EXCLUDED.sem6 + EXCLUDED.sem7 + EXCLUDED.sem8 + EXCLUDED.sem9 + EXCLUDED.sem10) > 0
                THEN (EXCLUDED.sem1 + EXCLUDED.sem2 + EXCLUDED.sem3 + EXCLUDED.sem4 + EXCLUDED.sem5
                      + EXCLUDED.sem6 + EXCLUDED.sem7 + EXCLUDED.sem8 + EXCLUDED.sem9 + EXCLUDED.sem10)
              ELSE COALESCE(
                     (SELECT semfees FROM public.student_master sm WHERE sm.stuid = EXCLUDED.stuid), 0.00
                   ) * COALESCE(
                         CASE
                           WHEN $20::smallint IS NOT NULL THEN $20::smallint
                           ELSE f.total_semesters
                         END,
                         EXCLUDED.total_semesters,
                         0
                       )
            END
          )
        )::int
      ),
      updatedat = now()
    `,
    [
      stuid,                          // $1
      s.stuname,                      // $2
      Number(s.scholrshipfees) || 0,  // $3
      totalSemesters,                 // $4
      currentSemester,                // $5
      s.stuadmissiondt,               // $6
      stream,                         // $7
      fallbackProgramFee,             // $8 (fallback mult)

      // sem1..sem10
      semVals[0],                     // $9
      semVals[1],                     // $10
      semVals[2],                     // $11
      semVals[3],                     // $12
      semVals[4],                     // $13
      semVals[5],                     // $14
      semVals[6],                     // $15
      semVals[7],                     // $16
      semVals[8],                     // $17
      semVals[9],                     // $18   (also used as sem-sum test in INSERT program_fee)

      s.createdat,                    // $19
      overrideTotalSemesters ?? null, // $20  (affects total_semesters + program_fee fallback)
      (overrideProgramFee != null ? Math.max(0, Math.round(Number(overrideProgramFee))) : null) // $21 explicit override
    ]
  );
}

// ========================= Routes: Student Master =========================

/**
 * Add new student (transactional)
 * - inserts into student_master
 * - ensures ay_2025_2026 row
 * - upserts finance row into fin_master_student
 */
router.post('/add', async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      stuid,
      stu_enrollmentnumber,
      stu_rollnumber,
      stu_regn_number,
      stuname,
      stuemailid,
      stumob1,
      stumob2,
      stucaste,
      stugender,
      studob,
      stucategory,
      stuadmissiondt,
      stu_course_id,
      programdescription,          // stored in DB
      stu_lat_entry,
      stu_curr_semester,
      stu_section,
      stuvalid,
      stuuserid,
      stuparentname,
      stuaddress,
      stuparentemailid,
      stuprentmob1,
      stuprentmob2,
      stuparentaddress,
      stu_inst_id,
      semfees = 0.00,
      scholrshipfees = 0.00,
      seemfees = 0.00,
      scholrship_fee_head = null,
      balance = 0.00,

      // NEW: sem1..sem10, cgpa, remarks
      sem1 = 0.00,
      sem2 = 0.00,
      sem3 = 0.00,
      sem4 = 0.00,
      sem5 = 0.00,
      sem6 = 0.00,
      sem7 = 0.00,
      sem8 = 0.00,
      sem9 = 0.00,
      sem10 = 0.00,
      cgpa = 0.00,
      remarks = false,
      stu_mother_name = null,   
      admission_officer_name = null,
      // NEW: optional Course Total override for finance.program_fee
      program_fee_override = null
    } = req.body;

    const createdat = new Date();
    const updatedat = new Date();
// ✅ compute net payable for new student (Course Total − Scholarship)

// build array of sem1..sem10 as numbers
// ✅ compute net payable for new student (Course Total − Scholarship)
const semArray = [
  Number(sem1)||0, Number(sem2)||0, Number(sem3)||0, Number(sem4)||0, Number(sem5)||0,
  Number(sem6)||0, Number(sem7)||0, Number(sem8)||0, Number(sem9)||0, Number(sem10)||0,
];

const programFeeEff = computeProgramFeeEffective({
  programdescription,
  stu_course_id,
  semfees,
  sems: semArray,
  overrideProgramFee: program_fee_override,
});

const computedBalance = round2(programFeeEff - Number(scholrshipfees || 0));

    await client.query('BEGIN');

    // NOTE: we append sem1..sem10,cgpa,remarks just before createdat,updatedat
    const insert = await client.query(
  `INSERT INTO public.student_master (
  stuid, stu_enrollmentnumber, stu_rollnumber, stu_regn_number, stuname,
  stuemailid, stumob1, stumob2, stucaste, stugender,
  studob, stucategory, stuadmissiondt, stu_course_id, programdescription,
  stu_lat_entry, stu_curr_semester, stu_section, stuvalid, stuuserid,
  stuparentname, stuaddress, stuparentemailid, stuprentmob1, stuprentmob2,
  stuparentaddress, stu_inst_id, semfees, scholrshipfees, seemfees,
  scholrship_fee_head, balance,               -- 👈 fixed
  sem1, sem2, sem3, sem4, sem5, sem6, sem7, sem8, sem9, sem10,
  cgpa, remarks, stu_mother_name, admission_officer_name,
  createdat, updatedat
) VALUES  (
    $1,  $2,  $3,  $4,  $5,
    $6,  $7,  $8,  $9,  $10,
    NULLIF($11,'')::timestamp, $12, NULLIF($13,'')::timestamp, $14, $15,
    $16, $17, $18, $19, $20,
    $21, $22, $23, $24, $25,
    $26, $27, $28, $29, $30,
    $31, $32,
    $33, $34, $35, $36, $37, $38, $39, $40, $41, $42,
    $43, $44, $45, $46,   -- 👈 45: mother, 46: officer
    $47, $48              -- 👈 createdat, updatedat shift by +1
  ) RETURNING *`,
[
  stuid, stu_enrollmentnumber, stu_rollnumber, stu_regn_number, stuname,
  stuemailid, stumob1, stumob2, stucaste, stugender,
  studob, stucategory, stuadmissiondt, stu_course_id, programdescription,
  stu_lat_entry, stu_curr_semester, stu_section, stuvalid, stuuserid,
  stuparentname, stuaddress, stuparentemailid, stuprentmob1, stuprentmob2,
  stuparentaddress, stu_inst_id, semfees, scholrshipfees, seemfees, scholrship_fee_head,
  computedBalance,     // 👈 use computed net payable here
  sem1, sem2, sem3, sem4, sem5, sem6, sem7, sem8, sem9, sem10,
  cgpa, remarks, stu_mother_name, admission_officer_name,
  createdat, updatedat
]

    );

    // ensure progress row exists (idempotent)
    await ensureProgressRow(client, stuid);

    // finance upsert (auto → fin_master_student) with optional override for program_fee
    await upsertFinanceRow(
      client,
      stuid,
      null, // overrideTotalSemesters
      program_fee_override // NEW
    );

    await client.query('COMMIT');
    res.status(201).json({ message: 'Student added successfully', student: insert.rows[0] });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('Add Student Error:', error);
    res.status(500).json({ error: 'Failed to add student' });
  } finally {
    pool.release && pool.release(); // in case pool is pg.Pool, but keep original pattern below
  }
  try { /* keep original style */ } finally {}
});

// (keep the original finally style where you used client.release())
router.post('/add', (req, res, next) => next()); // no-op to avoid duplicate definition in bundlers

/**
 * Update student (transactional)
 * - updates student_master
 * - ensures ay_2025_2026 row exists
 * - syncs progress mirror
 * - upserts finance row (keeps any manual total_semesters override unless you pass one)
 */
router.put('/update/:stuid', async (req, res) => {
  const client = await pool.connect();
  try {
    const { stuid } = req.params;
    const {
      stu_enrollmentnumber,
      stu_rollnumber,
      stu_regn_number,
      stuname,
      stuemailid,
      stumob1,
      stumob2,
      stucaste,
      stugender,
      studob,
      stucategory,
      stuadmissiondt,
      stu_course_id,
      programdescription,          // stored in DB
      stu_lat_entry,
      stu_curr_semester,
      stu_section,
      stuvalid,
      stuuserid,
      stuparentname,
      stuaddress,
      stuparentemailid,
      stuprentmob1,
      stuprentmob2,
      stuparentaddress,
      stu_inst_id,
      semfees,
      scholrshipfees,
      seemfees,
      scholrship_fee_head,
      balance,

      // NEW: sem1..sem10, cgpa, remarks
      sem1,
      sem2,
      sem3,
      sem4,
      sem5,
      sem6,
      sem7,
      sem8,
      sem9,
      sem10,
      cgpa,
      remarks,
      stu_mother_name = null,
      admission_officer_name = null,
      // NEW: optional Course Total override for finance.program_fee
      program_fee_override = null
    } = req.body;

    const updatedat = new Date();
// ✅ compute net payable for update (Course Total − Scholarship)

// use incoming values (post-edit) to recompute
const semArrayUpd = [
  Number(sem1)||0, Number(sem2)||0, Number(sem3)||0, Number(sem4)||0, Number(sem5)||0,
  Number(sem6)||0, Number(sem7)||0, Number(sem8)||0, Number(sem9)||0, Number(sem10)||0,
];

const programFeeEffUpd = computeProgramFeeEffective({
  programdescription,
  stu_course_id,
  semfees,
  sems: semArrayUpd,
  overrideProgramFee: program_fee_override,
});

const computedBalanceUpd = round2(programFeeEffUpd - Number(scholrshipfees || 0));

    await client.query('BEGIN');

    const upd = await client.query(
  `UPDATE public.student_master SET
    stu_enrollmentnumber   = $1,
    stu_rollnumber         = $2,
    stu_regn_number        = $3,
    stuname                = $4,
    stuemailid             = $5,
    stumob1                = $6,
    stumob2                = $7,
    stucaste               = $8,
    stugender              = $9,
    studob                 = NULLIF($10,'')::timestamp,
    stucategory            = $11,
    stuadmissiondt         = NULLIF($12,'')::timestamp,
    admission_officer_name = $13,               -- ✅ FIX: give it a real index
    stu_course_id          = $14,
    programdescription     = $15,
    stu_lat_entry          = $16,
    stu_curr_semester      = $17,
    stu_section            = $18,
    stuvalid               = $19,
    stuuserid              = $20,
    stuparentname          = $21,
    stuaddress             = $22,
    stuparentemailid       = $23,
    stuprentmob1           = $24,
    stuprentmob2           = $25,
    stuparentaddress       = $26,
    stu_inst_id            = $27,
    semfees                = $28,
    scholrshipfees         = $29,
    seemfees               = $30,
    scholrship_fee_head    = $31,
    balance                = $32,

    sem1                   = $33,
    sem2                   = $34,
    sem3                   = $35,
    sem4                   = $36,
    sem5                   = $37,
    sem6                   = $38,
    sem7                   = $39,
    sem8                   = $40,
    sem9                   = $41,
    sem10                  = $42,
    cgpa                   = $43,
    remarks                = $44,
    stu_mother_name        = $45,
    updatedat              = $46
  WHERE stuid               = $47
  RETURNING *`,
  [
    // 1..12
    stu_enrollmentnumber, stu_rollnumber, stu_regn_number, stuname,
    stuemailid, stumob1, stumob2, stucaste, stugender,
    studob, stucategory, stuadmissiondt,
    // 13
    admission_officer_name,                 // ✅ now included
    // 14..32
    stu_course_id, programdescription, stu_lat_entry, stu_curr_semester, stu_section,
    stuvalid, stuuserid, stuparentname, stuaddress, stuparentemailid,
    stuprentmob1, stuprentmob2, stuparentaddress, stu_inst_id, semfees,
    scholrshipfees, seemfees, scholrship_fee_head, computedBalanceUpd,
    // 33..45
    sem1, sem2, sem3, sem4, sem5, sem6, sem7, sem8, sem9, sem10, cgpa, remarks,
    stu_mother_name,
    // 46..47
    updatedat, stuid
  ]
);


    if (upd.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Student not found' });
    }

    // ensure progress row exists (if someone inserted master without add route)
    await ensureProgressRow(client, stuid);

    // keep mirrored fields fresh
    await syncProgressMirror(client, stuid);

    // finance upsert (auto → fin_master_student) with optional override for program_fee
    await upsertFinanceRow(
      client,
      stuid,
      null, // overrideTotalSemesters
      program_fee_override // NEW
    );

    await client.query('COMMIT');
    res.json({ message: 'Student updated successfully', student: upd.rows[0] });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('Update Student Error:', error);
    res.status(500).json({ error: 'Failed to update student' });
  } finally {
    client.release();
  }
});

// DELETE student + all dependent rows
router.delete('/delete/:stuid', async (req, res) => {
  const { stuid } = req.params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1) delete progress / AY rows
    await client.query(
      'DELETE FROM public.ay_2025_2026 WHERE stuid = $1',
      [stuid]
    );

    // 2) delete finance mirror rows
    await client.query(
      'DELETE FROM public.fin_master_student WHERE stuid = $1',
      [stuid]
    );

    // 👉 if you have more child tables, delete them here in the same way
    // await client.query('DELETE FROM public.attendance WHERE stuid = $1', [stuid]);
    // await client.query('DELETE FROM public.exam_marks WHERE stuid = $1', [stuid]);

    // 3) now delete the actual student
    const result = await client.query(
      'DELETE FROM public.student_master WHERE stuid = $1 RETURNING *',
      [stuid]
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Student not found' });
    }

    await client.query('COMMIT');
    return res.json({
      message: 'Student and related records deleted successfully',
      student: result.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Delete Student Error:', err);
    return res.status(500).json({ error: 'Failed to delete student', detail: err.message });
  } finally {
    client.release();
  }
});

/**
 * Get all students (all columns)
 */
router.get('/list', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT *
       FROM public.student_master
       ORDER BY COALESCE(updatedat, createdat) DESC`
    );
    res.json({ students: result.rows });
  } catch (error) {
    console.error('Fetch Students Error:', error);
    res.status(500).json({ error: 'Failed to fetch students' });
  }
});

/**
 * Get a single student by ID
 */
router.get('/:stuid', async (req, res) => {
  const { stuid } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM public.student_master WHERE stuid = $1`,
      [stuid]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    res.json({ student: result.rows[0] });
  } catch (error) {
    console.error('Fetch Student Error:', error);
    res.status(500).json({ error: 'Failed to fetch student' });
  }
});

// ========================= Finance: POST API =========================
//
// POST /finance/upsert
// body: { stuid: string, total_semesters?: number, program_fee_override?: number }
//
// - Upserts the finance row for the given student into public.fin_master_student.
// - If total_semesters is provided, it overrides the inference for THIS call.
// - If program_fee_override is provided, program_fee will be set to round(override).
//
router.post('/finance/upsert', async (req, res) => {
  const client = await pool.connect();
  try {
    const { stuid, total_semesters, program_fee_override = null } = req.body;

    if (!stuid) {
      client.release();
      return res.status(400).json({ error: 'stuid is required' });
    }

    const override =
      total_semesters == null
        ? null
        : Math.max(1, Math.min(12, parseInt(total_semesters, 10) || 0));

    await client.query('BEGIN');
    await upsertFinanceRow(
      client,
      stuid,
      override,
      program_fee_override // NEW: allow explicit Course Total push
    );
    await client.query('COMMIT');

    res.status(200).json({
      message: 'Finance row upserted successfully',
      stuid,
      override_total_semesters: override,
      override_program_fee: (program_fee_override != null ? Math.round(Math.max(0, Number(program_fee_override))) : null)
    });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('Finance Upsert Error:', error);
    res.status(500).json({ error: 'Failed to upsert finance row' });
  } finally {
    client.release();
  }
});

// ========================= Settle a semester (zero semX and reduce balance) =========================
//
// POST /settle-semester
// body: { stuid: string, semester: number (1..10), amount?: number }
//
// - If amount is not provided, the current value of sem{semester} from student_master is used.
// - Atomically sets sem{semester} = 0 and balance = GREATEST(0, balance - amount)
// - Mirrors to fin_master_student and ay_2025_2026 via existing helpers.
//

router.post('/settle-semester', async (req, res) => {
  const client = await pool.connect();
  try {
    const { stuid, semester, amount } = req.body || {};
    const semN = parseInt(semester, 10);

    if (!stuid || !Number.isFinite(semN) || semN < 1 || semN > 10) {
      client.release();
      return res.status(400).json({ error: 'stuid and semester (1..10) are required' });
    }

    const col = `sem${semN}`;

    await client.query('BEGIN');

    // Lock the row and read current semN + balance
    const sel = await client.query(
      `SELECT COALESCE(${col}, 0.00)::numeric AS sem_amount,
              COALESCE(balance, 0.00)::numeric    AS balance
       FROM public.student_master
       WHERE stuid = $1
       FOR UPDATE`,
      [stuid]
    );

    if (sel.rowCount === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({ error: 'Student not found' });
    }

    const currentSemAmt = Number(sel.rows[0].sem_amount) || 0;
    const useAmt = Math.max(0, Number(amount != null ? amount : currentSemAmt));

    // If there's nothing to settle, no-op but keep it successful
    if (useAmt <= 0 && currentSemAmt <= 0) {
      await client.query('COMMIT');
      client.release();
      return res.json({ message: `No amount to settle for ${col}.`, stuid, semester: semN, amount: 0 });
    }

    // Update student_master: zero semN and reduce balance
    const upd = await client.query(
      `
      UPDATE public.student_master
      SET ${col}  = 0.00,
          balance = GREATEST(0, COALESCE(balance,0) - $2),
          updatedat = now()
      WHERE stuid = $1
      RETURNING *
      `,
      [stuid, useAmt]
    );

    if (upd.rowCount === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({ error: 'Student not found during update' });
    }

    // Keep mirrors fresh
    await ensureProgressRow(client, stuid);        // idempotent
    await syncProgressMirror(client, stuid);       // mirrors sem1..sem10 etc.
    await upsertFinanceRow(client, stuid, null, null); // mirrors into fin_master_student

    await client.query('COMMIT');

    res.json({
      message: `Settled ${col} and updated balance.`,
      stuid,
      semester: semN,
      settled_amount: useAmt,
      student: upd.rows[0]
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('Settle Semester Error:', err);
    res.status(500).json({ error: 'Failed to settle semester', detail: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;