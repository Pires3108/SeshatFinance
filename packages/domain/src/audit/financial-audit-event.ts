export const financialAuditActions = [
  'created',
  'updated',
  'archived',
  'unarchived',
  'moved-to-trash',
  'restored-from-trash',
] as const;

export type FinancialAuditAction = (typeof financialAuditActions)[number];

export const financialAuditResourceTypes = [
  'account',
  'transaction',
  'transfer',
  'balance-adjustment',
] as const;

export type FinancialAuditResourceType =
  (typeof financialAuditResourceTypes)[number];

export type CreateFinancialAuditEventProperties = Readonly<{
  action: FinancialAuditAction;
  actorId: string;
  id: string;
  occurredAt: Date;
  ownerId: string;
  resourceId: string;
  resourceType: FinancialAuditResourceType;
}>;

export type FinancialAuditEventSnapshot = Readonly<{
  action: FinancialAuditAction;
  actorId: string;
  id: string;
  occurredAt: Date;
  ownerId: string;
  resourceId: string;
  resourceType: FinancialAuditResourceType;
}>;

export class InvalidFinancialAuditEventError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidFinancialAuditEventError';
  }
}

export class FinancialAuditEvent {
  private constructor(
    public readonly id: string,
    public readonly ownerId: string,
    public readonly actorId: string,
    public readonly action: FinancialAuditAction,
    public readonly resourceType: FinancialAuditResourceType,
    public readonly resourceId: string,
    public readonly occurredAt: Date,
  ) {}

  public static create(
    properties: CreateFinancialAuditEventProperties,
  ): FinancialAuditEvent {
    assertRequiredText(properties.id, 'Audit event id');
    assertRequiredText(properties.ownerId, 'Audit event owner id');
    assertRequiredText(properties.actorId, 'Audit event actor id');
    assertRequiredText(properties.resourceId, 'Audit event resource id');
    if (Number.isNaN(properties.occurredAt.getTime())) {
      throw new InvalidFinancialAuditEventError(
        'Audit event instant must be valid.',
      );
    }
    return new FinancialAuditEvent(
      properties.id,
      properties.ownerId,
      properties.actorId,
      properties.action,
      properties.resourceType,
      properties.resourceId,
      new Date(properties.occurredAt),
    );
  }

  public toSnapshot(): FinancialAuditEventSnapshot {
    return {
      action: this.action,
      actorId: this.actorId,
      id: this.id,
      occurredAt: new Date(this.occurredAt),
      ownerId: this.ownerId,
      resourceId: this.resourceId,
      resourceType: this.resourceType,
    };
  }
}

function assertRequiredText(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new InvalidFinancialAuditEventError(`${label} is required.`);
  }
}
