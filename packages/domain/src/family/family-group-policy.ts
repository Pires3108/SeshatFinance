import type { FamilyGroupRole } from './family-group.js';

export type FamilyGroupCapability =
  | 'manage-group-settings'
  | 'manage-members'
  | 'manage-administrators'
  | 'transfer-ownership'
  | 'delete-group'
  | 'write-shared-data'
  | 'read-shared-data';

const capabilities: Readonly<
  Record<FamilyGroupRole, readonly FamilyGroupCapability[]>
> = {
  administrator: [
    'manage-group-settings',
    'manage-members',
    'write-shared-data',
    'read-shared-data',
  ],
  member: ['write-shared-data', 'read-shared-data'],
  owner: [
    'manage-group-settings',
    'manage-members',
    'manage-administrators',
    'transfer-ownership',
    'delete-group',
    'write-shared-data',
    'read-shared-data',
  ],
  viewer: ['read-shared-data'],
};

export function hasFamilyGroupCapability(
  role: FamilyGroupRole,
  capability: FamilyGroupCapability,
): boolean {
  return capabilities[role].includes(capability);
}
