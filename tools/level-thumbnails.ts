import { createServer, type Plugin, type ResolvedConfig } from 'vite';

const ID = 'virtual:level-thumbnails';
/** the page that draws them, served by a dev server during the build */
const PAGE = 'tools/thumbnails.html';
const TIMEOUT_MS = 120_000;

/**
 * `virtual:level-thumbnails`: the level select's pictures of the levels, by level name.
 * `vite build` draws them with the game's own code in headless Chrome (puppeteer) and ships them as images, so the
 * built game doesn't draw every level to show the list; any level added or edited is pictured on the next build.
 * The dev server gives null: the game draws them itself, so saving a level in Tiled shows up straight away.
 * Should drawing them fail (no Chrome: `npx puppeteer browsers install chrome-headless-shell`), the build says so and
 * the game draws them itself too.
 */
export function levelThumbnails(): Plugin {
  let config: ResolvedConfig;
  /** emitted image references, by level name; null: none made */
  let refs: Record<string, string> | null = null;
  return {
    name: 'level-thumbnails',
    configResolved(c) {
      config = c;
    },
    async buildStart() {
      refs = null;
      if (config.command !== 'build') return;
      const started = Date.now();
      try {
        const images = await drawThumbnails(config);
        refs = {};
        for (const [name, dataUrl] of Object.entries(images)) {
          const source = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
          refs[name] = this.emitFile({ type: 'asset', name: `level-${name}.webp`, source });
        }
        config.logger.info(`level thumbnails: ${Object.keys(refs).length} drawn in ${((Date.now() - started) / 1000).toFixed(1)}s`);
      } catch (e) {
        this.warn(`level thumbnails not made, the game will draw them itself: ${e instanceof Error ? e.message : e}`);
      }
    },
    resolveId: (source) => (source === ID ? `\0${ID}` : undefined),
    load(resolved) {
      if (resolved !== `\0${ID}`) return;
      if (!refs) return 'export default null;';
      const entries = Object.entries(refs).map(([name, ref]) => `${JSON.stringify(name)}: import.meta.ROLLUP_FILE_URL_${ref}`);
      return `export default {${entries.join(', ')}};`;
    },
  };
}

/** Serves the game with a dev server and opens `PAGE` in headless Chrome; its thumbnails as data URLs, by level name. */
async function drawThumbnails(config: ResolvedConfig): Promise<Record<string, string>> {
  const { default: puppeteer } = await import('puppeteer');
  // the same config, served: this plugin does nothing there
  const server = await createServer({
    configFile: config.configFile,
    root: config.root,
    mode: 'development',
    logLevel: 'warn',
    server: { open: false, hmr: false, host: 'localhost' },
  });
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    await server.listen();
    const base = server.resolvedUrls?.local[0];
    if (!base) throw new Error('the dev server has no local URL');
    // WebGL in software, so it works without a GPU too
    browser = await puppeteer.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e instanceof Error ? e.message : String(e)));
    await page.goto(new URL(PAGE, base).href);
    await page.waitForFunction(() => window.thumbnails !== undefined, { timeout: TIMEOUT_MS });
    const result = await page.evaluate(() => window.thumbnails);
    // a broken map is left out of the game too; its message is worth seeing
    for (const e of errors) config.logger.warn(`level thumbnails: ${e}`);
    if (typeof result === 'string') throw new Error(result);
    return result ?? {};
  } finally {
    await browser?.close();
    await server.close();
  }
}
