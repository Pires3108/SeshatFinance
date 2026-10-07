import { describe, expect, it, vi } from 'vitest';
import {
  FamilyGroupInvitationDeliveryError,
  SupabaseFamilyGroupInvitationDeliveryGateway,
  type SupabaseFamilyGroupInvitationClient,
} from './supabase-family-group-invitation-delivery.gateway.js';

const command = {
  email: 'person@example.test',
  redirectUrl: 'https://app.example.test/family/invitations?token=opaque',
};

function client(
  invitationError: { message?: string; status?: number } | null,
  magicLinkError: { message?: string; status?: number } | null = null,
): SupabaseFamilyGroupInvitationClient {
  return {
    auth: {
      admin: {
        inviteUserByEmail: vi
          .fn()
          .mockResolvedValue({ error: invitationError }),
      },
      signInWithOtp: vi.fn().mockResolvedValue({ error: magicLinkError }),
    },
  };
}

describe('SupabaseFamilyGroupInvitationDeliveryGateway', () => {
  it('uses the registration invite for an unregistered recipient', async () => {
    const supabase = client(null);
    const method = await new SupabaseFamilyGroupInvitationDeliveryGateway(
      () => supabase,
    ).deliver(command);

    expect(method).toBe('registration_invite');
    expect(supabase.auth.admin.inviteUserByEmail).toHaveBeenCalledWith(
      command.email,
      { redirectTo: command.redirectUrl },
    );
    expect(supabase.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it('falls back to a non-creating magic link for an existing recipient', async () => {
    const supabase = client({
      status: 422,
      message: 'User already registered',
    });
    const method = await new SupabaseFamilyGroupInvitationDeliveryGateway(
      () => supabase,
    ).deliver(command);

    expect(method).toBe('magic_link');
    expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({
      email: command.email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: command.redirectUrl,
      },
    });
  });

  it('does not fall back for an unrelated provider failure', async () => {
    const supabase = client({ status: 500, message: 'provider unavailable' });

    await expect(
      new SupabaseFamilyGroupInvitationDeliveryGateway(() => supabase).deliver(
        command,
      ),
    ).rejects.toBeInstanceOf(FamilyGroupInvitationDeliveryError);
    expect(supabase.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it('does not accept a magic link failure as delivery', async () => {
    const supabase = client(
      { status: 422, message: 'User already registered' },
      { status: 429, message: 'rate limited' },
    );

    await expect(
      new SupabaseFamilyGroupInvitationDeliveryGateway(() => supabase).deliver(
        command,
      ),
    ).rejects.toBeInstanceOf(FamilyGroupInvitationDeliveryError);
  });
});
