import { describe, expect, it, vi } from 'vitest';

import {
  InvalidOpaqueSessionError,
  OpaqueSessionService,
  isSessionActive,
  type OpaqueSession,
  type OpaqueSessionRepository,
} from './opaque-session.js';

const createdAt = new Date('2026-09-29T12:00:00.000Z');
const session: OpaqueSession = {
  id: '00000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-000000000002',
  tokenHash: 'hash',
  createdAt,
  lastSeenAt: createdAt,
  revokedAt: null,
};

describe('opaque session policy', () => {
  it('expires at the inactivity and absolute boundaries', () => {
    expect(
      isSessionActive(session, new Date(createdAt.getTime() + 29 * 60_000)),
    ).toBe(true);
    expect(
      isSessionActive(session, new Date(createdAt.getTime() + 30 * 60_000)),
    ).toBe(false);
    expect(
      isSessionActive(
        {
          ...session,
          lastSeenAt: new Date(
            createdAt.getTime() + 11 * 60 * 60_000 + 45 * 60_000,
          ),
        },
        new Date(createdAt.getTime() + 12 * 60 * 60_000),
      ),
    ).toBe(false);
    expect(
      isSessionActive({ ...session, revokedAt: createdAt }, createdAt),
    ).toBe(false);
  });

  it('stores only a token hash and rejects a concurrent revocation', async () => {
    const create = vi
      .fn<OpaqueSessionRepository['create']>()
      .mockResolvedValue();
    const findByTokenHash = vi
      .fn<OpaqueSessionRepository['findByTokenHash']>()
      .mockResolvedValue(session);
    const touchIfActive = vi
      .fn<OpaqueSessionRepository['touchIfActive']>()
      .mockResolvedValue(false);
    const service = new OpaqueSessionService(
      {
        create,
        findByTokenHash,
        touchIfActive,
        revoke: vi.fn(),
        revokeOthers: vi.fn(),
        revokeAll: vi.fn(),
      },
      { generate: () => 'raw-token', hash: () => 'hash' },
      { now: () => createdAt },
      { generate: () => session.id },
    );

    expect(await service.issue(session.userId)).toEqual({
      token: 'raw-token',
      expiresAt: new Date(createdAt.getTime() + 12 * 60 * 60_000),
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ tokenHash: 'hash' }),
    );
    expect(JSON.stringify(create.mock.calls[0])).not.toContain('raw-token');
    await expect(service.resolve('raw-token')).rejects.toBeInstanceOf(
      InvalidOpaqueSessionError,
    );
  });

  it('closes other sessions only after validating the requesting session', async () => {
    const revokeOthers = vi
      .fn<OpaqueSessionRepository['revokeOthers']>()
      .mockResolvedValue();
    const service = new OpaqueSessionService(
      {
        create: vi.fn(),
        findByTokenHash: vi.fn().mockResolvedValue(session),
        touchIfActive: vi.fn().mockResolvedValue(true),
        revoke: vi.fn(),
        revokeOthers,
        revokeAll: vi.fn(),
      },
      { generate: () => 'raw-token', hash: () => 'hash' },
      { now: () => createdAt },
      { generate: () => session.id },
    );
    await service.revokeOtherSessions('raw-token');
    expect(revokeOthers).toHaveBeenCalledWith(
      session.userId,
      session.id,
      createdAt,
    );
  });

  it('does not close remote sessions when the requesting session expired', async () => {
    const revokeOthers = vi.fn<OpaqueSessionRepository['revokeOthers']>();
    const service = new OpaqueSessionService(
      {
        create: vi.fn(),
        findByTokenHash: vi.fn().mockResolvedValue(session),
        touchIfActive: vi.fn(),
        revoke: vi.fn(),
        revokeOthers,
        revokeAll: vi.fn(),
      },
      { generate: () => 'raw-token', hash: () => 'hash' },
      { now: () => new Date(createdAt.getTime() + 30 * 60_000) },
      { generate: () => session.id },
    );
    await expect(
      service.revokeOtherSessions('raw-token'),
    ).rejects.toBeInstanceOf(InvalidOpaqueSessionError);
    expect(revokeOthers).not.toHaveBeenCalled();
  });
});
