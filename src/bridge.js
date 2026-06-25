// WebSocket relay bridge — works across browser processes (OBS CEF ↔ Chrome).
// Both sides connect to the Vite dev server at /relay; the server echoes each
// message to every other connected client.
const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
const RELAY  = `${proto}//${location.host}/relay`;

export class Bridge {
  constructor() {
    this._on    = {};
    this._queue = [];   // messages sent before the socket opens
    this._connect();
  }

  _connect() {
    const ws = this._ws = new WebSocket(RELAY);

    ws.onopen = () => {
      for (const m of this._queue) ws.send(m);
      this._queue = [];
    };

    ws.onmessage = ({ data }) => {
      try {
        const { t, p } = JSON.parse(data);
        this._on[t]?.(p);
      } catch { /* ignore malformed messages */ }
    };

    ws.onclose = () => setTimeout(() => this._connect(), 1000);
  }

  on(type, fn)   { this._on[type] = fn; return this; }

  send(type, payload) {
    const msg = JSON.stringify({ t: type, p: payload });
    if (this._ws.readyState === 1 /* OPEN */) this._ws.send(msg);
    else this._queue.push(msg);
  }

  close() { this._ws.onclose = null; this._ws.close(); }
}
