import type {
  FamilyGroupInvitationDeliveryGateway,
  FamilyGroupInvitationDeliveryMethod,
  DeliverFamilyGroupInvitationCommand,
} from '@seshat/application';

type SupabaseAuthError = Readonly<{
  message?: unknown;
  status?: unknown;
}>;

export type SupabaseFamilyGroupInvitationClient = Readonly<{
  auth: Readonly<{
    admin: Readonly<{
      inviteUserByEmail(
        email: string,
        options: Readonly<{ redirectTo: string }>,
      ): PromiseLike<Readonly<{ error: SupabaseAuthError | null }>>;
    }>;
    signInWithOtp(
      options: Readonly<{
        email: string;
        options: Readonly<{ shouldCreateUser: false; emailRedirectTo: string }>;
      }>,
    ): PromiseLike<Readonly<{ error: SupabaseAuthError | null }>>;
  }>;
}>;

export class FamilyGroupInvitationDeliveryError extends Error {
  public constructor() {
    super('Family group invitation delivery was not accepted.');
    this.name = 'FamilyGroupInvitationDeliveryError';
  }
}

export class SupabaseFamilyGroupInvitationDeliveryGateway implements FamilyGroupInvitationDeliveryGateway {
  public constructor(
    private readonly clientFactory: () => SupabaseFamilyGroupInvitationClient,
  ) {}

  public async deliver(
    command: DeliverFamilyGroupInvitationCommand,
  ): Promise<FamilyGroupInvitationDeliveryMethod> {
    const client = this.clientFactory();
    const invitation = await client.auth.admin.inviteUserByEmail(
      command.email,
      {
        redirectTo: command.redirectUrl,
      },
    );

    if (invitation.error === null) return 'registration_invite';
    if (!isAlreadyRegisteredError(invitation.error))
      throw new FamilyGroupInvitationDeliveryError();

    const magicLink = await client.auth.signInWithOtp({
      email: command.email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: command.redirectUrl,
      },
    });
    if (magicLink.error !== null)
      throw new FamilyGroupInvitationDeliveryError();
    return 'magic_link';
  }
}

function isAlreadyRegisteredError(error: SupabaseAuthError): boolean {
  const message = typeof error.message === 'string' ? error.message : '';
  return (
    error.status === 422 &&
    /already\s+(registered|exists)|user\s+already/i.test(message)
  );
}
