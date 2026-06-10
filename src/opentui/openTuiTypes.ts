import { type OpenTuiEntryRole } from './openTuiTheme';
import { type PermissionOutcome, type PermissionScope } from '../permissions/types';
import { type ProviderName } from '../providers/types';

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
  scopeDescription: string;
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
  query: string;
  selectedIndex: number;
  step: 'list' | 'custom';
  activeProvider: ProviderName | null;
  customModelInput: string;
  isLoading: boolean;
  groups: OpenTuiModelGroup[];
}

export interface OpenTuiModelGroup {
  provider: ProviderName;
  models: string[];
  source: 'live' | 'fallback';
}

export type OpenTuiModelsSetupRow =
  | {
      key: string;
      type: 'provider_heading';
      provider: ProviderName;
      source: 'live' | 'fallback';
    }
  | {
      key: string;
      type: 'model';
      provider: ProviderName;
      model: string;
      source: 'live' | 'fallback';
    }
  | {
      key: string;
      type: 'custom';
      provider: ProviderName;
      source: 'live' | 'fallback';
    };
