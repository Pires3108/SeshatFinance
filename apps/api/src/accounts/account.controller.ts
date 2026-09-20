import {
  AccountVersionConflictError,
  ChangeOwnedAccountLifecycleUseCase,
  CreateAccountUseCase,
  GetOwnedAccountUseCase,
  OwnedAccountNotFoundError,
} from '@seshat/application';
import {
  AccountLifecycleError,
  InvalidAccountError,
  InvalidAccountTypeError,
  InvalidCurrencyError,
  InvalidMoneyAmountError,
  type Account,
  type AccountSnapshot,
} from '@seshat/domain';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  type SchemaObject,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { AuthenticatedActorContext } from '../auth/authenticated-actor-context.js';
import { BearerAuthGuard } from '../auth/bearer-auth.guard.js';
import { ZodValidationPipe } from '../platform/zod-validation.pipe.js';

const accountIdSchema = z.uuid();
const plainDecimalPattern = /^-?\d+(?:\.\d+)?$/u;
const typeKeyPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const createAccountSchema = z.object({
  color: z.string().trim().min(1).nullable(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/u),
  currencyMinorUnitScale: z.number().int().min(0).max(18),
  description: z.string().trim().min(1).nullable(),
  icon: z.string().trim().min(1).nullable(),
  initialBalance: z.string().max(1002).regex(plainDecimalPattern),
  institution: z.string().trim().min(1).nullable(),
  name: z.string().trim().min(1),
  typeKey: z.string().regex(typeKeyPattern),
});
const lifecycleSchema = z.object({
  action: z.enum([
    'archive',
    'unarchive',
    'move-to-trash',
    'restore-from-trash',
  ]),
});

type CreateAccountRequest = z.infer<typeof createAccountSchema>;
type LifecycleRequest = z.infer<typeof lifecycleSchema>;
type AccountResponse = Readonly<{
  archivedAt: string | null;
  color: string | null;
  createdAt: string;
  currencyCode: string;
  currencyMinorUnitScale: number;
  description: string | null;
  icon: string | null;
  id: string;
  initialBalance: string;
  institution: string | null;
  lifecycle: AccountSnapshot['lifecycle'];
  name: string;
  trashedAt: string | null;
  typeKey: string;
  updatedAt: string;
  version: number;
}>;

const accountResponseSchema: SchemaObject = {
  properties: {
    archivedAt: { format: 'date-time', nullable: true, type: 'string' },
    color: { nullable: true, type: 'string' },
    createdAt: { format: 'date-time', type: 'string' },
    currencyCode: { pattern: '^[A-Z]{3}$', type: 'string' },
    currencyMinorUnitScale: { maximum: 18, minimum: 0, type: 'integer' },
    description: { nullable: true, type: 'string' },
    icon: { nullable: true, type: 'string' },
    id: { format: 'uuid', type: 'string' },
    initialBalance: { pattern: '^-?\\d+(?:\\.\\d+)?$', type: 'string' },
    institution: { nullable: true, type: 'string' },
    lifecycle: { enum: ['active', 'archived', 'trashed'], type: 'string' },
    name: { type: 'string' },
    trashedAt: { format: 'date-time', nullable: true, type: 'string' },
    typeKey: { type: 'string' },
    updatedAt: { format: 'date-time', type: 'string' },
    version: { minimum: 1, type: 'integer' },
  },
  required: [
    'archivedAt',
    'color',
    'createdAt',
    'currencyCode',
    'currencyMinorUnitScale',
    'description',
    'icon',
    'id',
    'initialBalance',
    'institution',
    'lifecycle',
    'name',
    'trashedAt',
    'typeKey',
    'updatedAt',
    'version',
  ],
  type: 'object',
};

@Controller('accounts')
@ApiTags('accounts')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer token missing or invalid' })
@UseGuards(BearerAuthGuard)
export class AccountController {
  public constructor(
    @Inject(CreateAccountUseCase)
    private readonly createAccount: CreateAccountUseCase,
    @Inject(GetOwnedAccountUseCase)
    private readonly getAccount: GetOwnedAccountUseCase,
    @Inject(ChangeOwnedAccountLifecycleUseCase)
    private readonly changeLifecycle: ChangeOwnedAccountLifecycleUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Create an account owned by the authenticated user',
  })
  @ApiBody({ schema: createAccountBodySchema() })
  @ApiCreatedResponse({ schema: accountResponseSchema })
  public async create(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(createAccountSchema))
    body: CreateAccountRequest,
  ): Promise<AccountResponse> {
    try {
      return mapAccount(
        await this.createAccount.execute({
          actorId: this.actorId(request),
          ...body,
        }),
      );
    } catch (error) {
      throw mapDomainError(error);
    }
  }

  @Get(':accountId')
  @ApiOperation({ summary: 'Get an account owned by the authenticated user' })
  @ApiParam({ format: 'uuid', name: 'accountId', type: 'string' })
  @ApiOkResponse({ schema: accountResponseSchema })
  @ApiNotFoundResponse({ description: 'Owned account was not found' })
  public async get(
    @Req() request: FastifyRequest,
    @Param('accountId', new ZodValidationPipe(accountIdSchema))
    accountId: string,
  ): Promise<AccountResponse> {
    const account = await this.getAccount.execute(
      accountId,
      this.actorId(request),
    );
    if (account === null) throw new NotFoundException('Account not found.');
    return mapAccount(account);
  }

  @Patch(':accountId/lifecycle')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change an owned account lifecycle' })
  @ApiParam({ format: 'uuid', name: 'accountId', type: 'string' })
  @ApiBody({
    schema: {
      additionalProperties: false,
      properties: {
        action: {
          enum: ['archive', 'unarchive', 'move-to-trash', 'restore-from-trash'],
          type: 'string',
        },
      },
      required: ['action'],
      type: 'object',
    },
  })
  @ApiOkResponse({ schema: accountResponseSchema })
  @ApiNotFoundResponse({ description: 'Owned account was not found' })
  public async lifecycle(
    @Req() request: FastifyRequest,
    @Param('accountId', new ZodValidationPipe(accountIdSchema))
    accountId: string,
    @Body(new ZodValidationPipe(lifecycleSchema)) body: LifecycleRequest,
  ): Promise<AccountResponse> {
    try {
      return mapAccount(
        await this.changeLifecycle.execute({
          accountId,
          action: body.action,
          actorId: this.actorId(request),
        }),
      );
    } catch (error) {
      throw mapDomainError(error);
    }
  }

  private actorId(request: FastifyRequest): string {
    const actor = this.actors.get(request);
    if (actor === undefined) throw new UnauthorizedException();
    return actor.id;
  }
}

function mapAccount(account: Account): AccountResponse {
  const snapshot = account.toSnapshot();
  return {
    archivedAt: snapshot.archivedAt?.toISOString() ?? null,
    color: snapshot.color,
    createdAt: snapshot.createdAt.toISOString(),
    currencyCode: snapshot.initialBalance.currency.code,
    currencyMinorUnitScale: snapshot.initialBalance.currency.minorUnitScale,
    description: snapshot.description,
    icon: snapshot.icon,
    id: snapshot.id,
    initialBalance: snapshot.initialBalance.amount,
    institution: snapshot.institution,
    lifecycle: snapshot.lifecycle,
    name: snapshot.name,
    trashedAt: snapshot.trashedAt?.toISOString() ?? null,
    typeKey: snapshot.type.key,
    updatedAt: snapshot.updatedAt.toISOString(),
    version: snapshot.version,
  };
}

function mapDomainError(error: unknown): Error {
  if (error instanceof OwnedAccountNotFoundError) {
    return new NotFoundException('Account not found.');
  }
  if (error instanceof AccountVersionConflictError) {
    return new ConflictException('Account was modified concurrently.');
  }
  if (
    error instanceof AccountLifecycleError ||
    error instanceof InvalidAccountError ||
    error instanceof InvalidAccountTypeError ||
    error instanceof InvalidCurrencyError ||
    error instanceof InvalidMoneyAmountError
  ) {
    return new BadRequestException('Invalid account operation.');
  }
  return error instanceof Error ? error : new Error('Unknown account error.');
}

function createAccountBodySchema(): SchemaObject {
  return {
    additionalProperties: false,
    properties: {
      color: { nullable: true, type: 'string' },
      currencyCode: { pattern: '^[A-Z]{3}$', type: 'string' },
      currencyMinorUnitScale: { maximum: 18, minimum: 0, type: 'integer' },
      description: { nullable: true, type: 'string' },
      icon: { nullable: true, type: 'string' },
      initialBalance: {
        maxLength: 1002,
        pattern: '^-?\\d+(?:\\.\\d+)?$',
        type: 'string',
      },
      institution: { nullable: true, type: 'string' },
      name: { minLength: 1, type: 'string' },
      typeKey: { pattern: '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$', type: 'string' },
    },
    required: [
      'color',
      'currencyCode',
      'currencyMinorUnitScale',
      'description',
      'icon',
      'initialBalance',
      'institution',
      'name',
      'typeKey',
    ],
    type: 'object',
  };
}
