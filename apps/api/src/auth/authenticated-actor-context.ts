import type { AuthenticatedActor } from '@seshat/application';
import { Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

@Injectable()
export class AuthenticatedActorContext {
  readonly #actors = new WeakMap<FastifyRequest, AuthenticatedActor>();

  public set(request: FastifyRequest, actor: AuthenticatedActor): void {
    this.#actors.set(request, actor);
  }

  public get(request: FastifyRequest): AuthenticatedActor | undefined {
    return this.#actors.get(request);
  }
}
