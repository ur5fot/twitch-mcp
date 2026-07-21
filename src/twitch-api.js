const HELIX_BASE_URL = 'https://api.twitch.tv/helix';
const VALIDATE_TOKEN_URL = 'https://id.twitch.tv/oauth2/validate';

export function resolveChannelLogin(login) {
  const value = String(
    login
      ?? process.env.TWITCH_CHANNEL_LOGIN
      ?? process.env.TWITCH_BROADCASTER_LOGIN
      ?? '',
  ).trim().toLowerCase();

  if (!value) {
    throw new Error('TWITCH_CHANNEL_LOGIN is not set. Pass login explicitly.');
  }

  return value;
}

export function buildHelixUrl(path, params = {}) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${HELIX_BASE_URL}${normalizedPath}`);

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
      continue;
    }
    url.searchParams.set(key, String(value));
  }

  return url;
}

export function clampInt(value, { min, max, fallback }) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export class TwitchApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'TwitchApiError';
    this.status = status;
    this.body = body;
  }
}

export class TwitchApi {
  constructor({
    clientId = process.env.TWITCH_CLIENT_ID,
    accessToken = process.env.TWITCH_ACCESS_TOKEN,
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.clientId = clientId;
    this.accessToken = accessToken;
    this.fetchImpl = fetchImpl;
  }

  requireCredentials() {
    if (!this.clientId || !this.accessToken) {
      throw new Error('TWITCH_CLIENT_ID and TWITCH_ACCESS_TOKEN are required.');
    }
  }

  async helix(path, params = {}) {
    this.requireCredentials();

    const response = await this.fetchImpl(buildHelixUrl(path, params), {
      headers: {
        'Client-Id': this.clientId,
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    return parseJsonResponse(response, `Twitch Helix ${path} failed`);
  }

  async validateToken() {
    if (!this.accessToken) {
      throw new Error('TWITCH_ACCESS_TOKEN is required.');
    }

    const response = await this.fetchImpl(VALIDATE_TOKEN_URL, {
      headers: {
        Authorization: `OAuth ${this.accessToken}`,
      },
    });

    const payload = await parseJsonResponse(response, 'Twitch token validation failed');

    return sanitizeTokenValidation(payload);
  }

  async getUserByLogin(login) {
    const normalizedLogin = resolveChannelLogin(login);
    const payload = await this.helix('/users', { login: normalizedLogin });
    const user = payload.data?.[0] ?? null;

    if (!user) {
      throw new Error(`Twitch user not found: ${normalizedLogin}`);
    }

    return user;
  }

  async getChannelInfo(login) {
    const user = await this.getUserByLogin(login);
    const payload = await this.helix('/channels', { broadcaster_id: user.id });

    return {
      user: sanitizeUser(user),
      channel: sanitizeChannel(payload.data?.[0] ?? null),
    };
  }

  async getStreamStatus(login, { includeChannel = true } = {}) {
    const user = await this.getUserByLogin(login);
    const streamPayload = await this.helix('/streams', { user_id: user.id });
    const stream = streamPayload.data?.[0] ?? null;
    const channel = includeChannel
      ? (await this.helix('/channels', { broadcaster_id: user.id })).data?.[0] ?? null
      : null;

    return {
      login: user.login,
      displayName: user.display_name,
      isLive: Boolean(stream),
      stream: sanitizeStream(stream),
      channel: sanitizeChannel(channel),
      checkedAt: new Date().toISOString(),
    };
  }

  async getRecentVideos(login, { first = 5, type = 'archive' } = {}) {
    const user = await this.getUserByLogin(login);
    const payload = await this.helix('/videos', {
      user_id: user.id,
      first: clampInt(first, { min: 1, max: 20, fallback: 5 }),
      type,
    });

    return {
      user: sanitizeUser(user),
      videos: (payload.data ?? []).map(sanitizeVideo),
      pagination: payload.pagination ?? {},
    };
  }

  async getChannelSchedule(login, { first = 5 } = {}) {
    const user = await this.getUserByLogin(login);
    const payload = await this.helix('/schedule', {
      broadcaster_id: user.id,
      first: clampInt(first, { min: 1, max: 25, fallback: 5 }),
    });

    return {
      user: sanitizeUser(user),
      schedule: sanitizeSchedule(payload.data ?? null),
      pagination: payload.pagination ?? {},
    };
  }
}

export function sanitizeTokenValidation(payload) {
  return {
    login: payload.login ?? null,
    clientIdPresent: Boolean(payload.client_id),
    scopes: payload.scopes ?? [],
    expiresInSeconds: payload.expires_in ?? null,
  };
}

export function sanitizeUser(user) {
  if (!user) return null;

  return {
    login: user.login,
    displayName: user.display_name,
    type: user.type,
    broadcasterType: user.broadcaster_type,
    description: user.description,
    profileImageUrl: user.profile_image_url,
    offlineImageUrl: user.offline_image_url,
    viewCount: user.view_count,
    createdAt: user.created_at,
  };
}

export function sanitizeChannel(channel) {
  if (!channel) return null;

  return {
    broadcasterLogin: channel.broadcaster_login,
    broadcasterName: channel.broadcaster_name,
    gameName: channel.game_name,
    title: channel.title,
    delay: channel.delay,
    tags: channel.tags ?? [],
    contentClassificationLabels: channel.content_classification_labels ?? [],
    isBrandedContent: channel.is_branded_content,
  };
}

export function sanitizeStream(stream) {
  if (!stream) return null;

  return {
    userLogin: stream.user_login,
    userName: stream.user_name,
    gameName: stream.game_name,
    type: stream.type,
    title: stream.title,
    viewerCount: stream.viewer_count,
    startedAt: stream.started_at,
    language: stream.language,
    thumbnailUrl: stream.thumbnail_url,
    tags: stream.tags ?? [],
    isMature: stream.is_mature,
  };
}

export function sanitizeVideo(video) {
  return {
    userLogin: video.user_login,
    userName: video.user_name,
    title: video.title,
    description: video.description,
    createdAt: video.created_at,
    publishedAt: video.published_at,
    url: video.url,
    thumbnailUrl: video.thumbnail_url,
    viewable: video.viewable,
    viewCount: video.view_count,
    language: video.language,
    type: video.type,
    duration: video.duration,
    mutedSegments: video.muted_segments ?? [],
  };
}

export function sanitizeSchedule(schedule) {
  if (!schedule) return null;

  return {
    broadcasterLogin: schedule.broadcaster_login,
    broadcasterName: schedule.broadcaster_name,
    vacation: schedule.vacation ?? null,
    segments: (schedule.segments ?? []).map((segment) => ({
      startTime: segment.start_time,
      endTime: segment.end_time,
      title: segment.title,
      canceledUntil: segment.canceled_until,
      category: segment.category
        ? { name: segment.category.name }
        : null,
      isRecurring: segment.is_recurring,
    })),
  };
}

async function parseJsonResponse(response, fallbackMessage) {
  const body = await readResponseBody(response);

  if (!response.ok) {
    const message = body?.message || `${fallbackMessage}: ${response.status} ${response.statusText}`;
    throw new TwitchApiError(message, { status: response.status, body });
  }

  return body;
}

async function readResponseBody(response) {
  const contentType = response.headers?.get?.('content-type') ?? '';
  if (contentType.includes('application/json')) return response.json();

  try {
    return await response.json();
  } catch {
    return { message: await response.text() };
  }
}
