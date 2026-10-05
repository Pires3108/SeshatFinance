import {
  ChangeOwnedCounterpartyStatusUseCase,
  CounterpartyConflictError,
  CreateCounterpartyUseCase,
  GetOwnedCounterpartyUseCase,
  InvalidMergeTargetError,
  ListOwnedCounterpartiesUseCase,
  MergeOwnedCounterpartiesUseCase,
  OwnedCounterpartyNotFoundError,
  UpdateOwnedCounterpartyUseCase,
} from '@seshat/application';
import { InvalidCounterpartyError, type Counterparty } from '@seshat/domain';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { AuthenticatedActorContext } from '../auth/authenticated-actor-context.js';
import { BearerAuthGuard } from '../auth/bearer-auth.guard.js';
import { ZodValidationPipe } from '../platform/zod-validation.pipe.js';

const idSchema = z.uuid();
const detailsSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  type: z.enum(['person', 'company', 'institution']),
  email: z.email().max(254).nullable(),
  phone: z.string().max(40).nullable(),
  document: z.string().max(40).nullable(),
  notes: z.string().max(2000).nullable(),
});
const listSchema = z.enum(['active', 'inactive', 'merged']).optional();
const mergeSchema = z.strictObject({ targetId: z.uuid() });
type DetailsRequest = z.infer<typeof detailsSchema>;
type CounterpartyResponse = Readonly<{
  id: string;
  name: string;
  type: 'person' | 'company' | 'institution';
  email: string | null;
  phone: string | null;
  document: string | null;
  notes: string | null;
  status: 'active' | 'inactive' | 'merged';
  mergedIntoId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}>;

@Controller('counterparties')
@ApiTags('counterparties')
@ApiBearerAuth()
@UseGuards(BearerAuthGuard)
export class CounterpartyController {
  public constructor(
    @Inject(CreateCounterpartyUseCase)
    private readonly createUseCase: CreateCounterpartyUseCase,
    @Inject(ListOwnedCounterpartiesUseCase)
    private readonly listUseCase: ListOwnedCounterpartiesUseCase,
    @Inject(GetOwnedCounterpartyUseCase)
    private readonly getUseCase: GetOwnedCounterpartyUseCase,
    @Inject(UpdateOwnedCounterpartyUseCase)
    private readonly updateUseCase: UpdateOwnedCounterpartyUseCase,
    @Inject(ChangeOwnedCounterpartyStatusUseCase)
    private readonly statusUseCase: ChangeOwnedCounterpartyStatusUseCase,
    @Inject(MergeOwnedCounterpartiesUseCase)
    private readonly mergeUseCase: MergeOwnedCounterpartiesUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Post()
  public async create(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(detailsSchema)) body: DetailsRequest,
  ): Promise<CounterpartyResponse> {
    try {
      return map(
        await this.createUseCase.execute({
          actorId: this.actorId(request),
          ...body,
        }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Get()
  public async list(
    @Req() request: FastifyRequest,
    @Query('status', new ZodValidationPipe(listSchema))
    status?: 'active' | 'inactive' | 'merged',
  ): Promise<readonly CounterpartyResponse[]> {
    return (await this.listUseCase.execute(this.actorId(request), status)).map(
      map,
    );
  }

  @Get(':id')
  public async get(
    @Req() request: FastifyRequest,
    @Param('id', new ZodValidationPipe(idSchema)) id: string,
  ): Promise<CounterpartyResponse> {
    try {
      return map(await this.getUseCase.execute(this.actorId(request), id));
    } catch (error) {
      throw mapError(error);
    }
  }

  @Patch(':id')
  public async update(
    @Req() request: FastifyRequest,
    @Param('id', new ZodValidationPipe(idSchema)) id: string,
    @Body(new ZodValidationPipe(detailsSchema)) body: DetailsRequest,
  ): Promise<CounterpartyResponse> {
    try {
      return map(
        await this.updateUseCase.execute({
          actorId: this.actorId(request),
          id,
          ...body,
        }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Post(':id/deactivate')
  public async deactivate(
    @Req() request: FastifyRequest,
    @Param('id', new ZodValidationPipe(idSchema)) id: string,
  ): Promise<CounterpartyResponse> {
    return this.changeStatus(request, id, 'deactivate');
  }

  @Post(':id/reactivate')
  public async reactivate(
    @Req() request: FastifyRequest,
    @Param('id', new ZodValidationPipe(idSchema)) id: string,
  ): Promise<CounterpartyResponse> {
    return this.changeStatus(request, id, 'reactivate');
  }

  @Post(':id/merge')
  public async merge(
    @Req() request: FastifyRequest,
    @Param('id', new ZodValidationPipe(idSchema)) id: string,
    @Body(new ZodValidationPipe(mergeSchema)) body: z.infer<typeof mergeSchema>,
  ): Promise<CounterpartyResponse> {
    try {
      return map(
        await this.mergeUseCase.execute({
          actorId: this.actorId(request),
          sourceId: id,
          targetId: body.targetId,
        }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  private async changeStatus(
    request: FastifyRequest,
    id: string,
    action: 'deactivate' | 'reactivate',
  ): Promise<CounterpartyResponse> {
    try {
      return map(
        await this.statusUseCase.execute({
          actorId: this.actorId(request),
          id,
          action,
        }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  private actorId(request: FastifyRequest): string {
    const actor = this.actors.get(request);
    if (actor === undefined) throw new UnauthorizedException();
    return actor.id;
  }
}

function map(item: Counterparty): CounterpartyResponse {
  const snapshot = item.toSnapshot();
  return {
    ...snapshot,
    createdAt: snapshot.createdAt.toISOString(),
    updatedAt: snapshot.updatedAt.toISOString(),
  };
}

function mapError(error: unknown): Error {
  if (error instanceof OwnedCounterpartyNotFoundError)
    return new NotFoundException('Entidade não encontrada.');
  if (error instanceof CounterpartyConflictError)
    return new ConflictException('Entidade alterada simultaneamente.');
  if (
    error instanceof InvalidCounterpartyError ||
    error instanceof InvalidMergeTargetError
  )
    return new BadRequestException('Operação inválida para a entidade.');
  return error instanceof Error
    ? error
    : new Error('Unknown counterparty error.');
}
