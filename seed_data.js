const db = require('./src/config/database');

async function seed() {
  try {
    console.log('Seeding Enhanced Data...');
    const conn = await db.getConnection();
    
    // 1. Create Workspace
    const [wRes] = await conn.query(
      `INSERT INTO workspace (name, pipeline_stage) VALUES ('Enhanced Test Workspace', 'BUILD')`
    );
    const wId = wRes.insertId;
    console.log('Created Workspace:', wId);

    // 2. Checklist Rules
    await conn.query(
      `INSERT IGNORE INTO stage_checklist_definition 
       (pipeline_stage, rule_key, title, ownership_type, rule_kind, rule_spec_json)
       VALUES 
       ('BUILD', 'has_int_flow', 'Integration Flow', 'AUTO', 'HAS_ARTIFACT', '{"artifact_type_in": ["INTEGRATION_FLOW"], "min_count": 1}'),
       ('BUILD', 'has_sec_control', 'Security Controls', 'AUTO', 'HAS_ARTIFACT', '{"artifact_type_in": ["SECURITY_CONTROL"], "min_count": 1}')`
    );

    // 3. Artifacts
    // 3a. Risk (High, Open) -> Weight 20
    await conn.query(
      `INSERT INTO artifact (workspace_id, type, content) VALUES (?, 'RISK', ?)`,
      [wId, JSON.stringify({ severity: 'HIGH', status: 'OPEN', title: 'Data Lease' })]
    );
    // 3b. Risk (Medium, Accepted) -> Weight 10/2 = 5
    await conn.query(
      `INSERT INTO artifact (workspace_id, type, content) VALUES (?, 'RISK', ?)`,
      [wId, JSON.stringify({ severity: 'MEDIUM', status: 'ACCEPTED', title: 'Legacy Auth' })]
    );
    
    // 3c. Core Artifact: Integration Flow (Passes checklist, Helps readiness)
    await conn.query(
      `INSERT INTO artifact (workspace_id, type, content) VALUES (?, 'INTEGRATION_FLOW', '{}')`,
      [wId]
    );

    console.log('Seeded Artifacts for Workspace', wId);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

seed();
