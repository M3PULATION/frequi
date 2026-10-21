import { describe, expect, it } from 'vitest';

import {
  CATALOG_FAILURE_MS,
  CATALOG_GRACE_MS,
  CATALOG_SUCCESS_MS,
  accessTokenUsable,
  botIdFromOrigin,
  catalogTtl,
  describeFallback,
  loadBotConfigs,
  normalizeBotUrl,
} from '../server/botsProxy';

function token(expSeconds: number): string {
  const body = Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url');
  return `x.${body}.y`;
}

describe('bot config', () => {
  it('strips the dashboard path and builds a stable id', () => {
    expect(normalizeBotUrl('us.vxtrans.com:2894/dashboard')).toBe('http://us.vxtrans.com:2894');
    expect(botIdFromOrigin('http://us.vxtrans.com:2894')).toBe('us-vxtrans-com-2894');
  });

  it('requires a url and account for every bot', () => {
    const bots = loadBotConfigs(
      JSON.stringify([{ name: '示例策略', url: 'http://example.test:1/dashboard', username: 'freqtrader', password: 'secret' }]),
    );
    expect(bots[0]?.name).toBe('示例策略');
    expect(bots[0]?.host).toBe('example.test:1');
    expect(bots[0]?.password).toBe('secret');
  });
});

describe('access token', () => {
  it('stays usable until a minute before expiry', () => {
    const now = 1_700_000_000_000;
    const exp = Math.floor(now / 1000) + 120;
    expect(accessTokenUsable(token(exp), now)).toBe(true);
    expect(accessTokenUsable(token(Math.floor(now / 1000) + 30), now)).toBe(false);
    expect(accessTokenUsable('not-a-jwt', now)).toBe(false);
  });
});

describe('catalog stability', () => {
  const listed = {
    id: 'a',
    name: 'A',
    strategy: 'Martingale',
    botName: 'bot',
    host: 'h',
    online: true,
  };

  it('keeps the last good reading during a short outage', () => {
    expect(describeFallback({ at: 0, listed }, 60_000)).toEqual(listed);
  });

  it('marks the bot offline after the grace window but keeps its strategy', () => {
    expect(describeFallback({ at: 0, listed }, CATALOG_GRACE_MS)).toMatchObject({
      online: false,
      strategy: 'Martingale',
    });
  });

  it('rechecks quickly when a bot is offline', () => {
    expect(catalogTtl([{ ...listed, online: false }])).toBe(CATALOG_FAILURE_MS);
    expect(catalogTtl([listed])).toBe(CATALOG_SUCCESS_MS);
  });
});
