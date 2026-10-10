import {
  ConfirmRegistrationUseCase,
  IdentityProviderUnavailableError,
  RegisterUserUseCase,
  ResendRegistrationConfirmationUseCase,
} from '@seshat/application';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBody,
  ApiNoContentResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';

import { ZodValidationPipe } from '../platform/zod-validation.pipe.js';
import { AuthConfiguration } from './auth-configuration.js';

const registerUserRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  email: z.email().max(320),
  password: z.string().min(1).max(1024),
});
const confirmationRequestSchema = z.object({
  tokenHash: z.string().min(1).max(2048),
});
const resendRequestSchema = z.object({ email: z.email().max(320) });

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
    @Inject(ConfirmRegistrationUseCase)
    private readonly confirmRegistration: ConfirmRegistrationUseCase,
    @Inject(ResendRegistrationConfirmationUseCase)
    private readonly resendConfirmation: ResendRegistrationConfirmationUseCase,
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
        password: { maxLength: 1024, minLength: 1, type: 'string' },
      },
      required: ['displayName', 'email', 'password'],
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
    await this.registerUser.execute({
      ...request,
      confirmationRedirectUrl: configuration.confirmationRedirectUrl,
    });
    return { status: 'confirmation_required' };
  }

  @Post('confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Confirm a registration with a single-use email token',
  })
  @ApiBody({
    schema: {
      additionalProperties: false,
      properties: {
        tokenHash: { maxLength: 2048, minLength: 1, type: 'string' },
      },
      required: ['tokenHash'],
      type: 'object',
    },
  })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({
    description: 'Invalid, expired, or reused confirmation token',
  })
  @ApiServiceUnavailableResponse({
    description: 'Confirmation is temporarily unavailable',
  })
  public async confirm(
    @Body(new ZodValidationPipe(confirmationRequestSchema))
    request: z.infer<typeof confirmationRequestSchema>,
  ): Promise<void> {
    try {
      if (!(await this.confirmRegistration.execute(request.tokenHash)))
        throw new BadRequestException(
          'Link de confirmação inválido ou expirado.',
        );
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (error instanceof IdentityProviderUnavailableError)
        throw new ServiceUnavailableException();
      throw new ServiceUnavailableException();
    }
  }

  @Post('resend')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Request another registration confirmation email' })
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
    schema: {
      properties: {
        status: { enum: ['confirmation_required'], type: 'string' },
      },
      required: ['status'],
      type: 'object',
    },
  })
  @ApiServiceUnavailableResponse({
    description: 'Resend is temporarily unavailable',
  })
  public async resend(
    @Body(new ZodValidationPipe(resendRequestSchema))
    request: z.infer<typeof resendRequestSchema>,
  ): Promise<RegisterUserResponse> {
    const configuration = this.configuration.read();
    try {
      await this.resendConfirmation.execute({
        email: request.email,
        confirmationRedirectUrl: configuration.confirmationRedirectUrl,
      });
    } catch {
      throw new ServiceUnavailableException();
    }
    return { status: 'confirmation_required' };
  }
}
