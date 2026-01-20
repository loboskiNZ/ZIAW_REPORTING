const cabReadinessService = require('./CabReadinessService');
const cabReadinessStatusWriter = require('./CabReadinessStatusWriter');

class CabReadinessOrchestrator {
  /**
   * Recomputes the CAB readiness status and persists it.
   * @param {number} workspaceId 
   * @returns {Promise<string>} The persisted status
   */
  async recomputeAndPersist(workspaceId) {
    // 1. Evaluate
    const status = await cabReadinessService.evaluateCabReadiness(workspaceId);

    // 2. Persist
    await cabReadinessStatusWriter.write(workspaceId, status);

    return status;
  }
}

module.exports = new CabReadinessOrchestrator();
