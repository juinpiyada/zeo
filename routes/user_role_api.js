const express = require('express');
const router = express.Router();
const db = require('../config/db_conn');

// ✅ GET all user roles
router.get('/', async (req, res) => {
  try {
    const result = await db.query(`SELECT * FROM public.user_role`);
    return res.status(200).json({ roles: result.rows });
  } catch (err) {
    console.error('Error fetching user roles:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ GET roles by user ID
router.get('/:userid', async (req, res) => {
  const { userid } = req.params;
  try {
    const result = await db.query(`SELECT * FROM public.user_role WHERE userid = $1`, [userid]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No roles found for this user' });
    }
    return res.status(200).json({ roles: result.rows });
  } catch (err) {
    console.error('Error fetching roles for user:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ POST a new user role
router.post('/', async (req, res) => {
  const { userid, userrolesid, userroledesc } = req.body;

  if (!userid || !userrolesid || !userroledesc) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const result = await db.query(
      `INSERT INTO public.user_role (
        userid, userrolesid, userroledesc, createdat, updatedat
      ) VALUES ($1, $2, $3, NOW(), NOW()) RETURNING *`,
      [userid, userrolesid, userroledesc]
    );
    return res.status(201).json({ message: 'User role added', role: result.rows[0] });
  } catch (err) {
    console.error('Error adding user role:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ PUT update role by user ID and role ID
router.put('/:userid/:userrolesid', async (req, res) => {
  const { userid, userrolesid } = req.params;
  const { userroledesc } = req.body;

  try {
    const result = await db.query(
      `UPDATE public.user_role
       SET userroledesc = $1,
           updatedat = NOW()
       WHERE userid = $2 AND userrolesid = $3
       RETURNING *`,
      [userroledesc, userid, userrolesid]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User role not found' });
    }

    return res.status(200).json({ message: 'User role updated', role: result.rows[0] });
  } catch (err) {
    console.error('Error updating user role:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ DELETE a user role by user ID and role ID
router.delete('/:userid/:userrolesid', async (req, res) => {
  const { userid, userrolesid } = req.params;

  try {
    const result = await db.query(
      `DELETE FROM public.user_role
       WHERE userid = $1 AND userrolesid = $2
       RETURNING *`,
      [userid, userrolesid]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User role not found' });
    }

    return res.status(200).json({ message: 'User role deleted', role: result.rows[0] });
  } catch (err) {
    console.error('Error deleting user role:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
