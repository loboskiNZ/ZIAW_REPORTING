-- V12__add_cab_sla_fields.sql

-- 1. Add SLA fields to workspace
ALTER TABLE workspace
ADD COLUMN cab_submitted_at DATETIME NULL,
ADD COLUMN cab_expires_at DATETIME NULL;

-- 2. Update decision ENUM in stage_transition_log to include EXPIRED
ALTER TABLE stage_transition_log
MODIFY COLUMN decision ENUM('APPROVED','REJECTED','FAILED_PRECONDITION','SUBMITTED','CHAIR_APPROVED','EXPIRED') NOT NULL;

-- 3. Update Audit Validity Trigger to block actions on EXPIRED
DROP TRIGGER IF EXISTS trg_audit_cab_validity;

DELIMITER //

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

    -- Block actions if EXPIRED (except strict re-submissions which might reset things, but typically block)
    -- Allow 'EXPIRED' action itself (which sets state to EXPIRED)
    IF current_review_state = 'EXPIRED' AND NEW.decision != 'SUBMITTED' THEN
         SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CAB_REVIEW_EXPIRED';
    END IF;

    -- SUBMITTED
    IF NEW.decision = 'SUBMITTED' THEN
        IF current_stage != 'VERIFY_CAB' THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CAB_AUDIT_ACTION_INVALID: SUBMITTED requires VERIFY_CAB';
        END IF;
    END IF;

    -- APPROVED
    IF NEW.decision = 'APPROVED' THEN
        IF current_stage != 'VERIFY_CAB' THEN
             SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CAB_AUDIT_ACTION_INVALID: APPROVED requires VERIFY_CAB';
        END IF;
        IF current_cab_status != 'PENDING_REVIEW' THEN
             SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CAB_AUDIT_ACTION_INVALID: APPROVED requires PENDING_REVIEW';
        END IF;
    END IF;

    -- CHAIR_APPROVED
    IF NEW.decision = 'CHAIR_APPROVED' THEN
        IF current_stage != 'VERIFY_CAB' THEN
             SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CAB_AUDIT_ACTION_INVALID: CHAIR_APPROVED requires VERIFY_CAB';
        END IF;
        IF current_cab_status != 'PENDING_REVIEW' THEN
             SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CAB_AUDIT_ACTION_INVALID: CHAIR_APPROVED requires PENDING_REVIEW';
        END IF;
    END IF;

    -- REJECTED
    IF NEW.decision = 'REJECTED' THEN
        IF current_stage != 'VERIFY_CAB' THEN
             SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CAB_AUDIT_ACTION_INVALID: REJECTED requires VERIFY_CAB';
        END IF;
        IF current_cab_status != 'PENDING_REVIEW' THEN
             SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CAB_AUDIT_ACTION_INVALID: REJECTED requires PENDING_REVIEW';
        END IF;
    END IF;

END//

DELIMITER ;
