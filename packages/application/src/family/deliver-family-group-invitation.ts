export type FamilyGroupInvitationDeliveryMethod =
  'registration_invite' | 'magic_link';

export type DeliverFamilyGroupInvitationCommand = Readonly<{
  email: string;
  redirectUrl: string;
}>;

export interface FamilyGroupInvitationDeliveryGateway {
  deliver(
    command: DeliverFamilyGroupInvitationCommand,
  ): Promise<FamilyGroupInvitationDeliveryMethod>;
}
