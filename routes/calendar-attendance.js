// routes/calendar-attendance.js
const express = require('express');
const router = express.Router();
const db = require('../config/db_conn');

/* ============ Utilities ============ */
function parseBool(val) {
  if (val === undefined) return undefined;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const s = val.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(s)) return true;
    if (['false', '0', 'no'].includes(s)) return false;
  }
  return undefined;
}

function toLocalISODate(d) {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Build [start, endExclusive] range; if client passes YYYY-MM-DD, end is inclusive */
function getRange(query) {
  const today = new Date();
  const defaultEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1); // tomorrow 00:00
  const defaultStart = new Date(defaultEnd);
  defaultStart.setDate(defaultEnd.getDate() - 30);

  const qStart = query.start ? new Date(`${query.start}T00:00:00`) : defaultStart;
  const qEnd   = query.end   ? new Date(`${query.end}T00:00:00`)   : defaultEnd;
  const endExclusive = new Date(qEnd);
  if (query.end) endExclusive.setDate(endExclusive.getDate() + 1);
  return { start: qStart, endExclusive };
}


// Resolves any student hint (email/username/roll/ids) -> canonical values for college_attendance.attuserid
async function resolveStudentUserIds(raw) {
  if (!raw) return [];
  const v = String(raw).trim();

  // Discover which columns actually exist so we only reference valid ones
  const colSql = `
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('student_master','master_user')
  `;
  let smCols = new Set(), muCols = new Set();
  try {
    const { rows } = await db.query(colSql);
    rows.forEach(r => {
      if (r.table_name === 'student_master') smCols.add(r.column_name);
      if (r.table_name === 'master_user')    muCols.add(r.column_name);
    });
  } catch (e) {
    console.warn('resolveStudentUserIds: could not inspect columns:', e?.message || e);
    // sensible fallbacks so we still work
    smCols = new Set(['stuid', 'rollno']);
    muCols = new Set(['userid']);
  }

  // Build WHERE predicates only for columns that exist
  const smFields = [];
  if (smCols.has('stuid'))      smFields.push('sm.stuid');                 // ✅ your schema
  if (smCols.has('stuuserid'))  smFields.push('sm.stuuserid');
  if (smCols.has('rollno'))     smFields.push('CAST(sm.rollno AS TEXT)');
  if (smCols.has('roll_no'))    smFields.push('CAST(sm.roll_no AS TEXT)');
  if (smCols.has('username'))   smFields.push('sm.username');
  if (smCols.has('email'))      smFields.push('sm.email');

  const muFields = [];
  if (muCols.has('userid'))     muFields.push('mu.userid');
  if (muCols.has('username'))   muFields.push('mu.username');
  if (muCols.has('email'))      muFields.push('mu.email');

  // If nothing discovered on SM, assume at least stuid exists
  if (smFields.length === 0) smFields.push('sm.stuid');

  const mkClause = (fields, offset) => ({
    text: fields.map((f, i) => `${f} = $${offset + i + 1}`).join(' OR '),
    params: Array(fields.length).fill(v)
  });

  const smClause = mkClause(smFields, 0);
  const muClause = mkClause(muFields, smClause.params.length);

  const whereParts = [];
  const params = [];
  if (smClause.text) { whereParts.push(`(${smClause.text})`); params.push(...smClause.params); }
  if (muClause.text) { whereParts.push(`(${muClause.text})`); params.push(...muClause.params); }
  const where = whereParts.length ? whereParts.join(' OR ') : '$1 = $1';

  // Pick a safe join condition based on columns that actually exist
  let joinCond = 'TRUE';
  if (muCols.has('userid') && smCols.has('stuid'))      joinCond = 'mu.userid = sm.stuid';
  else if (muCols.has('userid') && smCols.has('stuuserid')) joinCond = 'mu.userid = sm.stuuserid';
  else if (muCols.has('email')  && smCols.has('email')) joinCond = 'mu.email = sm.email';
  else if (muCols.has('username') && smCols.has('username')) joinCond = 'mu.username = sm.username';

  // Choose which column to SELECT as the canonical id for attendance
  let selectId = 'NULL';
  if (smCols.has('stuid'))       selectId = 'sm.stuid';        // ✅ prefer stuid if present
  else if (smCols.has('stuuserid')) selectId = 'sm.stuuserid';
  else if (muCols.has('userid')) selectId = 'mu.userid';

  const sql = `
    SELECT DISTINCT ${selectId} AS id
    FROM public.student_master sm
    LEFT JOIN public.master_user mu
      ON ${joinCond}
    WHERE ${where}
  `;

  try {
    const { rows } = await db.query(sql, params);
    const ids = rows.map(r => r.id).filter(Boolean);

    // also include the raw value (in case attendance stored raw emails/usernames directly)
    if (!ids.includes(v)) ids.push(v);

    return [...new Set(ids)];
  } catch (e) {
    console.warn('resolveStudentUserIds error:', e?.message || e);
    return [v]; // fall back to raw value only
  }
}


/* ============ WHERE builders ============ */
/**
 * Build WHERE for college_attendance (student attendance).
 * Columns used: attuserid, attcourseid, attsubjectid, attclassid, attmaarkedbyemployee, attvalid, attts
 */
async function buildStudentFilters(query, start, endExclusive) {
  const where = [`ca.attts >= $1`, `ca.attts < $2`];
  const params = [start, endExclusive];
  let i = params.length;

  // Student id (support stuid OR attuserid in query); allow multiple mapped ids
  const stuidRaw = query.stuid ?? query.attuserid;
  if (stuidRaw) {
    const candidates = await resolveStudentUserIds(stuidRaw);
    params.push(candidates);
    where.push(`ca.attuserid = ANY($${++i})`);
  }

  if (query.teacherid)  { params.push(String(query.teacherid)); where.push(`ca.attmaarkedbyemployee = $${++i}`); }
  if (query.courseid)   { params.push(String(query.courseid));  where.push(`ca.attcourseid = $${++i}`); }
  if (query.subjectid)  { params.push(String(query.subjectid)); where.push(`ca.attsubjectid = $${++i}`); }

  // ⚠️ IMPORTANT: section/classid often differs from attendance.attclassid (room vs section).
  // Keep supporting it, but DO NOT force clients to send it (front-end will omit it for summary).
  const classid = query.classid ?? query.section;
  if (classid) { params.push(String(classid)); where.push(`ca.attclassid = $${++i}`); }

  const valid = parseBool(query.valid);
  if (valid !== undefined) { params.push(valid); where.push(`ca.attvalid = $${++i}`); }

  return { where: where.join(' AND '), params };
}

/**
 * Build WHERE for employee_attendance (presence if attts_in not null).
 */
function buildEmployeeFilters(query, start, endExclusive) {
  const where = [`ea.attts_in >= $1`, `ea.attts_in < $2`];
  const params = [start, endExclusive];
  let i = params.length;

  if (query.attuserid) { params.push(String(query.attuserid)); where.push(`ea.attuserid = $${++i}`); }
  if (query.courseid)  { params.push(String(query.courseid));  where.push(`ea.attcourseid = $${++i}`); }
  if (query.subjectid) { params.push(String(query.subjectid)); where.push(`ea.attsubjectid = $${++i}`); }
  if (query.classid)   { params.push(String(query.classid));   where.push(`ea.attclassid = $${++i}`); }
  if (query.teacherid) { params.push(String(query.teacherid)); where.push(`ea.attuserid = $${++i}`); }

  return { where: where.join(' AND '), params };
}

/* ============ Mappers ============ */
function rowToStudentEvent(r) {
  const title = `${r.attvalid ? 'Present' : 'Absent'} • ${r.attsubjectid || 'Subject'}${r.attclassid ? ' • ' + r.attclassid : ''}`;
  return {
    id: r.attid,
    title,
    start: r.attts,
    end: null,
    allDay: false,
    extendedProps: {
      type: 'student',
      attuserid: r.attuserid,
      attcourseid: r.attcourseid,
      attsubjectid: r.attsubjectid,
      attclassid: r.attclassid,
      attlat: r.attlat,
      attlong: r.attlong,
      attvalid: r.attvalid,
      attvaliddesc: r.attvaliddesc,
      teacherid: r.attmaarkedbyemployee,
      // routine fields (may be null)
      drdayofweek: r.drdayofweek,
      drslot: r.drslot,
      drfrom: r.drfrom,
      drto: r.drto,
      drcourseid: r.drcourseid,
      drsubjid: r.drsubjid,
      drclassroomid: r.drclassroomid,
      stu_curr_semester: r.stu_curr_semester,
      stu_section: r.stu_section,
      acad_year: r.acad_year
    }
  };
}

function rowToEmployeeEvent(r) {
  const title = `Employee • ${r.attuserid}${r.attsubjectid ? ' • ' + r.attsubjectid : ''}`;
  return {
    id: r.attid,
    title,
    start: r.attts_in,
    end: r.attts_out || null,
    allDay: false,
    extendedProps: {
      type: 'employee',
      attuserid: r.attuserid,
      attcourseid: r.attcourseid,
      attsubjectid: r.attsubjectid,
      attclassid: r.attclassid,
      attlat: r.attlat,
      attlong: r.attlong
    }
  };
}

/* ============ Routes ============ */

/** STUDENT EVENTS */
router.get('/student-events', async (req, res) => {
  try {
    const { start, endExclusive } = getRange(req.query);
    const { where, params } = await buildStudentFilters(req.query, start, endExclusive);

    const sql = `
      SELECT ca.*,
             dr.drdayofweek, dr.drslot, dr.drfrom, dr.drto,
             dr.drsubjid, dr.drclassroomid,
             dr.stu_curr_semester, dr.stu_section, dr.acad_year
        FROM public.college_attendance ca
        LEFT JOIN public.college_daily_routine dr
          ON ca.attsubjectid = dr.drsubjid
         AND (ca.attclassid = dr.drclassroomid OR ca.attclassid = dr.stu_section)
       WHERE ${where}
       ORDER BY ca.attts DESC
    `;
    const rows = await db.query(sql, params);
    res.status(200).json({ range: { start, end: endExclusive }, events: rows.rows.map(rowToStudentEvent) });
  } catch (err) {
    console.error('student-events error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** EMPLOYEE EVENTS */
router.get('/employee-events', async (req, res) => {
  try {
    const { start, endExclusive } = getRange(req.query);
    const { where, params } = buildEmployeeFilters(req.query, start, endExclusive);

    const sql = `
      SELECT ea.*,
             dr.drdayofweek, dr.drslot, dr.drfrom, dr.drto,
             dr.drsubjid, dr.drclassroomid,
             dr.stu_curr_semester, dr.stu_section, dr.acad_year
        FROM public.employee_attendance ea
        LEFT JOIN public.college_daily_routine dr
          ON ea.attsubjectid = dr.drsubjid
         AND (ea.attclassid = dr.drclassroomid OR ea.attclassid = dr.stu_section)
       WHERE ${where}
       ORDER BY ea.attts_in DESC
    `;
    const rows = await db.query(sql, params);
    res.status(200).json({ range: { start, end: endExclusive }, events: rows.rows.map(rowToEmployeeEvent) });
  } catch (err) {
    console.error('employee-events error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** COMBINED EVENTS (student + employee) */
router.get('/combined-events', async (req, res) => {
  try {
    const { start, endExclusive } = getRange(req.query);

    const sFilt = await buildStudentFilters(req.query, start, endExclusive);
    const eFilt = buildEmployeeFilters(req.query, start, endExclusive);

    const sSql = `
      SELECT ca.*,
             dr.drdayofweek, dr.drslot, dr.drfrom, dr.drto,
             dr.drsubjid, dr.drclassroomid,
             dr.stu_curr_semester, dr.stu_section, dr.acad_year
        FROM public.college_attendance ca
        LEFT JOIN public.college_daily_routine dr
          ON ca.attsubjectid = dr.drsubjid
         AND (ca.attclassid = dr.drclassroomid OR ca.attclassid = dr.stu_section)
       WHERE ${sFilt.where}
       ORDER BY ca.attts DESC
    `;
    const eSql = `
      SELECT ea.*,
             dr.drdayofweek, dr.drslot, dr.drfrom, dr.drto,
             dr.drsubjid, dr.drclassroomid,
             dr.stu_curr_semester, dr.stu_section, dr.acad_year
        FROM public.employee_attendance ea
        LEFT JOIN public.college_daily_routine dr
          ON ea.attsubjectid = dr.drsubjid
         AND (ea.attclassid = dr.drclassroomid OR ea.attclassid = dr.stu_section)
       WHERE ${eFilt.where}
       ORDER BY ea.attts_in DESC
    `;

    const [sRows, eRows] = await Promise.all([
      db.query(sSql, sFilt.params),
      db.query(eSql, eFilt.params)
    ]);

    const events = [
      ...sRows.rows.map(rowToStudentEvent),
      ...eRows.rows.map(rowToEmployeeEvent)
    ].sort((a, b) => new Date(b.start) - new Date(a.start));

    res.status(200).json({ range: { start, end: endExclusive }, events });
  } catch (err) {
    console.error('combined-events error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** STUDENT SUMMARY (per day) */
router.get('/student-summary', async (req, res) => {
  try {
    const { start, endExclusive } = getRange({
      start: req.query.start || '2000-01-01',
      end: req.query.end || toLocalISODate(new Date())
    });

    const { where, params } = await buildStudentFilters(req.query, start, endExclusive);
    const sql = `
      SELECT DATE(ca.attts) AS day,
             COUNT(*) AS total,
             SUM(CASE WHEN ca.attvalid IS TRUE  THEN 1 ELSE 0 END) AS present,
             SUM(CASE WHEN ca.attvalid IS FALSE THEN 1 ELSE 0 END) AS absent
        FROM public.college_attendance ca
       WHERE ${where}
       GROUP BY DATE(ca.attts)
       ORDER BY day
    `;
    const result = await db.query(sql, params);

    // Fill day-by-day with zeros for missing days
    const days = [];
    for (let d = new Date(start); d < endExclusive; d.setDate(d.getDate() + 1)) {
      const key = toLocalISODate(d);
      const row = result.rows.find(r => toLocalISODate(r.day) === key);
      days.push({
        day: key,
        total: Number(row?.total ?? 0),
        present: Number(row?.present ?? 0),
        absent:  Number(row?.absent ?? 0),
      });
    }

    res.json({
      start: toLocalISODate(start),
      end:   toLocalISODate(new Date(endExclusive.getTime() - 86400000)),
      days
    });
  } catch (err) {
    console.error('student-summary error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** EMPLOYEE SUMMARY (per day) */
router.get('/employee-summary', async (req, res) => {
  try {
    const { start, endExclusive } = getRange({
      start: req.query.start || '2000-01-01',
      end: req.query.end || toLocalISODate(new Date())
    });

    const { where, params } = buildEmployeeFilters(req.query, start, endExclusive);
    const sql = `
      SELECT DATE(ea.attts_in) AS day,
             COUNT(*) AS total,
             COUNT(ea.attts_in) AS present
        FROM public.employee_attendance ea
       WHERE ${where}
       GROUP BY DATE(ea.attts_in)
       ORDER BY day
    `;
    const result = await db.query(sql, params);

    const days = [];
    for (let d = new Date(start); d < endExclusive; d.setDate(d.getDate() + 1)) {
      const key = toLocalISODate(d);
      const row = result.rows.find(r => toLocalISODate(r.day) === key);
      const present = Number(row?.present ?? 0);
      const total = Number(row?.total ?? 0);
      days.push({ day: key, total, present, absent: Math.max(0, total - present) });
    }

    res.json({
      start: toLocalISODate(start),
      end:   toLocalISODate(new Date(endExclusive.getTime() - 86400000)),
      days
    });
  } catch (err) {
    console.error('employee-summary error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
