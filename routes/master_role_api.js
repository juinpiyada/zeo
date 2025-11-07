const express = require('express');
const router = express.Router();
const db = require('../config/db_conn'); // ✅ your PostgreSQL client setup
const cors = require('cors');

// ✅ Enable CORS for all routes
router.use(cors());

// ✅ GET all roles
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM public.master_role ORDER BY createdat DESC');
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error fetching roles:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ POST: create a new role
router.post('/', async (req, res) => {
  const { role_ID, role_DESC } = req.body;

  try {
    const createdat = new Date();
    const updatedat = new Date();
    await db.query(
      `INSERT INTO public.master_role (role_ID, role_DESC, createdat, updatedat) 
       VALUES ($1, $2, $3, $4)`,
      [role_ID, role_DESC, createdat, updatedat]
    );
    res.status(201).json({ message: 'Role created successfully' });
  } catch (err) {
    console.error('Error creating role:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ PUT: update role by ID
router.put('/:role_ID', async (req, res) => {
  const { role_ID } = req.params;
  const { role_DESC } = req.body;

  try {
    const updatedat = new Date();
    await db.query(
      `UPDATE public.master_role SET role_DESC = $1, updatedat = $2 WHERE role_ID = $3`,
      [role_DESC, updatedat, role_ID]
    );
    res.status(200).json({ message: 'Role updated successfully' });
  } catch (err) {
    console.error('Error updating role:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ DELETE: remove role by ID
router.delete('/:role_ID', async (req, res) => {
  const { role_ID } = req.params;

  try {
    await db.query('DELETE FROM public.master_role WHERE role_ID = $1', [role_ID]);
    res.status(200).json({ message: 'Role deleted successfully' });
  } catch (err) {
    console.error('Error deleting role:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;