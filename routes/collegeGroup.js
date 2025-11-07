const express = require('express');
const router = express.Router();
const cors = require('cors');
const pool = require('../config/db_conn'); // PostgreSQL pool connection

// ✅ Add College Group
router.post('/add', async (req, res) => {
  const {
    groupid,
    groupdesc,
    groupcorporateaddress,
    groupcity,
    grouppin,
    groupcountry,
    groupemailid,
    grouprole,
    group_user_id,
  } = req.body;

  if (!groupid || !groupdesc) {
    return res.status(400).json({ error: 'groupid and groupdesc are required' });
  }

  const createdat = new Date();
  const updatedat = new Date();

  try {
    const result = await pool.query(
      `INSERT INTO public.master_college_group (
        groupid, groupdesc, groupcorporateaddress, groupcity, grouppin,
        groupcountry, groupemailid, grouprole, group_user_id, createdat, updatedat
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        groupid,
        groupdesc,
        groupcorporateaddress || null,
        groupcity || null,
        grouppin || null,
        groupcountry || null,
        groupemailid || null,
        grouprole || null,
        group_user_id || null,
        createdat,
        updatedat,
      ]
    );
    res.status(201).json({ message: 'Group added successfully', group: result.rows[0] });
  } catch (error) {
    console.error('Add Group Error:', error);
    res.status(500).json({ error: 'Failed to add college group' });
  }
});

// ✅ Update College Group
router.put('/update/:groupid', async (req, res) => {
  const { groupid } = req.params;

  const {
    groupdesc,
    groupcorporateaddress,
    groupcity,
    grouppin,
    groupcountry,
    groupemailid,
    grouprole,
    group_user_id
  } = req.body;

  if (!groupid || !groupdesc) {
    return res.status(400).json({ error: 'groupid and groupdesc are required' });
  }

  const updatedat = new Date();
  const createdat = new Date(); // Optional if not updating it – remove if not needed

  try {
    const result = await pool.query(
      `UPDATE public.master_college_group
       SET groupid = $1,
           groupdesc = $2,
           groupcorporateaddress = $3,
           groupcity = $4,
           grouppin = $5,
           groupcountry = $6,
           groupemailid = $7,
           grouprole = $8,
           group_user_id = $9,
           createdat = $10,
           updatedat = $11
       WHERE groupid = $1
       RETURNING *`,
      [
        groupid,
        groupdesc,
        groupcorporateaddress || null,
        groupcity || null,
        grouppin || null,
        groupcountry || null,
        groupemailid || null,
        grouprole || null,
        group_user_id || null,
        createdat,  // only include if your table expects it to be re-updated
        updatedat
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Group not found for update' });
    }

    res.status(200).json({ message: 'Group updated successfully', group: result.rows[0] });
  } catch (error) {
    console.error('Update Group Error:', error);
    res.status(500).json({ error: 'Failed to update college group' });
  }
});

// ✅ DELETE College Group by groupid
router.delete('/delete/:groupid', async (req, res) => {
  const { groupid } = req.params;

  if (!groupid) {
    return res.status(400).json({ error: 'Group ID is required in URL params' });
  }

  try {
    const result = await pool.query(
      `DELETE FROM public.master_college_group WHERE groupid = $1 RETURNING *`,
      [groupid]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: `Group with ID '${groupid}' not found` });
    }

    res.status(200).json({
      message: `Group '${groupid}' deleted successfully`,
      deletedGroup: result.rows[0]
    });
  } catch (error) {
    console.error('Delete Group Error:', error);
    res.status(500).json({ error: 'Failed to delete group' });
  }
});

// ✅ Get All Groups
router.get('/list', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM public.master_college_group ORDER BY createdat DESC');
    res.json({ groups: result.rows });
  } catch (error) {
    console.error('Fetch Groups Error:', error);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// ✅ Get All College Groups for Selector
router.get('/list', async (req, res) => {
  try {
    // Adjust query to ensure groupdesc is returned as groupname
    const result = await pool.query(
      'SELECT groupid, groupdesc AS groupname FROM public.master_college_group ORDER BY createdat DESC'
    );
    
    // Send the results in the response
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'No college groups found' });
    }
    
    res.json({ groups: result.rows }); // Return groupid and groupname (groupdesc)
  } catch (error) {
    console.error('Fetch Groups Error:', error);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});
// ✅ Get All College Groups with groupid, groupname, and group_user_id
router.get('/list', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
         groupid, 
         groupdesc AS groupname, 
         group_user_id 
       FROM public.master_college_group 
       ORDER BY createdat DESC`
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'No college groups found' });
    }

    res.json({ groups: result.rows }); // Now includes groupid, groupname, group_user_id
  } catch (error) {
    console.error('Fetch Groups Error:', error);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});


module.exports = router;
