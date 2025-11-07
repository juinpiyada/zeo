const express = require('express');
const router = express.Router();
const db = require('../config/db_conn');

// ✅ GET all users
router.get('/users', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM public.master_user ORDER BY createdat DESC');
    res.status(200).json({ users: result.rows });
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ GET userid list (for dropdown or simple display)
router.get('/users/id-list', async (req, res) => {
  try {
    const result = await db.query('SELECT userid FROM public.master_user');
    res.status(200).json({ users: result.rows });
  } catch (err) {
    console.error('Error fetching user IDs:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ POST: Add a new user
router.post('/users', async (req, res) => {
  const {
    userid,
    userpwd,
    userroles,
    usercreated,
    userlastlogon,
    useractive
  } = req.body;

  if (!userid || !userpwd) {
    return res.status(400).json({ error: 'User ID and Password are required' });
  }

  try {
    const result = await db.query(
      `INSERT INTO public.master_user (
        userid, userpwd, userroles, usercreated, userlastlogon,
        useractive, createdat, updatedat
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      RETURNING userid`,
      [
        userid,
        userpwd,
        userroles || 'user',
        usercreated || new Date().toISOString(),
        userlastlogon || new Date().toISOString(),
        useractive === true || useractive === 'true'
      ]
    );

    res.status(201).json({ message: 'User added successfully', userid: result.rows[0].userid });
  } catch (err) {
    console.error('Error adding user:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ PUT: Update user
router.put('/users/:userid', async (req, res) => {
  const { userid } = req.params;
  const {
    userpwd,
    userroles,
    usercreated,
    userlastlogon,
    useractive
  } = req.body;

  try {
    const result = await db.query(
      `UPDATE public.master_user SET
        userpwd = $1,
        userroles = $2,
        usercreated = $3,
        userlastlogon = $4,
        useractive = $5,
        updatedat = NOW()
      WHERE userid = $6
      RETURNING userid`,
      [
        userpwd,
        userroles || 'user',
        usercreated || new Date().toISOString(),
        userlastlogon || new Date().toISOString(),
        useractive === true || useractive === 'true',
        userid
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(200).json({ message: 'User updated successfully', userid: result.rows[0].userid });
  } catch (err) {
    console.error('Error updating user:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ DELETE user
router.delete('/users/:userid', async (req, res) => {
  const { userid } = req.params;

  try {
    const result = await db.query(
      'DELETE FROM public.master_user WHERE userid = $1 RETURNING userid',
      [userid]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(200).json({ message: 'User deleted successfully', userid: result.rows[0].userid });
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;