import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveTranscriptRenderMode } from '../src/opentui/transcriptRenderMode';

test('resolveTranscriptRenderMode keeps assistant entries on markdown rendering', () => {
  assert.equal(resolveTranscriptRenderMode('assistant', null), 'assistant-markdown');
  assert.equal(resolveTranscriptRenderMode('assistant', 'diff --git a/file b/file'), 'assistant-markdown');
});

test('resolveTranscriptRenderMode uses diff rendering only for system entries with renderable diffs', () => {
  assert.equal(resolveTranscriptRenderMode('system', 'diff --git a/file b/file'), 'system-diff');
});

test('resolveTranscriptRenderMode falls back to plain text for non-diff system and user entries', () => {
  assert.equal(resolveTranscriptRenderMode('system', null), 'plain-text');
  assert.equal(resolveTranscriptRenderMode('user', null), 'plain-text');
  assert.equal(resolveTranscriptRenderMode('user', 'diff --git a/file b/file'), 'plain-text');
});
