'use strict';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// fetch + JSON, with a timeout and one clear error type.
async function fetchJson(url, options, timeoutMs) {
  let res;
  try {
    res = await fetch(url, Object.assign({}, options || {}, { signal: AbortSignal.timeout(timeoutMs || 15000) }));
  } catch (e) {
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new HttpError(504, timedOut ? 'The service took too long to answer' : 'Could not reach the service');
  }
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
  if (!res.ok) {
    let msg = data && ((data.error && (data.error.message || data.error)) || data.message || data.msg);
    if (!msg) msg = text.replace(/\s+/g, ' ').slice(0, 160) || 'HTTP ' + res.status;
    if (typeof msg !== 'string') msg = JSON.stringify(msg);
    throw new HttpError(res.status, msg.slice(0, 200));
  }
  return data;
}

module.exports = { HttpError, fetchJson };
