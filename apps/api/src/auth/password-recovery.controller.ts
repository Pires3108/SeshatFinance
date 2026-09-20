import { RequestPasswordRecoveryUseCase } from '@seshat/application';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';

import { ZodValidationPipe } from '../platform/zod-validation.pipe.js';
import { AuthConfiguration } from './auth-configuration.js';

const requestPasswordRecoverySchema = z.object({
  email: z.email().max(320),
});

type RequestPasswordRecoveryRequest = z.infer<
  typeof requestPasswordRecoverySchema
>;

export type RequestPasswordRecoveryResponse = Readonly<{
  status: 'accepted';
}>;

@Controller('auth/password-recovery-requests')
@ApiTags('auth')
export class PasswordRecoveryController {
  public constructor(
    @Inject(RequestPasswordRecoveryUseCase)
    private readonly requestRecovery: RequestPasswordRecoveryUseCase,
    @Inject(AuthConfiguration)
    private readonly configuration: AuthConfiguration,
  ) {}

  @Post()
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
}
