const express = require('express');
const router = express.Router();
const db = require('../config/db_conn');

// ✅ GET all devices
router.get('/devices', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM public.sms_device ORDER BY userid ASC');
    res.status(200).json({ devices: result.rows });
  } catch (err) {
    console.error('Error fetching devices:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ GET userid list (for dropdown or mapping)
router.get('/devices/userid-list', async (req, res) => {
  try {
    const result = await db.query('SELECT userid FROM public.sms_device');
    res.status(200).json({ userids: result.rows });
  } catch (err) {
    console.error('Error fetching user IDs:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ POST: Add a new device
router.post('/devices', async (req, res) => {
  const { device_id, mobile_number, userid } = req.body;

  if (!device_id || !mobile_number || !userid) {
    return res.status(400).json({ error: 'Device ID, Mobile Number, and User ID are required' });
  }

  try {
    const result = await db.query(
      `INSERT INTO public.sms_device (device_id, mobile_number, userid)
       VALUES ($1, $2, $3)
       RETURNING userid`,
      [device_id, mobile_number, userid]
    );

    res.status(201).json({ message: 'Device added successfully', userid: result.rows[0].userid });
  } catch (err) {
    console.error('Error adding device:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ PUT: Update device by userid
router.put('/devices/:userid', async (req, res) => {
  const { userid } = req.params;
  const { device_id, mobile_number } = req.body;

  try {
    const result = await db.query(
      `UPDATE public.sms_device
       SET device_id = $1, mobile_number = $2
       WHERE userid = $3
       RETURNING userid`,
      [device_id, mobile_number, userid]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }

    res.status(200).json({ message: 'Device updated successfully', userid: result.rows[0].userid });
  } catch (err) {
    console.error('Error updating device:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ DELETE device by userid
router.delete('/devices/:userid', async (req, res) => {
  const { userid } = req.params;

  try {
    const result = await db.query(
      'DELETE FROM public.sms_device WHERE userid = $1 RETURNING userid',
      [userid]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }

    res.status(200).json({ message: 'Device deleted successfully', userid: result.rows[0].userid });
  } catch (err) {
    console.error('Error deleting device:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;