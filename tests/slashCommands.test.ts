import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getSlashCommandCatalogEntries,
  getSlashCommandInsertText,
  getSlashCommandSuggestions,
  parseSlashCommand,
} from '../src/opentui/slashCommands';

test('parseSlashCommand recognizes /permissions', () => {
  assert.deepEqual(parseSlashCommand('/permissions'), { type: 'permissions' });
});

test('parseSlashCommand keeps the existing command execution matrix intact', () => {
  assert.deepEqual(parseSlashCommand('/connect'), { type: 'connect' });
  assert.deepEqual(parseSlashCommand('/models'), { type: 'models' });
  assert.deepEqual(parseSlashCommand('/diff'), { type: 'diff' });
  assert.deepEqual(parseSlashCommand('/undo'), { type: 'undo' });
  assert.deepEqual(parseSlashCommand('/plan show'), { type: 'plan_show' });
  assert.deepEqual(parseSlashCommand('/exit'), { type: 'exit' });
  assert.deepEqual(parseSlashCommand('/mode plan'), { type: 'mode', mode: 'plan' });
});

test('parseSlashCommand recognizes /quit as an alias for /exit', () => {
  assert.deepEqual(parseSlashCommand('/quit'), { type: 'exit' });
});

test('parseSlashCommand recognizes /mode build through the shared catalog', () => {
  assert.deepEqual(parseSlashCommand('/mode build'), { type: 'mode', mode: 'build' });
});

test('parseSlashCommand keeps invalid slash commands invalid', () => {
  assert.deepEqual(parseSlashCommand('/mode nope'), { type: 'invalid' });
  assert.deepEqual(parseSlashCommand('/plan'), { type: 'invalid' });
});

test('parseSlashCommand treats unknown slash commands as invalid', () => {
  assert.deepEqual(parseSlashCommand('/wat'), { type: 'invalid' });
});

test('getSlashCommandCatalogEntries returns the full command set and compact subset', () => {
  const fullEntries = getSlashCommandCatalogEntries();
  const fullCommands = fullEntries.map((entry) => entry.command);
  const compactCommands = getSlashCommandCatalogEntries({ includeCompactOnly: true }).map((entry) => entry.command);

  assert.deepEqual(fullCommands, [
    '/mode',
    '/permissions',
    '/connect',
    '/models',
    '/plan',
    '/diff',
    '/undo',
    '/exit',
  ]);
  assert.ok(fullEntries.every((entry) => entry.description.length > 0));
  assert.deepEqual(compactCommands, [
    '/mode',
    '/permissions',
    '/connect',
    '/models',
    '/exit',
  ]);
});

test('getSlashCommandInsertText expands fixed commands and leaves open-ended commands ready for typing', () => {
  const modeEntry = getSlashCommandCatalogEntries().find((entry) => entry.command === '/mode');
  const planEntry = getSlashCommandCatalogEntries().find((entry) => entry.command === '/plan');
  const diffEntry = getSlashCommandCatalogEntries().find((entry) => entry.command === '/diff');

  assert.equal(getSlashCommandInsertText(modeEntry!), '/mode ');
  assert.equal(getSlashCommandInsertText(planEntry!), '/plan show');
  assert.equal(getSlashCommandInsertText(diffEntry!), '/diff');
});

test('getSlashCommandSuggestions hides suggestions for non-slash input', () => {
  assert.deepEqual(getSlashCommandSuggestions('hello'), {
    visible: false,
    query: '',
    matches: [],
  });
});

test('getSlashCommandSuggestions only triggers from the start of the trimmed draft', () => {
  assert.equal(getSlashCommandSuggestions('  /mo').visible, true);
  assert.equal(getSlashCommandSuggestions('hello /mo').visible, false);
});

test('getSlashCommandSuggestions returns all commands for a bare slash', () => {
  const suggestions = getSlashCommandSuggestions('/');

  assert.equal(suggestions.visible, true);
  assert.equal(suggestions.query, '/');
  assert.deepEqual(suggestions.matches.map((entry) => entry.command), [
    '/mode',
    '/permissions',
    '/connect',
    '/models',
    '/plan',
    '/diff',
    '/undo',
    '/exit',
  ]);
});

test('getSlashCommandSuggestions prioritizes prefix matches', () => {
  const suggestions = getSlashCommandSuggestions('/mo');

  assert.deepEqual(suggestions.matches.map((entry) => entry.command), ['/mode', '/models']);
});

test('getSlashCommandSuggestions supports alias prefix matches', () => {
  const suggestions = getSlashCommandSuggestions('/qui');

  assert.deepEqual(suggestions.matches.map((entry) => entry.command), ['/exit']);
});

test('getSlashCommandSuggestions supports substring fallback on command text', () => {
  const suggestions = getSlashCommandSuggestions('/ff');

  assert.deepEqual(suggestions.matches.map((entry) => entry.command), ['/diff']);
});

test('getSlashCommandSuggestions keeps matching commands visible while typing arguments', () => {
  const suggestions = getSlashCommandSuggestions('/mode b');

  assert.deepEqual(suggestions.matches.map((entry) => entry.command), ['/mode']);
});

test('getSlashCommandSuggestions only considers the first line of composer input', () => {
  const suggestions = getSlashCommandSuggestions('/mo\nextra text');

  assert.equal(suggestions.query, '/mo');
  assert.deepEqual(suggestions.matches.map((entry) => entry.command), ['/mode', '/models']);
});
