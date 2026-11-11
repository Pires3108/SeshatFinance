import type { FamilyGroupRole } from './family-group.js';

export type FamilyGroupCapability =
  | 'manage-group-settings'
  | 'manage-members'
  | 'manage-administrators'
  | 'transfer-ownership'
  | 'delete-group'
  | 'write-shared-data'
  | 'read-shared-data'
  | 'trash-shared-data'
  | 'restore-shared-data'
  | 'purge-shared-data'
  | 'archive-shared-account'
  | 'import-shared-data'
  | 'revert-shared-import'
  | 'export-shared-data'
  | 'read-own-audit'
  | 'read-all-audit';

const memberCapabilities: readonly FamilyGroupCapability[] = [
  'write-shared-data',
  'read-shared-data',
  'trash-shared-data',
  'restore-shared-data',
  'import-shared-data',
  'export-shared-data',
  'read-own-audit',
];

const administratorCapabilities: readonly FamilyGroupCapability[] = [
  ...memberCapabilities,
  'purge-shared-data',
  'archive-shared-account',
  'revert-shared-import',
  'read-all-audit',
  'manage-group-settings',
  'manage-members',
];

const capabilities: Readonly<
  Record<FamilyGroupRole, readonly FamilyGroupCapability[]>
> = {
  administrator: administratorCapabilities,
  member: memberCapabilities,
  owner: [
    ...administratorCapabilities,
    'manage-administrators',
    'transfer-ownership',
    'delete-group',
  ],
  viewer: ['read-shared-data'],
};

export function hasFamilyGroupCapability(
  role: FamilyGroupRole,
  capability: FamilyGroupCapability,
): boolean {
  return capabilities[role].includes(capability);
}

export function canInviteToFamilyGroup(
  actorRole: FamilyGroupRole,
  invitedRole: FamilyGroupRole,
): boolean {
  return (
    invitedRole !== 'owner' &&
    hasFamilyGroupCapability(actorRole, 'manage-members')
  );
}

export function canChangeFamilyGroupRole(
  actorRole: FamilyGroupRole,
  currentRole: FamilyGroupRole,
  nextRole: FamilyGroupRole,
): boolean {
  if (currentRole === 'owner' || nextRole === 'owner') return false;
  if (!hasFamilyGroupCapability(actorRole, 'manage-members')) return false;
  if (currentRole === nextRole) return true;
  return (
    nextRole !== 'administrator' ||
    hasFamilyGroupCapability(actorRole, 'manage-administrators')
  );
}

export function canRemoveFamilyGroupMember(
  actorRole: FamilyGroupRole,
  targetRole: FamilyGroupRole,
): boolean {
  return (
    targetRole !== 'owner' &&
    hasFamilyGroupCapability(actorRole, 'manage-members')
  );
}
