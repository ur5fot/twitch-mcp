import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TwitchApi,
  TwitchApiError,
  buildHelixUrl,
  clampInt,
  resolveChannelLogin,
  sanitizeTokenValidation,
  sanitizeUser,
} from '../src/twitch-api.js';

/**
 * A real Response, not a hand-rolled stub: its body can only be consumed once,
 * which is exactly the constraint the error path has to respect.
 */
function jsonResponse(body, { status = 200, statusText = 'OK' } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(body, { status = 200, statusText = 'OK', contentType = 'text/html' } = {}) {
  return new Response(body, { status, statusText, headers: { 'content-type': contentType } });
}

async function withEnv(values, fn) {
  const saved = new Map();
  for (const [key, value] of Object.entries(values)) {
    saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('buildHelixUrl appends scalar and repeated params', () => {
  const url = buildHelixUrl('/users', { login: ['testchannel', 'other'], first: 2 });

  assert.equal(url.origin, 'https://api.twitch.tv');
  assert.equal(url.pathname, '/helix/users');
  assert.deepEqual(url.searchParams.getAll('login'), ['testchannel', 'other']);
  assert.equal(url.searchParams.get('first'), '2');
});

test('resolveChannelLogin without env and without argument throws', async () => {
  await withEnv(
    { TWITCH_CHANNEL_LOGIN: undefined, TWITCH_BROADCASTER_LOGIN: undefined },
    () => {
      assert.throws(
        () => resolveChannelLogin(undefined),
        /TWITCH_CHANNEL_LOGIN is not set/,
      );
    },
  );
});

test('resolveChannelLogin falls back to env, argument wins, case is normalized', async () => {
  await withEnv(
    { TWITCH_CHANNEL_LOGIN: 'EnvChannel', TWITCH_BROADCASTER_LOGIN: undefined },
    () => {
      assert.equal(resolveChannelLogin(undefined), 'envchannel');
      assert.equal(resolveChannelLogin('  ArgChannel '), 'argchannel');
    },
  );
});

test('resolveChannelLogin accepts TWITCH_BROADCASTER_LOGIN as an alias', async () => {
  await withEnv(
    { TWITCH_CHANNEL_LOGIN: undefined, TWITCH_BROADCASTER_LOGIN: 'AliasChannel' },
    () => {
      assert.equal(resolveChannelLogin(undefined), 'aliaschannel');
    },
  );
});

test('getUserByLogin without configured channel fails before any request', async () => {
  await withEnv(
    { TWITCH_CHANNEL_LOGIN: undefined, TWITCH_BROADCASTER_LOGIN: undefined },
    async () => {
      const api = new TwitchApi({
        clientId: 'client-id',
        accessToken: 'token',
        fetchImpl: async () => {
          throw new Error('network call must not happen');
        },
      });

      await assert.rejects(
        () => api.getUserByLogin(undefined),
        /TWITCH_CHANNEL_LOGIN is not set/,
      );
    },
  );
});

test('clampInt uses fallback and bounds', () => {
  assert.equal(clampInt(undefined, { min: 1, max: 20, fallback: 5 }), 5);
  assert.equal(clampInt(99, { min: 1, max: 20, fallback: 5 }), 20);
  assert.equal(clampInt(-1, { min: 1, max: 20, fallback: 5 }), 1);
});

test('getStreamStatus returns offline status with channel metadata', async () => {
  const calls = [];
  const api = new TwitchApi({
    clientId: 'client-id',
    accessToken: 'token',
    fetchImpl: async (url) => {
      calls.push(url.toString());
      if (url.pathname.endsWith('/users')) {
        return jsonResponse({ data: [{ id: '123', login: 'testchannel', display_name: 'Test Channel' }] });
      }
      if (url.pathname.endsWith('/streams')) {
        return jsonResponse({ data: [] });
      }
      if (url.pathname.endsWith('/channels')) {
        return jsonResponse({ data: [{ broadcaster_id: '123', broadcaster_name: 'Test Channel', game_name: 'Science & Technology' }] });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  const status = await api.getStreamStatus('testchannel');

  assert.equal(status.isLive, false);
  assert.equal(status.channel.gameName, 'Science & Technology');
  assert.equal(status.channel.broadcaster_id, undefined);
  assert.equal(calls.length, 3);
});

test('sanitizeUser removes private email and internal ids', () => {
  const user = sanitizeUser({
    id: '123',
    login: 'testchannel',
    display_name: 'Test Channel',
    email: 'private@example.test',
    description: 'Code. Coffee. Fix.',
  });

  assert.deepEqual(user, {
    login: 'testchannel',
    displayName: 'Test Channel',
    type: undefined,
    broadcasterType: undefined,
    description: 'Code. Coffee. Fix.',
    profileImageUrl: undefined,
    offlineImageUrl: undefined,
    viewCount: undefined,
    createdAt: undefined,
  });
});

test('sanitizeTokenValidation keeps useful metadata without account ids', () => {
  const metadata = sanitizeTokenValidation({
    client_id: 'client-id',
    login: 'testchannel',
    user_id: '123',
    scopes: ['channel:read:subscriptions'],
    expires_in: 3600,
  });

  assert.deepEqual(metadata, {
    login: 'testchannel',
    clientIdPresent: true,
    scopes: ['channel:read:subscriptions'],
    expiresInSeconds: 3600,
  });
});

test('helix throws structured errors', async () => {
  const api = new TwitchApi({
    clientId: 'client-id',
    accessToken: 'token',
    fetchImpl: async () => jsonResponse(
      { status: 401, message: 'Invalid OAuth token' },
      { status: 401, statusText: 'Unauthorized' },
    ),
  });

  await assert.rejects(
    () => api.helix('/users', { login: 'testchannel' }),
    (error) => error instanceof TwitchApiError
      && error.status === 401
      && error.message === 'Invalid OAuth token',
  );
});

test('a non-JSON error response reports the status, not a body-reuse crash', async () => {
  const api = new TwitchApi({
    clientId: 'client-id',
    accessToken: 'token',
    fetchImpl: async () => textResponse('<html>502 Bad Gateway</html>', {
      status: 502,
      statusText: 'Bad Gateway',
    }),
  });

  await assert.rejects(
    () => api.helix('/users', { login: 'testchannel' }),
    (error) => {
      assert.ok(error instanceof TwitchApiError, `expected TwitchApiError, got ${error.name}`);
      assert.equal(error.status, 502);
      assert.doesNotMatch(error.message, /Body is unusable|already been read/);
      return true;
    },
  );
});

test('an empty body does not crash the response parser', async () => {
  const api = new TwitchApi({
    clientId: 'client-id',
    accessToken: 'token',
    fetchImpl: async () => new Response(null, { status: 204, statusText: 'No Content' }),
  });

  assert.deepEqual(await api.helix('/users', { login: 'testchannel' }), {});
});
