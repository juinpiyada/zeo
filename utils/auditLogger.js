// ================================================
// Audit Logger Utility for SMS System
// ================================================
// Centralized logging for security events and user activities

const db = require('../config/db_conn');
const os = require('os');

// Event types constants
const EVENT_TYPES = {
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGIN_LOCKED: 'LOGIN_LOCKED',
  LOGOUT: 'LOGOUT',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  PASSWORD_CHANGE: 'PASSWORD_CHANGE',
  PASSWORD_RESET: 'PASSWORD_RESET',
  ACCOUNT_CREATED: 'ACCOUNT_CREATED',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  ACCOUNT_ENABLED: 'ACCOUNT_ENABLED',
  ROLE_CHANGED: 'ROLE_CHANGED',
  SUSPICIOUS_ACTIVITY: 'SUSPICIOUS_ACTIVITY'
};

// Event categories
const EVENT_CATEGORIES = {
  AUTH: 'AUTH',
  USER_MGMT: 'USER_MGMT',
  DATA_CHANGE: 'DATA_CHANGE',
  SYSTEM: 'SYSTEM'
};

// Risk score calculation factors
const RISK_FACTORS = {
  FAILED_LOGIN: 10,
  MULTIPLE_FAILURES: 20,
  UNUSUAL_IP: 15,
  UNUSUAL_HOURS: 5,
  ADMIN_ACCESS: 5,
  SUSPICIOUS_USER_AGENT: 10
};

/**
 * Extract client information from Express request object
 * @param {Object} req - Express request object
 * @returns {Object} Extracted client information
 */
function extractClientInfo(req) {
  const clientIP = req.ip || 
                   req.connection?.remoteAddress || 
                   req.socket?.remoteAddress ||
                   req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
                   req.headers['x-real-ip'] ||
                   'unknown';

  const userAgent = req.headers['user-agent'] || 'unknown';
  const requestMethod = req.method || 'unknown';
  const requestPath = req.path || req.originalUrl || 'unknown';

  return {
    ip_address: clientIP,
    user_agent: userAgent,
    request_method: requestMethod,
    request_path: requestPath
  };
}

/**
 * Calculate risk score based on various factors
 * @param {Object} eventData - Event data to analyze
 * @returns {number} Risk score (0-100)
 */
function calculateRiskScore(eventData) {
  let score = 0;

  // Failed login attempts
  if (eventData.event_type === EVENT_TYPES.LOGIN_FAILED) {
    score += RISK_FACTORS.FAILED_LOGIN;
  }

  // Admin/privileged access
  if (eventData.user_roles && (
    eventData.user_roles.includes('SMS_SUPERADM') || 
    eventData.user_roles.includes('GRP_ADM')
  )) {
    score += RISK_FACTORS.ADMIN_ACCESS;
  }

  // Suspicious user agents (bots, scrapers, etc.)
  const userAgent = eventData.user_agent?.toLowerCase() || '';
  if (userAgent.includes('bot') || 
      userAgent.includes('crawler') || 
      userAgent.includes('spider') ||
      userAgent === 'unknown') {
    score += RISK_FACTORS.SUSPICIOUS_USER_AGENT;
  }

  // Time-based risk (outside business hours)
  const hour = new Date().getHours();
  if (hour < 6 || hour > 22) {
    score += RISK_FACTORS.UNUSUAL_HOURS;
  }

  return Math.min(score, 100); // Cap at 100
}

/**
 * Main audit logging function
 * @param {Object} auditData - Audit event data
 * @param {Object} req - Optional Express request object for client info
 * @returns {Promise<Object>} Created audit log entry
 */
async function logAuditEvent(auditData, req = null) {
  try {
    // Extract client information if request is provided
    const clientInfo = req ? extractClientInfo(req) : {};

    // Prepare the audit data with defaults
    const eventData = {
      event_type: auditData.event_type,
      event_category: auditData.event_category || EVENT_CATEGORIES.AUTH,
      event_description: auditData.event_description || `${auditData.event_type} event`,
      
      // User information
      userid: auditData.userid || null,
      attempted_userid: auditData.attempted_userid || auditData.userid || null,
      user_roles: Array.isArray(auditData.user_roles) 
        ? auditData.user_roles.join(',') 
        : (auditData.user_roles || null),
      
      // Request information
      session_id: auditData.session_id || null,
      ...clientInfo,
      
      // Result information
      success: auditData.success || false,
      error_code: auditData.error_code || null,
      error_message: auditData.error_message || null,
      
      // Additional context
      additional_data: auditData.additional_data ? JSON.stringify(auditData.additional_data) : null,
      
      // Metadata
      server_name: auditData.server_name || os.hostname(),
      application_version: auditData.application_version || process.env.APP_VERSION || '1.0.0',
      
      // Timestamp
      event_timestamp: auditData.event_timestamp || new Date()
    };

    // Calculate risk score
    eventData.risk_score = calculateRiskScore(eventData);

    // Insert into database
    const query = `
      INSERT INTO public.audit_log (
        event_type, event_category, event_description,
        userid, attempted_userid, user_roles,
        session_id, ip_address, user_agent, request_method, request_path,
        success, error_code, error_message,
        additional_data, risk_score,
        server_name, application_version,
        event_timestamp
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 
        $12, $13, $14, $15, $16, $17, $18, $19
      ) RETURNING id, event_timestamp`;

    const values = [
      eventData.event_type, eventData.event_category, eventData.event_description,
      eventData.userid, eventData.attempted_userid, eventData.user_roles,
      eventData.session_id, eventData.ip_address, eventData.user_agent, 
      eventData.request_method, eventData.request_path,
      eventData.success, eventData.error_code, eventData.error_message,
      eventData.additional_data, eventData.risk_score,
      eventData.server_name, eventData.application_version,
      eventData.event_timestamp
    ];

    console.log('🔧 DEBUG: Executing audit log query with values:', {
      event_type: eventData.event_type,
      attempted_userid: eventData.attempted_userid,
      success: eventData.success,
      ip_address: eventData.ip_address
    });
    
    const result = await db.query(query, values);
    
    console.log(`📋 Audit Log Created: ${eventData.event_type} - User: ${eventData.attempted_userid || 'unknown'} - Success: ${eventData.success} - Risk: ${eventData.risk_score} - DB ID: ${result.rows[0].id}`);
    
    return {
      id: result.rows[0].id,
      timestamp: result.rows[0].event_timestamp,
      ...eventData
    };

  } catch (error) {
    console.error('❌ Failed to create audit log entry:', {
      error: error.message,
      stack: error.stack,
      event_type: auditData.event_type,
      attempted_userid: auditData.attempted_userid || auditData.userid,
      database_connection: !!db
    });
    // Don't throw error to prevent breaking main application flow
    return null;
  }
}

/**
 * Convenience functions for common audit events
 */
const auditLogger = {
  // Generic audit logging
  log: logAuditEvent,

  // Login success
  loginSuccess: (userid, userRoles, req, additionalData = {}) => {
    return logAuditEvent({
      event_type: EVENT_TYPES.LOGIN_SUCCESS,
      event_category: EVENT_CATEGORIES.AUTH,
      event_description: `User ${userid} logged in successfully`,
      userid: userid,
      attempted_userid: userid,
      user_roles: userRoles,
      success: true,
      additional_data: additionalData
    }, req);
  },

  // Login failure
  loginFailed: (attemptedUserid, reason, req, additionalData = {}) => {
    return logAuditEvent({
      event_type: EVENT_TYPES.LOGIN_FAILED,
      event_category: EVENT_CATEGORIES.AUTH,
      event_description: `Failed login attempt for user ${attemptedUserid}: ${reason}`,
      attempted_userid: attemptedUserid,
      success: false,
      error_message: reason,
      additional_data: additionalData
    }, req);
  },

  // Logout
  logout: (userid, userRoles, req, additionalData = {}) => {
    return logAuditEvent({
      event_type: EVENT_TYPES.LOGOUT,
      event_category: EVENT_CATEGORIES.AUTH,
      event_description: `User ${userid} logged out`,
      userid: userid,
      user_roles: userRoles,
      success: true,
      additional_data: additionalData
    }, req);
  },

  // Account locked
  accountLocked: (userid, reason, req, additionalData = {}) => {
    return logAuditEvent({
      event_type: EVENT_TYPES.LOGIN_LOCKED,
      event_category: EVENT_CATEGORIES.AUTH,
      event_description: `Account ${userid} locked: ${reason}`,
      userid: userid,
      attempted_userid: userid,
      success: false,
      error_message: reason,
      additional_data: additionalData
    }, req);
  },

  // Suspicious activity
  suspiciousActivity: (userid, description, req, additionalData = {}) => {
    return logAuditEvent({
      event_type: EVENT_TYPES.SUSPICIOUS_ACTIVITY,
      event_category: EVENT_CATEGORIES.AUTH,
      event_description: description,
      userid: userid,
      success: false,
      error_message: 'Suspicious activity detected',
      additional_data: additionalData
    }, req);
  }
};

// Export constants and functions
module.exports = {
  auditLogger,
  EVENT_TYPES,
  EVENT_CATEGORIES,
  RISK_FACTORS
};
