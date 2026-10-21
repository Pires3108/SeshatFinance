import {
  OpaqueSessionService,
  ResolveAuthenticatedActorUseCase,
} from '@seshat/application';
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { AuthenticatedActorContext } from './authenticated-actor-context.js';
import { readSessionCookie } from './session.controller.js';

@Injectable()
export class BearerAuthGuard implements CanActivate {
  public constructor(
    @Inject(ResolveAuthenticatedActorUseCase)
    private readonly resolveActor: ResolveAuthenticatedActorUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
    @Optional()
    @Inject(OpaqueSessionService)
    private readonly sessions?: OpaqueSessionService,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const sessionToken = readSessionCookie(request.headers.cookie);
    if (sessionToken !== undefined && this.sessions !== undefined) {
      try {
        const userId = await this.sessions.resolve(sessionToken);
        this.actors.set(request, { id: userId });
        return true;
      } catch {
        throw new UnauthorizedException();
      }
    }
    const accessToken = extractBearerToken(request.headers.authorization);
    if (accessToken === undefined) {
      throw new UnauthorizedException();
    }

    try {
      const actor = await this.resolveActor.execute(accessToken);
      this.actors.set(request, actor);
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}

function extractBearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer ([^\s]+)$/iu.exec(header ?? '');
  return match?.[1];
}
