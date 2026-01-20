-- V6__cab_governance_invariants.sql

-- 1. Update ENUM to include SUBMITTED
ALTER TABLE stage_transition_log 
MODIFY COLUMN decision ENUM('APPROVED','REJECTED','FAILED_PRECONDITION','SUBMITTED') NOT NULL;

-- 2. Trigger Rule A: Stage/Status Alignment
-- If pipeline_stage != VERIFY_CAB, cab_readiness_status must be NOT_READY
DELIMITER //

CREATE TRIGGER trg_workspace_cab_consistency
BEFORE UPDATE ON workspace
FOR EACH ROW
BEGIN
    IF NEW.pipeline_stage != 'VERIFY_CAB' THEN
        IF NEW.cab_readiness_status != 'NOT_READY' THEN
            SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'CAB_STATUS_INVALID_FOR_STAGE';
        END IF;
    END IF;
END//

-- 3. Trigger Rule B: Audit Action Eligibility
CREATE TRIGGER trg_audit_cab_validity
BEFORE INSERT ON stage_transition_log
FOR EACH ROW
BEGIN
    -- We need to check the CURRENT state of the workspace.
    -- Triggers cannot query the table they are on, but this is 'stage_transition_log', checks 'workspace'.
    DECLARE current_stage VARCHAR(32);
    DECLARE current_cab_status VARCHAR(32);

    SELECT pipeline_stage, cab_readiness_status 
    INTO current_stage, current_cab_status
    FROM workspace WHERE id = NEW.workspace_id;

    -- SUBMITTED
    IF NEW.decision = 'SUBMITTED' THEN
        IF current_stage != 'VERIFY_CAB' THEN
            SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'CAB_AUDIT_ACTION_INVALID: SUBMITTED requires VERIFY_CAB';
        END IF;
    END IF;

    -- APPROVED
    IF NEW.decision = 'APPROVED' THEN
        -- Allow APPROVE only if in VERIFY_CAB and PENDING_REVIEW
        -- Note: When 'Approving' via CabDecisionController, we update status to APPROVED.
        -- But the Log is inserted. 
        -- If we inserted Log BEFORE updating workspace, current status is PENDING_REVIEW.
        -- If we insert Log AFTER updating workspace, current status is APPROVED.
        -- We must coordinate Code to insert Log appropriately.
        -- Typically we log 'APPROVED' then update status? Or update status then log?
        -- The trigger reads DB *now*.
        -- If transaction: WLock Workspace -> Insert Log -> Select W (sees blocked/old val) -> OK.
        -- Wait, inside same transaction, SELECT sees updates? Yes.
        -- My `logDecision` usage in `CabDecisionController` happens BEFORE `UPDATE workspace`.
        -- So status is `PENDING_REVIEW`.
        -- But `CabController.submitCab` logged `APPROVED` (now `SUBMITTED`) *AFTER* status update to `PENDING_REVIEW`.
        -- `submitCab` starts with `NOT_READY` -> updates to `PENDING_REVIEW` -> logs.
        -- If I change `submitCab` to log `SUBMITTED`, then `APPROVED` rule only applies to `CabDecisionController`.
        
        IF current_stage != 'VERIFY_CAB' THEN
             SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CAB_AUDIT_ACTION_INVALID: APPROVED requires VERIFY_CAB';
        END IF;
        
        -- Constraint: cab_readiness_status must be PENDING_REVIEW
        -- If I log 'APPROVED', I must be PENDING_REVIEW.
        IF current_cab_status != 'PENDING_REVIEW' THEN
             SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CAB_AUDIT_ACTION_INVALID: APPROVED requires PENDING_REVIEW';
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
