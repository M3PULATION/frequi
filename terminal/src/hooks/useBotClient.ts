import { useMemo } from 'react';

import { ApiError, createApiClient, type ApiClient } from '@/api/client';

export function useBotClient(botId: string): ApiClient {
  return useMemo(() => createApiClient({ getBotId: () => botId }), [botId]);
}

export function errorMessage(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return '请求失败';
}
