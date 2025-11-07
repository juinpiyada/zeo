-- ================================================
-- Audit Log Table for SMS System
-- ================================================
-- This table tracks all security-related events, primarily login activities

CREATE TABLE IF NOT EXISTS public.audit_log (
    id SERIAL PRIMARY KEY,
    
    -- Event Details
    event_type VARCHAR(50) NOT NULL,           -- LOGIN_SUCCESS, LOGIN_FAILED, LOGOUT, PASSWORD_CHANGE, etc.
    event_category VARCHAR(20) DEFAULT 'AUTH', -- AUTH, USER_MGMT, DATA_CHANGE, SYSTEM, etc.
    event_description TEXT,                    -- Human readable description
    
    -- User Information
    userid VARCHAR(100),                       -- The user attempting the action (may be null for failed attempts)
    attempted_userid VARCHAR(100),             -- The userid used in the attempt (useful for failed logins)
    user_roles VARCHAR(200),                   -- User roles at time of event
    
    -- Session & Request Details
    session_id VARCHAR(100),                   -- Session identifier if available
    ip_address INET,                           -- Client IP address
    user_agent TEXT,                           -- Browser/client information
    request_method VARCHAR(10),                -- HTTP method (POST, GET, etc.)
    request_path VARCHAR(200),                 -- API endpoint path
    
    -- Result Information
    success BOOLEAN NOT NULL DEFAULT FALSE,    -- Whether the action succeeded
    error_code VARCHAR(50),                    -- Error code if applicable
    error_message TEXT,                        -- Error details if applicable
    
    -- Additional Context
    additional_data JSONB,                     -- Flexible field for extra context
    risk_score INTEGER DEFAULT 0,             -- Risk assessment score (0-100)
    
    -- Metadata
    server_name VARCHAR(100),                  -- Server handling the request
    application_version VARCHAR(20),           -- App version for tracking
    
    -- Timestamps
    event_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ================================================
-- Indexes for Performance
-- ================================================

-- Primary queries by user and time
CREATE INDEX IF NOT EXISTS idx_audit_log_userid_timestamp 
    ON public.audit_log (userid, event_timestamp DESC);

-- Event type filtering
CREATE INDEX IF NOT EXISTS idx_audit_log_event_type 
    ON public.audit_log (event_type, event_timestamp DESC);

-- Failed login monitoring
CREATE INDEX IF NOT EXISTS idx_audit_log_failed_logins 
    ON public.audit_log (attempted_userid, success, event_timestamp DESC) 
    WHERE event_type LIKE 'LOGIN_%';

-- IP address tracking for security monitoring
CREATE INDEX IF NOT EXISTS idx_audit_log_ip_address 
    ON public.audit_log (ip_address, event_timestamp DESC);

-- Risk monitoring
CREATE INDEX IF NOT EXISTS idx_audit_log_risk_score 
    ON public.audit_log (risk_score DESC, event_timestamp DESC) 
    WHERE risk_score > 0;

-- ================================================
-- Table Comments
-- ================================================

COMMENT ON TABLE public.audit_log IS 'Audit log for tracking security events, primarily authentication activities';
COMMENT ON COLUMN public.audit_log.event_type IS 'Type of event: LOGIN_SUCCESS, LOGIN_FAILED, LOGOUT, etc.';
COMMENT ON COLUMN public.audit_log.attempted_userid IS 'UserID used in login attempt (useful for tracking failed attempts)';
COMMENT ON COLUMN public.audit_log.risk_score IS 'Calculated risk score 0-100 based on various factors';
COMMENT ON COLUMN public.audit_log.additional_data IS 'JSON field for storing flexible additional context';

-- ================================================
-- Sample Event Types Reference
-- ================================================
/*
Common event_type values:
- LOGIN_SUCCESS: Successful login
- LOGIN_FAILED: Failed login attempt
- LOGIN_LOCKED: Account locked due to failed attempts
- LOGOUT: User logout
- SESSION_EXPIRED: Session timeout
- PASSWORD_CHANGE: Password was changed
- PASSWORD_RESET: Password reset requested/completed
- ACCOUNT_CREATED: New user account created
- ACCOUNT_DISABLED: User account disabled
- ACCOUNT_ENABLED: User account enabled
- ROLE_CHANGED: User roles modified
- SUSPICIOUS_ACTIVITY: Detected suspicious behavior
*/
