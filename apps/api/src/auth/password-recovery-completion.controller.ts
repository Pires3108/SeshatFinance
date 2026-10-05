import { CompletePasswordRecoveryUseCase } from '@seshat/application';
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
  ApiBody,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';

import { ZodValidationPipe } from '../platform/zod-validation.pipe.js';

const completePasswordRecoverySchema = z.object({
  tokenHash: z.string().min(1).max(512),
  password: z.string().min(1).max(1024),
});

type CompletePasswordRecoveryRequest = z.infer<
  typeof completePasswordRecoverySchema
>;

@Controller('auth/password-recovery-completions')
@ApiTags('auth')
export class PasswordRecoveryCompletionController {
  public constructor(
    @Inject(CompletePasswordRecoveryUseCase)
    private readonly completeRecovery: CompletePasswordRecoveryUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Complete password recovery with a one-time token' })
  @ApiBody({
    schema: {
      additionalProperties: false,
      properties: {
        tokenHash: { minLength: 1, maxLength: 512, type: 'string' },
        password: { minLength: 1, maxLength: 1024, type: 'string' },
      },
      required: ['tokenHash', 'password'],
      type: 'object',
    },
  })
  @ApiNoContentResponse({ description: 'The password was changed.' })
  public async complete(
    @Body(new ZodValidationPipe(completePasswordRecoverySchema))
    request: CompletePasswordRecoveryRequest,
  ): Promise<void> {
    let completed: boolean;
    try {
      completed = await this.completeRecovery.execute(request);
    } catch {
      throw new ServiceUnavailableException();
    }
    if (!completed)
      throw new BadRequestException('Recovery link is invalid or expired.');
  }
}
