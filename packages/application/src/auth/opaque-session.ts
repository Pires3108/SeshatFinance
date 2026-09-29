import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';

const INACTIVITY_LIMIT_MS = 30 * 60 * 1000;
const ABSOLUTE_LIMIT_MS = 12 * 60 * 60 * 1000;

export type OpaqueSession = Readonly<{
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
}>;

export interface OpaqueSessionRepository {
  create(session: OpaqueSession): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<OpaqueSession | null>;
  touchIfActive(id: string, seenAt: Date): Promise<boolean>;
  revoke(id: string, revokedAt: Date): Promise<void>;
}

export interface OpaqueSessionTokenService {
  generate(): string;
  hash(token: string): string;
}

export type IssuedOpaqueSession = Readonly<{
  token: string;
  expiresAt: Date;
}>;

export class InvalidOpaqueSessionError extends Error {
  public constructor() {
    super('Session is invalid or expired.');
    this.name = 'InvalidOpaqueSessionError';
  }
}

export class OpaqueSessionService {
  public constructor(
    private readonly sessions: OpaqueSessionRepository,
    private readonly tokens: OpaqueSessionTokenService,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async issue(userId: string): Promise<IssuedOpaqueSession> {
    const now = this.clock.now();
    const token = this.tokens.generate();
    await this.sessions.create({
      id: this.identifiers.generate(),
      userId,
      tokenHash: this.tokens.hash(token),
      createdAt: now,
      lastSeenAt: now,
      revokedAt: null,
    });
    return { token, expiresAt: new Date(now.getTime() + ABSOLUTE_LIMIT_MS) };
  }

  public async resolve(token: string): Promise<string> {
    const session = await this.sessions.findByTokenHash(
      this.tokens.hash(token),
    );
    const now = this.clock.now();
    if (session === null || !isSessionActive(session, now)) {
      throw new InvalidOpaqueSessionError();
    }
    const touched = await this.sessions.touchIfActive(session.id, now);
    if (!touched) {
      throw new InvalidOpaqueSessionError();
    }
    return session.userId;
  }

  public async revoke(token: string): Promise<void> {
    const session = await this.sessions.findByTokenHash(
      this.tokens.hash(token),
    );
    if (session !== null) {
      await this.sessions.revoke(session.id, this.clock.now());
    }
  }
}

export function isSessionActive(session: OpaqueSession, now: Date): boolean {
  const elapsed = now.getTime() - session.lastSeenAt.getTime();
  const age = now.getTime() - session.createdAt.getTime();
  return (
    session.revokedAt === null &&
    elapsed >= 0 &&
    elapsed < INACTIVITY_LIMIT_MS &&
    age >= 0 &&
    age < ABSOLUTE_LIMIT_MS
  );
}
