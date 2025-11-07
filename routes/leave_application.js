// routes/leaveApplicationRouter.js
const express = require('express');
const cors = require('cors');
const router = express.Router();
const pool = require('../config/db_conn'); // adjust path if needed

router.use(cors());
router.use(express.json());

/* ------------------ helpers ------------------ */
const toDateOrNull = (v) => (v ? new Date(v) : null);
const toBoolOrDefault = (v, dflt = false) =>
  typeof v === 'boolean' ? v : (v == null ? dflt : String(v).toLowerCase() === 'true');
const toTextOrNull = (v) => (v === '' || v == null ? null : String(v));

/* map common pg error codes to friendly messages */
function pgErrorToHttp(error) {
  // 23502: not-null violation
  if (error?.code === '23502') {
    return { status: 400, msg: 'Missing required fields. Please fill all mandatory inputs.' };
  }
  // 23514: check constraint
  if (error?.code === '23514') {
    return { status: 400, msg: 'Date validation failed: Provide one valid section (CL / OD / Comp) with a proper date range.' };
  }
  return { status: 500, msg: 'Server error. Please try again.' };
}

/**
 * Add new leave application
 * POST /add
 */
router.post('/add', async (req, res) => {
  try {
    const {
      applicant_name,
      designation,
      department,

      cl_from,
      cl_to,
      cl_reason,

      od_from,
      od_to,
      od_reason,

      comp_from,
      comp_to,
      comp_in_lieu_from,
      comp_in_lieu_to,
      comp_for,
      comp_details,

      classes_adjusted,

      hod_countersigned = false,
      principal_signed = false,
    } = req.body;

    // Required field (matches NOT NULL in schema)
    if (!applicant_name || String(applicant_name).trim() === '') {
      return res.status(400).json({ error: 'Applicant name is required.' });
    }

    // Friendly pre-check for the “at_least_one_section” constraint
    if (
      !(cl_from && cl_to) &&
      !(od_from && od_to) &&
      !(comp_from && comp_to)
    ) {
      return res.status(400).json({
        error:
          'Provide at least one section with a valid date range: CL (cl_from & cl_to) OR OD (od_from & od_to) OR Comp (comp_from & comp_to).',
      });
    }

    const result = await pool.query(
      `INSERT INTO public.leave_application (
         applicant_name, designation, department,
         cl_from, cl_to, cl_reason,
         od_from, od_to, od_reason,
         comp_from, comp_to, comp_in_lieu_from, comp_in_lieu_to, comp_for, comp_details,
         classes_adjusted,
         hod_countersigned, principal_signed
       ) VALUES (
         $1, $2, $3,
         $4, $5, $6,
         $7, $8, $9,
         $10, $11, $12, $13, $14, $15,
         $16,
         $17, $18
       )
       RETURNING *`,
      [
        toTextOrNull(applicant_name),
        toTextOrNull(designation),
        toTextOrNull(department),

        toDateOrNull(cl_from),
        toDateOrNull(cl_to),
        toTextOrNull(cl_reason),

        toDateOrNull(od_from),
        toDateOrNull(od_to),
        toTextOrNull(od_reason),

        toDateOrNull(comp_from),
        toDateOrNull(comp_to),
        toDateOrNull(comp_in_lieu_from),
        toDateOrNull(comp_in_lieu_to),
        toTextOrNull(comp_for),
        toTextOrNull(comp_details),

        toTextOrNull(classes_adjusted),

        toBoolOrDefault(hod_countersigned, false),
        toBoolOrDefault(principal_signed, false),
      ]
    );

    res.status(201).json({ message: 'Leave application created', application: result.rows[0] });
  } catch (error) {
    console.error('Add LeaveApplication Error:', error);
    const { status, msg } = pgErrorToHttp(error);
    res.status(status).json({ error: msg });
  }
});

/**
 * Update leave application
 * PUT /update/:id
 * (the updated_at is handled by your trigger: trg_leave_application_updated_at)
 */
router.put('/update/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  const {
    applicant_name,
    designation,
    department,

    cl_from,
    cl_to,
    cl_reason,

    od_from,
    od_to,
    od_reason,

    comp_from,
    comp_to,
    comp_in_lieu_from,
    comp_in_lieu_to,
    comp_for,
    comp_details,

    classes_adjusted,

    hod_countersigned,
    principal_signed,
  } = req.body;

  try {
    const result = await pool.query(
      `UPDATE public.leave_application SET
         applicant_name     = $1,
         designation        = $2,
         department         = $3,

         cl_from            = $4,
         cl_to              = $5,
         cl_reason          = $6,

         od_from            = $7,
         od_to              = $8,
         od_reason          = $9,

         comp_from          = $10,
         comp_to            = $11,
         comp_in_lieu_from  = $12,
         comp_in_lieu_to    = $13,
         comp_for           = $14,
         comp_details       = $15,

         classes_adjusted   = $16,

         hod_countersigned  = $17,
         principal_signed   = $18
       WHERE id = $19
       RETURNING *`,
      [
        toTextOrNull(applicant_name),
        toTextOrNull(designation),
        toTextOrNull(department),

        toDateOrNull(cl_from),
        toDateOrNull(cl_to),
        toTextOrNull(cl_reason),

        toDateOrNull(od_from),
        toDateOrNull(od_to),
        toTextOrNull(od_reason),

        toDateOrNull(comp_from),
        toDateOrNull(comp_to),
        toDateOrNull(comp_in_lieu_from),
        toDateOrNull(comp_in_lieu_to),
        toTextOrNull(comp_for),
        toTextOrNull(comp_details),

        toTextOrNull(classes_adjusted),

        toBoolOrDefault(hod_countersigned, false),
        toBoolOrDefault(principal_signed, false),

        id,
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Leave application not found' });
    }

    res.json({ message: 'Leave application updated', application: result.rows[0] });
  } catch (error) {
    console.error('Update LeaveApplication Error:', error);
    const { status, msg } = pgErrorToHttp(error);
    res.status(status).json({ error: msg });
  }
});

/**
 * Delete leave application
 * DELETE /delete/:id
 */
router.delete('/delete/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  try {
    const result = await pool.query(
      'DELETE FROM public.leave_application WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Leave application not found' });
    }

    res.json({ message: 'Leave application deleted', application: result.rows[0] });
  } catch (error) {
    console.error('Delete LeaveApplication Error:', error);
    res.status(500).json({ error: 'Failed to delete leave application' });
  }
});

/**
 * Get all leave applications
 * GET /list
 */
router.get('/list', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT *
         FROM public.leave_application
        ORDER BY COALESCE(updated_at, submitted_at) DESC`
    );
    res.json({ applications: result.rows });
  } catch (error) {
    console.error('Fetch LeaveApplications Error:', error);
    res.status(500).json({ error: 'Failed to fetch leave applications' });
  }
});

/**
 * Get leave application by ID
 * GET /:id
 */
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  try {
    const result = await pool.query(
      `SELECT * FROM public.leave_application WHERE id = $1`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Leave application not found' });
    }

    res.json({ application: result.rows[0] });
  } catch (error) {
    console.error('Fetch LeaveApplication Error:', error);
    res.status(500).json({ error: 'Failed to fetch leave application' });
  }
});

module.exports = router;
