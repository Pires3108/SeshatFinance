import {
  GetOwnUserProfileUseCase,
  InvalidUserProfilePreferencesError,
  UpdateOwnUserProfileUseCase,
  type UserProfile,
} from '@seshat/application';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Patch,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  type SchemaObject,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { AuthenticatedActorContext } from '../auth/authenticated-actor-context.js';
import { BearerAuthGuard } from '../auth/bearer-auth.guard.js';
import { ZodValidationPipe } from '../platform/zod-validation.pipe.js';

const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(120).nullable(),
  locale: z.literal('pt-BR'),
  presentationCurrency: z.literal('BRL'),
  timeZone: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, 'Invalid IANA time zone.'),
});

type UpdateProfileRequest = z.infer<typeof updateProfileSchema>;
type UserProfileResponse = Readonly<{
  createdAt: string;
  displayName: string | null;
  id: string;
  locale: string;
  presentationCurrency: string;
  timeZone: string;
  updatedAt: string;
  version: number;
}>;

const profileResponseSchema: SchemaObject = {
  properties: {
    createdAt: { format: 'date-time', type: 'string' },
    displayName: { nullable: true, type: 'string' },
    id: { type: 'string' },
    locale: { type: 'string' },
    presentationCurrency: { maxLength: 3, minLength: 3, type: 'string' },
    timeZone: { type: 'string' },
    updatedAt: { format: 'date-time', type: 'string' },
    version: { minimum: 1, type: 'integer' },
  },
  required: [
    'createdAt',
    'displayName',
    'id',
    'locale',
    'presentationCurrency',
    'timeZone',
    'updatedAt',
    'version',
  ],
  type: 'object',
};

@Controller('users/me/profile')
@ApiTags('users')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer token missing or invalid' })
@UseGuards(BearerAuthGuard)
export class UserProfileController {
  public constructor(
    @Inject(GetOwnUserProfileUseCase)
    private readonly getProfile: GetOwnUserProfileUseCase,
    @Inject(UpdateOwnUserProfileUseCase)
    private readonly updateProfile: UpdateOwnUserProfileUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get the authenticated user profile' })
  @ApiOkResponse({ schema: profileResponseSchema })
  @ApiNotFoundResponse({ description: 'Profile has not been created' })
  public async get(
    @Req() request: FastifyRequest,
  ): Promise<UserProfileResponse> {
    const profile = await this.getProfile.execute(this.actorId(request));
    if (profile === null) {
      throw new NotFoundException('Profile not found.');
    }
    return mapResponse(profile);
  }

  @Patch()
  @ApiOperation({ summary: 'Create or update the authenticated user profile' })
  @ApiBody({
    schema: {
      additionalProperties: false,
      properties: {
        displayName: {
          maxLength: 120,
          minLength: 1,
          nullable: true,
          type: 'string',
        },
        locale: { enum: ['pt-BR'], type: 'string' },
        presentationCurrency: {
          enum: ['BRL'],
          type: 'string',
        },
        timeZone: { maxLength: 64, minLength: 1, type: 'string' },
      },
      required: ['displayName', 'locale', 'presentationCurrency', 'timeZone'],
      type: 'object',
    },
  })
  @ApiOkResponse({ schema: profileResponseSchema })
  public async update(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(updateProfileSchema))
    body: UpdateProfileRequest,
  ): Promise<UserProfileResponse> {
    try {
      return mapResponse(
        await this.updateProfile.execute({
          actorId: this.actorId(request),
          ...body,
        }),
      );
    } catch (error) {
      if (error instanceof InvalidUserProfilePreferencesError) {
        throw new BadRequestException('Invalid profile preferences.');
      }
      throw error;
    }
  }

  private actorId(request: FastifyRequest): string {
    const actor = this.actors.get(request);
    if (actor === undefined) {
      throw new UnauthorizedException();
    }
    return actor.id;
  }
}

function mapResponse(profile: UserProfile): UserProfileResponse {
  return {
    ...profile,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}
