/**
 * fetch() with a deadline that covers the whole exchange.
 *
 * The timeout stays armed until the body has been read: a server that sends
 * headers and then stalls must not hang the caller. (Clearing the timer once
 * fetch() resolves, as is common, leaves `response.text()` unbounded.)
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const USER_AGENT = 'WroclawTransit/0.1 (personal, non-commercial)';

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export type RequestOptions = RequestInit & {
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  /** Aborts the request early, in addition to the timeout. */
  signal?: AbortSignal;
};

export const request = async <T>(
  url: string,
  read: (response: Response) => Promise<T>,
  { timeoutMs = 15_000, fetchImpl = globalThis.fetch, signal, headers, ...init }: RequestOptions = {},
): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort);
  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, ...(headers as Record<string, string> | undefined) },
    });
    if (!response.ok) throw new HttpError(`HTTP ${response.status} ${response.statusText}`.trim(), response.status);
    return await read(response);
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) {
      throw new Error(`timed out after ${timeoutMs} ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
};

export const fetchText = (url: string, options?: RequestOptions) =>
  request(url, (response) => response.text(), options);

/**
 * JSON, with a useful error when a retired or moved portal answers with its
 * own HTML page and a 200.
 */
export const fetchJson = async <T = unknown>(url: string, options?: RequestOptions): Promise<T> => {
  const body = await fetchText(url, {
    ...options,
    headers: { Accept: 'application/json', ...(options?.headers as Record<string, string> | undefined) },
  });
  try {
    return JSON.parse(body) as T;
  } catch {
    const looksLikeHtml = /^\s*<(!doctype|html)/i.test(body);
    throw new Error(
      looksLikeHtml
        ? 'responded with an HTML page, not JSON — the API path is probably wrong'
        : `responded with something that is not JSON: ${body.slice(0, 80).replace(/\s+/g, ' ')}…`,
    );
  }
};
