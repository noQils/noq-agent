import { type PermissionRequest } from './types';

export interface PermissionPromptLifecycleEvent {
  request: PermissionRequest;
}

type PermissionPromptListener = (event: PermissionPromptLifecycleEvent) => void;

const openListeners = new Set<PermissionPromptListener>();
const closeListeners = new Set<PermissionPromptListener>();

export function onPermissionPromptOpened(listener: PermissionPromptListener): () => void {
  openListeners.add(listener);
  return () => {
    openListeners.delete(listener);
  };
}

export function onPermissionPromptClosed(listener: PermissionPromptListener): () => void {
  closeListeners.add(listener);
  return () => {
    closeListeners.delete(listener);
  };
}

export function emitPermissionPromptOpened(request: PermissionRequest): void {
  for (const listener of openListeners) {
    listener({ request });
  }
}

export function emitPermissionPromptClosed(request: PermissionRequest): void {
  for (const listener of closeListeners) {
    listener({ request });
  }
}
