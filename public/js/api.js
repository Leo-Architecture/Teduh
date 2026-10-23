'use strict';
// Talks to the Teduh server. Every call either returns the JSON answer or throws an Error with a readable message.

(function (root) {
  async function call(method, url, body, token) {
    const opt = { method: method, headers: {} };
    if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    if (token) opt.headers.Authorization = 'Bearer ' + token;
    let res;
    try { res = await fetch(url, opt); } catch (e) { const err = new Error('Could not reach the server'); err.status = 0; throw err; }
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Something went wrong (' + res.status + ')');
      err.status = res.status;
      throw err;
    }
    return data;
  }
  root.Api = {
    get: function (url, token) { return call('GET', url, null, token); },
    post: function (url, body, token) { return call('POST', url, body || {}, token); },
    // a photo or video as the raw request body
    upload: async function (url, blob, token) {
      let res;
      try { res = await fetch(url, { method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {}, body: blob }); } catch (e) { const err = new Error('Could not reach the server'); err.status = 0; throw err; }
      let data = null; try { data = await res.json(); } catch (e) { /* no body */ }
      if (!res.ok) { const err = new Error((data && data.error) || 'Upload failed (' + res.status + ')'); err.status = res.status; throw err; }
      return data;
    }
  };
})(window);
