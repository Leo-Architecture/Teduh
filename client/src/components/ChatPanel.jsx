import { useEffect, useRef, useState } from 'react';
import { useStore } from '../hooks.js';
import { ui, sendChat } from '../store.js';

const ASKS = ['Which way is the shadiest?', 'Will I get wet?', 'Any covered walkways?', 'Should I wait out the rain?'];

export default function ChatPanel() {
  useStore();
  const [text, setText] = useState('');
  const log = useRef(null);
  useEffect(function () { if (log.current) log.current.scrollTop = log.current.scrollHeight; });
  const on = ui.online && ui.features.chat;
  if (!on) return null;
  return (
    <section className="sec card" id="chatSec">
      <h2>Ask Teduh Buddy</h2>
      <p className="sub" id="chatSub">A friendly walking buddy powered by {ui.features.chat === 'gemini' ? 'Gemini' : 'Claude'}. It only talks about the routes above.</p>
      <div className="chat" id="chatLog" role="log" aria-live="polite" ref={log}>
        {ui.chat.map(function (m, i) { return <p key={i} className={'bubble ' + (m.role === 'user' ? 'me' : 'bot') + (m.error ? ' err' : '')}>{m.text}</p>; })}
        {ui.chatBusy ? <p className="bubble bot">Thinking</p> : null}
      </div>
      {!ui.chat.length ? (
        <div className="chips" id="chatSuggest">
          {ASKS.map(function (q) { return <button type="button" key={q} className="chip" onClick={function () { sendChat(q); }}>{q}</button>; })}
        </div>
      ) : null}
      <form className="row" id="chatForm" onSubmit={function (ev) { ev.preventDefault(); const t = text; setText(''); sendChat(t); }}>
        <label className="sr" htmlFor="chatIn">Message</label>
        <input id="chatIn" maxLength={300} autoComplete="off" placeholder="Ask about shade, rain or the route" value={text} onChange={function (ev) { setText(ev.target.value); }} />
        <button type="submit" className="btn sm" id="chatSend" disabled={ui.chatBusy}>Send</button>
      </form>
    </section>
  );
}
