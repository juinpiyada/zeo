const express = require('express');
const cors = require('cors');
const pool = require('../config/db_conn'); // PostgreSQL Pool

const router = express.Router();

router.use(cors());
router.use(express.json());

// Helper to validate and parse dates
const isValidDate = (val) => {
  const date = new Date(val);
  return !isNaN(date.getTime()) ? date : null;
};

/**
 * Add a new menu item
 */
router.post('/', async (req, res) => {
  try {
    const { menuid, menurole, menudesc, menulink, createdat, updatedat } = req.body;

    const now = new Date();

    const result = await pool.query(`
      INSERT INTO public.menu_master (
        menuid, menurole, menudesc, menulink,
        createdat, updatedat
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6
      ) RETURNING menuid
    `, [
      menuid,
      menurole || null,
      menudesc || null,
      menulink || null,
      createdat || now,
      updatedat || now
    ]);

    res.status(201).json({ message: 'Menu item added successfully', menuid: result.rows[0].menuid });
  } catch (err) {
    console.error('Error adding menu item:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * Update an existing menu item
 */
router.put('/:menuid', async (req, res) => {
  const { menuid } = req.params;
  const { menurole, menudesc, menulink, updatedat } = req.body;

  const updatedAt = updatedat || new Date();

  try {
    const result = await pool.query(`
      UPDATE public.menu_master SET
        menurole = $1,
        menudesc = $2,
        menulink = $3,
        updatedat = $4
      WHERE menuid = $5
      RETURNING *`,
      [menurole, menudesc, menulink, updatedAt, menuid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Menu item not found' });
    }

    res.json({ message: 'Menu item updated successfully', menu: result.rows[0] });
  } catch (err) {
    console.error('Update Menu Item Error:', err);
    res.status(500).json({ error: 'Failed to update menu item' });
  }
});

/**
 * Delete a menu item
 */
router.delete('/:menuid', async (req, res) => {
  const { menuid } = req.params;

  try {
    const result = await pool.query(
      'DELETE FROM public.menu_master WHERE menuid = $1 RETURNING *',
      [menuid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Menu item not found' });
    }

    res.json({ message: 'Menu item deleted successfully', menu: result.rows[0] });
  } catch (err) {
    console.error('Delete Menu Item Error:', err);
    res.status(500).json({ error: 'Failed to delete menu item' });
  }
});

/**
 * Get all menu items
 */
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM public.menu_master ORDER BY createdat DESC');
    res.json({ menu: result.rows });
  } catch (err) {
    console.error('Fetch Menu Items Error:', err);
    res.status(500).json({ error: 'Failed to fetch menu items' });
  }
});

/**
 * Get menu item by ID
 */
router.get('/:menuid', async (req, res) => {
  const { menuid } = req.params;

  try {
    const result = await pool.query(
      'SELECT * FROM public.menu_master WHERE menuid = $1',
      [menuid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Menu item not found' });
    }

    res.json({ menu: result.rows[0] });
  } catch (err) {
    console.error('Fetch Menu Item Error:', err);
    res.status(500).json({ error: 'Failed to fetch menu item' });
  }
});

module.exports = router;