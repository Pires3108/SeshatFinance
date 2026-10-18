// Public audit write boundary: callers share their transaction for atomic writes.
export { insertFinancialAuditEvent } from './prisma-financial-audit-event-repository.js';
