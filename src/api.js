export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
let csrfToken = '';
export const setCsrf = (token) => {
  csrfToken = token || '';
};
export async function api(path, options = {}) {
  const { body, csrf, ...rest } = options;
  const form = body instanceof FormData;
  const response = await fetch('/api' + path, {
    credentials: 'include',
    ...rest,
    headers: {
      ...(!form && body ? { 'Content-Type': 'application/json' } : {}),
      'X-CSRF-Token': csrf ?? csrfToken,
      ...rest.headers,
    },
    ...(body ? { body: form ? body : JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.details?.map((d) => d.field + ': ' + d.message).join(' · ');
    throw new ApiError(detail || data.error || 'No se pudo conectar al servidor.', response.status);
  }
  return data;
}
