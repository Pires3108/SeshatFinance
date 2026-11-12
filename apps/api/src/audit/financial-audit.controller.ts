import {
  ListOwnedFinancialAuditTrailUseCase,
  VerifyOwnedFinancialAuditChainUseCase,
  type FinancialAuditTrailEntry,
} from '@seshat/application';
import {
  financialAuditResourceTypes,
  type FinancialAuditResourceType,
} from '@seshat/domain';
import {
  Controller,
  Get,
  Inject,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
  type SchemaObject,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { AuthenticatedActorContext } from '../auth/authenticated-actor-context.js';
import { BearerAuthGuard } from '../auth/bearer-auth.guard.js';
import { ZodValidationPipe } from '../platform/zod-validation.pipe.js';

const listSchema = z
  .object({
    afterSequence: z
      .string()
      .regex(/^\d{1,18}$/u)
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    resourceType: z.enum(financialAuditResourceTypes).optional(),
    resourceId: z.uuid().optional(),
  })
  .strict();
type ListRequest = z.infer<typeof listSchema>;

/** Allowlisted fields only (27/09): no amounts, descriptions or snapshots. */
type EntryResponse = Readonly<{
  id: string;
  sequence: string;
  occurredAt: string;
  actorId: string;
  action: string;
  resourceType: FinancialAuditResourceType;
  resourceId: string;
  result: 'succeeded' | 'failed';
  errorCode: string | null;
  correlationId: string | null;
  previousHash: string;
  hash: string;
}>;

type VerificationResponse = Readonly<{
  checkedEvents: string;
  valid: boolean;
  firstInvalidSequence: string | null;
}>;

const entrySchema: SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    sequence: { type: 'string', pattern: '^\\d+$' },
    occurredAt: { type: 'string', format: 'date-time' },
    actorId: { type: 'string', format: 'uuid' },
    action: { type: 'string' },
    resourceType: { type: 'string', enum: [...financialAuditResourceTypes] },
    resourceId: { type: 'string', format: 'uuid' },
    result: { type: 'string', enum: ['succeeded', 'failed'] },
    errorCode: { type: 'string', nullable: true },
    correlationId: { type: 'string', format: 'uuid', nullable: true },
    previousHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    hash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
  },
  required: [
    'id',
    'sequence',
    'occurredAt',
    'actorId',
    'action',
    'resourceType',
    'resourceId',
    'result',
    'errorCode',
    'correlationId',
    'previousHash',
    'hash',
  ],
};

@Controller('audit-events')
@ApiTags('audit')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer token missing or invalid' })
@UseGuards(BearerAuthGuard)
export class FinancialAuditController {
  public constructor(
    @Inject(ListOwnedFinancialAuditTrailUseCase)
    private readonly listTrail: ListOwnedFinancialAuditTrailUseCase,
    @Inject(VerifyOwnedFinancialAuditChainUseCase)
    private readonly verifyChain: VerifyOwnedFinancialAuditChainUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List the authenticated owner financial audit trail in order',
  })
  @ApiQuery({ name: 'afterSequence', required: false, type: 'string' })
  @ApiQuery({ name: 'limit', required: false, type: 'integer' })
  @ApiQuery({
    name: 'resourceType',
    required: false,
    enum: [...financialAuditResourceTypes],
  })
  @ApiQuery({ name: 'resourceId', required: false, format: 'uuid' })
  @ApiOkResponse({ schema: { type: 'array', items: entrySchema } })
  public async list(
    @Req() request: FastifyRequest,
    @Query(new ZodValidationPipe(listSchema)) query: ListRequest,
  ): Promise<readonly EntryResponse[]> {
    const entries = await this.listTrail.execute(this.actorId(request), {
      limit: query.limit ?? 50,
      ...(query.afterSequence === undefined
        ? {}
        : { afterSequence: BigInt(query.afterSequence) }),
      ...(query.resourceType === undefined
        ? {}
        : { resourceType: query.resourceType }),
      ...(query.resourceId === undefined
        ? {}
        : { resourceId: query.resourceId }),
    });
    return entries.map(mapEntry);
  }

  @Get('verification')
  @ApiOperation({
    summary: 'Recompute the authenticated owner audit hash chain',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        checkedEvents: { type: 'string', pattern: '^\\d+$' },
        valid: { type: 'boolean' },
        firstInvalidSequence: { type: 'string', nullable: true },
      },
      required: ['checkedEvents', 'valid', 'firstInvalidSequence'],
    },
  })
  public async verification(
    @Req() request: FastifyRequest,
  ): Promise<VerificationResponse> {
    const result = await this.verifyChain.execute(this.actorId(request));
    return {
      checkedEvents: result.checkedEvents.toString(),
      valid: result.firstInvalidSequence === null,
      firstInvalidSequence: result.firstInvalidSequence?.toString() ?? null,
    };
  }

  private actorId(request: FastifyRequest): string {
    const actor = this.actors.get(request);
    if (actor === undefined) throw new UnauthorizedException();
    return actor.id;
  }
}

function mapEntry(entry: FinancialAuditTrailEntry): EntryResponse {
  return {
    id: entry.id,
    sequence: entry.sequence.toString(),
    occurredAt: entry.occurredAt.toISOString(),
    actorId: entry.actorId,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    result: entry.result,
    errorCode: entry.errorCode,
    correlationId: entry.correlationId,
    previousHash: entry.previousHash,
    hash: entry.hash,
  };
}
