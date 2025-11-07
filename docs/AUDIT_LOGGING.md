# SMS Audit Logging System

## Overview

The SMS audit logging system provides comprehensive tracking of security events, particularly login activities, to ensure system security and compliance. This system captures detailed information about user authentication attempts, successes, failures, and other security-relevant events.

## Features

- ✅ **Comprehensive Login Tracking**: All login attempts (successful and failed)
- ✅ **Risk Assessment**: Automatic risk scoring based on various factors
- ✅ **IP Address Tracking**: Client IP monitoring for security analysis
- ✅ **User Agent Analysis**: Browser/client information capture
- ✅ **Flexible Filtering**: Advanced search and filtering capabilities
- ✅ **Data Export**: CSV export functionality for external analysis
- ✅ **Admin APIs**: Complete administrative interface
- ✅ **Performance Optimized**: Indexed database design

## Database Schema

### audit_log Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | Primary key |
| `event_type` | VARCHAR(50) | Event type (LOGIN_SUCCESS, LOGIN_FAILED, etc.) |
| `event_category` | VARCHAR(20) | Category (AUTH, USER_MGMT, SYSTEM, etc.) |
| `event_description` | TEXT | Human-readable description |
| `userid` | VARCHAR(100) | Authenticated user ID |
| `attempted_userid` | VARCHAR(100) | User ID used in attempt |
| `user_roles` | VARCHAR(200) | User roles at time of event |
| `session_id` | VARCHAR(100) | Session identifier |
| `ip_address` | INET | Client IP address |
| `user_agent` | TEXT | Browser/client information |
| `request_method` | VARCHAR(10) | HTTP method |
| `request_path` | VARCHAR(200) | API endpoint path |
| `success` | BOOLEAN | Whether action succeeded |
| `error_code` | VARCHAR(50) | Error code if applicable |
| `error_message` | TEXT | Error details |
| `additional_data` | JSONB | Flexible additional context |
| `risk_score` | INTEGER | Calculated risk score (0-100) |
| `server_name` | VARCHAR(100) | Server handling request |
| `application_version` | VARCHAR(20) | Application version |
| `event_timestamp` | TIMESTAMPTZ | When event occurred |
| `created_at` | TIMESTAMPTZ | When record was created |

## Event Types

### Authentication Events
- `LOGIN_SUCCESS` - Successful login
- `LOGIN_FAILED` - Failed login attempt
- `LOGIN_LOCKED` - Account locked due to failures
- `LOGOUT` - User logout
- `SESSION_EXPIRED` - Session timeout

### Account Management
- `PASSWORD_CHANGE` - Password changed
- `PASSWORD_RESET` - Password reset
- `ACCOUNT_CREATED` - New user account
- `ACCOUNT_DISABLED` - Account disabled
- `ACCOUNT_ENABLED` - Account enabled
- `ROLE_CHANGED` - User roles modified

### System Events
- `SUSPICIOUS_ACTIVITY` - Suspicious behavior detected
- `AUDIT_CLEANUP` - Audit log cleanup
- `AUDIT_EXPORT` - Audit log export

## Risk Scoring

The system automatically calculates risk scores based on:

| Factor | Points | Description |
|--------|---------|-------------|
| Failed Login | 10 | Each failed login attempt |
| Multiple Failures | 20 | Multiple consecutive failures |
| Unusual IP | 15 | Login from new/suspicious IP |
| Unusual Hours | 5 | Access outside business hours (6 AM - 10 PM) |
| Admin Access | 5 | Administrative role access |
| Suspicious User Agent | 10 | Bot/crawler detection |

Risk scores are capped at 100 points maximum.

## API Endpoints

### Authentication Required
All audit log endpoints require administrative privileges. Include these headers:
```
x-user-role: SMS_SUPERADM
x-user-id: your-admin-userid
```

### GET /api/audit-logs
Retrieve audit logs with filtering options.

**Query Parameters:**
- `page` (default: 1) - Page number
- `limit` (default: 50) - Records per page (max 500)
- `event_type` - Filter by event type
- `userid` - Filter by user ID (partial match)
- `success` - Filter by success status (true/false)
- `start_date` - Filter from date (ISO format)
- `end_date` - Filter to date (ISO format)
- `ip_address` - Filter by IP address
- `risk_score_min` - Minimum risk score
- `search` - General search across multiple fields

**Example:**
```bash
GET /api/audit-logs?event_type=LOGIN_FAILED&risk_score_min=20&page=1&limit=25
```

### GET /api/audit-logs/summary
Get summary statistics and analysis.

**Query Parameters:**
- `days` (default: 7) - Analysis period in days (max 365)

**Response includes:**
- Total events count
- Success/failure breakdown
- Unique users and IPs
- Risk score statistics
- Event type breakdown
- Top failed IPs
- Recent high-risk events

### GET /api/audit-logs/user/:userid
Get audit logs for a specific user.

**Query Parameters:**
- `limit` (default: 100) - Max records (max 500)
- `days` (default: 30) - Analysis period (max 365)

### GET /api/audit-logs/export
Export audit logs in CSV format.

**Query Parameters:**
- `start_date` - Export from date
- `end_date` - Export to date
- `event_type` - Filter by event type

**Returns:** CSV file download

### POST /api/audit-logs/cleanup
Clean up old audit logs (admin only).

**Body:**
```json
{
  "days": 365
}
```

**Note:** Minimum retention is 30 days.

## Usage Examples

### 1. Track Login Attempts
```javascript
const { auditLogger } = require('../utils/auditLogger');

// Successful login
await auditLogger.loginSuccess('user123', ['USER'], req, {
  login_method: 'password',
  remember_me: true
});

// Failed login
await auditLogger.loginFailed('user123', 'Invalid password', req, {
  attempt_number: 3,
  account_exists: true
});
```

### 2. Custom Audit Events
```javascript
await auditLogger.log({
  event_type: 'DATA_EXPORT',
  event_category: 'DATA_CHANGE',
  event_description: 'User exported student data',
  userid: 'admin123',
  success: true,
  additional_data: {
    export_type: 'student_records',
    record_count: 150,
    department: 'CS'
  }
}, req);
```

### 3. Query Audit Logs
```bash
# Get all failed logins in last 24 hours
curl -H "x-user-role: SMS_SUPERADM" -H "x-user-id: admin" \
  "https://devcms.aimtechcampus.com/api/audit-logs?event_type=LOGIN_FAILED&start_date=2024-01-10T00:00:00Z"

# Get high-risk events
curl -H "x-user-role: SMS_SUPERADM" -H "x-user-id: admin" \
  "https://devcms.aimtechcampus.com/api/audit-logs?risk_score_min=30"

# Get summary for last week
curl -H "x-user-role: SMS_SUPERADM" -H "x-user-id: admin" \
  "https://devcms.aimtechcampus.com/api/audit-logs/summary?days=7"

```

## Setup Instructions

### 1. Run Database Setup
```bash
# Execute the SQL script to create tables
node scripts/setup_audit_logging.js
```

### 2. Add Routes to Your App
```javascript
// In your main app.js or server.js
const auditLogRoutes = require('./routes/audit_log_api');
app.use('/api/audit-logs', auditLogRoutes);
```

### 3. Verify Installation
The setup script will automatically test the system and provide verification.

## Security Considerations

1. **Access Control**: Audit log APIs require administrative privileges
2. **Data Retention**: Implement regular cleanup policies
3. **Performance**: Queries are optimized with indexes
4. **Privacy**: Consider data retention laws and privacy requirements
5. **Monitoring**: Set up alerts for high-risk events

## Performance Optimization

### Indexes Created
- `idx_audit_log_userid_timestamp` - User-based queries
- `idx_audit_log_event_type` - Event type filtering
- `idx_audit_log_failed_logins` - Failed login monitoring
- `idx_audit_log_ip_address` - IP-based analysis
- `idx_audit_log_risk_score` - Risk assessment queries

### Maintenance
- Regular cleanup of old records (recommended: 1 year retention)
- Monitor table size and performance
- Archive old data if needed for compliance

## Compliance Features

- **Audit Trail**: Complete record of authentication events
- **Data Integrity**: Immutable audit records
- **Access Logging**: Who accessed audit data and when
- **Export Capability**: Data export for compliance reporting
- **Time Tracking**: Precise timestamps for all events

## Troubleshooting

### Common Issues

1. **Permission Denied**
   - Ensure admin headers are set correctly
   - Verify user has SMS_SUPERADM role

2. **Database Connection**
   - Check database connectivity
   - Verify table exists: `\d audit_log`

3. **Performance Issues**
   - Check if indexes exist
   - Consider data retention cleanup
   - Monitor query execution plans

### Monitoring Queries

```sql
-- Check audit log size
SELECT 
  schemaname,
  tablename,
  attname,
  n_distinct,
  correlation
FROM pg_stats 
WHERE tablename = 'audit_log';

-- Monitor recent activity
SELECT 
  event_type,
  COUNT(*) as count,
  AVG(risk_score) as avg_risk
FROM audit_log 
WHERE event_timestamp >= NOW() - INTERVAL '24 hours'
GROUP BY event_type
ORDER BY count DESC;
```

## Integration Points

The audit logging system integrates with:
- Login authentication (`routes/user.js`)
- User management operations
- Administrative functions
- Security monitoring systems

## Future Enhancements

- Real-time alerting for high-risk events
- Machine learning-based anomaly detection
- Integration with SIEM systems
- Advanced reporting dashboards
- Automated incident response
