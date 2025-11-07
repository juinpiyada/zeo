const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer(); // memory storage -> Buffer for bytea
const db = require('../config/db_conn'); // ✅ same as master_depts.js

// ---- Aadhaar validation (12 digits) ----
const AADHAAR_RE = /^[0-9]{12}$/;

// ---------- helpers ----------
const toNull = (s) => (s === undefined || s === null || `${s}`.trim() === '' ? null : s);
const safeTrim = (s) => (typeof s === 'string' ? s.trim() : s);

// Simple ID generator if client doesn't provide one
function newId(prefix = 'TCHDTL_') {
  const t = new Date();
  return `${prefix}${t.getFullYear()}${String(t.getMonth()+1).padStart(2,'0')}${String(t.getDate()).padStart(2,'0')}_${t.getTime()}`;
}

/* =========================================================
 * CREATE (multipart/form-data)
 * fields: tchr_teacher_id*, tchr_dtls_desc*, tchr_aadharno?
 * file field: "file"
 * optional: tchr_dtls_id (autogenerates if omitted)
 * =======================================================*/
router.post('/', upload.single('file'), async (req, res) => {
  try {
    const {
      tchr_dtls_id,
      tchr_teacher_id,
      tchr_dtls_desc,
      tchr_aadharno
    } = req.body;

    const id = safeTrim(tchr_dtls_id) || newId();
    const teacherId = safeTrim(tchr_teacher_id);
    const desc = safeTrim(tchr_dtls_desc);
    const aadhaar = toNull(safeTrim(tchr_aadharno));

    if (!teacherId) return res.status(400).json({ error: 'tchr_teacher_id is required' });
    if (!desc) return res.status(400).json({ error: 'tchr_dtls_desc is required' });
    if (aadhaar && !AADHAAR_RE.test(aadhaar)) {
      return res.status(400).json({ error: 'Invalid tchr_aadharno (must be 12 digits)' });
    }

    const fileBuf = req.file?.buffer || null;

    const q = `
      INSERT INTO public.teacher_dtls
        (tchr_dtls_id, tchr_teacher_id, tchr_dtls_desc, tchr_dtls_file, tchr_aadharno)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING tchr_dtls_id
    `;
    const { rows } = await db.query(q, [id, teacherId, desc, fileBuf, aadhaar]);

    res.status(201).json({ tchr_dtls_id: rows[0].tchr_dtls_id });
  } catch (err) {
    console.error('Error creating teacher_dtls:', err);
    res.status(500).json({ error: 'Failed to create teacher_dtls record', detail: String(err?.message || err) });
  }
});

/* =========================================================
 * LIST (optional pagination)
 * query params: limit, offset, teacherId
 * =======================================================*/
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
    const offset = parseInt(req.query.offset || '0', 10) || 0;
    const teacherId = safeTrim(req.query.teacherId);

    let sql = `
      SELECT tchr_dtls_id, tchr_teacher_id, tchr_dtls_desc, tchr_aadharno,
             CASE WHEN tchr_dtls_file IS NULL THEN 0 ELSE 1 END AS has_file
      FROM public.teacher_dtls
    `;
    const params = [];
    if (teacherId) {
      sql += ` WHERE tchr_teacher_id = $1`;
      params.push(teacherId);
    }
    sql += ` ORDER BY tchr_dtls_id DESC LIMIT ${limit} OFFSET ${offset}`;

    const { rows } = await db.query(sql, params);
    res.json({ data: rows, limit, offset });
  } catch (err) {
    console.error('Error listing teacher_dtls:', err);
    res.status(500).json({ error: 'Failed to list teacher_dtls', detail: String(err?.message || err) });
  }
});

/* =========================================================
 * LIST BY TEACHER (convenience)
 * GET /by-teacher/:teacherId
 * =======================================================*/
router.get('/by-teacher/:teacherId', async (req, res) => {
  try {
    const teacherId = safeTrim(req.params.teacherId);
    if (!teacherId) return res.status(400).json({ error: 'teacherId is required' });

    const sql = `
      SELECT tchr_dtls_id, tchr_teacher_id, tchr_dtls_desc, tchr_aadharno,
             CASE WHEN tchr_dtls_file IS NULL THEN 0 ELSE 1 END AS has_file
      FROM public.teacher_dtls
      WHERE tchr_teacher_id = $1
      ORDER BY tchr_dtls_id DESC
    `;
    const { rows } = await db.query(sql, [teacherId]);
    res.json({ data: rows });
  } catch (err) {
    console.error('Error fetching teacher_dtls by teacher:', err);
    res.status(500).json({ error: 'Failed to fetch teacher_dtls by teacher', detail: String(err?.message || err) });
  }
});

/* =========================================================
 * READ one (without file bytes)
 * =======================================================*/
router.get('/:id', async (req, res) => {
  try {
    const id = safeTrim(req.params.id);
    const sql = `
      SELECT tchr_dtls_id, tchr_teacher_id, tchr_dtls_desc, tchr_aadharno,
             CASE WHEN tchr_dtls_file IS NULL THEN 0 ELSE 1 END AS has_file
      FROM public.teacher_dtls
      WHERE tchr_dtls_id = $1
    `;
    const { rows } = await db.query(sql, [id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error fetching teacher_dtls:', err);
    res.status(500).json({ error: 'Failed to fetch teacher_dtls', detail: String(err?.message || err) });
  }
});

/* =========================================================
 * DOWNLOAD file bytes
 * GET /:id/file
 * =======================================================*/
const { fileTypeFromBuffer } = require('file-type');

router.get('/:id/file', async (req, res) => {
  try {
    const id = (req.params.id || '').trim();
    const { rows } = await db.query(
      `SELECT tchr_dtls_file FROM public.teacher_dtls WHERE tchr_dtls_id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });

    const buf = rows[0].tchr_dtls_file;
    if (!buf) return res.status(404).json({ error: 'No file for this record' });

    
    const ft = await fileTypeFromBuffer(buf);
    const mime = ft?.mime || 'application/octet-stream';
    const ext  = ft?.ext  || 'bin';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', buf.length);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(id)}.${ext}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Filename');
    res.setHeader('X-Filename', encodeURIComponent(`${id}.${ext}`));

    return res.send(buf);
  } catch (err) {
    console.error('Error fetching teacher_dtls file:', err);
    res.status(500).json({ error: 'Failed to fetch file', detail: String(err?.message || err) });
  }
});

/* =========================================================
 * UPDATE (multipart/form-data)
 * Allows updating desc, aadhaar, and optionally replacing file
 * =======================================================*/
router.put('/:id', upload.single('file'), async (req, res) => {
  try {
    const id = safeTrim(req.params.id);
    const desc = toNull(safeTrim(req.body.tchr_dtls_desc));
    const aadhaar = toNull(safeTrim(req.body.tchr_aadharno));
    const fileBuf = req.file?.buffer;

    if (aadhaar && !AADHAAR_RE.test(aadhaar)) {
      return res.status(400).json({ error: 'Invalid tchr_aadharno (must be 12 digits)' });
    }

    // Dynamically build SET
    const sets = [];
    const params = [];
    let i = 1;

    if (desc !== null) { sets.push(`tchr_dtls_desc = $${i++}`); params.push(desc); }
    if (aadhaar !== null) { sets.push(`tchr_aadharno = $${i++}`); params.push(aadhaar); }
    if (fileBuf !== undefined) { sets.push(`tchr_dtls_file = $${i++}`); params.push(fileBuf || null); }

    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

    const sql = `UPDATE public.teacher_dtls SET ${sets.join(', ')} WHERE tchr_dtls_id = $${i} RETURNING tchr_dtls_id`;
    params.push(id);

    const { rows } = await db.query(sql, params);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ tchr_dtls_id: rows[0].tchr_dtls_id });
  } catch (err) {
    console.error('Error updating teacher_dtls:', err);
    res.status(500).json({ error: 'Failed to update teacher_dtls', detail: String(err?.message || err) });
  }
});

/* =========================================================
 * DELETE
 * =======================================================*/
router.delete('/:id', async (req, res) => {
  try {
    const id = safeTrim(req.params.id);
    const { rowCount } = await db.query(
      `DELETE FROM public.teacher_dtls WHERE tchr_dtls_id = $1`, [id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Error deleting teacher_dtls:', err);
    res.status(500).json({ error: 'Failed to delete teacher_dtls', detail: String(err?.message || err) });
  }
});

module.exports = router;
