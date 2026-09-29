const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...extraHeaders } });
}

export function errorResponse(status, code, error) {
  return json({ error, code }, status);
}

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Runs a handler and converts thrown errors into stable JSON errors without leaking internals. */
export async function guard(handler) {
  try {
    return await handler();
  } catch (err) {
    if (err instanceof HttpError) return errorResponse(err.status, err.code, err.message);
    console.error('Unexpected error:', err?.name, err?.message);
    return errorResponse(500, 'INTERNAL_ERROR', 'Unexpected error');
  }
}

export function methodNotAllowed() {
  return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
}
