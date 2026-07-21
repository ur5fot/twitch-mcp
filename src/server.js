#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { TwitchApi } from './twitch-api.js';

const SERVER_INFO = {
  name: 'twitch-mcp',
  version: '0.1.0',
};

const tools = [
  {
    name: 'twitch_validate_token',
    description: 'Validate TWITCH_ACCESS_TOKEN and return Twitch token metadata. Does not expose the token.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'twitch_get_channel_info',
    description: 'Get public Twitch channel/profile info for a login. Defaults to TWITCH_CHANNEL_LOGIN.',
    inputSchema: {
      type: 'object',
      properties: {
        login: {
          type: 'string',
          description: 'Twitch channel login. Defaults to TWITCH_CHANNEL_LOGIN.',
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'twitch_get_stream_status',
    description: 'Check whether a Twitch channel is live and return current stream details when available.',
    inputSchema: {
      type: 'object',
      properties: {
        login: {
          type: 'string',
          description: 'Twitch channel login. Defaults to TWITCH_CHANNEL_LOGIN.',
        },
        includeChannel: {
          type: 'boolean',
          description: 'Include channel title/category metadata. Default true.',
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'twitch_get_recent_videos',
    description: 'Get recent videos for a Twitch channel.',
    inputSchema: {
      type: 'object',
      properties: {
        login: {
          type: 'string',
          description: 'Twitch channel login. Defaults to TWITCH_CHANNEL_LOGIN.',
        },
        first: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          description: 'Number of videos to return. Default 5, max 20.',
        },
        type: {
          type: 'string',
          enum: ['all', 'archive', 'highlight', 'upload'],
          description: 'Video type. Default archive.',
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'twitch_get_channel_schedule',
    description: 'Get upcoming scheduled Twitch stream segments for a channel.',
    inputSchema: {
      type: 'object',
      properties: {
        login: {
          type: 'string',
          description: 'Twitch channel login. Defaults to TWITCH_CHANNEL_LOGIN.',
        },
        first: {
          type: 'integer',
          minimum: 1,
          maximum: 25,
          description: 'Number of schedule segments to return. Default 5, max 25.',
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
];

function textResult(value, isError = false) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return {
    content: [{ type: 'text', text }],
    ...(isError ? { isError: true } : {}),
  };
}

async function callTool(name, args) {
  const twitch = new TwitchApi();

  switch (name) {
    case 'twitch_validate_token':
      return twitch.validateToken();
    case 'twitch_get_channel_info':
      return twitch.getChannelInfo(args.login);
    case 'twitch_get_stream_status':
      return twitch.getStreamStatus(args.login, {
        includeChannel: args.includeChannel !== false,
      });
    case 'twitch_get_recent_videos':
      return twitch.getRecentVideos(args.login, {
        first: args.first,
        type: args.type ?? 'archive',
      });
    case 'twitch_get_channel_schedule':
      return twitch.getChannelSchedule(args.login, { first: args.first });
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const value = await callTool(
      request.params.name,
      request.params.arguments ?? {},
    );
    return textResult(value);
  } catch (error) {
    return textResult(error instanceof Error ? error.message : String(error), true);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
