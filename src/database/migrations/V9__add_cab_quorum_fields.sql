ALTER TABLE workspace 
ADD COLUMN cab_review_state VARCHAR(32) NOT NULL DEFAULT 'NONE',
ADD COLUMN cab_required_approvals INT NOT NULL DEFAULT 2,
ADD COLUMN cab_approval_count INT NOT NULL DEFAULT 0;
