import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';

/**
 * Dev server only, for the tutorial recorder (`src/dev/tutorial-recorder.html`):
 * - `GET /__tutorial?name=<level>` reads `src/tutorial/<level>.json`, `POST` (the JSON as the body) writes it: the
 *   pose streams the instructions page plays (the game loads them from there, `src/tutorial/index.ts`)
 * - `GET` / `POST /__trace?name=<file>` the same with `traces/<file>.json`: debug traces (`src/dev/debugTrace.ts`)
 */
export function tutorialRecordings(): Plugin {
  return {
    name: 'tutorial-recordings',
    apply: 'serve',
    configureServer(server) {
      jsonFiles(server, '/__tutorial', 'src/tutorial', 'tutorial recording');
      jsonFiles(server, '/__trace', 'traces', 'debug trace');
    },
  };
}

/** `route?name=<name>`: GET reads `<dir>/<name>.json`, POST writes it. */
function jsonFiles(server: ViteDevServer, route: string, dir: string, what: string) {
  server.middlewares.use(route, (req, res) => {
    const name = new URL(req.url ?? '', 'http://localhost').searchParams.get('name') ?? '';
    if (!/^[\w.-]+$/.test(name) || name.startsWith('.')) {
      res.statusCode = 400;
      return res.end('bad name');
    }
    const file = resolve(dir, `${name}.json`);
    if (req.method === 'GET') {
      if (!existsSync(file)) {
        res.statusCode = 404;
        return res.end(`no ${what}`);
      }
      res.setHeader('Content-Type', 'application/json');
      return res.end(readFileSync(file));
    }
    if (req.method !== 'POST') {
      res.statusCode = 405;
      return res.end();
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        JSON.parse(text);
        mkdirSync(resolve(dir), { recursive: true });
        writeFileSync(file, text);
        server.config.logger.info(`${what} saved: ${dir}/${name}.json`);
        res.end('saved');
      } catch (e) {
        res.statusCode = 400;
        res.end(e instanceof Error ? e.message : String(e));
      }
    });
  });
}
