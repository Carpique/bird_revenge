import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const AUDIO_DIR = 'public/assets/audio';

/** `virtual:audio-files`: the sound files in public/assets/audio, so adding a sound needs no code change. */
function audioFiles(): Plugin {
  const id = 'virtual:audio-files';
  return {
    name: 'audio-files',
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    load(resolved) {
      if (resolved !== `\0${id}`) return;
      const files = readdirSync(AUDIO_DIR).filter((f) => /\.(mp3|m4a|ogg|wav)$/i.test(f)).sort();
      return `export default ${JSON.stringify(files)};`;
    },
    // a sound added, removed or renamed while the dev server runs: rebuild the list and reload the page
    configureServer(server) {
      const dir = resolve(AUDIO_DIR);
      server.watcher.add(dir);
      const onChange = (file: string) => {
        if (!file.startsWith(dir)) return;
        const mod = server.moduleGraph.getModuleById(`\0${id}`);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', onChange);
      server.watcher.on('unlink', onChange);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [audioFiles()],
  server: { port: 5173, open: true },
});
