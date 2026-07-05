import type { FiletypeParserOptions } from '@opentui/core';

/**
 * @opentui/core only bundles javascript/typescript/markdown/zig grammars locally.
 * These entries register additional languages via remote tree-sitter release
 * assets so diffs/previews get syntax coloring for more than the built-in set.
 * Registered once via addDefaultParsers() before the shared tree-sitter client
 * initializes (see src/opentui/index.tsx).
 */
export const additionalLanguageParsers: FiletypeParserOptions[] = [
  {
    filetype: 'python',
    wasm: 'https://github.com/tree-sitter/tree-sitter-python/releases/download/v0.23.6/tree-sitter-python.wasm',
    queries: {
      highlights: ['https://raw.githubusercontent.com/tree-sitter/tree-sitter-python/master/queries/highlights.scm'],
    },
  },
  {
    filetype: 'go',
    wasm: 'https://github.com/tree-sitter/tree-sitter-go/releases/download/v0.23.4/tree-sitter-go.wasm',
    queries: {
      highlights: ['https://raw.githubusercontent.com/tree-sitter/tree-sitter-go/master/queries/highlights.scm'],
    },
  },
  {
    filetype: 'rust',
    wasm: 'https://github.com/tree-sitter/tree-sitter-rust/releases/download/v0.23.2/tree-sitter-rust.wasm',
    queries: {
      highlights: ['https://raw.githubusercontent.com/tree-sitter/tree-sitter-rust/master/queries/highlights.scm'],
    },
  },
  {
    filetype: 'java',
    wasm: 'https://github.com/tree-sitter/tree-sitter-java/releases/download/v0.23.5/tree-sitter-java.wasm',
    queries: {
      highlights: ['https://raw.githubusercontent.com/tree-sitter/tree-sitter-java/master/queries/highlights.scm'],
    },
  },
  {
    filetype: 'c',
    wasm: 'https://github.com/tree-sitter/tree-sitter-c/releases/download/v0.23.4/tree-sitter-c.wasm',
    queries: {
      highlights: ['https://raw.githubusercontent.com/tree-sitter/tree-sitter-c/master/queries/highlights.scm'],
    },
  },
  {
    filetype: 'cpp',
    wasm: 'https://github.com/tree-sitter/tree-sitter-cpp/releases/download/v0.23.4/tree-sitter-cpp.wasm',
    queries: {
      highlights: ['https://raw.githubusercontent.com/tree-sitter/tree-sitter-cpp/master/queries/highlights.scm'],
    },
  },
  {
    filetype: 'csharp',
    wasm: 'https://github.com/tree-sitter/tree-sitter-c-sharp/releases/download/v0.23.1/tree-sitter-c_sharp.wasm',
    queries: {
      highlights: ['https://raw.githubusercontent.com/tree-sitter/tree-sitter-c-sharp/master/queries/highlights.scm'],
    },
  },
  {
    filetype: 'css',
    wasm: 'https://github.com/tree-sitter/tree-sitter-css/releases/download/v0.23.2/tree-sitter-css.wasm',
    queries: {
      highlights: ['https://raw.githubusercontent.com/tree-sitter/tree-sitter-css/master/queries/highlights.scm'],
    },
  },
  {
    filetype: 'html',
    wasm: 'https://github.com/tree-sitter/tree-sitter-html/releases/download/v0.23.2/tree-sitter-html.wasm',
    queries: {
      highlights: ['https://raw.githubusercontent.com/tree-sitter/tree-sitter-html/master/queries/highlights.scm'],
    },
  },
  {
    filetype: 'json',
    wasm: 'https://github.com/tree-sitter/tree-sitter-json/releases/download/v0.24.8/tree-sitter-json.wasm',
    queries: {
      highlights: ['https://raw.githubusercontent.com/tree-sitter/tree-sitter-json/master/queries/highlights.scm'],
    },
  },
  {
    filetype: 'bash',
    wasm: 'https://github.com/tree-sitter/tree-sitter-bash/releases/download/v0.23.3/tree-sitter-bash.wasm',
    queries: {
      highlights: ['https://raw.githubusercontent.com/tree-sitter/tree-sitter-bash/master/queries/highlights.scm'],
    },
  },
  {
    filetype: 'yaml',
    wasm: 'https://github.com/tree-sitter-grammars/tree-sitter-yaml/releases/download/v0.7.1/tree-sitter-yaml.wasm',
    queries: {
      highlights: [
        'https://raw.githubusercontent.com/tree-sitter-grammars/tree-sitter-yaml/master/queries/highlights.scm',
      ],
    },
  },
  {
    filetype: 'toml',
    wasm: 'https://github.com/tree-sitter-grammars/tree-sitter-toml/releases/download/v0.7.0/tree-sitter-toml.wasm',
    queries: {
      highlights: [
        'https://raw.githubusercontent.com/tree-sitter-grammars/tree-sitter-toml/master/queries/highlights.scm',
      ],
    },
  },
  {
    filetype: 'lua',
    wasm: 'https://github.com/tree-sitter-grammars/tree-sitter-lua/releases/download/v0.4.0/tree-sitter-lua.wasm',
    queries: {
      highlights: [
        'https://raw.githubusercontent.com/tree-sitter-grammars/tree-sitter-lua/master/queries/highlights.scm',
      ],
    },
  },
  {
    filetype: 'php',
    wasm: 'https://github.com/tree-sitter/tree-sitter-php/releases/download/v0.23.11/tree-sitter-php.wasm',
    queries: {
      highlights: ['https://raw.githubusercontent.com/tree-sitter/tree-sitter-php/master/queries/highlights.scm'],
    },
  },
  {
    filetype: 'ruby',
    wasm: 'https://github.com/tree-sitter/tree-sitter-ruby/releases/download/v0.23.1/tree-sitter-ruby.wasm',
    queries: {
      highlights: ['https://raw.githubusercontent.com/tree-sitter/tree-sitter-ruby/master/queries/highlights.scm'],
    },
  },
  {
    filetype: 'kotlin',
    wasm: 'https://github.com/fwcd/tree-sitter-kotlin/releases/download/0.3.8/tree-sitter-kotlin.wasm',
    queries: {
      highlights: ['https://raw.githubusercontent.com/fwcd/tree-sitter-kotlin/master/queries/highlights.scm'],
    },
  },
  {
    filetype: 'swift',
    wasm: 'https://github.com/alex-pinkus/tree-sitter-swift/releases/download/0.7.3/tree-sitter-swift.wasm',
    queries: {
      highlights: ['https://raw.githubusercontent.com/alex-pinkus/tree-sitter-swift/main/queries/highlights.scm'],
    },
  },
  {
    filetype: 'xml',
    wasm: 'https://github.com/tree-sitter-grammars/tree-sitter-xml/releases/download/v0.7.0/tree-sitter-xml.wasm',
    queries: {
      highlights: [
        'https://raw.githubusercontent.com/tree-sitter-grammars/tree-sitter-xml/master/queries/xml/highlights.scm',
      ],
    },
  },
];
