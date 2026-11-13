import type {
  FinancialAuditChainVerification,
  FinancialAuditTrailEntry,
  FinancialAuditTrailQuery,
  FinancialAuditTrailRepository,
} from '@seshat/application';
import type {
  FinancialAuditAction as DomainFinancialAuditAction,
  FinancialAuditEvent,
  FinancialAuditResourceType as DomainFinancialAuditResourceType,
} from '@seshat/domain';

import type { PrismaClient } from '../generated/prisma/client.js';
import type {
  FinancialAuditAction,
  FinancialAuditResourceType,
} from '../generated/prisma/enums.js';

const opaqueIdentifier =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

let correlationSource: () => string | undefined = () => undefined;

/**
 * Registers where audit writes read the current correlation id from (the
 * API request context). Values other than a UUID v4 are recorded as null.
 */
export function configureFinancialAuditCorrelation(
  source: () => string | undefined,
): void {
  correlationSource = source;
}

function currentCorrelationId(): string | null {
  const value = correlationSource();
  return value !== undefined && opaqueIdentifier.test(value) ? value : null;
}

export class PrismaFinancialAuditEventRepository implements FinancialAuditTrailRepository {
  public constructor(private readonly client: PrismaClient) {}

  public async insert(event: FinancialAuditEvent): Promise<void> {
    await insertFinancialAuditEvent(this.client, event);
  }

  public async listForOwner(
    ownerId: string,
    query: FinancialAuditTrailQuery,
  ): Promise<readonly FinancialAuditTrailEntry[]> {
    const rows = await this.client.financialAuditEvent.findMany({
      orderBy: { ownerSequence: 'asc' },
      take: query.limit,
      where: {
        ownerId,
        ...(query.afterSequence === undefined
          ? {}
          : { ownerSequence: { gt: query.afterSequence } }),
        ...(query.resourceType === undefined
          ? {}
          : { resourceType: toPersistedResourceType(query.resourceType) }),
        ...(query.resourceId === undefined
          ? {}
          : { resourceId: query.resourceId }),
      },
    });
    return rows.map((row) => ({
      action: fromPersistedAction(row.action),
      actorId: row.actorId,
      correlationId: row.correlationId,
      errorCode: row.errorCode,
      hash: row.hash,
      id: row.id,
      occurredAt: row.occurredAt,
      previousHash: row.previousHash,
      resourceId: row.resourceId,
      resourceType: fromPersistedResourceType(row.resourceType),
      result: row.result === 'failed' ? 'failed' : 'succeeded',
      sequence: row.ownerSequence,
    }));
  }

  public async verifyChainForOwner(
    ownerId: string,
  ): Promise<FinancialAuditChainVerification> {
    const [row] = await this.client.$queryRaw<
      { checked_events: bigint; first_invalid_sequence: bigint | null }[]
    >`SELECT * FROM verify_financial_audit_chain(${ownerId}::uuid)`;
    return {
      checkedEvents: row?.checked_events ?? 0n,
      firstInvalidSequence: row?.first_invalid_sequence ?? null,
    };
  }
}

type FinancialAuditEventClient = Pick<PrismaClient, 'financialAuditEvent'>;

/**
 * Appends an event inside the caller's transaction. The database trigger
 * links it to the owner's hash chain (sequence, previous hash and hash).
 */
export async function insertFinancialAuditEvent(
  client: FinancialAuditEventClient,
  event: FinancialAuditEvent,
): Promise<void> {
  const snapshot = event.toSnapshot();
  await client.financialAuditEvent.create({
    data: {
      action: toPersistedAction(snapshot.action),
      actorId: snapshot.actorId,
      correlationId: currentCorrelationId(),
      id: snapshot.id,
      occurredAt: snapshot.occurredAt,
      ownerId: snapshot.ownerId,
      resourceId: snapshot.resourceId,
      resourceType: toPersistedResourceType(snapshot.resourceType),
      result: 'succeeded',
    },
  });
}

function toPersistedAction(
  action: DomainFinancialAuditAction,
): FinancialAuditAction {
  switch (action) {
    case 'moved-to-trash':
      return 'moved_to_trash';
    case 'restored-from-trash':
      return 'restored_from_trash';
    default:
      return action;
  }
}

function fromPersistedAction(
  action: FinancialAuditAction,
): DomainFinancialAuditAction {
  switch (action) {
    case 'moved_to_trash':
      return 'moved-to-trash';
    case 'restored_from_trash':
      return 'restored-from-trash';
    default:
      return action;
  }
}

function toPersistedResourceType(
  resourceType: DomainFinancialAuditResourceType,
): FinancialAuditResourceType {
  switch (resourceType) {
    case 'balance-adjustment':
      return 'balance_adjustment';
    case 'credit-card':
      return 'credit_card';
    case 'card-purchase':
      return 'card_purchase';
    case 'card-invoice':
      return 'card_invoice';
    case 'invoice-settlement':
      return 'invoice_settlement';
    case 'manual-exchange-quote':
      return 'manual_exchange_quote';
    default:
      return resourceType;
  }
}

function fromPersistedResourceType(
  resourceType: FinancialAuditResourceType,
): DomainFinancialAuditResourceType {
  switch (resourceType) {
    case 'balance_adjustment':
      return 'balance-adjustment';
    case 'credit_card':
      return 'credit-card';
    case 'card_purchase':
      return 'card-purchase';
    case 'card_invoice':
      return 'card-invoice';
    case 'invoice_settlement':
      return 'invoice-settlement';
    case 'manual_exchange_quote':
      return 'manual-exchange-quote';
    default:
      return resourceType;
  }
}
