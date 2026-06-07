const permissionDecisionCache = new Map<string, boolean>();

export function getCachedPermissionDecision(cacheKey: string): boolean | undefined {
  return permissionDecisionCache.get(cacheKey);
}

export function setCachedPermissionDecision(cacheKey: string, allowed: boolean): void {
  permissionDecisionCache.set(cacheKey, allowed);
}

export function resetPermissionDecisionCache(): void {
  permissionDecisionCache.clear();
}
