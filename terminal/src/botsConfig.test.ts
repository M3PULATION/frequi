import { describe, expect, it } from 'vitest';

import { botIdFromOrigin, loadBotConfigs, normalizeBotUrl } from '../server/botsProxy';

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
