import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getTranscriptMaxScrollTop,
  isTranscriptAtExactBottom,
  TranscriptAutoScrollState,
} from '../src/opentui/transcriptAutoScroll';

test('exact bottom follows appended entries regardless of transcript role', () => {
  const state = new TranscriptAutoScrollState();
  const roles = ['user', 'assistant', 'system'];

  state.syncScrollPosition({
    scrollTop: 12,
    scrollHeight: 20,
    viewportHeight: 8,
  });

  roles.forEach((role, index) => {
    assert.equal(state.recordEntryCount(index + 1), true, `${role} append should schedule alignment`);
    assert.equal(state.consumePendingBottomAlignment(), true);
    state.syncScrollPosition({
      scrollTop: 13 + index,
      scrollHeight: 21 + index,
      viewportHeight: 8,
    });
  });
});

test('one row above the bottom does not follow an appended entry', () => {
  const state = new TranscriptAutoScrollState();

  assert.equal(state.syncScrollPosition({
    scrollTop: 11,
    scrollHeight: 20,
    viewportHeight: 8,
  }), false);
  assert.equal(state.recordEntryCount(1), false);
  assert.equal(state.hasPendingBottomAlignment, false);
});

test('manually returning to the exact bottom re-enables following', () => {
  const state = new TranscriptAutoScrollState();

  state.syncScrollPosition({
    scrollTop: 11,
    scrollHeight: 20,
    viewportHeight: 8,
  });
  assert.equal(state.recordEntryCount(1), false);

  assert.equal(state.syncScrollPosition({
    scrollTop: 12,
    scrollHeight: 20,
    viewportHeight: 8,
  }), true);
  assert.equal(state.recordEntryCount(2), true);
});

test('rapid consecutive appends collapse into one pending alignment', () => {
  const state = new TranscriptAutoScrollState();

  assert.equal(state.recordEntryCount(1), true);
  assert.equal(state.recordEntryCount(2), false);
  assert.equal(state.recordEntryCount(3), false);
  assert.equal(state.hasPendingBottomAlignment, true);
  assert.equal(state.consumePendingBottomAlignment(), true);
  assert.equal(state.consumePendingBottomAlignment(), false);
});

test('scrolling upward cancels a pending bottom alignment', () => {
  const state = new TranscriptAutoScrollState();

  assert.equal(state.recordEntryCount(1), true);
  assert.equal(state.syncScrollPosition({
    scrollTop: 4,
    scrollHeight: 10,
    viewportHeight: 5,
  }), false);
  assert.equal(state.hasPendingBottomAlignment, false);
});

test('replacements, removals, and same-length updates do not schedule alignment', () => {
  const state = new TranscriptAutoScrollState();

  assert.equal(state.recordEntryCount(3), true);
  state.consumePendingBottomAlignment();

  assert.equal(state.recordEntryCount(3), false);
  assert.equal(state.recordEntryCount(2), false);
});

test('initial and shorter-than-viewport transcripts are treated as bottom-aligned', () => {
  const state = new TranscriptAutoScrollState();
  const metrics = {
    scrollTop: 0,
    scrollHeight: 4,
    viewportHeight: 8,
  };

  assert.equal(getTranscriptMaxScrollTop(metrics), 0);
  assert.equal(isTranscriptAtExactBottom(metrics), true);
  assert.equal(state.syncScrollPosition(metrics), true);
  assert.equal(state.recordEntryCount(5), true);
});
