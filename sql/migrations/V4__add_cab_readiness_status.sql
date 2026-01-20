-- V4__add_cab_readiness_status.sql
-- Column cab_readiness_status already exists in V1 (as ENUM).
-- This migration ensures data consistency by resetting status.

UPDATE workspace SET cab_readiness_status = 'NOT_READY';
