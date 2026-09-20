import {
  CostCenterVersionConflictError,
  CreateCostCenterUseCase,
  ListOwnedCostCentersUseCase,
  OwnedCostCenterNotFoundError,
  RenameOwnedCostCenterUseCase,
} from '@seshat/application';
import { InvalidCostCenterError, type CostCenter } from '@seshat/domain';
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

const costCenterIdSchema = z.uuid();
const createCostCenterSchema = z.object({ name: z.string().trim().min(1) });
const renameCostCenterSchema = z.object({ name: z.string().trim().min(1) });

type CreateCostCenterRequest = z.infer<typeof createCostCenterSchema>;
type RenameCostCenterRequest = z.infer<typeof renameCostCenterSchema>;
type CostCenterResponse = Readonly<{
  createdAt: string;
  id: string;
  name: string;
  updatedAt: string;
  version: number;
}>;

const responseSchema: SchemaObject = {
  properties: {
    createdAt: { format: 'date-time', type: 'string' },
    id: { format: 'uuid', type: 'string' },
    name: { minLength: 1, type: 'string' },
    updatedAt: { format: 'date-time', type: 'string' },
    version: { minimum: 1, type: 'integer' },
  },
  required: ['createdAt', 'id', 'name', 'updatedAt', 'version'],
  type: 'object',
};

@Controller('cost-centers')
@ApiTags('cost-centers')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer token missing or invalid' })
@UseGuards(BearerAuthGuard)
export class CostCenterController {
  public constructor(
    @Inject(CreateCostCenterUseCase)
    private readonly createCostCenter: CreateCostCenterUseCase,
    @Inject(ListOwnedCostCentersUseCase)
    private readonly listCostCenters: ListOwnedCostCentersUseCase,
    @Inject(RenameOwnedCostCenterUseCase)
    private readonly renameCostCenter: RenameOwnedCostCenterUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Create a cost center owned by the authenticated user',
  })
  @ApiBody({ schema: bodySchema() })
  @ApiCreatedResponse({ schema: responseSchema })
  public async create(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(createCostCenterSchema))
    body: CreateCostCenterRequest,
  ): Promise<CostCenterResponse> {
    try {
      return mapCostCenter(
        await this.createCostCenter.execute({
          actorId: this.actorId(request),
          name: body.name,
        }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Get()
  @ApiOperation({
    summary: 'List cost centers owned by the authenticated user',
  })
  @ApiOkResponse({ schema: { items: responseSchema, type: 'array' } })
  public async list(
    @Req() request: FastifyRequest,
  ): Promise<readonly CostCenterResponse[]> {
    const costCenters = await this.listCostCenters.execute(
      this.actorId(request),
    );
    return costCenters.map(mapCostCenter);
  }

  @Patch(':costCenterId')
  @ApiOperation({ summary: 'Rename an owned cost center' })
  @ApiParam({ format: 'uuid', name: 'costCenterId', type: 'string' })
  @ApiBody({ schema: bodySchema() })
  @ApiOkResponse({ schema: responseSchema })
  @ApiNotFoundResponse({ description: 'Owned cost center was not found' })
  public async rename(
    @Req() request: FastifyRequest,
    @Param('costCenterId', new ZodValidationPipe(costCenterIdSchema))
    costCenterId: string,
    @Body(new ZodValidationPipe(renameCostCenterSchema))
    body: RenameCostCenterRequest,
  ): Promise<CostCenterResponse> {
    try {
      return mapCostCenter(
        await this.renameCostCenter.execute({
          actorId: this.actorId(request),
          costCenterId,
          name: body.name,
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

function mapCostCenter(costCenter: CostCenter): CostCenterResponse {
  const snapshot = costCenter.toSnapshot();
  return {
    createdAt: snapshot.createdAt.toISOString(),
    id: snapshot.id,
    name: snapshot.name,
    updatedAt: snapshot.updatedAt.toISOString(),
    version: snapshot.version,
  };
}

function mapError(error: unknown): Error {
  if (error instanceof OwnedCostCenterNotFoundError) {
    return new NotFoundException('Cost center not found.');
  }
  if (error instanceof CostCenterVersionConflictError) {
    return new ConflictException('Cost center was modified concurrently.');
  }
  if (error instanceof InvalidCostCenterError) {
    return new BadRequestException('Invalid cost center operation.');
  }
  return error instanceof Error
    ? error
    : new Error('Unknown cost center error.');
}

function bodySchema(): SchemaObject {
  return {
    additionalProperties: false,
    properties: { name: { minLength: 1, type: 'string' } },
    required: ['name'],
    type: 'object',
  };
}
