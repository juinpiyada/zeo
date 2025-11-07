// ================================================
// Test Audit Logging During Login
// ================================================
// This script tests the audit logging functionality by making actual login requests

const axios = require('axios');
const db = require('../config/db_conn');

// 🔁 Use the deployed base URL
const BASE_URL = 'https://devcms.aimtechcampus.com';

async function testAuditLogging() {
    console.log('🧪 Testing Audit Logging During Login...\n');

    try {
        // 1. Check initial audit log count
        console.log('📊 Checking initial audit log count...');
        const initialCount = await db.query('SELECT COUNT(*) as count FROM audit_log WHERE event_type LIKE \'LOGIN_%\'');
        console.log(`   Initial login-related audit entries: ${initialCount.rows[0].count}`);

        // 2. Test failed login - invalid credentials
        console.log('\n❌ Testing failed login (invalid credentials)...');
        try {
            await axios.post(`${BASE_URL}/login/`, {
                username: 'nonexistent_user',
                password: 'wrong_password'
            });
        } catch (error) {
            console.log(`   Expected error: ${error.response.status} - ${error.response.data.error}`);
        }

        // 3. Test failed login - missing credentials
        console.log('\n❌ Testing failed login (missing credentials)...');
        try {
            await axios.post(`${BASE_URL}/login/`, {
                username: 'test_user',
                // missing password
            });
        } catch (error) {
            console.log(`   Expected error: ${error.response.status} - ${error.response.data.error}`);
        }

        // 4. Check if audit logs were created
        console.log('\n📋 Checking audit logs after failed attempts...');
        const afterFailedCount = await db.query('SELECT COUNT(*) as count FROM audit_log WHERE event_type = \'LOGIN_FAILED\'');
        console.log(`   LOGIN_FAILED entries: ${afterFailedCount.rows[0].count}`);

        // Show recent failed login entries
        const recentFailed = await db.query(`
            SELECT attempted_userid, error_message, ip_address, event_timestamp, risk_score 
            FROM audit_log 
            WHERE event_type = 'LOGIN_FAILED' 
            ORDER BY event_timestamp DESC 
            LIMIT 5
        `);
        
        console.log('   Recent failed login attempts:');
        recentFailed.rows.forEach((row, index) => {
            console.log(`   ${index + 1}. User: ${row.attempted_userid}, Error: ${row.error_message}, Risk: ${row.risk_score}, Time: ${row.event_timestamp}`);
        });

        // 5. Test with real user credentials (if available)
        console.log('\n🔍 Checking for existing users to test successful login...');
        const users = await db.query('SELECT userid FROM master_user WHERE useractive = true LIMIT 3');
        
        if (users.rowCount > 0) {
            const testUser = users.rows[0];
            console.log(`   Found test user: ${testUser.userid}`);
            
            // Get the user's password for testing
            const userDetails = await db.query('SELECT userpwd FROM master_user WHERE userid = $1', [testUser.userid]);
            
            if (userDetails.rowCount > 0) {
                const userPassword = userDetails.rows[0].userpwd;
                
                console.log('\n✅ Testing successful login...');
                try {
                    const response = await axios.post(`${BASE_URL}/login/`, {
                        username: testUser.userid,
                        password: userPassword
                    });
                    console.log(`   Success: ${response.data.message}`);
                    console.log(`   User role: ${response.data.user_role}`);
                } catch (error) {
                    console.log(`   Login attempt failed: ${error.response?.data?.error || error.message}`);
                }
            }
        } else {
            console.log('   No active users found for testing successful login');
        }

        // 6. Final audit log check
        console.log('\n📈 Final audit log statistics...');
        const finalStats = await db.query(`
            SELECT 
                event_type,
                COUNT(*) as count,
                AVG(risk_score) as avg_risk
            FROM audit_log 
            WHERE event_type LIKE 'LOGIN_%'
            GROUP BY event_type
            ORDER BY count DESC
        `);

        console.log('   Event breakdown:');
        finalStats.rows.forEach(row => {
            console.log(`   - ${row.event_type}: ${row.count} entries (avg risk: ${Math.round(row.avg_risk || 0)})`);
        });

        // 7. Show all recent audit entries
        console.log('\n📋 Recent audit log entries (all types):');
        const recentAll = await db.query(`
            SELECT event_type, attempted_userid, success, error_message, event_timestamp 
            FROM audit_log 
            ORDER BY event_timestamp DESC 
            LIMIT 10
        `);

        recentAll.rows.forEach((row, index) => {
            const status = row.success ? '✅' : '❌';
            console.log(`   ${index + 1}. ${status} ${row.event_type} - ${row.attempted_userid || 'unknown'} - ${row.error_message || 'success'} (${row.event_timestamp})`);
        });

        console.log('\n🎉 Audit logging test completed!');

        // 8. Test audit log API endpoints
        console.log('\n🔗 Testing audit log API endpoints...');
        try {
            const apiResponse = await axios.get(`${BASE_URL}/api/audit-logs`, {
                headers: {
                    'x-user-role': 'SMS_SUPERADM',
                    'x-user-id': 'test_admin'
                },
                params: {
                    limit: 5
                }
            });
            console.log(`   ✅ Audit logs API working: ${apiResponse.data.data.length} records retrieved`);
        } catch (error) {
            console.log(`   ❌ Audit logs API error: ${error.response?.data?.error || error.message}`);
        }

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        if (error.code) {
            console.error('   Error code:', error.code);
        }
    } finally {
        // Close database connection
        if (db && db.end) {
            await db.end();
        }
    }
}

// Instructions for running the test
function showInstructions() {
    console.log('📋 Before running this test:');
    console.log('   1. Make sure your SMS backend server is running on port 9090');
    console.log('   2. Ensure the audit_log table exists (run setup_audit_logging.js)');
    console.log('   3. Have at least one active user in master_user table');
    console.log('');
    console.log('💡 To run: node test/test_audit_login.js');
    console.log('');
}

// Check if server is running before starting tests
async function checkServer() {
    try {
        await axios.get(`${BASE_URL}/`);
        return true;
    } catch (error) {
        return false;
    }
}

// Main execution
if (require.main === module) {
    checkServer().then(serverRunning => {
        if (serverRunning) {
            testAuditLogging().then(() => {
                console.log('\n✨ Test completed');
                process.exit(0);
            }).catch(error => {
                console.error('Test execution error:', error);
                process.exit(1);
            });
        } else {
            console.log('❌ Server is not reachable at https://devcms.aimtechcampus.com');
            console.log('   Please start your SMS backend server first');
            showInstructions();
            process.exit(1);
        }
    });
}

module.exports = { testAuditLogging };
