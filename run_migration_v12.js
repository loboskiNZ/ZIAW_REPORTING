const db = require('./src/config/database');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const sql = fs.readFileSync(path.join(__dirname, 'src/database/migrations/V12__add_cab_sla_fields.sql'), 'utf8');
  const connection = await db.getConnection();
  try {
    // Split by delimiter logic is primitive here, causing issues with DELIMITER //
    // I should handle simple statements or just exec whole thing if mysql2 supports multipleStatements?
    // mysql2 supports multipleStatements if configured.
    // However, I will use a simplified split approach or just run the blocks.
    
    // Actually, mysql2 'query' with multipleStatements: true works best for migrations.
    // But my DB config might not have it.
    
    // I will simplisticly split by known delimiters for this specific file.
    // 1. ALTER TABLE workspace... semi-colon.
    // 2. ALTER TABLE stage_transition_log... semi-colon.
    // 3. DROP TRIGGER... semi-colon.
    // 4. CREATE TRIGGER... (block)
    
    // Instead of hacking a parser, I'll update the Runner to act like a real migration tool for this file specifically.
    // I'll execute the statements I know are there.
    
    await connection.query('ALTER TABLE workspace ADD COLUMN cab_submitted_at DATETIME NULL, ADD COLUMN cab_expires_at DATETIME NULL');
    console.log('Added columns.');
    
    await connection.query("ALTER TABLE stage_transition_log MODIFY COLUMN decision ENUM('APPROVED','REJECTED','FAILED_PRECONDITION','SUBMITTED','CHAIR_APPROVED','EXPIRED') NOT NULL");
    console.log('Updated ENUM.');
    
    await connection.query('DROP TRIGGER IF EXISTS trg_audit_cab_validity');
    console.log('Dropped trigger.');
    
    await connection.query(`
CREATE TRIGGER trg_audit_cab_validity
BEFORE INSERT ON stage_transition_log
FOR EACH ROW
BEGIN
    DECLARE current_stage VARCHAR(32);
    DECLARE current_cab_status VARCHAR(32);
    DECLARE current_review_state VARCHAR(32);

    SELECT pipeline_stage, cab_readiness_status, cab_review_state
    INTO current_stage, current_cab_status, current_review_state
    FROM workspace WHERE id = NEW.workspace_id;

    IF current_review_state = 'EXPIRED' AND NEW.decision != 'SUBMITTED' THEN
         SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CAB_REVIEW_EXPIRED';
    END IF;

    IF NEW.decision = 'SUBMITTED' THEN
        IF current_stage != 'VERIFY_CAB' THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CAB_AUDIT_ACTION_INVALID: SUBMITTED requires VERIFY_CAB';
        END IF;
    END IF;

    IF NEW.decision = 'APPROVED' THEN
        IF current_stage != 'VERIFY_CAB' THEN
             SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CAB_AUDIT_ACTION_INVALID: APPROVED requires VERIFY_CAB';
        END IF;
        IF current_cab_status != 'PENDING_REVIEW' THEN
             SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CAB_AUDIT_ACTION_INVALID: APPROVED requires PENDING_REVIEW';
        END IF;
    END IF;

    IF NEW.decision = 'CHAIR_APPROVED' THEN
        IF current_stage != 'VERIFY_CAB' THEN
             SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CAB_AUDIT_ACTION_INVALID: CHAIR_APPROVED requires VERIFY_CAB';
        END IF;
        IF current_cab_status != 'PENDING_REVIEW' THEN
             SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CAB_AUDIT_ACTION_INVALID: CHAIR_APPROVED requires PENDING_REVIEW';
        END IF;
    END IF;

    IF NEW.decision = 'REJECTED' THEN
        IF current_stage != 'VERIFY_CAB' THEN
             SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CAB_AUDIT_ACTION_INVALID: REJECTED requires VERIFY_CAB';
        END IF;
        IF current_cab_status != 'PENDING_REVIEW' THEN
             SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CAB_AUDIT_ACTION_INVALID: REJECTED requires PENDING_REVIEW';
        END IF;
    END IF;
END
    `);
    console.log('Created trigger.');
    
  } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') {
          console.log('Columns already exist.');
      } else {
        console.error('Migration failed:', err);
        process.exit(1);
      }
  } finally {
    connection.release();
    process.exit(0);
  }
}

runMigration();
