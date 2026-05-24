export type PermissionOutcome = 'allow' | 'ask' | 'deny';

export type PermissionScope =
  | 'todo'
  | 'read'
  | 'edit'
  | 'list'
  | 'glob'
  | 'grep'
  | 'bash'
  | 'external_directory'
  | 'doom_loop';

export interface PermissionRequest {
  scope: PermissionScope;
  toolName: string;
  target: string;
  args: Record<string, unknown>;
  pathTargets?: string[];
}
