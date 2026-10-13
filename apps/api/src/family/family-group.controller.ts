import {
  ChangeFamilyGroupRoleUseCase,
  CreateFamilyGroupUseCase,
  FamilyGroupRoleChangeDeniedError,
  ListOwnFamilyGroupsUseCase,
} from '@seshat/application';
import {
  Controller,
  Body,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Patch,
  Param,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiBody,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  type SchemaObject,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type { FamilyGroupRole } from '@seshat/domain';
import { z } from 'zod';

import { AuthenticatedActorContext } from '../auth/authenticated-actor-context.js';
import { BearerAuthGuard } from '../auth/bearer-auth.guard.js';
import { ZodValidationPipe } from '../platform/zod-validation.pipe.js';

const roleChangeSchema = z.object({
  role: z.enum(['administrator', 'member', 'viewer']),
});
type RoleChangeRequest = z.infer<typeof roleChangeSchema>;

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
    @Inject(ChangeFamilyGroupRoleUseCase)
    private readonly changeFamilyGroupRole: ChangeFamilyGroupRoleUseCase,
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

  @Patch(':groupId/members/:userId/role')
  @ApiOperation({ summary: 'Change a family group membership role' })
  @ApiParam({ name: 'groupId', format: 'uuid', type: 'string' })
  @ApiParam({ name: 'userId', format: 'uuid', type: 'string' })
  @ApiBody({
    schema: {
      properties: {
        role: { enum: ['administrator', 'member', 'viewer'], type: 'string' },
      },
      required: ['role'],
      type: 'object',
    },
  })
  @ApiOkResponse({
    schema: {
      properties: {
        role: {
          enum: ['owner', 'administrator', 'member', 'viewer'],
          type: 'string',
        },
      },
      required: ['role'],
      type: 'object',
    },
  })
  @ApiForbiddenResponse({
    description: 'Membership or role change is not allowed',
  })
  public async changeRole(
    @Req() request: FastifyRequest,
    @Param('groupId', new ZodValidationPipe(z.uuid())) groupId: string,
    @Param('userId', new ZodValidationPipe(z.uuid())) targetUserId: string,
    @Body(new ZodValidationPipe(roleChangeSchema)) body: RoleChangeRequest,
  ): Promise<Readonly<{ role: FamilyGroupRole }>> {
    try {
      const role = await this.changeFamilyGroupRole.execute({
        actorId: this.actorId(request),
        groupId,
        nextRole: body.role,
        targetUserId,
      });
      return { role };
    } catch (error) {
      if (error instanceof FamilyGroupRoleChangeDeniedError) {
        throw new ForbiddenException(
          'Family group role change is not allowed.',
        );
      }
      throw error;
    }
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
