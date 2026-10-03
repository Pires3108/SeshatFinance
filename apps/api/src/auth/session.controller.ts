import {
  AuthenticateUserUseCase,
  IdentityProviderUnavailableError,
  InvalidIdentityCredentialsError,
  OpaqueSessionService,
} from '@seshat/application';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { ZodValidationPipe } from '../platform/zod-validation.pipe.js';

const credentialsSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(1).max(1024),
});

type Credentials = z.infer<typeof credentialsSchema>;

const COOKIE_NAME = '__Host-seshat_session';

@Controller('auth/sessions')
@ApiTags('auth')
export class SessionController {
  public constructor(
    @Inject(AuthenticateUserUseCase)
    private readonly authenticate: AuthenticateUserUseCase,
    @Inject(OpaqueSessionService)
    private readonly sessions: OpaqueSessionService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Create an opaque browser session' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        email: { type: 'string', format: 'email' },
        password: { type: 'string' },
      },
      required: ['email', 'password'],
    },
  })
  public async login(
    @Body(new ZodValidationPipe(credentialsSchema)) credentials: Credentials,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    let userId: string;
    try {
      userId = (await this.authenticate.execute(credentials)).userId;
    } catch (error) {
      if (error instanceof InvalidIdentityCredentialsError)
        throw new UnauthorizedException();
      if (error instanceof IdentityProviderUnavailableError)
        throw new ServiceUnavailableException();
      throw new ServiceUnavailableException();
    }
    const session = await this.sessions.issue(userId);
    reply.header(
      'Set-Cookie',
      `${COOKIE_NAME}=${session.token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`,
    );
  }

  @Get()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Check the current browser session' })
  public async check(@Req() request: FastifyRequest): Promise<void> {
    const token = readSessionCookie(request.headers.cookie);
    if (token === undefined) throw new UnauthorizedException();
    try {
      await this.sessions.resolve(token);
    } catch {
      throw new UnauthorizedException();
    }
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the current browser session' })
  public async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const token = readSessionCookie(request.headers.cookie);
    if (token !== undefined) await this.sessions.revoke(token);
    reply.header(
      'Set-Cookie',
      `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
    );
  }
}

export function readSessionCookie(
  header: string | undefined,
): string | undefined {
  const value = header
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);
  return value !== undefined && /^[A-Za-z0-9_-]{43}$/u.test(value)
    ? value
    : undefined;
}
