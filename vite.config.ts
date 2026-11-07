import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { levelThumbnails } from './tools/level-thumbnails';
import { tutorialRecordings } from './tools/tutorial-recordings';

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

// `npm run dev:lan`: HTTPS on the local network, so phones and tablets can use the camera
// (browsers only allow the camera on https or localhost). The certificate is self-signed.
// The build is served by GitHub Pages from the repo's subpath (see DEPLOYMENT.md).
export default defineConfig(({ command, mode }) => {
  const lan = mode === 'lan';
  return {
    base: command === 'build' ? '/bird_revenge/' : './',
    plugins: [audioFiles(), levelThumbnails(), tutorialRecordings(), ...(lan ? [basicSsl()] : [])],
    server: { port: 5173, open: !lan, host: lan },
  };
});
