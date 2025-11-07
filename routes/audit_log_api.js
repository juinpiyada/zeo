// ================================================
// Audit Log API for SMS System
// ================================================
// Administrative endpoints for viewing and managing audit logs

const express = require('express');
const router = express.Router();
const db = require('../config/db_conn');
const { auditLogger, EVENT_TYPES } = require('../utils/auditLogger');

// ================================================
// Middleware for basic admin authorization
// (You may want to enhance this with proper JWT/session validation)
// ================================================
const requireAdmin = (req, res, next) => {
  // Simple header-based check - replace with proper authentication
  const userRole = req.headers['x-user-role'];
  const userId = req.headers['x-user-id'];
  
  if (!userRole || !userRole.includes('SMS_SUPERADM')) {
    return res.status(403).json({ error: 'Administrative access required' });
  }
  
  req.adminUser = userId;
  next();
};

// ================================================
// GET /audit-logs - Retrieve audit logs with filtering
// ================================================
router.get('/', requireAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      event_type,
      userid,
      success,
      start_date,
      end_date,
      ip_address,
      risk_score_min,
      search
    } = req.query;

    // Validate pagination parameters
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(500, Math.max(1, parseInt(limit))); // Cap at 500
    const offset = (pageNum - 1) * limitNum;

    // Build WHERE clause dynamically
    const conditions = [];
    const values = [];
    let paramCount = 0;

    if (event_type) {
      paramCount++;
      conditions.push(`event_type = $${paramCount}`);
      values.push(event_type);
    }

    if (userid) {
      paramCount++;
      conditions.push(`(userid ILIKE $${paramCount} OR attempted_userid ILIKE $${paramCount})`);
      values.push(`%${userid}%`);
    }

    if (success !== undefined) {
      paramCount++;
      conditions.push(`success = $${paramCount}`);
      values.push(success === 'true');
    }

    if (start_date) {
      paramCount++;
      conditions.push(`event_timestamp >= $${paramCount}`);
      values.push(new Date(start_date));
    }

    if (end_date) {
      paramCount++;
      conditions.push(`event_timestamp <= $${paramCount}`);
      values.push(new Date(end_date));
    }

    if (ip_address) {
      paramCount++;
      conditions.push(`ip_address::text ILIKE $${paramCount}`);
      values.push(`%${ip_address}%`);
    }

    if (risk_score_min) {
      paramCount++;
      conditions.push(`risk_score >= $${paramCount}`);
      values.push(parseInt(risk_score_min));
    }

    if (search) {
      paramCount++;
      conditions.push(`(
        event_description ILIKE $${paramCount} OR 
        userid ILIKE $${paramCount} OR 
        attempted_userid ILIKE $${paramCount} OR
        error_message ILIKE $${paramCount} OR
        user_agent ILIKE $${paramCount}
      )`);
      values.push(`%${search}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count for pagination
    const countQuery = `SELECT COUNT(*) FROM public.audit_log ${whereClause}`;
    const countResult = await db.query(countQuery, values);
    const totalRecords = parseInt(countResult.rows[0].count);

    // Get the actual records
    paramCount++;
    const dataQuery = `
      SELECT 
        id, event_type, event_category, event_description,
        userid, attempted_userid, user_roles,
        session_id, ip_address, user_agent, request_method, request_path,
        success, error_code, error_message,
        risk_score, server_name, application_version,
        event_timestamp, created_at
      FROM public.audit_log 
      ${whereClause}
      ORDER BY event_timestamp DESC 
      LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    
    values.push(limitNum, offset);
    
    const dataResult = await db.query(dataQuery, values);

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalRecords / limitNum);
    
    res.json({
      success: true,
      data: dataResult.rows,
      pagination: {
        current_page: pageNum,
        per_page: limitNum,
        total_records: totalRecords,
        total_pages: totalPages,
        has_next: pageNum < totalPages,
        has_previous: pageNum > 1
      },
      filters_applied: {
        event_type,
        userid,
        success,
        start_date,
        end_date,
        ip_address,
        risk_score_min,
        search
      }
    });

  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to retrieve audit logs',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// ================================================
// GET /audit-logs/summary - Get summary statistics
// ================================================
router.get('/summary', requireAdmin, async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const daysNum = Math.min(365, Math.max(1, parseInt(days))); // Limit to 1 year

    const summaryQuery = `
      SELECT 
        COUNT(*) as total_events,
        COUNT(CASE WHEN success = true THEN 1 END) as successful_events,
        COUNT(CASE WHEN success = false THEN 1 END) as failed_events,
        COUNT(CASE WHEN event_type = 'LOGIN_SUCCESS' THEN 1 END) as successful_logins,
        COUNT(CASE WHEN event_type = 'LOGIN_FAILED' THEN 1 END) as failed_logins,
        COUNT(DISTINCT userid) as unique_users,
        COUNT(DISTINCT ip_address) as unique_ips,
        AVG(risk_score) as avg_risk_score,
        MAX(risk_score) as max_risk_score,
        COUNT(CASE WHEN risk_score > 50 THEN 1 END) as high_risk_events
      FROM public.audit_log 
      WHERE event_timestamp >= NOW() - INTERVAL '${daysNum} days'`;

    const summaryResult = await db.query(summaryQuery);

    // Get event type breakdown
    const eventTypesQuery = `
      SELECT event_type, COUNT(*) as count
      FROM public.audit_log 
      WHERE event_timestamp >= NOW() - INTERVAL '${daysNum} days'
      GROUP BY event_type 
      ORDER BY count DESC`;

    const eventTypesResult = await db.query(eventTypesQuery);

    // Get top IPs with failed attempts
    const topFailedIPsQuery = `
      SELECT ip_address, COUNT(*) as failed_attempts
      FROM public.audit_log 
      WHERE event_timestamp >= NOW() - INTERVAL '${daysNum} days'
        AND success = false
        AND ip_address IS NOT NULL
      GROUP BY ip_address 
      ORDER BY failed_attempts DESC 
      LIMIT 10`;

    const topFailedIPsResult = await db.query(topFailedIPsQuery);

    // Get recent high-risk events
    const highRiskQuery = `
      SELECT event_type, attempted_userid, ip_address, risk_score, event_timestamp
      FROM public.audit_log 
      WHERE event_timestamp >= NOW() - INTERVAL '${daysNum} days'
        AND risk_score > 30
      ORDER BY risk_score DESC, event_timestamp DESC 
      LIMIT 10`;

    const highRiskResult = await db.query(highRiskQuery);

    res.json({
      success: true,
      summary: summaryResult.rows[0],
      event_types: eventTypesResult.rows,
      top_failed_ips: topFailedIPsResult.rows,
      high_risk_events: highRiskResult.rows,
      analysis_period_days: daysNum
    });

  } catch (error) {
    console.error('Error generating audit log summary:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to generate summary',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// ================================================
// GET /audit-logs/user/:userid - Get logs for specific user
// ================================================
router.get('/user/:userid', requireAdmin, async (req, res) => {
  try {
    const { userid } = req.params;
    const { limit = 100, days = 30 } = req.query;
    
    const limitNum = Math.min(500, Math.max(1, parseInt(limit)));
    const daysNum = Math.min(365, Math.max(1, parseInt(days)));

    const query = `
      SELECT 
        id, event_type, event_category, event_description,
        userid, attempted_userid, success, error_message,
        ip_address, user_agent, risk_score,
        event_timestamp
      FROM public.audit_log 
      WHERE (userid = $1 OR attempted_userid = $1)
        AND event_timestamp >= NOW() - INTERVAL '${daysNum} days'
      ORDER BY event_timestamp DESC 
      LIMIT $2`;

    const result = await db.query(query, [userid, limitNum]);

    // Get user summary
    const summaryQuery = `
      SELECT 
        COUNT(*) as total_events,
        COUNT(CASE WHEN success = true THEN 1 END) as successful_events,
        COUNT(CASE WHEN success = false THEN 1 END) as failed_events,
        AVG(risk_score) as avg_risk_score,
        MAX(event_timestamp) as last_activity,
        COUNT(DISTINCT ip_address) as unique_ips
      FROM public.audit_log 
      WHERE (userid = $1 OR attempted_userid = $1)
        AND event_timestamp >= NOW() - INTERVAL '${daysNum} days'`;

    const summaryResult = await db.query(summaryQuery, [userid]);

    res.json({
      success: true,
      userid: userid,
      events: result.rows,
      summary: summaryResult.rows[0],
      analysis_period_days: daysNum
    });

  } catch (error) {
    console.error('Error fetching user audit logs:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to retrieve user audit logs',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// ================================================
// POST /audit-logs/cleanup - Clean up old audit logs
// ================================================
router.post('/cleanup', requireAdmin, async (req, res) => {
  try {
    const { days = 365 } = req.body;
    const daysNum = Math.max(30, parseInt(days)); // Minimum 30 days retention

    // Log the cleanup action
    await auditLogger.log({
      event_type: 'AUDIT_CLEANUP',
      event_category: 'SYSTEM',
      event_description: `Audit log cleanup initiated by ${req.adminUser}`,
      userid: req.adminUser,
      success: true,
      additional_data: { retention_days: daysNum }
    }, req);

    const deleteQuery = `
      DELETE FROM public.audit_log 
      WHERE event_timestamp < NOW() - INTERVAL '${daysNum} days'`;

    const result = await db.query(deleteQuery);

    res.json({
      success: true,
      message: `Cleaned up audit logs older than ${daysNum} days`,
      deleted_records: result.rowCount,
      retention_days: daysNum
    });

  } catch (error) {
    console.error('Error cleaning up audit logs:', error);
    
    // Log the failed cleanup
    await auditLogger.log({
      event_type: 'AUDIT_CLEANUP',
      event_category: 'SYSTEM',
      event_description: `Audit log cleanup failed`,
      userid: req.adminUser,
      success: false,
      error_message: error.message
    }, req);

    res.status(500).json({ 
      success: false,
      error: 'Failed to cleanup audit logs',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// ================================================
// GET /audit-logs/export - Export audit logs (CSV format)
// ================================================
router.get('/export', requireAdmin, async (req, res) => {
  try {
    const { start_date, end_date, event_type } = req.query;

    let whereConditions = [];
    let values = [];
    let paramCount = 0;

    if (start_date) {
      paramCount++;
      whereConditions.push(`event_timestamp >= $${paramCount}`);
      values.push(new Date(start_date));
    }

    if (end_date) {
      paramCount++;
      whereConditions.push(`event_timestamp <= $${paramCount}`);
      values.push(new Date(end_date));
    }

    if (event_type) {
      paramCount++;
      whereConditions.push(`event_type = $${paramCount}`);
      values.push(event_type);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const query = `
      SELECT 
        event_timestamp,
        event_type,
        userid,
        attempted_userid,
        success,
        ip_address,
        user_agent,
        error_message,
        risk_score,
        event_description
      FROM public.audit_log 
      ${whereClause}
      ORDER BY event_timestamp DESC 
      LIMIT 10000`; // Limit for performance

    const result = await db.query(query, values);

    // Log the export action
    await auditLogger.log({
      event_type: 'AUDIT_EXPORT',
      event_category: 'SYSTEM',
      event_description: `Audit logs exported by ${req.adminUser}`,
      userid: req.adminUser,
      success: true,
      additional_data: { 
        exported_records: result.rowCount,
        filters: { start_date, end_date, event_type }
      }
    }, req);

    // Convert to CSV format
    if (result.rows.length === 0) {
      return res.json({ success: true, message: 'No records found for export', data: [] });
    }

    const headers = Object.keys(result.rows[0]);
    const csvContent = [
      headers.join(','),
      ...result.rows.map(row => 
        headers.map(header => {
          const value = row[header];
          // Escape CSV values properly
          if (value === null || value === undefined) return '';
          const stringValue = String(value);
          if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
            return `"${stringValue.replace(/"/g, '""')}"`;
          }
          return stringValue;
        }).join(',')
      )
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="audit_logs_${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csvContent);

  } catch (error) {
    console.error('Error exporting audit logs:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to export audit logs',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;
