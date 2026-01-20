/* =========================================================
   ZIAW – Seed Stage Checklist Definitions (V2)
   ========================================================= */

-- INTAKE
INSERT INTO stage_checklist_definition
(pipeline_stage, rule_key, title, description, ownership_type, rule_kind, rule_spec_json, is_required, display_order)
VALUES
(
  'INTAKE',
  'intake_objective_defined',
  'Objective Defined',
  'At least one functional objective has been captured.',
  'AUTO',
  'HAS_ARTIFACT',
  JSON_OBJECT(
    'min_count', 1,
    'artifact_type_in', JSON_ARRAY('FUNCTIONAL_REQUIREMENT'),
    'content_filters', JSON_ARRAY(
      JSON_OBJECT('json_path', '$.objective', 'op', '=', 'value', true)
    )
  ),
  1,
  10
);

-- DISCOVERY
INSERT INTO stage_checklist_definition
(pipeline_stage, rule_key, title, description, ownership_type, rule_kind, rule_spec_json, is_required, display_order)
VALUES
(
  'DISCOVERY',
  'discovery_as_is_integrations',
  'AS-IS Integrations Identified',
  'Existing integrations have been identified.',
  'AUTO',
  'HAS_ARTIFACT',
  JSON_OBJECT(
    'min_count', 1,
    'artifact_type_in', JSON_ARRAY('INTEGRATION_FLOW'),
    'content_filters', JSON_ARRAY(
      JSON_OBJECT('json_path', '$.state', 'op', '=', 'value', 'AS_IS')
    )
  ),
  1,
  10
);

-- DESIGN
INSERT INTO stage_checklist_definition
(pipeline_stage, rule_key, title, description, ownership_type, rule_kind, rule_spec_json, is_required, display_order)
VALUES
(
  'DESIGN',
  'design_to_be_integration',
  'TO-BE Integration Defined',
  'Target integration flow is defined.',
  'AUTO',
  'HAS_ARTIFACT',
  JSON_OBJECT(
    'min_count', 1,
    'artifact_type_in', JSON_ARRAY('INTEGRATION_FLOW'),
    'content_filters', JSON_ARRAY(
      JSON_OBJECT('json_path', '$.state', 'op', '=', 'value', 'TO_BE')
    )
  ),
  1,
  10
),
(
  'DESIGN',
  'design_security_controls',
  'Security Controls Defined',
  'Security controls have been defined.',
  'AUTO',
  'HAS_ARTIFACT',
  JSON_OBJECT(
    'min_count', 1,
    'artifact_type_in', JSON_ARRAY('SECURITY_CONTROL')
  ),
  1,
  20
);

-- PLANNING
INSERT INTO stage_checklist_definition
(pipeline_stage, rule_key, title, description, ownership_type, rule_kind, rule_spec_json, is_required, display_order)
VALUES
(
  'PLANNING',
  'planning_implementation_outline',
  'Implementation Plan Exists',
  'Implementation outline has been created.',
  'AUTO',
  'HAS_ARTIFACT',
  JSON_OBJECT(
    'min_count', 1,
    'artifact_type_in', JSON_ARRAY('IMPLEMENTATION_OUTLINE')
  ),
  1,
  10
),
(
  'PLANNING',
  'planning_architect_signoff',
  'Architect Sign-off',
  'Architect has approved the plan.',
  'HUMAN',
  'MANUAL_CONFIRM',
  JSON_OBJECT(
    'prompt', 'Confirm architect sign-off.'
  ),
  1,
  20
);

-- BUILD
INSERT INTO stage_checklist_definition
(pipeline_stage, rule_key, title, description, ownership_type, rule_kind, rule_spec_json, is_required, display_order)
VALUES
(
  'BUILD',
  'build_api_contracts',
  'API / Event Contracts Defined',
  'Contracts for integrations are defined.',
  'AUTO',
  'HAS_ARTIFACT',
  JSON_OBJECT(
    'min_count', 1,
    'artifact_type_in', JSON_ARRAY('API_CONTRACT','EVENT_CONTRACT')
  ),
  1,
  10
);

-- VERIFY_CAB
INSERT INTO stage_checklist_definition
(pipeline_stage, rule_key, title, description, ownership_type, rule_kind, rule_spec_json, is_required, display_order)
VALUES
(
  'VERIFY_CAB',
  'cab_runbook_present',
  'Runbook Present',
  'Operational runbook exists.',
  'AUTO',
  'HAS_ARTIFACT',
  JSON_OBJECT(
    'min_count', 1,
    'artifact_type_in', JSON_ARRAY('RUNBOOK')
  ),
  1,
  10
),
(
  'VERIFY_CAB',
  'cab_risks_reviewed',
  'Risks Reviewed',
  'Critical and high risks reviewed.',
  'HUMAN',
  'MANUAL_CONFIRM',
  JSON_OBJECT(
    'prompt', 'Confirm all risks reviewed.'
  ),
  1,
  20
);
