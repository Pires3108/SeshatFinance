import {
  CreateFamilyGroupUseCase,
  ListOwnFamilyGroupsUseCase,
} from '@seshat/application';
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  type SchemaObject,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { AuthenticatedActorContext } from '../auth/authenticated-actor-context.js';
import { BearerAuthGuard } from '../auth/bearer-auth.guard.js';

type FamilyGroupResponse = Readonly<{
  groupId: string;
  joinedAt: string;
  role: 'owner' | 'administrator' | 'member' | 'viewer';
}>;

const responseSchema: SchemaObject = {
  properties: {
    groupId: { format: 'uuid', type: 'string' },
    joinedAt: { format: 'date-time', type: 'string' },
    role: {
      enum: ['owner', 'administrator', 'member', 'viewer'],
      type: 'string',
    },
  },
  required: ['groupId', 'joinedAt', 'role'],
  type: 'object',
};

@Controller('family-groups')
@ApiTags('family-groups')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer token missing or invalid' })
@UseGuards(BearerAuthGuard)
export class FamilyGroupController {
  public constructor(
    @Inject(CreateFamilyGroupUseCase)
    private readonly createFamilyGroup: CreateFamilyGroupUseCase,
    @Inject(ListOwnFamilyGroupsUseCase)
    private readonly listFamilyGroups: ListOwnFamilyGroupsUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a family group with the authenticated user as its owner',
  })
  @ApiCreatedResponse({ schema: responseSchema })
  public async create(
    @Req() request: FastifyRequest,
  ): Promise<FamilyGroupResponse> {
    return mapMembership(
      await this.createFamilyGroup.execute(this.actorId(request)),
    );
  }

  @Get()
  @ApiOperation({ summary: 'List family groups of the authenticated user' })
  @ApiOkResponse({ schema: { items: responseSchema, type: 'array' } })
  public async list(
    @Req() request: FastifyRequest,
  ): Promise<readonly FamilyGroupResponse[]> {
    return (await this.listFamilyGroups.execute(this.actorId(request))).map(
      (membership) => ({
        groupId: membership.groupId,
        joinedAt: membership.joinedAt.toISOString(),
        role: membership.role,
      }),
    );
  }

  private actorId(request: FastifyRequest): string {
    const actor = this.actors.get(request);
    if (actor === undefined) throw new UnauthorizedException();
    return actor.id;
  }
}

function mapMembership(membership: {
  toSnapshot(): {
    groupId: string;
    joinedAt: Date;
    role: FamilyGroupResponse['role'];
  };
}): FamilyGroupResponse {
  const snapshot = membership.toSnapshot();
  return {
    groupId: snapshot.groupId,
    joinedAt: snapshot.joinedAt.toISOString(),
    role: snapshot.role,
  };
}
