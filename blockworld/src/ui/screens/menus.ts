/** Title, world selection, world creation, options, pause, death and loading screens. */

import type { Settings, Action } from '../../game/settings';
import { ACTION_LABELS, DEFAULT_KEYS, keyLabel } from '../../game/settings';
import type { WorldRecord } from '../../save/storage';
import { button, clearChildren, el, slider } from '../dom';
import { drawLogo } from '../logo';
import { Screen } from '../screen';

export interface AppHost {
  readonly settings: Settings;
  listWorlds(): Promise<WorldRecord[]>;
  playWorld(id: string): void;
  createWorld(name: string, seed: string, mode: 'survival' | 'creative' | 'hardcore', difficulty: number): void;
  deleteWorld(id: string): Promise<void>;
  openMainMenu(): void;
  openWorldSelect(): void;
  openCreateWorld(): void;
  openOptions(back: () => void): void;
  openCredits(): void;
  resumeGame(): void;
  saveAndQuit(): void;
  applySettings(): void;
  respawn(): void;
  readonly inGame: boolean;
  readonly worldName: string;
  /** Reopen the pause menu (used when leaving options from in-game). */
  resumeGamePause?(): void;
}

const SPLASHES = [
  'Now with 100% more blocks!', 'Punch a tree!', 'Pixel perfect!', 'Also try gardening!', 'Made of cubes!',
  'Beware the hissing!', 'Mind the lava!', 'One block at a time!', 'Seeds of adventure!', 'Dig straight down? No!',
  'Contains no dragons... yet!', 'Handcrafted in code!', 'Sixteen by sixteen!', 'Torches are friends!',
  'Now in your browser!', 'The sky is square!', 'Obsidian is patient!', 'Eyes point the way!',
];

export class MainMenuScreen extends Screen {
  constructor(private readonly app: AppHost) {
    super('screen');
  }

  override onOpen(): void {
    const r = this.root;
    clearChildren(r);
    const logoWrap = el('div', 'logo', r);
    logoWrap.style.position = 'relative';
    const logo = drawLogo();
    logo.style.width = `${Math.round(logo.width * 0.5)}px`;
    logo.style.height = `${Math.round(logo.height * 0.5)}px`;
    logoWrap.appendChild(logo);
    const splash = el('div', 'splash', logoWrap, SPLASHES[Math.floor(Math.random() * SPLASHES.length)]);
    splash.style.left = `${Math.round(logo.width * 0.5) - 60}px`;
    splash.style.top = `${Math.round(logo.height * 0.5) - 6}px`;
    const col = el('div', 'center-col', r);
    col.style.marginTop = '28px';
    button(col, 'Singleplayer', () => this.app.openWorldSelect());
    button(col, 'Options...', () => this.app.openOptions(() => this.app.openMainMenu()));
    button(col, 'Credits', () => this.app.openCredits());
    const footer = el('div', 'menu-footer', r);
    el('div', 'shadow', footer, 'BLOCKWORLD 1.0');
    el('div', 'shadow gray', footer, 'An independent voxel survival game');
  }
}

export class WorldSelectScreen extends Screen {
  private selected: string | null = null;
  private worlds: WorldRecord[] = [];

  constructor(private readonly app: AppHost) {
    super('screen dirt');
  }

  override onOpen(): void {
    void this.render();
  }

  private async render(): Promise<void> {
    const r = this.root;
    clearChildren(r);
    el('div', 'title', r, 'Select World');
    const list = el('div', 'world-list', r);
    el('div', 'gray', list, 'Loading...');
    try {
      this.worlds = await this.app.listWorlds();
    } catch (err) {
      clearChildren(list);
      el('div', 'red', list, 'Could not open storage.');
      console.error(err);
      this.worlds = [];
    }
    clearChildren(list);
    if (this.worlds.length === 0) el('div', 'gray', list, 'No worlds yet. Create one!').style.padding = '4px';
    for (const w of this.worlds) {
      const e = el('div', `world-entry${this.selected === w.id ? ' selected' : ''}`, list);
      el('div', '', e, w.meta.name);
      const date = new Date(w.meta.lastPlayed);
      el('div', 'sub', e, `${w.meta.id.slice(0, 12)} (${date.toLocaleDateString()} ${date.toLocaleTimeString()})`);
      el('div', 'sub', e, `${w.meta.gameMode === 'creative' ? 'Creative' : w.meta.gameMode === 'hardcore' ? 'Hardcore!' : 'Survival'} Mode`);
      e.addEventListener('click', () => { this.selected = w.id; void this.render(); });
      e.addEventListener('dblclick', () => this.app.playWorld(w.id));
    }
    const row1 = el('div', 'row', r);
    row1.style.marginTop = '8px';
    const play = button(row1, 'Play Selected World', () => this.selected && this.app.playWorld(this.selected), 150);
    play.disabled = !this.selected;
    button(row1, 'Create New World', () => this.app.openCreateWorld(), 150);
    const row2 = el('div', 'row', r);
    row2.style.marginTop = '4px';
    const del = button(row2, 'Delete', () => this.confirmDelete(), 72);
    del.disabled = !this.selected;
    button(row2, 'Cancel', () => this.app.openMainMenu(), 228);
  }

  private confirmDelete(): void {
    const w = this.worlds.find((x) => x.id === this.selected);
    if (!w) return;
    const r = this.root;
    clearChildren(r);
    el('div', 'title', r, 'Are you sure you want to delete this world?');
    el('div', 'gray', r, `'${w.meta.name}' will be lost forever! (A long time!)`);
    const row = el('div', 'row', r);
    row.style.marginTop = '24px';
    button(row, 'Delete', async () => {
      await this.app.deleteWorld(w.id);
      this.selected = null;
      void this.render();
    }, 150);
    button(row, 'Cancel', () => void this.render(), 150);
  }
}

export class CreateWorldScreen extends Screen {
  private mode: 'survival' | 'creative' | 'hardcore' = 'survival';
  private difficulty = 2;

  constructor(private readonly app: AppHost) {
    super('screen dirt');
  }

  override onOpen(): void {
    const r = this.root;
    clearChildren(r);
    el('div', 'title', r, 'Create New World');
    const col = el('div', 'center-col', r);
    el('div', 'gray', col, 'World Name').style.alignSelf = 'flex-start';
    const name = el('input', 'mc-input', col) as HTMLInputElement;
    name.value = 'New World';
    name.maxLength = 32;
    el('div', 'gray', col, 'Seed for the World Generator').style.alignSelf = 'flex-start';
    const seed = el('input', 'mc-input', col) as HTMLInputElement;
    seed.placeholder = 'Leave blank for a random seed';
    for (const inp of [name, seed]) inp.addEventListener('keydown', (e) => e.stopPropagation());
    const modeBtn = button(col, '', () => {
      this.mode = this.mode === 'survival' ? 'hardcore' : this.mode === 'hardcore' ? 'creative' : 'survival';
      update();
    }, 200);
    const diffBtn = button(col, '', () => {
      this.difficulty = (this.difficulty + 1) % 4;
      update();
    }, 200);
    const desc = el('div', 'gray', col);
    const update = () => {
      modeBtn.textContent = `Game Mode: ${this.mode[0].toUpperCase()}${this.mode.slice(1)}`;
      diffBtn.textContent = `Difficulty: ${['Peaceful', 'Easy', 'Normal', 'Hard'][this.difficulty]}`;
      diffBtn.disabled = this.mode === 'hardcore';
      desc.textContent = this.mode === 'survival' ? 'Search for resources, craft, gain levels, health and hunger'
        : this.mode === 'hardcore' ? 'Same as survival mode, locked at hardest difficulty, and one life only'
          : 'Unlimited resources, free flying and destroy blocks instantly';
    };
    update();
    const row = el('div', 'row', r);
    row.style.marginTop = '16px';
    button(row, 'Create New World', () => {
      const diff = this.mode === 'hardcore' ? 3 : this.difficulty;
      this.app.createWorld(name.value.trim() || 'New World', seed.value, this.mode, diff);
    }, 150);
    button(row, 'Cancel', () => this.app.openWorldSelect(), 150);
    setTimeout(() => name.focus(), 30);
  }
}

export class OptionsScreen extends Screen {
  private page: 'main' | 'video' | 'controls' = 'main';
  private rebinding: Action | null = null;

  constructor(private readonly app: AppHost, private readonly back: () => void) {
    super('screen dirt');
    this.pausesGame = true;
  }

  override onOpen(): void {
    this.render();
  }

  private render(): void {
    const r = this.root;
    const s = this.app.settings;
    clearChildren(r);
    const changed = () => this.app.applySettings();
    if (this.page === 'main') {
      el('div', 'title', r, 'Options');
      const grid = el('div', 'keybind-grid', r);
      slider(grid, (v) => `Master Volume: ${Math.round(v * 100)}%`, s.masterVolume, (v) => { s.masterVolume = v; changed(); });
      slider(grid, (v) => `Music: ${v === 0 ? 'OFF' : Math.round(v * 100) + '%'}`, s.musicVolume, (v) => { s.musicVolume = v; changed(); });
      slider(grid, (v) => `Sound: ${Math.round(v * 100)}%`, s.soundVolume, (v) => { s.soundVolume = v; changed(); });
      slider(grid, (v) => `Sensitivity: ${Math.round(v * 200)}%`, s.sensitivity, (v) => { s.sensitivity = v; changed(); });
      const inv = button(grid, `Invert Mouse: ${s.invertMouse ? 'ON' : 'OFF'}`, () => { s.invertMouse = !s.invertMouse; changed(); inv.textContent = `Invert Mouse: ${s.invertMouse ? 'ON' : 'OFF'}`; }, 150);
      slider(grid, (v) => `FOV: ${Math.round(30 + v * 80) === 70 ? 'Normal' : Math.round(30 + v * 80)}`, (s.fov - 30) / 80, (v) => { s.fov = Math.round(30 + v * 80); changed(); });
      const col = el('div', 'center-col', r);
      col.style.marginTop = '12px';
      button(col, 'Video Settings...', () => { this.page = 'video'; this.render(); });
      button(col, 'Controls...', () => { this.page = 'controls'; this.render(); });
      const done = el('div', 'center-col', r);
      done.style.marginTop = '16px';
      button(done, 'Done', () => this.back());
    } else if (this.page === 'video') {
      el('div', 'title', r, 'Video Settings');
      const grid = el('div', 'keybind-grid', r);
      slider(grid, (v) => `Render Distance: ${Math.round(2 + v * 14)} chunks`, (s.renderDistance - 2) / 14, (v) => { s.renderDistance = Math.round(2 + v * 14); changed(); });
      const gfx = button(grid, '', () => { s.fancyGraphics = !s.fancyGraphics; changed(); upd(); }, 150);
      const sl = button(grid, '', () => { s.smoothLighting = !s.smoothLighting; changed(); upd(); }, 150);
      const cl = button(grid, '', () => { s.clouds = !s.clouds; changed(); upd(); }, 150);
      const pa = button(grid, '', () => { s.particles = ((s.particles + 1) % 3) as 0 | 1 | 2; changed(); upd(); }, 150);
      const vb = button(grid, '', () => { s.viewBobbing = !s.viewBobbing; changed(); upd(); }, 150);
      slider(grid, (v) => `Brightness: ${v < 0.05 ? 'Moody' : v > 0.95 ? 'Bright' : '+' + Math.round(v * 100) + '%'}`, s.brightness, (v) => { s.brightness = v; changed(); });
      const gs = button(grid, '', () => { s.guiScale = (s.guiScale + 1) % 5; changed(); upd(); }, 150);
      const fps = button(grid, '', () => { s.showFps = !s.showFps; changed(); upd(); }, 150);
      const upd = () => {
        gfx.textContent = `Graphics: ${s.fancyGraphics ? 'Fancy' : 'Fast'}`;
        sl.textContent = `Smooth Lighting: ${s.smoothLighting ? 'ON' : 'OFF'}`;
        cl.textContent = `Clouds: ${s.clouds ? 'ON' : 'OFF'}`;
        pa.textContent = `Particles: ${['All', 'Decreased', 'Minimal'][s.particles]}`;
        vb.textContent = `View Bobbing: ${s.viewBobbing ? 'ON' : 'OFF'}`;
        gs.textContent = `GUI Scale: ${['Auto', 'Small', 'Normal', 'Large', 'Huge'][s.guiScale]}`;
        fps.textContent = `Show FPS: ${s.showFps ? 'ON' : 'OFF'}`;
      };
      upd();
      const done = el('div', 'center-col', r);
      done.style.marginTop = '16px';
      button(done, 'Done', () => { this.page = 'main'; this.render(); });
    } else {
      el('div', 'title', r, 'Controls');
      const grid = el('div', 'keybind-grid', r);
      grid.style.gridTemplateColumns = '90px 70px 90px 70px';
      for (const action of Object.keys(ACTION_LABELS) as Action[]) {
        el('div', 'shadow', grid, ACTION_LABELS[action]).style.lineHeight = '20px';
        const b = button(grid, this.rebinding === action ? '> ??? <' : keyLabel(s.keys[action]), () => {
          this.rebinding = action;
          this.render();
        }, 70);
        if (this.rebinding === action) b.style.color = '#ffff55';
      }
      const col = el('div', 'row', r);
      col.style.marginTop = '12px';
      button(col, 'Reset Keys', () => { s.keys = { ...DEFAULT_KEYS }; changed(); this.render(); }, 100);
      button(col, 'Done', () => { this.page = 'main'; this.render(); }, 150);
      el('div', 'gray', r, 'Hotbar: 1-9 / mouse wheel   Pause: ESC').style.marginTop = '8px';
    }
  }

  override onKey(code: string): boolean {
    if (this.rebinding) {
      if (code !== 'Escape') {
        this.app.settings.keys[this.rebinding] = code;
        this.app.applySettings();
      }
      this.rebinding = null;
      this.render();
      return true;
    }
    return false;
  }
}

export class PauseScreen extends Screen {
  constructor(private readonly app: AppHost) {
    super('screen dim');
    this.pausesGame = true;
  }

  override onOpen(): void {
    const r = this.root;
    clearChildren(r);
    el('div', 'title', r, 'Game menu').style.marginTop = '40px';
    const col = el('div', 'center-col', r);
    col.style.marginTop = '20px';
    button(col, 'Back to Game', () => this.app.resumeGame());
    button(col, 'Options...', () => this.app.openOptions(() => this.app.resumeGamePause?.()));
    button(col, 'Save and Quit to Title', () => this.app.saveAndQuit());
  }
}


export class DeathScreen extends Screen {
  constructor(private readonly app: AppHost, private readonly message: string, private readonly score: number, private readonly hardcore: boolean) {
    super('screen death-bg');
    this.closable = false;
  }

  override onOpen(): void {
    const r = this.root;
    clearChildren(r);
    const t = el('div', 'title', r, this.hardcore ? 'Game over!' : 'You died!');
    t.style.marginTop = '50px';
    t.style.transform = 'scale(2)';
    t.style.marginBottom = '20px';
    el('div', 'shadow', r, this.message);
    el('div', 'shadow', r, `Score: `).appendChild(el('span', 'yellow', null, String(this.score)));
    const col = el('div', 'center-col', r);
    col.style.marginTop = '30px';
    if (this.hardcore) {
      button(col, 'Delete world', () => this.app.saveAndQuit());
    } else {
      button(col, 'Respawn', () => this.app.respawn());
      button(col, 'Title menu', () => this.app.saveAndQuit());
    }
  }
}

export class LoadingScreen extends Screen {
  private titleEl!: HTMLDivElement;
  private bar!: HTMLDivElement;

  constructor(private title: string) {
    super('screen dirt');
    this.closable = false;
  }

  override onOpen(): void {
    const r = this.root;
    clearChildren(r);
    r.style.justifyContent = 'center';
    this.titleEl = el('div', 'shadow', r, this.title);
    const wrap = el('div', 'loading-bar', r);
    this.bar = el('div', '', wrap);
    this.bar.style.width = '0px';
  }

  set(title: string, progress: number): void {
    if (!this.titleEl) return;
    this.titleEl.textContent = title;
    this.bar.style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}px`;
  }
}

export class CreditsScreen extends Screen {
  constructor(private readonly app: AppHost) {
    super('screen dirt');
  }

  override onOpen(): void {
    const r = this.root;
    clearChildren(r);
    el('div', 'title', r, 'BLOCKWORLD');
    const lines = [
      'An independent voxel survival game inspired by',
      'the first full release era of 2011 PC block games.',
      '',
      'All textures, sounds, music, fonts and text',
      'are original and generated by the game itself.',
      '',
      'Built with TypeScript, Three.js and Vite.',
      '',
      'Thank you for playing.',
    ];
    for (const l of lines) el('div', 'shadow', r, l || ' ');
    const col = el('div', 'center-col', r);
    col.style.marginTop = '20px';
    button(col, 'Done', () => this.app.openMainMenu());
  }
}
