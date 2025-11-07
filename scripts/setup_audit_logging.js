// ================================================
// Audit Logging Setup Script
// ================================================
// Run this script to set up the audit logging system

const db = require('../config/db_conn');
const fs = require('fs');
const path = require('path');

async function setupAuditLogging() {
  console.log('🚀 Setting up audit logging system...\n');

  try {
    // 1. Create audit_log table
    console.log('📋 Creating audit_log table...');
    const sqlPath = path.join(__dirname, '..', 'sql', 'create_audit_log_table.sql');
    
    if (!fs.existsSync(sqlPath)) {
      throw new Error(`SQL file not found at: ${sqlPath}`);
    }

    const sql = fs.readFileSync(sqlPath, 'utf8');
    await db.query(sql);
    console.log('✅ Audit log table created successfully');

    // 2. Test database connection and table structure
    console.log('\n📊 Verifying table structure...');
    const tableCheck = await db.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'audit_log' AND table_schema = 'public'
      ORDER BY ordinal_position
    `);
    
    if (tableCheck.rowCount === 0) {
      throw new Error('Audit log table was not created properly');
    }

    console.log(`✅ Table verified with ${tableCheck.rowCount} columns:`);
    tableCheck.rows.forEach(row => {
      console.log(`   - ${row.column_name} (${row.data_type}) ${row.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
    });

    // 3. Test audit logger utility
    console.log('\n🧪 Testing audit logger utility...');
    const { auditLogger } = require('../utils/auditLogger');

    // Test a sample audit log entry
    const testEntry = await auditLogger.log({
      event_type: 'SYSTEM_SETUP',
      event_category: 'SYSTEM',
      event_description: 'Audit logging system setup completed',
      userid: 'system',
      success: true,
      additional_data: { 
        setup_timestamp: new Date().toISOString(),
        version: '1.0.0'
      }
    });

    if (testEntry) {
      console.log(`✅ Test audit entry created with ID: ${testEntry.id}`);
    } else {
      console.log('⚠️ Test audit entry creation returned null');
    }

    // 4. Verify the test entry was saved
    console.log('\n🔍 Verifying test entry in database...');
    const verifyResult = await db.query(
      'SELECT * FROM public.audit_log WHERE event_type = $1 ORDER BY created_at DESC LIMIT 1',
      ['SYSTEM_SETUP']
    );

    if (verifyResult.rowCount > 0) {
      const entry = verifyResult.rows[0];
      console.log('✅ Test entry verified in database:');
      console.log(`   - ID: ${entry.id}`);
      console.log(`   - Event: ${entry.event_type}`);
      console.log(`   - Description: ${entry.event_description}`);
      console.log(`   - Success: ${entry.success}`);
      console.log(`   - Risk Score: ${entry.risk_score}`);
      console.log(`   - Timestamp: ${entry.event_timestamp}`);
    } else {
      console.log('⚠️ Test entry not found in database');
    }

    // 5. Test different types of audit events
    console.log('\n🎭 Testing various audit event types...');
    
    // Test successful login
    await auditLogger.loginSuccess('test_user', ['USER'], null, { 
      test_type: 'setup_verification' 
    });
    
    // Test failed login
    await auditLogger.loginFailed('nonexistent_user', 'Test failed login', null, { 
      test_type: 'setup_verification' 
    });

    console.log('✅ Various audit event types tested');

    // 6. Check total audit log entries
    console.log('\n📈 Checking audit log statistics...');
    const statsResult = await db.query(`
      SELECT 
        COUNT(*) as total_entries,
        COUNT(CASE WHEN success = true THEN 1 END) as successful_events,
        COUNT(CASE WHEN success = false THEN 1 END) as failed_events,
        COUNT(DISTINCT event_type) as unique_event_types,
        MIN(event_timestamp) as earliest_entry,
        MAX(event_timestamp) as latest_entry
      FROM public.audit_log
    `);

    const stats = statsResult.rows[0];
    console.log('📊 Audit Log Statistics:');
    console.log(`   - Total entries: ${stats.total_entries}`);
    console.log(`   - Successful events: ${stats.successful_events}`);
    console.log(`   - Failed events: ${stats.failed_events}`);
    console.log(`   - Unique event types: ${stats.unique_event_types}`);
    console.log(`   - Earliest entry: ${stats.earliest_entry}`);
    console.log(`   - Latest entry: ${stats.latest_entry}`);

    // 7. Show setup completion
    console.log('\n🎉 Audit logging system setup completed successfully!');
    console.log('\n📝 Next steps:');
    console.log('   1. Add audit log API routes to your main app.js');
    console.log('   2. The login route already includes audit logging');
    console.log('   3. Review the audit logs via the API endpoints');
    console.log('   4. Configure log retention and cleanup policies');
    console.log('\n🔗 API Endpoints available:');
    console.log('   - GET /api/audit-logs - View audit logs');
    console.log('   - GET /api/audit-logs/summary - Get statistics');
    console.log('   - GET /api/audit-logs/user/:userid - User-specific logs');
    console.log('   - GET /api/audit-logs/export - Export logs to CSV');
    console.log('   - POST /api/audit-logs/cleanup - Clean old logs');

  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    if (process.env.NODE_ENV === 'development') {
      console.error('Stack trace:', error.stack);
    }
    process.exit(1);
  } finally {
    // Close database connection
    if (db && db.end) {
      await db.end();
    }
  }
}

// Run the setup
if (require.main === module) {
  setupAuditLogging().then(() => {
    console.log('\n✨ Setup script completed');
    process.exit(0);
  });
}

module.exports = { setupAuditLogging };
