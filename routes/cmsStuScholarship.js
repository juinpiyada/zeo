// routes/cms_stu_scholarship.js
const express = require('express');
const router = express.Router();
const db = require('../config/db_conn');

/* ---------- constants ---------- */
// Use 0.00 as the "no scholarship" value because student_master.scholrshipfees is NOT NULL
const SCHOLARSHIP_FALLBACK_AMOUNT = 0.00;

/* ---------- helpers ---------- */
function toNumberOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number.parseFloat(v);
  return Number.isNaN(n) ? NaN : n;
}

function badRequest(res, msg) {
  return res.status(400).json({ error: msg });
}

/* =========================
 *  GET all scholarships
 * ========================= */
router.get('/', async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM public.cms_stu_scholarship ORDER BY createdat DESC`
    );
    return res.status(200).json({ scholarships: result.rows });
  } catch (err) {
    console.error('Error fetching scholarships:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* =========================
 *  GET one scholarship
 * ========================= */
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `SELECT * FROM public.cms_stu_scholarship WHERE cms_schol_id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Scholarship not found' });
    }
    return res.status(200).json({ scholarship: result.rows[0] });
  } catch (err) {
    console.error('Error fetching scholarship:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* =========================
 *  CREATE scholarship
 *  Mirrors AMOUNT -> student_master.scholrshipfees (numeric)
 * ========================= */
router.post('/', async (req, res) => {
  const {
    cms_schol_id,
    cms_schol_stuid,
    cms_schol_term_id,
    cms_schol_fee_head,   // label, e.g. "Exam Fee"
    cms_stu_schol_amt,    // amount to mirror to student_master.scholrshipfees
    cms_schol_reason,
    cms_schol_apprved_by
  } = req.body;

  if (!cms_schol_id || !cms_schol_stuid || !cms_schol_fee_head) {
    return badRequest(res, 'Required fields are missing (cms_schol_id, cms_schol_stuid, cms_schol_fee_head)');
  }

  const amt = toNumberOrNull(cms_stu_schol_amt);
  if (Number.isNaN(amt)) {
    return badRequest(res, 'cms_stu_schol_amt must be numeric (e.g., 1000 or 1000.50)');
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const insertRes = await client.query(
      `INSERT INTO public.cms_stu_scholarship (
        cms_schol_id, cms_schol_stuid, cms_schol_term_id, cms_schol_fee_head,
        cms_stu_schol_amt, cms_schol_reason, cms_schol_apprved_by,
        createdat, updatedat
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7, NOW(), NOW()
      ) RETURNING *`,
      [
        cms_schol_id,
        cms_schol_stuid,
        cms_schol_term_id || null,
        cms_schol_fee_head,
        amt, // numeric or null
        cms_schol_reason || null,
        cms_schol_apprved_by || null
      ]
    );

    // Mirror the AMOUNT into numeric column student_master.scholrshipfees
    // IMPORTANT: Do not set NULL into a NOT NULL column; if amt is null, set fallback 0.00
    if (cms_schol_stuid) {
      const mirrored = amt === null ? SCHOLARSHIP_FALLBACK_AMOUNT : amt;
      await client.query(
        `UPDATE public.student_master
           SET scholrshipfees = $1, updatedat = NOW()
         WHERE stuid = $2`,
        [mirrored, cms_schol_stuid]
      );
    }

    await client.query('COMMIT');
    return res.status(201).json({ message: 'Scholarship added', scholarship: insertRes.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error adding scholarship:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  } finally {
    client.release();
  }
});

/* =========================
 *  UPDATE scholarship
 *  Mirrors AMOUNT -> student_master.scholrshipfees (numeric)
 * ========================= */
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const {
    cms_schol_stuid,
    cms_schol_term_id,
    cms_schol_fee_head,   // label
    cms_stu_schol_amt,    // amount; mirrored
    cms_schol_reason,
    cms_schol_apprved_by
  } = req.body;

  const amt = toNumberOrNull(cms_stu_schol_amt);
  if (Number.isNaN(amt)) {
    return badRequest(res, 'cms_stu_schol_amt must be numeric (e.g., 1000 or 1000.50)');
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const updateRes = await client.query(
      `UPDATE public.cms_stu_scholarship SET
         cms_schol_stuid = COALESCE($1, cms_schol_stuid),
         cms_schol_term_id = $2,
         cms_schol_fee_head = COALESCE($3, cms_schol_fee_head),
         cms_stu_schol_amt = $4,
         cms_schol_reason = $5,
         cms_schol_apprved_by = $6,
         updatedat = NOW()
       WHERE cms_schol_id = $7
       RETURNING *`,
      [
        cms_schol_stuid || null,
        cms_schol_term_id || null,
        cms_schol_fee_head || null,
        amt, // numeric or null
        cms_schol_reason || null,
        cms_schol_apprved_by || null,
        id
      ]
    );

    if (updateRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Scholarship not found' });
    }

    const row = updateRes.rows[0];

    // Mirror numeric amount logic:
    // If we know the student: set amt (or fallback 0.00 if null) to avoid NULL writes
    if (row.cms_schol_stuid) {
      const mirrored = amt === null ? SCHOLARSHIP_FALLBACK_AMOUNT : amt;
      await client.query(
        `UPDATE public.student_master
           SET scholrshipfees = $1, updatedat = NOW()
         WHERE stuid = $2`,
        [mirrored, row.cms_schol_stuid]
      );
    }

    await client.query('COMMIT');
    return res.status(200).json({ message: 'Scholarship updated', scholarship: row });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error updating scholarship:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  } finally {
    client.release();
  }
});

/* =========================
 *  DELETE scholarship
 *  Also refreshes student_master.scholrshipfees for that student
 *
 *  Logic:
 *    1) Delete the scholarship row and get (stuid).
 *    2) Find the latest remaining scholarship for that student.
 *       - If found and amount not null, mirror that amount.
 *       - If none (or amount is null), set scholrshipfees = 0.00 (NOT NULL column).
 * ========================= */
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Delete and return the row (so we know which student to refresh)
    const delRes = await client.query(
      `DELETE FROM public.cms_stu_scholarship
        WHERE cms_schol_id = $1
        RETURNING cms_schol_id, cms_schol_stuid, cms_schol_fee_head, cms_stu_schol_amt`,
      [id]
    );

    if (delRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Scholarship not found' });
    }

    const deleted = delRes.rows[0];
    const stuid = deleted.cms_schol_stuid;

    if (stuid) {
      // Find the latest scholarship for this student (by updatedat/createdat desc)
      const latestRes = await client.query(
        `SELECT cms_stu_schol_amt
           FROM public.cms_stu_scholarship
          WHERE cms_schol_stuid = $1
          ORDER BY COALESCE(updatedat, createdat) DESC NULLS LAST, createdat DESC NULLS LAST
          LIMIT 1`,
        [stuid]
      );

      if (latestRes.rows.length > 0 && latestRes.rows[0].cms_stu_schol_amt !== null) {
        // Mirror latest remaining scholarship amount
        await client.query(
          `UPDATE public.student_master
             SET scholrshipfees = $1, updatedat = NOW()
           WHERE stuid = $2`,
          [latestRes.rows[0].cms_stu_schol_amt, stuid]
        );
      } else {
        // No other scholarship remains or latest amount is NULL → set fallback 0.00
        await client.query(
          `UPDATE public.student_master
             SET scholrshipfees = $1, updatedat = NOW()
           WHERE stuid = $2`,
          [SCHOLARSHIP_FALLBACK_AMOUNT, stuid]
        );
      }
    }

    await client.query('COMMIT');
    return res.status(200).json({ message: 'Scholarship deleted', scholarship: deleted });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error deleting scholarship:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
