// routes/user_dtls.js
const express = require('express');
const cors = require('cors');
const router = express.Router();

// 🔁 Adjust this path to your pool config
const pool = require('../config/db_conn');

router.use(cors());
router.use(express.json({ limit: '25mb' })); // allow big base64 payloads

/** Helper: decode optional base64 into Buffer or null */
function decodeBase64ToBuf(str) {
  if (!str) return null;
  try {
    return Buffer.from(String(str), 'base64');
  } catch {
    return null;
  }
}

/** Helper: normalize nullable string ('' -> null) */
function nz(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** Helper: Aadhaar validation (must match DB CHECK: 12 digits) */
function isValidAadhaar(a) {
  if (a === null) return true; // null allowed by DDL
  return /^[0-9]{12}$/.test(a);
}

/** -------------------------------------------
 *  GET /list  -> list all rows
 *  ------------------------------------------*/
router.get('/list', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT usr_dtls_id, usr_usr_id, usr_dtls_desc,
              CASE WHEN usr_dtls_file IS NULL THEN FALSE ELSE TRUE END AS has_file,
              usr_aadharno, usr_abc_id
         FROM public.user_dtls
         ORDER BY usr_dtls_id ASC`
    );
    res.json({ ok: true, count: rows.length, user_dtls: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'Failed to list user_dtls' });
  }
});

/** -------------------------------------------
 *  GET /id/:id  -> get one row by primary key
 *  ------------------------------------------*/
router.get('/id/:id', async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ ok: false, error: 'usr_dtls_id is required' });

  try {
    const { rows } = await pool.query(
      `SELECT usr_dtls_id, usr_usr_id, usr_dtls_desc,
              encode(usr_dtls_file, 'base64') AS usr_dtls_file_base64,
              usr_aadharno, usr_abc_id
         FROM public.user_dtls
        WHERE usr_dtls_id = $1`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, user_dtls: rows[0] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'Failed to fetch record' });
  }
});

/** --------------------------------------------------------
 *  GET /by-user/:userid  -> all rows for a given master_user
 *  -------------------------------------------------------*/
router.get('/by-user/:userid', async (req, res) => {
  const userid = String(req.params.userid || '').trim();
  if (!userid) return res.status(400).json({ ok: false, error: 'usr_usr_id is required' });

  try {
    const { rows } = await pool.query(
      `SELECT usr_dtls_id, usr_usr_id, usr_dtls_desc,
              CASE WHEN usr_dtls_file IS NULL THEN FALSE ELSE TRUE END AS has_file,
              usr_aadharno, usr_abc_id
         FROM public.user_dtls
        WHERE usr_usr_id = $1
        ORDER BY usr_dtls_id ASC`,
      [userid]
    );
    res.json({ ok: true, count: rows.length, user_dtls: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'Failed to list user_dtls by user' });
  }
});

/** -------------------------------------------
 *  POST /add  -> create a new row
 *  Body JSON:
 *  {
 *    usr_dtls_id: "UD_001",
 *    usr_usr_id: "user@example.com",        // optional (FK)
 *    usr_dtls_desc: "Aadhar Card",
 *    usr_dtls_file_base64: "<base64 data>", // optional
 *    usr_aadharno: "123456789012",          // optional, must be 12 digits if present
 *    usr_abc_id: "ABC12345"                 // optional, up to 20 chars (DB)
 *  }
 *  ------------------------------------------*/
router.post('/add', async (req, res) => {
  const {
    usr_dtls_id,
    usr_usr_id,
    usr_dtls_desc,
    usr_dtls_file_base64,
    usr_aadharno,
    usr_abc_id
  } = req.body || {};

  if (!usr_dtls_id || !usr_dtls_desc) {
    return res.status(400).json({ ok: false, error: 'usr_dtls_id and usr_dtls_desc are required' });
  }

  const fileBuf = decodeBase64ToBuf(usr_dtls_file_base64);
  const aadhar = nz(usr_aadharno);
  const abcId  = nz(usr_abc_id);

  if (!isValidAadhaar(aadhar)) {
    return res.status(400).json({ ok: false, error: 'Invalid usr_aadharno: must be 12 digits' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO public.user_dtls
         (usr_dtls_id, usr_usr_id, usr_dtls_desc, usr_dtls_file, usr_aadharno, usr_abc_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING usr_dtls_id, usr_usr_id, usr_dtls_desc,
                 CASE WHEN usr_dtls_file IS NULL THEN FALSE ELSE TRUE END AS has_file,
                 usr_aadharno, usr_abc_id`,
      [usr_dtls_id, nz(usr_usr_id), usr_dtls_desc, fileBuf, aadhar, abcId]
    );
    res.status(201).json({ ok: true, message: 'Created', user_dtls: rows[0] });
  } catch (err) {
    // FK violation '23503'; duplicate PK '23505'; CHECK violation '23514'
    res.status(500).json({ ok: false, error: err.message || 'Failed to create record' });
  }
});

/** ---------------------------------------------------------
 *  PUT /update/:id  -> update fields; file optional
 *  Body JSON (all optional, only provided fields are updated):
 *  {
 *    usr_usr_id: "user@example.com",
 *    usr_dtls_desc: "New description",
 *    usr_dtls_file_base64: "<base64 data>",  // to replace the file
 *    clear_file: true,                        // to set file to NULL
 *    usr_aadharno: "123456789012" | "" | null,  // 12 digits or null/"" to clear
 *    usr_abc_id: "ABC999" | "" | null           // up to 20 chars or null/"" to clear
 *  }
 *  --------------------------------------------------------*/
router.put('/update/:id', async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ ok: false, error: 'usr_dtls_id param is required' });

  const {
    usr_usr_id,
    usr_dtls_desc,
    usr_dtls_file_base64,
    clear_file,
    usr_aadharno,
    usr_abc_id
  } = req.body || {};

  const sets = [];
  const vals = [];
  let i = 1;

  if (typeof usr_usr_id !== 'undefined') { sets.push(`usr_usr_id = $${i++}`); vals.push(usr_usr_id); }
  if (typeof usr_dtls_desc !== 'undefined') { sets.push(`usr_dtls_desc = $${i++}`); vals.push(usr_dtls_desc); }

  if (clear_file === true) {
    sets.push(`usr_dtls_file = NULL`);
  } else if (typeof usr_dtls_file_base64 !== 'undefined') {
    sets.push(`usr_dtls_file = $${i++}`);
    vals.push(decodeBase64ToBuf(usr_dtls_file_base64));
  }

  if (typeof usr_aadharno !== 'undefined') {
    const aadhar = nz(usr_aadharno);
    if (!isValidAadhaar(aadhar)) {
      return res.status(400).json({ ok: false, error: 'Invalid usr_aadharno: must be 12 digits' });
    }
    sets.push(`usr_aadharno = $${i++}`);
    vals.push(aadhar);
  }

  if (typeof usr_abc_id !== 'undefined') {
    sets.push(`usr_abc_id = $${i++}`);
    vals.push(nz(usr_abc_id));
  }

  if (sets.length === 0) {
    return res.status(400).json({ ok: false, error: 'No fields to update' });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE public.user_dtls
          SET ${sets.join(', ')}
        WHERE usr_dtls_id = $${i}
        RETURNING usr_dtls_id, usr_usr_id, usr_dtls_desc,
                  CASE WHEN usr_dtls_file IS NULL THEN FALSE ELSE TRUE END AS has_file,
                  usr_aadharno, usr_abc_id`,
      [...vals, id]
    );
    if (rows.length === 0) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, message: 'Updated', user_dtls: rows[0] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'Failed to update record' });
  }
});

/** -------------------------------------------
 *  DELETE /delete/:id  -> delete by primary key
 *  ------------------------------------------*/
router.delete('/delete/:id', async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ ok: false, error: 'usr_dtls_id param is required' });

  try {
    const { rowCount } = await pool.query(
      `DELETE FROM public.user_dtls WHERE usr_dtls_id = $1`,
      [id]
    );
    if (rowCount === 0) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, message: 'Deleted', id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'Failed to delete record' });
  }
});

module.exports = router;