import { type OpenTuiEntryRole } from './openTuiTheme';
import { type PermissionOutcome, type PermissionScope } from '../permissions/types';

export type OpenTuiSessionEntryKind = OpenTuiEntryRole;

export interface OpenTuiSessionEntry {
  id: string;
  createdAt: string;
  kind: OpenTuiSessionEntryKind;
  text: string;
}

export interface OpenTuiPermissionItem {
  scope: PermissionScope;
  outcome: PermissionOutcome;
  source: 'session' | 'workspace' | 'workspace_rules';
  scopeDescription: string;
  description: string;
}
