import { describe, expect, it } from 'vitest';
import {
  FamilyGroupInvitation,
  InvalidFamilyGroupInvitationError,
} from './family-group-invitation.js';

const base = {
  id: 'inv',
  groupId: 'group',
  invitedBy: 'owner',
  email: 'a@example.com',
  role: 'member' as const,
  tokenHash: 'hash',
  createdAt: new Date('2026-10-07T00:00:00Z'),
  expiresAt: new Date('2026-10-10T00:00:00Z'),
  status: 'pending' as const,
};
describe('FamilyGroupInvitation', () => {
  it('rejects owner role and non-forward expiry', () => {
    expect(() =>
      FamilyGroupInvitation.create({
        ...base,
        role: 'member',
        expiresAt: base.createdAt,
      }),
    ).toThrow(InvalidFamilyGroupInvitationError);
    expect(() =>
      FamilyGroupInvitation.create({ ...base, expiresAt: base.createdAt }),
    ).toThrow(InvalidFamilyGroupInvitationError);
  });
});
