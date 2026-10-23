'use strict';
// Sends the password reset email through an HTTP email service (no npm packages).
//   BREVO_API_KEY  (brevo.com, free plan, verify one sender address)  or  RESEND_API_KEY (resend.com)
// MAIL_FROM is the verified sender address. Without a key the link is only printed in the server console.

const { fetchJson, HttpError } = require('./http');

function createMail(cfg) {
  const m = cfg.mail;
  function provider() { return m.brevoKey ? 'brevo' : m.resendKey ? 'resend' : null; }
  async function send(to, subject, text) {
    const p = provider();
    if (!p) return { sent: false };
    if (!m.from) throw new HttpError(503, 'Email is not set up: add MAIL_FROM (a sender address you verified with your email service).');
    const html = '<p>' + text.split('\n\n').map(function (t) { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>'); }).join('</p><p>') + '</p>';
    try {
      if (p === 'brevo') {
        await fetchJson(m.brevoUrl, { method: 'POST', headers: { 'api-key': m.brevoKey, 'Content-Type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ sender: { email: m.from, name: 'Teduh' }, to: [{ email: to }], subject: subject, textContent: text, htmlContent: html }) }, 12000);
      } else {
        await fetchJson(m.resendUrl, { method: 'POST', headers: { Authorization: 'Bearer ' + m.resendKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: 'Teduh <' + m.from + '>', to: [to], subject: subject, text: text, html: html }) }, 12000);
      }
    } catch (e) {
      console.warn('Email failed: ' + e.message);
      throw new HttpError(502, 'The email could not be sent. Check the email settings in the .env file.');
    }
    return { sent: true };
  }
  return { send: send, provider: provider };
}
module.exports = { createMail };
