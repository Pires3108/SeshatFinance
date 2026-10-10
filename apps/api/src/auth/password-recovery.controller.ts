import {
  CompletePasswordRecoveryUseCase,
  InvalidRecoveryTokenError,
  RequestPasswordRecoveryUseCase,
} from '@seshat/application';
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBody,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
  ApiServiceUnavailableResponse,
} from '@nestjs/swagger';
import { z } from 'zod';

import { ZodValidationPipe } from '../platform/zod-validation.pipe.js';
import { AuthConfiguration } from './auth-configuration.js';

const requestPasswordRecoverySchema = z
  .object({
    email: z.email().max(320),
  })
  .strict();
const completePasswordRecoverySchema = z
  .object({
    tokenHash: z.string().min(1).max(2048),
    password: z.string().min(1).max(1024),
  })
  .strict();

type RequestPasswordRecoveryRequest = z.infer<
  typeof requestPasswordRecoverySchema
>;

export type RequestPasswordRecoveryResponse = Readonly<{
  status: 'accepted';
}>;

@Controller('auth')
@ApiTags('auth')
export class PasswordRecoveryController {
  public constructor(
    @Inject(RequestPasswordRecoveryUseCase)
    private readonly requestRecovery: RequestPasswordRecoveryUseCase,
    @Inject(AuthConfiguration)
    private readonly configuration: AuthConfiguration,
    @Inject(CompletePasswordRecoveryUseCase)
    private readonly completeRecovery: CompletePasswordRecoveryUseCase,
  ) {}

  @Post('password-recovery-requests')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Request a password recovery email' })
  @ApiBody({
    schema: {
      additionalProperties: false,
      properties: {
        email: { format: 'email', maxLength: 320, type: 'string' },
      },
      required: ['email'],
      type: 'object',
    },
  })
  @ApiAcceptedResponse({
    description:
      'The same response is returned whether the address exists or not.',
    schema: {
      properties: { status: { enum: ['accepted'], type: 'string' } },
      required: ['status'],
      type: 'object',
    },
  })
  public async request(
    @Body(new ZodValidationPipe(requestPasswordRecoverySchema))
    request: RequestPasswordRecoveryRequest,
  ): Promise<RequestPasswordRecoveryResponse> {
    await this.requestRecovery.execute({
      email: request.email,
      redirectUrl: this.configuration.readPasswordRecoveryRedirectUrl(),
    });
    return { status: 'accepted' };
  }

  @Post('password-recovery-completions')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Complete password recovery with a single-use token',
  })
  @ApiBody({
    schema: {
      additionalProperties: false,
      properties: {
        tokenHash: { type: 'string', minLength: 1, maxLength: 2048 },
        password: { type: 'string', minLength: 1, maxLength: 1024 },
      },
      required: ['tokenHash', 'password'],
      type: 'object',
    },
  })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ description: 'Invalid or expired recovery link' })
  @ApiServiceUnavailableResponse({
    description: 'Recovery is temporarily unavailable',
  })
  public async complete(
    @Body(new ZodValidationPipe(completePasswordRecoverySchema))
    request: z.infer<typeof completePasswordRecoverySchema>,
  ): Promise<void> {
    try {
      await this.completeRecovery.execute(request.tokenHash, request.password);
    } catch (error) {
      if (error instanceof InvalidRecoveryTokenError)
        throw new BadRequestException(
          'Link de recuperação inválido ou expirado.',
        );
      throw new ServiceUnavailableException(
        'Recuperação temporariamente indisponível.',
      );
    }
  }
}
