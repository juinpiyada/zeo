// SMS-be/routes/teacher_inform_api.js
const express = require('express');
const cors = require('cors');
const router = express.Router();
const pool = require('../config/db_conn'); // pg Pool

/* ------------------------ Router-level CORS (Express 5-safe) ------------------------ */
const corsOptions = {
  origin: true, // reflect incoming Origin
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // ← PUT (no PATCH)
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  optionsSuccessStatus: 204,
};
router.use(cors(corsOptions));
router.options('/', cors(corsOptions));
router.options('/list', cors(corsOptions));
router.options('/by-teacher/:teacherid', cors(corsOptions));
router.options('/:teacherid', cors(corsOptions));

/* ------------------------ helpers ------------------------ */
const NOW_YEAR = new Date().getFullYear();
const YEAR_MIN = 1950;
const YEAR_MAX = NOW_YEAR + 1;
const VALID_SCALES = new Set(['PCT', 'CGPA']);

const n = (v) => (v === '' || v === undefined ? null : v);
const num = (v) => {
  if (v === '' || v === undefined || v === null) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

function validateScale(scale, label) {
  if (scale == null) return null;
  if (!VALID_SCALES.has(String(scale))) return `${label}: scale must be 'PCT' or 'CGPA'`;
  return null;
}
function validatePointForScale(scale, val, label) {
  if (scale == null || val == null) return null;
  if (scale === 'PCT' && !(val >= 0 && val <= 100)) return `${label}: when scale=PCT, value must be 0..100`;
  if (scale === 'CGPA' && !(val >= 0 && val <= 10)) return `${label}: when scale=CGPA, value must be 0..10`;
  return null;
}
function validateYear(y, label) {
  if (y == null) return null;
  if (!(Number.isInteger(y) && y >= YEAR_MIN && y <= YEAR_MAX)) return `${label}: year must be ${YEAR_MIN}..${YEAR_MAX}`;
  return null;
}

const COLS = [
  'class10_board', 'class10_year_of_passing', 'class10_grade_scale', 'class10_gradepoint', 'class10_marks_total',
  'class12_board', 'class12_stream', 'class12_year_of_passing', 'class12_grade_scale', 'class12_gradepoint', 'class12_marks_total',
  'diploma_branch', 'diploma_year_of_passing', 'diploma_grade_scale',
  'diploma_sem1_gp', 'diploma_sem2_gp', 'diploma_sem3_gp', 'diploma_sem4_gp', 'diploma_sem5_gp', 'diploma_sem6_gp',
  'bachelor_degree', 'bachelor_department', 'bachelor_university', 'bachelor_year_of_passing', 'bachelor_gradepoint', 'bachelor_grade_scale',
  'master_degree', 'master_department', 'master_university', 'master_year_of_passing', 'master_gradepoint', 'master_grade_scale',
  'phd_field', 'phd_university', 'phd_year_of_passing'
];

function normalizeAndValidateBody(body) {
  const b = {};
  COLS.forEach((c) => {
    b[c] = c.includes('_year_of_passing') ? (body[c] == null ? null : Number(body[c])) : body[c];
  });
  [
    'class10_board','class12_board','class12_stream',
    'diploma_branch',
    'bachelor_degree','bachelor_department','bachelor_university',
    'master_degree','master_department','master_university',
    'phd_field','phd_university',
    'class10_grade_scale','class12_grade_scale','diploma_grade_scale',
    'bachelor_grade_scale','master_grade_scale'
  ].forEach(k => { b[k] = n(b[k]) == null ? null : String(b[k]).trim(); });

  [
    'class10_gradepoint','class10_marks_total',
    'class12_gradepoint','class12_marks_total',
    'diploma_sem1_gp','diploma_sem2_gp','diploma_sem3_gp','diploma_sem4_gp','diploma_sem5_gp','diploma_sem6_gp',
    'bachelor_gradepoint','master_gradepoint'
  ].forEach(k => { b[k] = num(b[k]); });

  [
    'class10_year_of_passing','class12_year_of_passing','diploma_year_of_passing',
    'bachelor_year_of_passing','master_year_of_passing','phd_year_of_passing'
  ].forEach(k => {
    const y = b[k] == null ? null : Number(b[k]);
    b[k] = Number.isFinite(y) ? Math.trunc(y) : null;
  });

  for (const [sk, label] of [
    ['class10_grade_scale','Class 10 scale'],
    ['class12_grade_scale','Class 12 scale'],
    ['diploma_grade_scale','Diploma scale'],
    ['bachelor_grade_scale','Bachelor scale'],
    ['master_grade_scale','Master scale'],
  ]) { const e = validateScale(b[sk], label); if (e) return { error: e }; }

  for (const [sKey, vKey, label] of [
    ['class10_grade_scale','class10_gradepoint','Class 10 gradepoint'],
    ['class12_grade_scale','class12_gradepoint','Class 12 gradepoint'],
    ['bachelor_grade_scale','bachelor_gradepoint','Bachelor gradepoint'],
    ['master_grade_scale','master_gradepoint','Master gradepoint'],
  ]) { const e = validatePointForScale(b[sKey], b[vKey], label); if (e) return { error: e }; }

  for (let i=1;i<=6;i++){
    const e = validatePointForScale(b['diploma_grade_scale'], b[`diploma_sem${i}_gp`], `Diploma Sem ${i}`);
    if (e) return { error: e };
  }

  for (const [k,label] of [
    ['class10_year_of_passing','Class 10 year'],
    ['class12_year_of_passing','Class 12 year'],
    ['diploma_year_of_passing','Diploma year'],
    ['bachelor_year_of_passing','Bachelor year'],
    ['master_year_of_passing','Master year'],
    ['phd_year_of_passing','PhD year'],
  ]) { const e = validateYear(b[k], label); if (e) return { error: e }; }

  return { data: b };
}

/* ------------------------ Routes ------------------------ */

// list
router.get('/list', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT teacherinfoid, teacherid, class10_board, class12_board, diploma_branch,
              bachelor_degree, master_degree, phd_field, updatedat
       FROM public.teacher_information
       ORDER BY teacherid ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error('list error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// fetch single
async function fetchByTeacherId(req, res) {
  try {
    const { teacherid } = req.params;
    const { rows } = await pool.query(
      `SELECT * FROM public.teacher_information WHERE teacherid=$1 LIMIT 1`, [teacherid]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('get error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}
router.get('/by-teacher/:teacherid', fetchByTeacherId);
router.get('/:teacherid', fetchByTeacherId);

// create
router.post('/', async (req, res) => {
  try {
    const teacherid = String(req.body.teacherid || '').trim();
    if (!teacherid) return res.status(400).json({ error: 'teacherid is required' });

    const ex = await pool.query(`SELECT 1 FROM public.teacher_information WHERE teacherid=$1`, [teacherid]);
    if (ex.rowCount) return res.status(409).json({ error: 'Already exists for this teacherid' });

    const { data, error } = normalizeAndValidateBody(req.body || {});
    if (error) return res.status(400).json({ error });

    const fields = ['teacherid', ...COLS];
    const params = [teacherid, ...COLS.map(k => data[k])];
    const colsSql = fields.map(c => `"${c}"`).join(', ');
    const valsSql = fields.map((_, i) => `$${i + 1}`).join(', ');

    const q = `INSERT INTO public.teacher_information (${colsSql}) VALUES (${valsSql}) RETURNING *;`;
    const { rows } = await pool.query(q, params);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('post error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/** UPDATE (full) with PUT — replaces fields you send */
router.put('/:teacherid', async (req, res) => {
  try {
    const { teacherid } = req.params;
    const cur = await pool.query(`SELECT 1 FROM public.teacher_information WHERE teacherid=$1`, [teacherid]);
    if (!cur.rowCount) return res.status(404).json({ error: 'Not found' });

    const { data, error } = normalizeAndValidateBody(req.body || {});
    if (error) return res.status(400).json({ error });

    const setPairs = [];
    const params = [];
    let idx = 1;

    for (const k of COLS) {
      setPairs.push(`"${k}" = $${idx++}`);
      params.push(data[k]); // normalized (may be null)
    }
    setPairs.push(`"updatedat" = NOW()`);

    params.push(teacherid);
    const q = `
      UPDATE public.teacher_information
         SET ${setPairs.join(', ')}
       WHERE teacherid = $${idx}
       RETURNING *;
    `;
    const { rows } = await pool.query(q, params);
    res.json(rows[0]);
  } catch (err) {
    console.error('put error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// delete
router.delete('/:teacherid', async (req, res) => {
  try {
    const { teacherid } = req.params;
    const del = await pool.query(`DELETE FROM public.teacher_information WHERE teacherid=$1 RETURNING teacherid`, [teacherid]);
    if (!del.rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, teacherid });
  } catch (err) {
    console.error('delete error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

/* Mount in server:
   const teacherInfoRouter = require('./routes/teacher_inform_api');
   app.use('/api/teacher-info', teacherInfoRouter);
*/
