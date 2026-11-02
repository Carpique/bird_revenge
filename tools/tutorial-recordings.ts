import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/** where the recordings go: the game loads them from there (`src/tutorial/index.ts`) */
const DIR = 'src/tutorial';
const ROUTE = '/__tutorial';

/**
 * Dev server only: `GET /__tutorial?name=<level>` reads `src/tutorial/<level>.json`, `POST` (the JSON as the body)
 * writes it — for the tutorial recorder (`src/dev/tutorial-recorder.html`), which records the pose streams the
 * instructions page plays.
 */
export function tutorialRecordings(): Plugin {
  return {
    name: 'tutorial-recordings',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(ROUTE, (req, res) => {
        const name = new URL(req.url ?? '', 'http://localhost').searchParams.get('name') ?? '';
        if (!/^[\w-]+$/.test(name)) {
          res.statusCode = 400;
          return res.end('bad name');
        }
        const file = resolve(DIR, `${name}.json`);
        if (req.method === 'GET') {
          if (!existsSync(file)) {
            res.statusCode = 404;
            return res.end('no recording');
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
            writeFileSync(file, text);
            server.config.logger.info(`tutorial recording saved: ${DIR}/${name}.json`);
            res.end('saved');
          } catch (e) {
            res.statusCode = 400;
            res.end(e instanceof Error ? e.message : String(e));
          }
        });
      });
    },
  };
}
