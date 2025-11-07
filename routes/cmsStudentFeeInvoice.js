// api/routes/cms_fee_invoice.js
const express = require('express');
const router = express.Router();
const db = require('../config/db_conn');

/* ----------------------- helpers ----------------------- */
function toNull(v) {
  return v === undefined || v === '' ? null : v;
}
function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1;
  const s = String(v ?? '').toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'y' || s === 'paid';
}
function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* ----------------------- doc validation ----------------------- */
const ALLOWED_TDOC = new Set([
  'AADHAAR',
  'PAN',
  'PASSPORT',
  'DRIVING_LICENSE',
  'VOTER_ID',
  'OTHER',
]);

const RE_ALNUM = /^[A-Za-z0-9]+$/;
const RE_AADHAAR = /^[0-9]{12}$/;                             // 12 digits
const RE_PAN = /^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/;               // AAAAA9999A

function normalizeDocFields({ tdoc, ndoc }) {
  // Normalize case: tdoc upper, PAN upper, others as-is
  const TDOC = toNull(tdoc);
  const NDOC = toNull(ndoc);

  const norm = {
    tdoc: TDOC ? String(TDOC).trim().toUpperCase() : null,
    ndoc: NDOC ? String(NDOC).trim() : null,
  };
  // PAN is case sensitive for letters => enforce uppercase to avoid db check mismatch
  if (norm.tdoc === 'PAN' && norm.ndoc) {
    norm.ndoc = norm.ndoc.toUpperCase();
  }
  return norm;
}

function validateDocFields({ tdoc, ndoc }) {
  // Allow both null
  if (!tdoc && !ndoc) return { ok: true };

  // tdoc present?
  if (tdoc && !ALLOWED_TDOC.has(tdoc)) {
    return { ok: false, error: `tdoc must be one of ${Array.from(ALLOWED_TDOC).join(', ')}` };
  }

  // ndoc present?
  if (ndoc && !RE_ALNUM.test(ndoc)) {
    return { ok: false, error: 'ndoc must be alphanumeric' };
  }

  // Optional tighter checks (match your SQL constraint)
  if (tdoc === 'AADHAAR' && ndoc && !RE_AADHAAR.test(ndoc)) {
    return { ok: false, error: 'ndoc must be 12 digits for AADHAAR' };
  }
  if (tdoc === 'PAN' && ndoc && !RE_PAN.test(ndoc)) {
    return { ok: false, error: 'ndoc must match PAN format AAAAA9999A' };
  }
  // For other types, accept 4–32 alphanumeric (handled by DB constraint too)
  if (tdoc && !['AADHAAR', 'PAN'].includes(tdoc) && ndoc) {
    if (!(ndoc.length >= 4 && ndoc.length <= 32)) {
      return { ok: false, error: 'ndoc must be 4–32 alphanumeric characters for this tdoc' };
    }
  }

  return { ok: true };
}

/* ----------------------- invoice totals (read-only) ----------------------- */
/**
 * Sum of all cms_fee_amt for a given student.
 * NOTE: This does NOT write to student_master; it's read-only.
 */
async function sumInvoicesForStudent(client, studentId) {
  if (!studentId) return 0;
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(cms_fee_amt), 0) AS total
       FROM public.cms_stu_fee_invoice
      WHERE cms_stu_id = $1`,
    [studentId]
  );
  return Number(rows?.[0]?.total || 0);
}

/* ----------------------- balance helpers (write) ----------------------- */
async function getStudentBalance(client, studentId) {
  const { rows } = await client.query(
    `SELECT COALESCE(balance, 0.00) AS balance
       FROM public.student_master
      WHERE stuid = $1`,
    [studentId]
  );
  if (rows.length === 0) throw new Error('Student not found');
  return Number(rows[0].balance || 0);
}

async function setStudentBalance(client, studentId, newValue) {
  const val = Number(newValue);
  if (!Number.isFinite(val) || val < 0) throw new Error('balance must be a non-negative number');
  const { rows } = await client.query(
    `UPDATE public.student_master
        SET balance = $2, updatedat = NOW()
      WHERE stuid = $1
      RETURNING stuid, balance`,
    [studentId, val]
  );
  if (rows.length === 0) throw new Error('Student not found');
  return Number(rows[0].balance);
}

/**
 * Apply a delta to student_master.balance (manual balance field).
 * sign: 'minus' (default) or 'plus'
 * Ensures balance never goes below 0.
 * Returns the updated balance and the attempted delta.
 */
async function applyBalanceDelta(client, studentId, amount, sign = 'minus') {
  const amt = Number(amount);
  if (!studentId) throw new Error('stuid required');
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('amount must be a positive number');

  const factor = sign === 'plus' ? 1 : -1;

  const current = await getStudentBalance(client, studentId);
  const next = Math.max(current + factor * amt, 0);
  const updated = await setStudentBalance(client, studentId, next);

  return {
    prev_balance: current,
    delta: factor * amt,
    balance: updated,
  };
}

/* ======================= Balance APIs (manual) ======================= */
router.get('/student/:id/balance', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query(
      `SELECT stuid, COALESCE(balance, 0.00) AS balance
         FROM public.student_master
        WHERE stuid = $1`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    return res.status(200).json({
      stuid: rows[0].stuid,
      balance: Number(rows[0].balance),
    });
  } catch (err) {
    console.error('Error fetching balance:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/student/balance', async (req, res) => {
  const { stuid, balance } = req.body || {};

  if (!stuid || String(stuid).trim() === '') {
    return res.status(400).json({ error: 'stuid is required' });
  }

  const val = toNum(balance);
  if (val === null) {
    return res.status(400).json({ error: 'balance must be a number' });
  }
  if (val < 0) {
    return res.status(400).json({ error: 'balance cannot be negative' });
  }

  try {
    const { rows } = await db.query(
      `UPDATE public.student_master
          SET balance = $2, updatedat = NOW()
        WHERE stuid = $1
        RETURNING stuid, balance`,
      [stuid.trim(), val]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    return res.status(200).json({
      message: 'Balance updated',
      stuid: rows[0].stuid,
      balance: Number(rows[0].balance),
    });
  } catch (err) {
    console.error('Error updating balance:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
/* ===================== END: Balance APIs (manual) ===================== */

/* ----------------------- invoice routes (with tdoc/ndoc) ----------------------- */

/** List all invoices (newest first).
 *  Optional filters: ?stuid=...&tdoc=...&ndoc=...
 */
router.get('/', async (req, res) => {
  const { stuid, tdoc, ndoc } = req.query || {};
  const norms = normalizeDocFields({ tdoc, ndoc });

  // Build dynamic WHERE
  const where = [];
  const params = [];
  let i = 1;

  if (stuid) {
    where.push(`cms_stu_id = $${i++}`);
    params.push(stuid);
  }
  if (norms.tdoc) {
    where.push(`tdoc = $${i++}`);
    params.push(norms.tdoc);
  }
  if (norms.ndoc) {
    where.push(`ndoc = $${i++}`);
    params.push(norms.ndoc);
  }

  const SQL = `
    SELECT *
      FROM public.cms_stu_fee_invoice
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY createdat DESC
  `;

  try {
    const result = await db.query(SQL, params);
    return res.status(200).json({ invoices: result.rows });
  } catch (err) {
    console.error('Error fetching invoices:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/** Get one invoice by ID */
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `SELECT * FROM public.cms_stu_fee_invoice WHERE cms_stu_inv_id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    return res.status(200).json({ invoice: result.rows[0] });
  } catch (err) {
    console.error('Error fetching invoice:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/** Create invoice (NO seemfees writes) */
router.post('/', async (req, res) => {
  const {
    cms_stu_inv_id,
    cms_stu_id,
    cms_term_id,
    cms_fee_head,
    cms_fee_amt,
    cms_due_dt,
    cmc_fee_is_paid,
    cmc_fee_paiddt,
    cmc_fee_pymt_mode,
    cmc_fee_trans_id,
    cmc_stu_fee_remarks,
    // NEW:
    tdoc,
    ndoc,
  } = req.body || {};

  if (!cms_stu_inv_id || !cms_stu_id || !cms_term_id || !cms_fee_head) {
    return res.status(400).json({ error: 'Required fields are missing' });
  }

  const norm = normalizeDocFields({ tdoc, ndoc });
  const valid = validateDocFields(norm);
  if (!valid.ok) {
    return res.status(400).json({ error: valid.error });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const insert = await client.query(
      `INSERT INTO public.cms_stu_fee_invoice (
         cms_stu_inv_id, cms_stu_id, cms_term_id, cms_fee_head, cms_fee_amt,
         cms_due_dt, cmc_fee_is_paid, cmc_fee_paiddt, cmc_fee_pymt_mode,
         cmc_fee_trans_id, cmc_stu_fee_remarks,
         tdoc, ndoc,
         createdat, updatedat
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW()
       ) RETURNING *`,
      [
        cms_stu_inv_id,
        cms_stu_id,
        cms_term_id,
        cms_fee_head,
        toNull(cms_fee_amt) != null ? Number(cms_fee_amt) : null,
        toNull(cms_due_dt),
        toBool(cmc_fee_is_paid),
        toNull(cmc_fee_paiddt),
        toNull(cmc_fee_pymt_mode),
        toNull(cmc_fee_trans_id),
        toNull(cmc_stu_fee_remarks),
        norm.tdoc,
        norm.ndoc,
      ]
    );

    // Read-only: compute student's total invoice amount (not saved anywhere)
    const totalFees = await sumInvoicesForStudent(client, cms_stu_id);

    await client.query('COMMIT');
    return res.status(201).json({
      message: 'Invoice created',
      invoice: insert.rows[0],
      student_total_from_invoices: totalFees,
    });
  } catch (err) {
    await client.query('ROLLBACK');

    // Handle unique constraint (optional index on (cms_stu_id, tdoc, ndoc))
    if (err && err.code === '23505') {
      return res.status(409).json({
        error: 'Duplicate document for this student (tdoc+ndoc must be unique per student)',
        details: err.detail || err.message,
      });
    }

    console.error('Error adding invoice:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  } finally {
    client.release();
  }
});

/** Update invoice (NO seemfees writes) */
router.put('/:id', async (req, res) => {
  const { id } = req.params;

  const {
    cms_stu_id,
    cms_term_id,
    cms_fee_head,
    cms_fee_amt,
    cms_due_dt,
    cmc_fee_is_paid,
    cmc_fee_paiddt,
    cmc_fee_pymt_mode,
    cmc_fee_trans_id,
    cmc_stu_fee_remarks,
    // NEW:
    tdoc,
    ndoc,
  } = req.body || {};

  const norm = normalizeDocFields({ tdoc, ndoc });
  const valid = validateDocFields(norm);
  if (!valid.ok) {
    return res.status(400).json({ error: valid.error });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Ensure invoice exists; also get old stuid in case it changed
    const existing = await client.query(
      `SELECT cms_stu_inv_id, cms_stu_id
         FROM public.cms_stu_fee_invoice
        WHERE cms_stu_inv_id = $1`,
      [id]
    );

    if (existing.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const oldStudentId = existing.rows[0].cms_stu_id;

    const result = await client.query(
      `UPDATE public.cms_stu_fee_invoice SET
         cms_stu_id = $1,
         cms_term_id = $2,
         cms_fee_head = $3,
         cms_fee_amt = $4,
         cms_due_dt = $5,
         cmc_fee_is_paid = $6,
         cmc_fee_paiddt = $7,
         cmc_fee_pymt_mode = $8,
         cmc_fee_trans_id = $9,
         cmc_stu_fee_remarks = $10,
         tdoc = $11,
         ndoc = $12,
         updatedat = NOW()
       WHERE cms_stu_inv_id = $13
       RETURNING *`,
      [
        cms_stu_id,
        cms_term_id,
        cms_fee_head,
        toNull(cms_fee_amt) != null ? Number(cms_fee_amt) : null,
        toNull(cms_due_dt),
        toBool(cmc_fee_is_paid),
        toNull(cmc_fee_paiddt),
        toNull(cmc_fee_pymt_mode),
        toNull(cmc_fee_trans_id),
        toNull(cmc_stu_fee_remarks),
        norm.tdoc,
        norm.ndoc,
        id,
      ]
    );

    // Read-only totals (old/new students) for client awareness
    const totals = {};
    if (oldStudentId && String(oldStudentId) !== String(cms_stu_id)) {
      totals[oldStudentId] = await sumInvoicesForStudent(client, oldStudentId);
    }
    if (cms_stu_id) {
      totals[cms_stu_id] = await sumInvoicesForStudent(client, cms_stu_id);
    }

    await client.query('COMMIT');
    return res.status(200).json({
      message: 'Invoice updated',
      invoice: result.rows[0],
      student_totals_from_invoices: totals,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err && err.code === '23505') {
      return res.status(409).json({
        error: 'Duplicate document for this student (tdoc+ndoc must be unique per student)',
        details: err.detail || err.message,
      });
    }
    console.error('Error updating invoice:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  } finally {
    client.release();
  }
});

/** Delete invoice (NO seemfees writes) */
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Get stuid before delete for recomputing read-only total
    const existing = await client.query(
      `SELECT cms_stu_inv_id, cms_stu_id
         FROM public.cms_stu_fee_invoice
        WHERE cms_stu_inv_id = $1`,
      [id]
    );

    if (existing.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const studentId = existing.rows[0].cms_stu_id;

    const del = await client.query(
      `DELETE FROM public.cms_stu_fee_invoice WHERE cms_stu_inv_id = $1 RETURNING *`,
      [id]
    );

    // Read-only: new total after delete
    const totalFees = await sumInvoicesForStudent(client, studentId);

    await client.query('COMMIT');
    return res.status(200).json({
      message: 'Invoice deleted',
      invoice: del.rows[0],
      student_total_from_invoices: totalFees,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error deleting invoice:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  } finally {
    client.release();
  }
});

/* ----------------------- payments → adjust BALANCE ----------------------- */
router.put('/apply-payment', async (req, res) => {
  const { stuid, amount } = req.body;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { prev_balance, delta, balance } = await applyBalanceDelta(client, stuid, amount, 'minus');
    await client.query('COMMIT');
    return res.status(200).json({
      message: 'Payment applied: balance decreased',
      stuid,
      amount: Number(amount),
      previous_balance: prev_balance,
      delta,
      balance,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error applying payment:', err);
    return res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.put('/revert-payment', async (req, res) => {
  const { stuid, amount } = req.body;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { prev_balance, delta, balance } = await applyBalanceDelta(client, stuid, amount, 'plus');
    await client.query('COMMIT');
    return res.status(200).json({
      message: 'Payment reverted: balance increased',
      stuid,
      amount: Number(amount),
      previous_balance: prev_balance,
      delta,
      balance,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error reverting payment:', err);
    return res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.put('/adjust/balance', async (req, res) => {
  const { stuid, amount, op } = req.body;
  const sign = op === 'plus' ? 'plus' : 'minus';
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { prev_balance, delta, balance } = await applyBalanceDelta(client, stuid, amount, sign);
    await client.query('COMMIT');
    return res.status(200).json({
      message: `balance ${sign === 'minus' ? 'decreased' : 'increased'}`,
      stuid,
      amount: Number(amount),
      previous_balance: prev_balance,
      delta,
      balance,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error adjusting balance:', err);
    return res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
