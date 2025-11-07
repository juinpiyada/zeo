const express = require('express');
const router = express.Router();
const db = require('../config/db_conn');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads_bg');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const base = path.basename(file.originalname || 'file', ext).replace(/\s+/g, '_');
    cb(null, `${base}_${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    if (!file || !file.mimetype) return cb(null, true);
    if (file.mimetype.startsWith('image/')) return cb(null, true);
    cb(new Error('Only image uploads are allowed'));
  }
});

const runUploadSingle = (field) => (req, res, next) => {
  upload.single(field)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
};

const toHeaderPath = (filename) => `uploads_bg/${path.basename(filename)}`;

const safeUnlink = async (relPath) => {
  try {
    if (!relPath) return;
    const abs = path.join(__dirname, '..', relPath.replace(/\//g, path.sep));
    await fs.promises.unlink(abs);
  } catch (_) {}
};

// ===================== CRUD =====================

// GET all
router.get('/', async (_req, res) => {
  try {
    const r = await db.query(
      `SELECT id, inst_id, bg, color, header, font_style, font_size
       FROM public.whiteboard_cms_theme
       ORDER BY id DESC`
    );
    res.json({ themes: r.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// CREATE
router.post('/create', runUploadSingle('header'), async (req, res) => {
  const { inst_id = null, bg = null, color = null, font_style = null } = req.body || {};
  const font_size = req.body?.font_size ? Number(req.body.font_size) : null;
  const headerPath = req.file ? toHeaderPath(req.file.filename) : null;
  try {
    const r = await db.query(
      `INSERT INTO public.whiteboard_cms_theme
       (inst_id, bg, color, header, font_style, font_size)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [inst_id || null, bg || null, color || null, headerPath, font_style || null, font_size]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create theme' });
  }
});

// UPDATE (POST for multer)
router.post('/update/:id', runUploadSingle('header'), async (req, res) => {
  const { id } = req.params;
  const allowed = ['inst_id', 'bg', 'color', 'font_style', 'font_size'];
  const sets = [];
  const values = [];
  let i = 1;

  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) {
      let val = req.body[key];
      if (val === '') val = null;
      if (key === 'font_size' && val !== null && val !== undefined) {
        const parsed = Number(val);
        val = isNaN(parsed) ? null : parsed;
      }
      sets.push(`${key} = $${i++}`);
      values.push(val);
    }
  }

  try {
    const prev = await db.query('SELECT header FROM public.whiteboard_cms_theme WHERE id=$1', [id]);
    if (prev.rowCount === 0) return res.status(404).json({ error: 'Theme not found' });

    if (req.file) {
      sets.push(`header = $${i++}`);
      values.push(toHeaderPath(req.file.filename));
    }

    if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(id);
    const r = await db.query(
      `UPDATE public.whiteboard_cms_theme SET ${sets.join(', ')}
       WHERE id=$${i} RETURNING *`,
      values
    );

    if (req.file && prev.rows[0]?.header && prev.rows[0].header !== r.rows[0].header) {
      safeUnlink(prev.rows[0].header);
    }

    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update theme' });
  }
});

// ✅ OPTIONAL: PATCH alias for clients that send PATCH
router.patch('/update/:id', runUploadSingle('header'), async (req, res) => {
  // identical logic to the POST /update/:id above
  const { id } = req.params;
  const allowed = ['inst_id', 'bg', 'color', 'font_style', 'font_size'];
  const sets = [];
  const values = [];
  let i = 1;

  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) {
      let val = req.body[key];
      if (val === '') val = null;
      if (key === 'font_size' && val !== null && val !== undefined) {
        const parsed = Number(val);
        val = isNaN(parsed) ? null : parsed;
      }
      sets.push(`${key} = $${i++}`);
      values.push(val);
    }
  }

  try {
    const prev = await db.query('SELECT header FROM public.whiteboard_cms_theme WHERE id=$1', [id]);
    if (prev.rowCount === 0) return res.status(404).json({ error: 'Theme not found' });

    if (req.file) {
      sets.push(`header = $${i++}`);
      values.push(toHeaderPath(req.file.filename));
    }

    if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(id);
    const r = await db.query(
      `UPDATE public.whiteboard_cms_theme SET ${sets.join(', ')}
       WHERE id=$${i} RETURNING *`,
      values
    );

    if (req.file && prev.rows[0]?.header && prev.rows[0].header !== r.rows[0].header) {
      safeUnlink(prev.rows[0].header);
    }

    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update theme' });
  }
});

// DELETE
router.delete('/delete/:id', async (req, res) => {
  try {
    const r = await db.query('DELETE FROM public.whiteboard_cms_theme WHERE id=$1 RETURNING header', [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Theme not found' });
    if (r.rows[0]?.header) await safeUnlink(r.rows[0].header);
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
