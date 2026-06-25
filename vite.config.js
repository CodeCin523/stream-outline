import { defineConfig } from 'vite';
import { WebSocketServer } from 'ws';

// Relay WebSocket messages between all connected clients (/ ↔ /remote).
// Lets OBS Browser Source (separate Chromium/CEF process) talk to the
// controller tab in a regular browser — BroadcastChannel can't cross processes.
function relayPlugin() {
  return {
    name: 'relay',
    configureServer(server) {
      const wss = new WebSocketServer({ noServer: true });
      const clients = new Set();

      wss.on('connection', ws => {
        clients.add(ws);
        ws.on('message', data => {
          for (const c of clients)
            if (c !== ws && c.readyState === 1 /* OPEN */) c.send(data, { binary: false });
        });
        ws.on('close', () => clients.delete(ws));
      });

      server.httpServer?.on('upgrade', (req, socket, head) => {
        const path = new URL(req.url, `http://${req.headers.host}`).pathname;
        if (path === '/relay')
          wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
      });
    },
  };
}

export default defineConfig({
  plugins: [relayPlugin()],
  optimizeDeps: {
    exclude: ['@mediapipe/tasks-vision'],
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    sourcemapIgnoreList: (p) => p.includes('node_modules'),
  },
});
