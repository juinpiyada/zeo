// SMS-be/routes/master_course_api.js
const express = require('express');
const cors = require('cors');
const router = express.Router();
const pool = require('../config/db_conn'); // PostgreSQL Pool

router.use(cors());
router.use(express.json());

/* -------------------------- Helpers (dates) --------------------------
   RULE: Never construct JS Date from a date-only string if you care about the calendar day.
   We strictly treat date-only values as plain strings.
------------------------------------------------------------------------ */

/**
 * Normalize a user or DB date value to "YYYY-MM-DD" without timezone math.
 * Accepts:
 *   - "YYYY-MM-DD"
 *   - "D.M.YYYY" / "DD.MM.YYYY" (also allows "/" or "-" separators)
 *   - Date object (formats using UTC parts to avoid tz drift)
 *   - ISO string with time (uses UTC date parts)
 */
const toISODate = (val) => {
  if (!val) return null;

  // If already a string
  if (typeof val === 'string') {
    const s = val.trim();

    // Exact ISO date yyyy-mm-dd
    const mIso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (mIso) {
      const y = Number(mIso[1]);
      const m = Number(mIso[2]);
      const d = Number(mIso[3]);
      if (isValidYMD(y, m, d)) return padYMD(y, m, d);
      return null;
    }

    // D.M.YYYY / D/M/YYYY / D-M-YYYY
    const mDMY = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s);
    if (mDMY) {
      const d = Number(mDMY[1]);
      const m = Number(mDMY[2]);
      const y = Number(mDMY[3]);
      if (isValidYMD(y, m, d)) return padYMD(y, m, d);
      return null;
    }

    // ISO with time (try to parse as date-only using UTC parts)
    const mISOTime = /^(\d{4})-(\d{2})-(\d{2})T/.exec(s);
    if (mISOTime) {
      const y = Number(mISOTime[1]);
      const m = Number(mISOTime[2]);
      const d = Number(mISOTime[3]);
      if (isValidYMD(y, m, d)) return padYMD(y, m, d);
      return null;
    }

    // As a last resort, try Date parse but only for time-bearing values.
    // If it looks like a date-only with unknown format, return null.
    // This avoids accidental tz shifts.
    if (/\dT\d/.test(s)) {
      const d = new Date(s);
      if (!Number.isNaN(d.getTime())) {
        return padYMD(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
      }
    }
    return null;
  }

  // If it's a JS Date
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    // Use UTC parts so local TZ never shifts the day
    return padYMD(val.getUTCFullYear(), val.getUTCMonth() + 1, val.getUTCDate());
  }

  // Unknown type
  return null;
};

// Validate simple Y-M-D ranges (not exhaustive, but safe for UI inputs)
function isValidYMD(y, m, d) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1900 || y > 9999) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  return true;
}
function pad(n) {
  return String(n).padStart(2, '0');
}
function padYMD(y, m, d) {
  return `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}`;
}

// Add N years to an ISO date "YYYY-MM-DD" (pure string math)
const addYearsISO = (iso, n = 0) => {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return `${String(y + n).padStart(4, '0')}-${pad(m)}-${pad(d)}`;
};

// Pass a DB-friendly value (DATE column prefers a plain "YYYY-MM-DD" string)
const toPgDateValue = (iso) => iso;

/**
 * Optional: If your table wants the same look as the selector (no leading zeros),
 * this creates "D.M.YYYY" from "YYYY-MM-DD".
 */
const toDisplayDMY = (iso) => {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!isValidYMD(y, m, d)) return null;
  return `${d}.${m}.${y}`; // no leading zeros, e.g. 1.6.2025
};

/* -------------------------- Lookups -------------------------- */
async function getAcadYearById(id) {
  if (!id) return null;
  // Force DATEs out as strings to avoid tz drift
  const q = `
    SELECT
      id,
      to_char(collegeacadyearstartdt, 'YYYY-MM-DD') AS collegeacadyearstartdt,
      to_char(collegeacadyearenddt,   'YYYY-MM-DD') AS collegeacadyearenddt
    FROM public.college_acad_year
    WHERE id = $1
    LIMIT 1
  `;
  const r = await pool.query(q, [id]);
  return r.rows[0] || null;
}

async function getDeptById(deptId) {
  if (!deptId) return null;
  const q = `
    SELECT collegedeptid, colldept_code, collegedeptdesc
    FROM public.college_depts
    WHERE collegedeptid = $1
    LIMIT 1
  `;
  const r = await pool.query(q, [deptId]);
  return r.rows[0] || null;
}

/* -------------------------- Insert with recovery -------------------------- */
async function insertCourseWithRecovery(payload) {
  const {
    courseid, coursedesc, collegedept, courseprgcod,
    course_level, course_totsemester, course_tot_credits,
    course_duration, coursestartdate, courseenddate,
    createdat, updatedat
  } = payload;

  const insertSQL = `
    INSERT INTO public.master_course (
      courseid, coursedesc, collegedept, courseprgcod,
      course_level, course_totsemester, course_tot_credits,
      course_duration, coursestartdate, courseenddate,
      createdat, updatedat
    ) VALUES (
      $1,$2,$3,$4,
      $5,$6,$7,
      $8,$9,$10,
      $11,$12
    )
    RETURNING courseid
  `;

  try {
    const res = await pool.query(insertSQL, [
      courseid,
      coursedesc,
      collegedept,
      courseprgcod || null,
      course_level || null,
      course_totsemester != null ? Number(course_totsemester) : null,
      course_tot_credits != null ? Number(course_tot_credits) : null,
      course_duration,               // as-is (string or number)
      coursestartdate,               // "YYYY-MM-DD" string
      courseenddate,                 // "YYYY-MM-DD" string
      createdat,
      updatedat
    ]);
    return res;
  } catch (err) {
    const isTypeErr = err && err.code === '22P02';
    if (isTypeErr && typeof course_duration === 'string') {
      const numericOnly = course_duration.replace(/\D+/g, '');
      const retryVal = numericOnly.length ? Number(numericOnly) : null;
      const res2 = await pool.query(insertSQL, [
        courseid,
        coursedesc,
        collegedept,
        courseprgcod || null,
        course_level || null,
        course_totsemester != null ? Number(course_totsemester) : null,
        course_tot_credits != null ? Number(course_tot_credits) : null,
        retryVal,                    // retry with numeric
        coursestartdate,
        courseenddate,
        createdat,
        updatedat
      ]);
      return res2;
    }
    throw err;
  }
}

/* -------------------------- Routes -------------------------- */
/**
 * Add a new course
 * - Auto-fill coursedesc & courseprgcod from department if missing
 * - If AY provided, dates come from AY (+auto year shift by semester)
 */
router.post('/add', async (req, res) => {
  try {
    const {
      courseid, coursedesc, collegedept, courseprgcod,
      course_level, course_totsemester, course_tot_credits,
      acadyearid: acadYearIdRaw,
      course_duration: courseDurationRaw,
      // client dates (used only when no AY is provided)
      coursestartdate: courseStartRaw,
      courseenddate: courseEndRaw,
      // optional explicit offset in years (UI can send this, else computed)
      ay_offset
    } = req.body;

    if (!courseid) return res.status(400).json({ error: 'courseid is required' });
    if (!collegedept) return res.status(400).json({ error: 'collegedept is required' });

    // Auto-fill description + program code from department when missing
    let finalCourseDesc = (coursedesc ?? '').trim();
    let finalCoursePrg  = (courseprgcod ?? '').trim();
    if (!finalCourseDesc || !finalCoursePrg) {
      const dept = await getDeptById(collegedept);
      if (!dept) return res.status(400).json({ error: `Department '${collegedept}' not found` });
      if (!finalCourseDesc) finalCourseDesc = dept.collegedeptdesc || null;
      if (!finalCoursePrg)  finalCoursePrg  = dept.colldept_code   || null;
    }

    const now = new Date();

    // Which AY id (if any)?
    const resolvedAYId =
      (acadYearIdRaw && String(acadYearIdRaw).trim()) ||
      (courseDurationRaw && String(courseDurationRaw).trim()) ||
      null;

    // Start/end from client only when NO AY is given
    let startISO = toISODate(courseStartRaw);
    let endISO   = toISODate(courseEndRaw);
    let courseDurationToSave = courseDurationRaw || acadYearIdRaw || null;

    if (resolvedAYId) {
      const ay = await getAcadYearById(resolvedAYId);
      if (!ay) return res.status(400).json({ error: `Academic Year '${resolvedAYId}' not found` });

      // Base dates from AY (already 'YYYY-MM-DD' via to_char in query)
      startISO = toISODate(ay.collegeacadyearstartdt);
      endISO   = toISODate(ay.collegeacadyearenddt);

      // Determine year offset:
      //  - prefer explicit ay_offset (number)
      //  - else compute from semester: floor((sem-1)/2)
      const semNum = Number(course_totsemester);
      const computedOffset = Number.isFinite(semNum) ? Math.floor((semNum - 1) / 2) : 0;
      const offsetYears = Number.isFinite(Number(ay_offset)) ? Number(ay_offset) : computedOffset;

      if (offsetYears) {
        startISO = addYearsISO(startISO, offsetYears);
        endISO   = addYearsISO(endISO, offsetYears);
      }

      // store the AY id string/integer as provided
      courseDurationToSave = resolvedAYId;
    }

    const result = await insertCourseWithRecovery({
      courseid,
      coursedesc: finalCourseDesc,
      collegedept,
      courseprgcod: finalCoursePrg,
      course_level,
      course_totsemester,
      course_tot_credits,
      course_duration: courseDurationToSave,
      coursestartdate: toPgDateValue(startISO),
      courseenddate: toPgDateValue(endISO),
      createdat: now,
      updatedat: now
    });

    // Respond with display-friendly dates too
    return res.status(201).json({
      message: 'Course added successfully',
      courseid: result.rows[0].courseid,
      coursestartdate_display: toDisplayDMY(startISO),
      courseenddate_display: toDisplayDMY(endISO)
    });
  } catch (err) {
    console.error('Error adding course:', err);
    return res.status(500).json({
      error: 'Internal Server Error',
      code: err.code,
      detail: err.detail || err.message
    });
  }
});

/**
 * Update existing course
 * - If AY provided, dates come from AY (+auto year shift by semester)
 */
router.put('/update/:courseid', async (req, res) => {
  const { courseid } = req.params;

  const {
    coursedesc,
    collegedept,
    courseprgcod,
    course_level,
    course_totsemester,
    course_tot_credits,
    acadyearid: acadYearIdRaw,
    course_duration: courseDurationRaw,
    coursestartdate: courseStartRaw,
    courseenddate: courseEndRaw,
    ay_offset
  } = req.body;

  const updatedat = new Date();

  try {
    if (!collegedept) {
      return res.status(400).json({ error: 'collegedept is required' });
    }

    // Auto-fill from department when missing
    let finalCourseDesc = (coursedesc ?? '').trim();
    let finalCoursePrg  = (courseprgcod ?? '').trim();
    if (!finalCourseDesc || !finalCoursePrg) {
      const dept = await getDeptById(collegedept);
      if (!dept) return res.status(400).json({ error: `Department '${collegedept}' not found` });
      if (!finalCourseDesc) finalCourseDesc = dept.collegedeptdesc || null;
      if (!finalCoursePrg)  finalCoursePrg  = dept.colldept_code   || null;
    }

    const resolvedAYId =
      (acadYearIdRaw && String(acadYearIdRaw).trim()) ||
      (courseDurationRaw && String(courseDurationRaw).trim()) ||
      null;

    let startISO = toISODate(courseStartRaw);
    let endISO   = toISODate(courseEndRaw);
    let courseDurationToSave = courseDurationRaw || acadYearIdRaw || null;

    if (resolvedAYId) {
      const ay = await getAcadYearById(resolvedAYId);
      if (!ay) return res.status(400).json({ error: `Academic Year '${resolvedAYId}' not found` });

      startISO = toISODate(ay.collegeacadyearstartdt);
      endISO   = toISODate(ay.collegeacadyearenddt);

      const semNum = Number(course_totsemester);
      const computedOffset = Number.isFinite(semNum) ? Math.floor((semNum - 1) / 2) : 0;
      const offsetYears = Number.isFinite(Number(ay_offset)) ? Number(ay_offset) : computedOffset;

      if (offsetYears) {
        startISO = addYearsISO(startISO, offsetYears);
        endISO   = addYearsISO(endISO, offsetYears);
      }

      courseDurationToSave = resolvedAYId;
    }

    // Update query (retry numeric if type mismatch)
    const updateSQL = `
      UPDATE public.master_course SET
        coursedesc = $1,
        collegedept = $2,
        courseprgcod = $3,
        course_level = $4,
        course_totsemester = $5,
        course_tot_credits = $6,
        course_duration = $7,
        coursestartdate = $8,
        courseenddate = $9,
        updatedat = $10
      WHERE courseid = $11
      RETURNING *
    `;

    async function doUpdate(val) {
      return pool.query(updateSQL, [
        finalCourseDesc,
        collegedept,
        finalCoursePrg || null,
        course_level || null,
        course_totsemester != null ? Number(course_totsemester) : null,
        course_tot_credits != null ? Number(course_tot_credits) : null,
        val,
        toPgDateValue(startISO),
        toPgDateValue(endISO),
        updatedat,
        courseid
      ]);
    }

    let result;
    try {
      result = await doUpdate(courseDurationToSave);
    } catch (err) {
      if (err && err.code === '22P02' && typeof courseDurationToSave === 'string') {
        const numericOnly = courseDurationToSave.replace(/\D+/g, '');
        const retryVal = numericOnly.length ? Number(numericOnly) : null;
        result = await doUpdate(retryVal);
      } else {
        throw err;
      }
    }

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }

    res.json({
      message: 'Course updated successfully',
      course: {
        ...result.rows[0],
        coursestartdate_display: toDisplayDMY(startISO),
        courseenddate_display: toDisplayDMY(endISO)
      }
    });
  } catch (error) {
    console.error('Update Course Error:', error);
    res.status(500).json({
      error: 'Failed to update course',
      code: error.code,
      detail: error.detail || error.message
    });
  }
});

/* -------------------------- Delete + Reads -------------------------- */
router.delete('/delete/:courseid', async (req, res) => {
  const { courseid } = req.params;

  try {
    const result = await pool.query(
      'DELETE FROM public.master_course WHERE courseid = $1 RETURNING *',
      [courseid]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }

    res.json({ message: 'Course deleted successfully', course: result.rows[0] });
  } catch (error) {
    console.error('Delete Course Error:', error);
    res.status(500).json({ error: 'Failed to delete course', code: error.code, detail: error.detail || error.message });
  }
});

/**
 * NOTE on reads:
 * We cast DATE columns to text in SQL (to_char(...,'YYYY-MM-DD')) so the API always
 * returns strings. That keeps your table view stable and identical to what was saved.
 */
router.get('/list', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        courseid, coursedesc, collegedept, courseprgcod,
        course_level, course_totsemester, course_tot_credits,
        course_duration,
        to_char(coursestartdate, 'YYYY-MM-DD') AS coursestartdate,
        to_char(courseenddate,   'YYYY-MM-DD') AS courseenddate,
        createdat, updatedat
      FROM public.master_course
      ORDER BY createdat DESC
    `);

    // If your table wants D.M.YYYY display too:
    const rows = result.rows.map(r => ({
      ...r,
      coursestartdate_display: toDisplayDMY(r.coursestartdate),
      courseenddate_display: toDisplayDMY(r.courseenddate),
    }));

    res.json({ courses: rows });
  } catch (error) {
    console.error('Fetch Courses Error:', error);
    res.status(500).json({ error: 'Failed to fetch courses', code: error.code, detail: error.detail || error.message });
  }
});

router.get('/all', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        courseid, coursedesc, collegedept, courseprgcod,
        course_level, course_totsemester, course_tot_credits,
        course_duration,
        to_char(coursestartdate, 'YYYY-MM-DD') AS coursestartdate,
        to_char(courseenddate,   'YYYY-MM-DD') AS courseenddate,
        createdat, updatedat
      FROM public.master_course
      ORDER BY createdat DESC
    `);

    const rows = result.rows.map(r => ({
      ...r,
      coursestartdate_display: toDisplayDMY(r.coursestartdate),
      courseenddate_display: toDisplayDMY(r.courseenddate),
    }));

    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch courses', code: error.code, detail: error.detail || error.message });
  }
});

router.get('/:courseid', async (req, res) => {
  const { courseid } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT
        courseid, coursedesc, collegedept, courseprgcod,
        course_level, course_totsemester, course_tot_credits,
        course_duration,
        to_char(coursestartdate, 'YYYY-MM-DD') AS coursestartdate,
        to_char(courseenddate,   'YYYY-MM-DD') AS courseenddate,
        createdat, updatedat
      FROM public.master_course
      WHERE courseid = $1
      `,
      [courseid]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const r = result.rows[0];
    res.json({
      course: {
        ...r,
        coursestartdate_display: toDisplayDMY(r.coursestartdate),
        courseenddate_display: toDisplayDMY(r.courseenddate),
      }
    });
  } catch (error) {
    console.error('Fetch Course Error:', error);
    res.status(500).json({ error: 'Failed to fetch course', code: error.code, detail: error.detail || error.message });
  }
});

module.exports = router;