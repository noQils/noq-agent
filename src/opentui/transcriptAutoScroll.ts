export interface TranscriptScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  viewportHeight: number;
}

export function getTranscriptMaxScrollTop(metrics: TranscriptScrollMetrics): number {
  return Math.max(0, metrics.scrollHeight - metrics.viewportHeight);
}

export function isTranscriptAtExactBottom(metrics: TranscriptScrollMetrics): boolean {
  return metrics.scrollTop === getTranscriptMaxScrollTop(metrics);
}

export class TranscriptAutoScrollState {
  private entryCount = 0;
  private atBottom = true;
  private pendingBottomAlignment = false;

  get hasPendingBottomAlignment(): boolean {
    return this.pendingBottomAlignment;
  }

  syncScrollPosition(metrics: TranscriptScrollMetrics): boolean {
    this.atBottom = isTranscriptAtExactBottom(metrics);

    if (!this.atBottom) {
      this.pendingBottomAlignment = false;
    }

    return this.atBottom;
  }

  recordEntryCount(entryCount: number): boolean {
    const hasAppendedEntry = entryCount > this.entryCount;
    this.entryCount = entryCount;

    if (!hasAppendedEntry || !this.atBottom) {
      return false;
    }

    if (this.pendingBottomAlignment) {
      return false;
    }

    this.pendingBottomAlignment = true;
    return true;
  }

  consumePendingBottomAlignment(): boolean {
    const wasPending = this.pendingBottomAlignment;
    this.pendingBottomAlignment = false;
    return wasPending;
  }

  cancelPendingBottomAlignment(): void {
    this.pendingBottomAlignment = false;
  }
}
