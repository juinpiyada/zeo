const express = require('express');
const router = express.Router();
const db = require('../config/db_conn');


router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM public.cms_stu_payments ORDER BY createdat DESC`
    );
    return res.status(200).json({ payments: result.rows });
  } catch (err) {
    console.error('Error fetching payments:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});


router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `SELECT * FROM public.cms_stu_payments WHERE cms_pymts_tran_id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    return res.status(200).json({ payment: result.rows[0] });
  } catch (err) {
    console.error('Error fetching payment:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});


router.post('/', async (req, res) => {
  const {
    cms_pymts_tran_id,
    cms_pymts_inv_id,
    cms_pymts_stuid,
    cms_pymts_gw_name,
    cms_pymts_gw_ord_id,
    cms_pymts_amt_pd,
    cms_pymts_response_pl,
    cms_pymts_callbk_time
  } = req.body;

  if (!cms_pymts_tran_id || !cms_pymts_inv_id || !cms_pymts_stuid) {
    return res.status(400).json({ error: 'Required fields are missing' });
  }

  try {
    const result = await db.query(
      `INSERT INTO public.cms_stu_payments (
        cms_pymts_tran_id, cms_pymts_inv_id, cms_pymts_stuid,
        cms_pymts_gw_name, cms_pymts_gw_ord_id, cms_pymts_amt_pd,
        cms_pymts_response_pl, cms_pymts_callbk_time,
        createdat, updatedat
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8, NOW(), NOW()
      ) RETURNING *`,
      [
        cms_pymts_tran_id,
        cms_pymts_inv_id,
        cms_pymts_stuid,
        cms_pymts_gw_name,
        cms_pymts_gw_ord_id,
        cms_pymts_amt_pd,
        cms_pymts_response_pl,
        cms_pymts_callbk_time
      ]
    );
    return res.status(201).json({ message: 'Payment added', payment: result.rows[0] });
  } catch (err) {
    console.error('Error adding payment:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});


// router.put('/:id', async (req, res) => {
//   const { id } = req.params;
//   const {
//     cms_pymts_inv_id,
//     cms_pymts_stuid,
//     cms_pymts_gw_name,
//     cms_pymts_gw_ord_id,
//     cms_pymts_amt_pd,
//     cms_pymts_response_pl,
//     cms_pymts_callbk_time
//   } = req.body;

//   try {
//     const result = await db.query(
//       `UPDATE public.cms_stu_payments SET
//         cms_pymts_inv_id = $1,
//         cms_pymts_stuid = $2,
//         cms_pymts_gw_name = $3,
//         cms_pymts_gw_ord_id = $4,
//         cms_pymts_amt_pd = $5,
//         cms_pymts_response_pl = $6,
//         cms_pymts_callbk_time = $7,
//         updatedat = NOW()
//       WHERE cms_pymts_tran_id = $8
//       RETURNING *`,
//       [
//         cms_pymts_inv_id,
//         cms_pymts_stuid,
//         cms_pymts_gw_name,
//         cms_pymts_gw_ord_id,
//         cms_pymts_amt_pd,
//         cms_pymts_response_pl,
//         cms_pymts_callbk_time,
//         id
//       ]
//     );

//     if (result.rowCount === 0) {
//       return res.status(404).json({ error: 'Payment not found' });
//     }

//     return res.status(200).json({ message: 'Payment updated', payment: result.rows[0] });
//   } catch (err) {
//     console.error('Error updating payment:', err);
//     return res.status(500).json({ error: 'Internal server error' });
//   }
// });


// router.delete('/:id', async (req, res) => {
//   const { id } = req.params;
//   try {
//     const result = await db.query(
//       `DELETE FROM public.cms_stu_payments WHERE cms_pymts_tran_id = $1 RETURNING *`,
//       [id]
//     );
//     if (result.rowCount === 0) {
//       return res.status(404).json({ error: 'Payment not found' });
//     }
//     return res.status(200).json({ message: 'Payment deleted', payment: result.rows[0] });
//   } catch (err) {
//     console.error('Error deleting payment:', err);
//     return res.status(500).json({ error: 'Internal server error' });
//   }
// });

module.exports = router;