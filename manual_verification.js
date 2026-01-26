const { execSync } = require('child_process');
const http = require('http');

const BASE_URL = 'http://localhost:8080/api';
const SCRIPTS_DIR = './scripts/cab';

function runCmd(cmd, env = {}) {
  console.log(`\n--- CMD: ${cmd} ---`);
  try {
    // Merge process.env with custom env
    const output = execSync(cmd, { 
      env: { ...process.env, ...env }, 
      encoding: 'utf8',
      stdio: 'pipe' // capture output
    });
    console.log(output.trim());
    return output.trim();
  } catch (e) {
    console.error(`FAILED: ${e.message}`);
    console.error(`STDERR: ${e.stderr.toString()}`);
    console.error(`STDOUT: ${e.stdout.toString()}`);
    process.exit(1);
  }
}

async function request(method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', ...headers }
    };
    const req = http.request(`${BASE_URL}${path}`, opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  console.log('=== START MANUAL VERIFICATION ===');

  // 1. Reset DB
  runCmd('node scripts/seed_quorum_actors.js');

  // 2. List Reviewers
  runCmd(`sh ${SCRIPTS_DIR}/list_reviewers.sh`, { ACTOR_ID: 'admin' });

  // 3. Readiness
  runCmd(`sh ${SCRIPTS_DIR}/readiness.sh`, { ACTOR_ID: 'admin' });

  // 4. Submit (Member)
  runCmd(`sh ${SCRIPTS_DIR}/submit.sh`, { ACTOR_ID: 'quorum_member' });

  // 5. Get History & Attach Evidence
  const histRes = await request('GET', '/workspaces/1/cab/history', {});
  const histData = JSON.parse(histRes.body);
  console.log('\n--- History (Post-Submit) ---');
  console.log(JSON.stringify(histData, null, 2));

  const events = histData.events || [];
  const submittedEvent = events.filter(e => e.action === 'SUBMITTED').pop();
  if (!submittedEvent) {
      console.error('No SUBMITTED event found');
      process.exit(1);
  }
  const auditId = submittedEvent.id;
  console.log(`\n>>> Attaching Evidence to Audit ID: ${auditId}`);
  
  // Attach Evidence via Curl-like request
  const evRes = await request('POST', '/workspaces/1/cab/evidence', { 'x-actor-id': 'admin' }, {
      audit_id: auditId,
      evidence_type: 'LINK',
      evidence_value: 'https://example.com/test-evidence'
  });
  console.log('Evidence Attach Response:', evRes.body);

  // 6. Vote 1 (Chair 1)
  runCmd(`sh ${SCRIPTS_DIR}/approve.sh`, { ACTOR_ID: 'quorum_chair_1' });

  // 7. Vote 2 (Chair 2)
  runCmd(`sh ${SCRIPTS_DIR}/approve.sh`, { ACTOR_ID: 'quorum_chair_2' });

  // 8. Final History
  const finalHistr = await request('GET', '/workspaces/1/cab/history', {});
  console.log('\n--- History (Final) ---');
  console.log(JSON.stringify(JSON.parse(finalHistr.body), null, 2));

  // 9. Governance Report
  const govRes = await request('GET', '/workspaces/1/governance/report', { 'x-actor-id': 'admin' });
  console.log('\n--- Governance Report ---');
  console.log(JSON.stringify(JSON.parse(govRes.body), null, 2));

  console.log('\n=== END MANUAL VERIFICATION ===');
}

main().catch(err => console.error(err));
