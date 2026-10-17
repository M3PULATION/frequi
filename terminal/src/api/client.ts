export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export const BOT_HEADER = 'X-Ft-Bot';

export type ApiClientOptions = {
  getBotId: () => string;
  fetchImpl?: typeof fetch;
};

type RequestOptions = {
  method?: string;
  body?: unknown;
};

/** Browser calls stay on this dev server. The server attaches credentials for the selected bot. */
export function apiRequest(botId: string, path: string): { url: string; headers: Headers } {
  const headers = new Headers();
  if (botId) headers.set(BOT_HEADER, botId);
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return { url: `/api/v1${suffix}`, headers };
}

function readDetail(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const first = detail[0] as { msg?: string } | undefined;
    if (typeof first?.msg === 'string') return first.msg;
  }
  return null;
}

async function errorFromResponse(response: Response): Promise<ApiError> {
  let detail = response.statusText || `请求失败 (${response.status})`;
  try {
    detail = readDetail(await response.json()) ?? detail;
  } catch {
    // Non-JSON error bodies stay as the status text.
  }
  return new ApiError(response.status, detail);
}

export function createApiClient(options: ApiClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request<T>(path: string, init?: RequestOptions): Promise<T> {
    const target = apiRequest(options.getBotId(), path);
    const hasBody = init?.body !== undefined;
    if (hasBody) target.headers.set('Content-Type', 'application/json');
    const response = await fetchImpl(target.url, {
      method: init?.method ?? 'GET',
      headers: target.headers,
      body: hasBody ? JSON.stringify(init.body) : undefined,
    });
    if (!response.ok) throw await errorFromResponse(response);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  return {
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body: unknown = {}) => request<T>(path, { method: 'POST', body }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
