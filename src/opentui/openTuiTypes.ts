import { type OpenTuiEntryRole } from './openTuiTheme';
import { type PermissionOutcome, type PermissionScope } from '../permissions/types';
import { type ProviderName } from '../providers/types';

export type OpenTuiSessionEntryKind = OpenTuiEntryRole;

export interface OpenTuiSessionEntry {
  id: string;
  createdAt: string;
  kind: OpenTuiSessionEntryKind;
  text: string;
  toolName?: string;
}

export interface OpenTuiPermissionItem {
  scope: PermissionScope;
  outcome: PermissionOutcome;
  scopeDescription: string;
}

export interface OpenTuiCurrentModelSelection {
  provider: ProviderName | null;
  model: string | null;
}

export interface OpenTuiDiffModalState {
  diffText: string;
  toolName?: string;
  filePath?: string;
  filetype?: string;
  mutationKind?: 'edit' | 'write';
  additionalFileCount?: number;
}

export type OpenTuiSetupModalKind = 'providers' | 'models';

export interface OpenTuiProviderSetupState {
  query: string;
  selectedIndex: number;
  step: 'list' | 'credential';
  activeProvider: ProviderName | null;
  apiKeyInput: string;
}

export interface OpenTuiModelsSetupState {
  step: 'provider' | 'list' | 'custom';
  providerQuery: string;
  providerSelectedIndex: number;
  activeProvider: ProviderName | null;
  query: string;
  selectedIndex: number;
  customModelInput: string;
  isLoading: boolean;
  models: string[];
  modelsSource: 'live' | 'fallback' | null;
}

export type OpenTuiModelsSetupRow =
  | {
      key: string;
      type: 'model';
      model: string;
    }
  | {
      key: string;
      type: 'custom';
    };
