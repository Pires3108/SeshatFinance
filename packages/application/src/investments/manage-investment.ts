import {
  CivilDate,
  Currency,
  FinancialAuditEvent,
  Investment,
  InvestmentType,
  type ContractedRate,
  type FinancialAuditAction,
  type InvestmentDetails,
  type InvestmentLiquidity,
  type InvestmentSnapshot,
} from '@seshat/domain';

import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';
import {
  normalizeIdempotencyKey,
  type IdempotencyRequest,
} from '../ports/idempotency.js';

export const CREATE_INVESTMENT_OPERATION = 'investment.create';

export type InvestmentWrite = Readonly<{
  investment: Investment;
  auditEvent: FinancialAuditEvent;
}>;

export interface InvestmentRepository {
  findIdempotentResponse(request: IdempotencyRequest): Promise<string | null>;
  findByIdForOwner(id: string, ownerId: string): Promise<Investment | null>;
  listForOwner(ownerId: string): Promise<readonly Investment[]>;
  /** Claims the key and inserts the investment, its audit and the response. */
  insertAtomically(
    request: IdempotencyRequest,
    write: InvestmentWrite,
    serialize: (investment: Investment) => string,
  ): Promise<string>;
  /** Locks, checks the version and saves; null when not owned. */
  saveAtomically(
    id: string,
    ownerId: string,
    expectedVersion: number,
    build: (investment: Investment) => InvestmentWrite,
  ): Promise<Investment | null>;
}

export class InvestmentNotFoundError extends Error {
  public constructor() {
    super('Owned investment was not found.');
    this.name = 'InvestmentNotFoundError';
  }
}

export class InvestmentVersionConflictError extends Error {
  public constructor() {
    super('The investment was changed by another request.');
    this.name = 'InvestmentVersionConflictError';
  }
}

export type InvestmentDetailsInput = Readonly<{
  type: string;
  institution: string;
  name: string;
  code?: string | null | undefined;
  currencyCode: string;
  currencyMinorUnitScale: number;
  startDate: string;
  maturityDate?: string | null | undefined;
  contractedRate?: ContractedRate | null | undefined;
  liquidity: InvestmentLiquidity;
}>;

export type CreateInvestmentCommand = InvestmentDetailsInput &
  Readonly<{ actorId: string; idempotencyKey: string }>;

export type UpdateInvestmentCommand = InvestmentDetailsInput &
  Readonly<{ actorId: string; investmentId: string; expectedVersion: number }>;

export type InvestmentLifecycleAction =
  'archive' | 'unarchive' | 'trash' | 'restore';

export type ChangeInvestmentLifecycleCommand = Readonly<{
  actorId: string;
  investmentId: string;
  expectedVersion: number;
  action: InvestmentLifecycleAction;
}>;

/**
 * Registers a manual investment (US-054, ADR-044). It only records
 * descriptive data: no transaction, balance or net worth changes.
 */
export class CreateInvestmentUseCase {
  public constructor(
    private readonly investments: InvestmentRepository,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(command: CreateInvestmentCommand): Promise<Investment> {
    const key = normalizeIdempotencyKey(command.idempotencyKey);
    const at = this.clock.now();
    const request: IdempotencyRequest = {
      key,
      operation: CREATE_INVESTMENT_OPERATION,
      ownerId: command.actorId,
      payload: { details: JSON.stringify(normalizeInput(command)) },
      requestedAt: at,
    };
    const replayed = await this.investments.findIdempotentResponse(request);
    if (replayed !== null) return parseInvestmentResponse(replayed);
    const investment = Investment.create({
      ...toDetails(command),
      createdAt: at,
      id: this.identifiers.generate(),
      ownerId: command.actorId,
    });
    const stored = await this.investments.insertAtomically(
      request,
      {
        auditEvent: audit(
          command.actorId,
          at,
          this.identifiers.generate(),
          investment.id,
          'created',
        ),
        investment,
      },
      serializeInvestmentResponse,
    );
    return parseInvestmentResponse(stored);
  }
}

export class ListInvestmentsUseCase {
  public constructor(
    private readonly investments: Pick<InvestmentRepository, 'listForOwner'>,
  ) {}

  public execute(actorId: string): Promise<readonly Investment[]> {
    return this.investments.listForOwner(actorId);
  }
}

export class GetInvestmentUseCase {
  public constructor(
    private readonly investments: Pick<
      InvestmentRepository,
      'findByIdForOwner'
    >,
  ) {}

  public async execute(
    query: Readonly<{ actorId: string; investmentId: string }>,
  ): Promise<Investment> {
    const investment = await this.investments.findByIdForOwner(
      query.investmentId,
      query.actorId,
    );
    if (investment === null) throw new InvestmentNotFoundError();
    return investment;
  }
}

export class UpdateInvestmentUseCase {
  public constructor(
    private readonly investments: InvestmentRepository,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(command: UpdateInvestmentCommand): Promise<Investment> {
    const at = this.clock.now();
    const details = toDetails(command);
    const auditId = this.identifiers.generate();
    const saved = await this.investments.saveAtomically(
      command.investmentId,
      command.actorId,
      command.expectedVersion,
      (investment) => {
        investment.update(details, at);
        return {
          auditEvent: audit(
            command.actorId,
            at,
            auditId,
            investment.id,
            'updated',
          ),
          investment,
        };
      },
    );
    if (saved === null) throw new InvestmentNotFoundError();
    return saved;
  }
}

export class ChangeInvestmentLifecycleUseCase {
  public constructor(
    private readonly investments: InvestmentRepository,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(
    command: ChangeInvestmentLifecycleCommand,
  ): Promise<Investment> {
    const at = this.clock.now();
    const auditId = this.identifiers.generate();
    const saved = await this.investments.saveAtomically(
      command.investmentId,
      command.actorId,
      command.expectedVersion,
      (investment) => {
        const action = applyLifecycle(investment, command.action, at);
        return {
          auditEvent: audit(
            command.actorId,
            at,
            auditId,
            investment.id,
            action,
          ),
          investment,
        };
      },
    );
    if (saved === null) throw new InvestmentNotFoundError();
    return saved;
  }
}

function applyLifecycle(
  investment: Investment,
  action: InvestmentLifecycleAction,
  at: Date,
): FinancialAuditAction {
  switch (action) {
    case 'archive':
      investment.archive(at);
      return 'archived';
    case 'unarchive':
      investment.unarchive(at);
      return 'unarchived';
    case 'trash':
      investment.trash(at);
      return 'moved-to-trash';
    case 'restore':
      investment.restoreFromTrash(at);
      return 'restored-from-trash';
  }
}

function toDetails(input: InvestmentDetailsInput): InvestmentDetails {
  return {
    code: input.code ?? null,
    contractedRate: input.contractedRate ?? null,
    currency: Currency.create(input.currencyCode, input.currencyMinorUnitScale),
    institution: input.institution,
    liquidity: input.liquidity,
    maturityDate:
      input.maturityDate === null || input.maturityDate === undefined
        ? null
        : CivilDate.parse(input.maturityDate),
    name: input.name,
    startDate: CivilDate.parse(input.startDate),
    type: InvestmentType.create(input.type),
  };
}

function normalizeInput(
  input: InvestmentDetailsInput,
): Record<string, unknown> {
  return {
    code: input.code?.trim().toUpperCase() ?? null,
    contractedRate: input.contractedRate ?? null,
    currency: `${input.currencyCode}:${String(input.currencyMinorUnitScale)}`,
    institution: input.institution.trim(),
    liquidity: input.liquidity,
    maturityDate: input.maturityDate ?? null,
    name: input.name.trim(),
    startDate: input.startDate,
    type: input.type,
  };
}

function audit(
  actorId: string,
  at: Date,
  id: string,
  investmentId: string,
  action: FinancialAuditAction,
): FinancialAuditEvent {
  return FinancialAuditEvent.create({
    action,
    actorId,
    id,
    occurredAt: at,
    ownerId: actorId,
    resourceId: investmentId,
    resourceType: 'investment',
  });
}

export function serializeInvestmentResponse(investment: Investment): string {
  const snapshot = investment.toSnapshot();
  return JSON.stringify({
    ...snapshot,
    createdAt: snapshot.createdAt.toISOString(),
    updatedAt: snapshot.updatedAt.toISOString(),
  });
}

export function parseInvestmentResponse(response: string): Investment {
  const raw = JSON.parse(response) as Omit<
    InvestmentSnapshot,
    'createdAt' | 'updatedAt'
  > & { createdAt: string; updatedAt: string };
  return Investment.restore({
    ...raw,
    createdAt: new Date(raw.createdAt),
    updatedAt: new Date(raw.updatedAt),
  });
}
