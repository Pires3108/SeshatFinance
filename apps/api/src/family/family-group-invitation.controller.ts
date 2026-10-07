import {
  AcceptFamilyGroupInvitationUseCase,
  CreateFamilyGroupInvitationUseCase,
  FamilyGroupInvitationDeniedError,
  RevokeFamilyGroupInvitationUseCase,
} from '@seshat/application';
import {
  Controller,
  Body,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthenticatedActorContext } from '../auth/authenticated-actor-context.js';
import { BearerAuthGuard } from '../auth/bearer-auth.guard.js';
import { ZodValidationPipe } from '../platform/zod-validation.pipe.js';
import { hashInvitationToken } from './system-invitation-token-generator.js';

const createSchema = z.object({
  email: z.string().email(),
  role: z.enum(['administrator', 'member', 'viewer']),
});
const acceptSchema = z.object({ token: z.string().min(32).max(512) });
type CreateRequest = z.infer<typeof createSchema>;
type AcceptRequest = z.infer<typeof acceptSchema>;

@Controller()
@ApiTags('family-group-invitations')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Bearer token missing, invalid, or email is not confirmed',
})
@UseGuards(BearerAuthGuard)
export class FamilyGroupInvitationController {
  public constructor(
    @Inject(CreateFamilyGroupInvitationUseCase)
    private readonly createInvitation: CreateFamilyGroupInvitationUseCase,
    @Inject(AcceptFamilyGroupInvitationUseCase)
    private readonly acceptInvitation: AcceptFamilyGroupInvitationUseCase,
    @Inject(RevokeFamilyGroupInvitationUseCase)
    private readonly revokeInvitation: RevokeFamilyGroupInvitationUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Post('family-groups/:groupId/invitations')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a single use family group invitation' })
  @ApiParam({ name: 'groupId', format: 'uuid', type: 'string' })
  @ApiCreatedResponse({
    description:
      'Invitation created; token is returned only for delivery by the trusted boundary',
  })
  public async create(
    @Req() request: FastifyRequest,
    @Param('groupId', new ZodValidationPipe(z.uuid())) groupId: string,
    @Body(new ZodValidationPipe(createSchema)) body: CreateRequest,
  ): Promise<unknown> {
    const actor = this.actor(request);
    try {
      const result = await this.createInvitation.execute({
        actorId: actor.id,
        groupId,
        email: body.email,
        role: body.role,
      });
      return {
        invitationId: result.invitation.id,
        groupId: result.invitation.groupId,
        email: result.invitation.email,
        role: result.invitation.role,
        expiresAt: result.invitation.expiresAt.toISOString(),
        token: result.token,
      };
    } catch (error) {
      if (
        error instanceof FamilyGroupInvitationDeniedError ||
        (error instanceof Error &&
          error.message === 'Family group invitation is not allowed.')
      )
        throw new ForbiddenException('Family group invitation is not allowed.');
      throw error;
    }
  }

  @Post('family-group-invitations/accept')
  @ApiOperation({
    summary:
      'Accept an invitation using the confirmed authenticated identity email',
  })
  public async accept(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(acceptSchema)) body: AcceptRequest,
  ): Promise<
    Readonly<{ invitationId: string; groupId: string; role: string }>
  > {
    const actor = this.actor(request);
    if (actor.confirmedEmail === undefined)
      throw new UnauthorizedException('A confirmed email is required.');
    const invitation = await this.acceptInvitation.execute({
      tokenHash: hashInvitationToken(body.token),
      userId: actor.id,
      confirmedEmail: actor.confirmedEmail,
    });
    return {
      invitationId: invitation.id,
      groupId: invitation.groupId,
      role: invitation.role,
    };
  }

  @Post('family-group-invitations/:invitationId/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a pending family group invitation' })
  @ApiParam({ name: 'invitationId', format: 'uuid', type: 'string' })
  public async revoke(
    @Req() request: FastifyRequest,
    @Param('invitationId', new ZodValidationPipe(z.uuid()))
    invitationId: string,
  ): Promise<void> {
    const actor = this.actor(request);
    await this.revokeInvitation.execute(invitationId, actor.id);
  }

  private actor(request: FastifyRequest) {
    const actor = this.actors.get(request);
    if (actor === undefined) throw new UnauthorizedException();
    return actor;
  }
}
