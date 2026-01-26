const assert = require('assert');
const http = require('http');

function request(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost',
      port: 8080,
      path: path,
      method: 'GET',
      headers: { 'Content-Type': 'application/json', ...headers }
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ statusCode: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ statusCode: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function runTests() {
  console.log('Running Auth Integration Tests...');

  try {
    // 1. Test Unauthenticated (No Header, No Session)
    console.log('Test 1: Unauthenticated request to /auth/me');
    const r1 = await request('/auth/me');
    assert.strictEqual(r1.statusCode, 401);
    assert.strictEqual(r1.body.error, 'UNAUTHENTICATED');

    // 2. Test Unauthenticated Access to Secured Resource
    console.log('Test 2: Unauthenticated request to secured resource (Checklist)');
    // Accessing CabEvidenceController which I know is secured
    const r2 = await request('/api/workspaces/1/cab/evidence');
    assert.strictEqual(r2.statusCode, 401);

    // 3. Test Authenticated request to /auth/me (Dev Shim)
    console.log('Test 3: Authenticated request to /auth/me (Dev Shim)');
    const rAuth = await request('/auth/me', { 'X-Actor-ID': 'test_user' });
    assert.strictEqual(rAuth.statusCode, 200);
    assert.strictEqual(rAuth.body.id, 'test_user');
    // Shim sets email/tenant to null
    assert.strictEqual(rAuth.body.tenant_id, null);

    console.log('✓ Auth Integration Tests Passed');

  } catch (err) {
    console.error('Test Failed:', err);
    process.exit(1);
  }
}

runTests();
