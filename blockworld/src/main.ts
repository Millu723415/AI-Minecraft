import './ui/style.css';
import { App } from './app';
import { loadResourcePack } from './render/pack';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

// Textures from an imported resource pack (if any) must be in memory before
// the texture atlases are built.
void loadResourcePack().then((n) => {
  if (n > 0) console.info(`Resource pack: ${n} textures`);
  const app = new App(canvas, ui);
  (window as unknown as { app: App }).app = app;
  void app.start();
});
