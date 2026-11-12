import type {
  FinancialAuditAction,
  FinancialAuditResourceType,
} from '@seshat/domain';

/**
 * One audit event as exposed to its owner. Only the 27/09 allowlist plus the
 * chain fields: no amounts, descriptions, account numbers or snapshots.
 */
export type FinancialAuditTrailEntry = Readonly<{
  id: string;
  sequence: bigint;
  occurredAt: Date;
  actorId: string;
  action: FinancialAuditAction;
  resourceType: FinancialAuditResourceType;
  resourceId: string;
  result: 'succeeded' | 'failed';
  errorCode: string | null;
  correlationId: string | null;
  previousHash: string;
  hash: string;
}>;

export type FinancialAuditTrailQuery = Readonly<{
  afterSequence?: bigint;
  limit: number;
  resourceType?: FinancialAuditResourceType;
  resourceId?: string;
}>;

export type FinancialAuditChainVerification = Readonly<{
  checkedEvents: bigint;
  firstInvalidSequence: bigint | null;
}>;

export interface FinancialAuditTrailRepository {
  listForOwner(
    ownerId: string,
    query: FinancialAuditTrailQuery,
  ): Promise<readonly FinancialAuditTrailEntry[]>;
  verifyChainForOwner(
    ownerId: string,
  ): Promise<FinancialAuditChainVerification>;
}

export const FINANCIAL_AUDIT_TRAIL_MAX_PAGE = 100;

/** Lists the authenticated owner's audit trail in chain order. */
export class ListOwnedFinancialAuditTrailUseCase {
  public constructor(private readonly trail: FinancialAuditTrailRepository) {}

  public execute(
    actorId: string,
    query: FinancialAuditTrailQuery,
  ): Promise<readonly FinancialAuditTrailEntry[]> {
    const limit = Math.min(
      Math.max(Math.trunc(query.limit), 1),
      FINANCIAL_AUDIT_TRAIL_MAX_PAGE,
    );
    return this.trail.listForOwner(actorId, { ...query, limit });
  }
}

/** Recomputes the authenticated owner's hash chain. */
export class VerifyOwnedFinancialAuditChainUseCase {
  public constructor(private readonly trail: FinancialAuditTrailRepository) {}

  public execute(actorId: string): Promise<FinancialAuditChainVerification> {
    return this.trail.verifyChainForOwner(actorId);
  }
}
