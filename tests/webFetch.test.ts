import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchUrl, webFetchInternals } from '../src/tools/webFetch';

type FakeResponseInit = {
  ok?: boolean;
  status?: number;
  statusText?: string;
  contentType?: string;
  contentLength?: string;
  location?: string;
  body: string;
};

type LookupResult = { address: string; family: number };

const publicAddress: LookupResult[] = [{ address: '93.184.216.34', family: 4 }];

function fakeResponse(init: FakeResponseInit): Response {
  const headers = new Map<string, string>();
  if (init.contentType !== undefined) {
    headers.set('content-type', init.contentType);
  }
  if (init.contentLength !== undefined) {
    headers.set('content-length', init.contentLength);
  }
  if (init.location !== undefined) {
    headers.set('location', init.location);
  }

  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    headers: {
      get: (name: string) => headers.get(name.toLowerCase()) ?? null,
    },
    body: undefined,
    text: async () => init.body,
  } as unknown as Response;
}

function isLiteralIpv4(host: string): boolean {
  return /^\d+\.\d+\.\d+\.\d+$/.test(host);
}

async function withMocks<T>(
  options: {
    fetchImpl: (...args: unknown[]) => Promise<Response>;
    lookupResult?: LookupResult[];
  },
  run: () => Promise<T>,
): Promise<T> {
  const originalFetch = global.fetch;
  const originalLookup = webFetchInternals.lookup;
  global.fetch = options.fetchImpl as typeof fetch;
  webFetchInternals.lookup = (async (hostname: string) => {
    // Mirrors real dns.lookup: an IP literal resolves to itself.
    if (isLiteralIpv4(hostname)) {
      return [{ address: hostname, family: 4 }];
    }
    if (hostname.includes(':')) {
      return [{ address: hostname, family: 6 }];
    }
    return options.lookupResult ?? publicAddress;
  }) as unknown as typeof webFetchInternals.lookup;
  try {
    return await run();
  } finally {
    global.fetch = originalFetch;
    webFetchInternals.lookup = originalLookup;
  }
}

test('fetchUrl converts HTML responses to markdown', async () => {
  const output = await withMocks(
    {
      fetchImpl: async () => fakeResponse({ contentType: 'text/html; charset=utf-8', body: '<h1>Title</h1><p>Hello <a href="https://example.com">world</a></p>' }),
    },
    () => fetchUrl('https://example.com'),
  );

  assert.match(output, /Title/);
  assert.match(output, /\[world\]\(https:\/\/example\.com\)/);
});

test('fetchUrl strips script and style content from HTML', async () => {
  const output = await withMocks(
    {
      fetchImpl: async () => fakeResponse({
        contentType: 'text/html',
        body: '<html><head><style>body{color:red}</style></head><body><script>alert(1)</script><p>hello</p></body></html>',
      }),
    },
    () => fetchUrl('https://example.com'),
  );

  assert.doesNotMatch(output, /color:red/);
  assert.doesNotMatch(output, /alert\(1\)/);
  assert.match(output, /hello/);
});

test('fetchUrl pretty-prints JSON responses', async () => {
  const output = await withMocks(
    { fetchImpl: async () => fakeResponse({ contentType: 'application/json', body: '{"a":1,"b":2}' }) },
    () => fetchUrl('https://example.com/data.json'),
  );

  assert.equal(output, JSON.stringify({ a: 1, b: 2 }, null, 2));
});

test('fetchUrl returns plain text as-is', async () => {
  const output = await withMocks(
    { fetchImpl: async () => fakeResponse({ contentType: 'text/plain', body: 'hello world' }) },
    () => fetchUrl('https://example.com/notes.txt'),
  );

  assert.equal(output, 'hello world');
});

test('fetchUrl throws on non-2xx responses', async () => {
  await withMocks(
    { fetchImpl: async () => fakeResponse({ ok: false, status: 404, statusText: 'Not Found', contentType: 'text/html', body: '' }) },
    async () => {
      await assert.rejects(
        () => fetchUrl('https://example.com/missing'),
        /Request failed: 404 Not Found/,
      );
    },
  );
});

test('fetchUrl rejects non-http(s) URLs', async () => {
  await assert.rejects(
    () => fetchUrl('ftp://example.com/file.txt'),
    /Unsupported URL protocol/,
  );
});

test('fetchUrl rejects malformed URLs', async () => {
  await assert.rejects(
    () => fetchUrl('not a url'),
    /Invalid URL/,
  );
});

test('fetchUrl rejects unsupported content types', async () => {
  await withMocks(
    { fetchImpl: async () => fakeResponse({ contentType: 'image/png', body: '' }) },
    async () => {
      await assert.rejects(
        () => fetchUrl('https://example.com/image.png'),
        /Unsupported content type/,
      );
    },
  );
});

test('fetchUrl rejects oversized responses based on content-length', async () => {
  await withMocks(
    { fetchImpl: async () => fakeResponse({ contentType: 'text/plain', contentLength: String(3 * 1024 * 1024), body: 'x' }) },
    async () => {
      await assert.rejects(
        () => fetchUrl('https://example.com/big.txt'),
        /Response body too large/,
      );
    },
  );
});

test('fetchUrl truncates very long output', async () => {
  const longBody = 'a'.repeat(25_000);
  const output = await withMocks(
    { fetchImpl: async () => fakeResponse({ contentType: 'text/plain', body: longBody }) },
    () => fetchUrl('https://example.com/long.txt'),
  );

  assert.equal(output.length, 20_000 + '\n...[truncated]'.length);
  assert.match(output, /\.\.\.\[truncated\]$/);
});

test('fetchUrl refuses hosts that resolve to loopback addresses', async () => {
  await withMocks(
    {
      fetchImpl: async () => fakeResponse({ contentType: 'text/plain', body: 'should not be reached' }),
      lookupResult: [{ address: '127.0.0.1', family: 4 }],
    },
    async () => {
      await assert.rejects(
        () => fetchUrl('http://localhost/secret'),
        /private\/internal address/,
      );
    },
  );
});

test('fetchUrl refuses hosts that resolve to link-local metadata addresses', async () => {
  await withMocks(
    {
      fetchImpl: async () => fakeResponse({ contentType: 'text/plain', body: 'should not be reached' }),
      lookupResult: [{ address: '169.254.169.254', family: 4 }],
    },
    async () => {
      await assert.rejects(
        () => fetchUrl('http://metadata.internal/latest/meta-data'),
        /private\/internal address/,
      );
    },
  );
});

test('fetchUrl refuses hosts that resolve to private IPv4 ranges', async () => {
  await withMocks(
    {
      fetchImpl: async () => fakeResponse({ contentType: 'text/plain', body: 'should not be reached' }),
      lookupResult: [{ address: '10.0.0.5', family: 4 }],
    },
    async () => {
      await assert.rejects(
        () => fetchUrl('http://internal.example/service'),
        /private\/internal address/,
      );
    },
  );
});

test('fetchUrl refuses hosts that resolve to IPv6 loopback/unique-local addresses', async () => {
  await withMocks(
    {
      fetchImpl: async () => fakeResponse({ contentType: 'text/plain', body: 'should not be reached' }),
      lookupResult: [{ address: '::1', family: 6 }],
    },
    async () => {
      await assert.rejects(
        () => fetchUrl('http://ipv6-local.example/service'),
        /private\/internal address/,
      );
    },
  );
});

test('fetchUrl re-validates redirect targets and refuses redirects into private ranges', async () => {
  await withMocks(
    {
      fetchImpl: async (input: unknown) => {
        const requestUrl = input instanceof URL ? input.toString() : String(input);
        if (requestUrl.startsWith('https://example.com')) {
          return fakeResponse({ status: 302, location: 'http://169.254.169.254/latest/meta-data', body: '' });
        }
        return fakeResponse({ contentType: 'text/plain', body: 'should not be reached' });
      },
    },
    async () => {
      await assert.rejects(
        () => fetchUrl('https://example.com/redirect'),
        /private\/internal address/,
      );
    },
  );
});
