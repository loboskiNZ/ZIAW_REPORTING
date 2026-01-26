CREATE TABLE cab_review_evidence (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    workspace_id BIGINT NOT NULL,
    audit_id BIGINT NOT NULL,
    evidence_type ENUM('LINK', 'NOTE', 'FILE') NOT NULL,
    evidence_value TEXT NOT NULL,
    actor VARCHAR(128) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_cab_evidence_workspace (workspace_id),
    INDEX idx_cab_evidence_audit (audit_id),
    CONSTRAINT fk_evidence_workspace FOREIGN KEY (workspace_id) REFERENCES workspace(id),
    CONSTRAINT fk_evidence_audit FOREIGN KEY (audit_id) REFERENCES stage_transition_log(id)
);
