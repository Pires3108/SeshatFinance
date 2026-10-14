import { RegisterUserUseCase } from '@seshat/application';
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

const registerUserRequestSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120),
    email: z.email().max(320),
    password: z.string().min(8).max(1024).regex(/[A-Z]/).regex(/[0-9]/),
    passwordConfirmation: z.string().max(1024),
  })
  .refine(
    ({ password, passwordConfirmation }) => password === passwordConfirmation,
    { path: ['passwordConfirmation'] },
  );

type RegisterUserRequest = z.infer<typeof registerUserRequestSchema>;

export type RegisterUserResponse = Readonly<{
  status: 'confirmation_required';
}>;

@Controller('auth/registrations')
@ApiTags('auth')
export class AuthController {
  public constructor(
    @Inject(RegisterUserUseCase)
    private readonly registerUser: RegisterUserUseCase,
    @Inject(AuthConfiguration)
    private readonly configuration: AuthConfiguration,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Register a user and request email confirmation' })
  @ApiBody({
    schema: {
      additionalProperties: false,
      properties: {
        displayName: { maxLength: 120, minLength: 1, type: 'string' },
        email: { format: 'email', maxLength: 320, type: 'string' },
        password: {
          description:
            'At least 8 characters, including an uppercase letter and a number.',
          maxLength: 1024,
          minLength: 8,
          pattern: '^(?=.*[A-Z])(?=.*[0-9]).+$',
          type: 'string',
        },
        passwordConfirmation: {
          description: 'Must match password.',
          maxLength: 1024,
          type: 'string',
        },
      },
      required: ['displayName', 'email', 'password', 'passwordConfirmation'],
      type: 'object',
    },
  })
  @ApiAcceptedResponse({
    schema: {
      properties: {
        status: { enum: ['confirmation_required'], type: 'string' },
      },
      required: ['status'],
      type: 'object',
    },
  })
  public async register(
    @Body(new ZodValidationPipe(registerUserRequestSchema))
    request: RegisterUserRequest,
  ): Promise<RegisterUserResponse> {
    const configuration = this.configuration.read();
    const command = {
      displayName: request.displayName,
      email: request.email,
      password: request.password,
    };
    await this.registerUser.execute({
      ...command,
      confirmationRedirectUrl: configuration.confirmationRedirectUrl,
    });
    return { status: 'confirmation_required' };
  }
}
