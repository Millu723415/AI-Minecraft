/**
 * Application shell: boots the renderer, UI, audio and storage; owns the
 * title-screen panorama and the lifecycle of game sessions.
 */

import { Renderer } from './render/renderer';
import { Input } from './game/input';
import { loadSettings, saveSettings, type Settings } from './game/settings';
import { UIManager, type UIHost } from './ui/manager';
import { AudioEngine } from './audio/audio';
import { Storage, SAVE_FORMAT_VERSION, GAME_VERSION, type WorldRecord } from './save/storage';
import { Game } from './game/game';
import { parseSeed } from './core/rng';
import { GENERATOR_VERSION } from './worldgen/index';
import { MainMenuScreen, WorldSelectScreen, CreateWorldScreen, OptionsScreen, PauseScreen, DeathScreen, LoadingScreen, CreditsScreen, type AppHost } from './ui/screens/menus';
import { EndingScreen } from './ui/screens/ending';
import { installPixelFont } from './ui/font';
import { setUiSound } from './ui/dom';
import { Panorama } from './panorama';
import type { Player } from './entity/player';
import type { ItemStack } from './items/stack';

export class App implements AppHost, UIHost {
  readonly settings: Settings;
  readonly renderer: Renderer;
  readonly input: Input;
  readonly ui: UIManager;
  readonly audio = new AudioEngine();
  readonly storage = new Storage();
  game: Game | null = null;
  private panorama: Panorama | null = null;
  private loading: LoadingScreen | null = null;
  private lastTime = 0;

  constructor(readonly canvas: HTMLCanvasElement, readonly uiRoot: HTMLElement) {
    this.settings = loadSettings();
    this.renderer = new Renderer(canvas);
    this.input = new Input(canvas, this.settings);
    this.ui = new UIManager(uiRoot, () => this.settings);
    this.ui.host = this;
    setUiSound(() => this.audio.play2d('ui.click', 0.6, 1));
    this.applySettings();
    // Audio can only start after a user gesture.
    const unlock = () => this.audio.resume();
    window.addEventListener('mousedown', unlock);
    window.addEventListener('keydown', unlock);
    this.input.onKey((code) => this.onKey(code));
    this.input.onLockChange((locked) => this.onLockChange(locked));
    canvas.addEventListener('mousedown', () => {
      if (this.game && this.game.state === 'playing' && !this.ui.screen && !this.input.locked) this.input.requestLock();
    });
    window.addEventListener('beforeunload', () => { void this.game?.save(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.game) {
        void this.game.save();
        if (this.game.state === 'playing' && !this.ui.screen) this.openPause();
      }
    });
  }

  async start(): Promise<void> {
    await installPixelFont();
    this.ui.resize();
    this.panorama = new Panorama(this.renderer);
    this.ui.setHudVisible(false);
    this.openMainMenu();
    requestAnimationFrame((t) => this.frame(t));
  }

  // --- UIHost ------------------------------------------------------------------
  get player(): Player {
    return this.game!.player;
  }

  dropItem(stack: ItemStack): void {
    this.game?.dropItem(stack);
  }

  onScreenOpened(): void {
    this.input.exitLock();
  }

  onScreenClosed(): void {
    if (this.game && this.game.state === 'playing') {
      this.game.paused = false;
      this.input.requestLock();
    }
  }

  onCrafted(stack: ItemStack): void { this.game?.onCrafted(stack); }
  onSmelted(stack: ItemStack, tile: import('./world/tileentity').FurnaceTile): void { this.game?.onSmelted(stack, tile); }
  onChestOpen(open: boolean): void { this.game?.onChestOpen(open); }
  enchantSeed(): number { return this.game?.enchantSeed() ?? 1; }
  onEnchanted(): void { this.game?.onEnchanted(); }

  // --- AppHost -----------------------------------------------------------------
  get inGame(): boolean {
    return !!this.game;
  }

  get worldName(): string {
    return this.game?.world.meta.name ?? '';
  }

  listWorlds(): Promise<WorldRecord[]> {
    return this.storage.listWorlds();
  }

  async deleteWorld(id: string): Promise<void> {
    await this.storage.deleteWorld(id);
  }

  openMainMenu(): void {
    this.ui.open(new MainMenuScreen(this));
  }

  openWorldSelect(): void {
    this.ui.open(new WorldSelectScreen(this));
  }

  openCreateWorld(): void {
    this.ui.open(new CreateWorldScreen(this));
  }

  openOptions(back: () => void): void {
    this.ui.open(new OptionsScreen(this, back));
  }

  openCredits(): void {
    this.ui.open(new CreditsScreen(this));
  }

  applySettings(): void {
    const s = this.settings;
    saveSettings(s);
    this.input.setSettings(s);
    this.audio.masterVolume = s.masterVolume;
    this.audio.musicVolume = s.musicVolume;
    this.audio.soundVolume = s.soundVolume;
    this.audio.applyVolumes();
    const u = this.renderer.materials.uniforms;
    u.brightness.value = s.brightness;
    this.renderer.sky.cloudsEnabled = s.clouds;
    this.ui.resize();
    if (this.game) {
      this.game.settings = s;
      this.game.particleSystem.level = s.particles;
      const mesherChanged = this.game.mesher && true;
      this.game.mesher.setOptions({ fancyLeaves: s.fancyGraphics, smoothLighting: s.smoothLighting });
      if (mesherChanged) this.game.chunkManager?.remeshAll();
    }
  }

  createWorld(name: string, seedText: string, mode: 'survival' | 'creative' | 'hardcore', difficulty: number): void {
    const id = `w${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const seed = parseSeed(seedText);
    const record: WorldRecord = {
      id,
      saveFormatVersion: SAVE_FORMAT_VERSION,
      generatorVersion: GENERATOR_VERSION,
      gameVersion: GAME_VERSION,
      meta: { id, name, seed, seedText: seedText.trim() || String(seed), gameMode: mode, difficulty, generatorVersion: GENERATOR_VERSION, created: Date.now(), lastPlayed: Date.now() },
      state: { totalTime: 0, dayTime: 0, raining: false, rainTime: 12000 + Math.floor(Math.random() * 60000), spawn: [0, 80, 0], dragonKilled: false, endInitialized: false, endingSeen: false, enchantSeed: (Math.random() * 1e9) | 0 },
      player: null,
      playerDim: 0,
    };
    void this.launch(record);
  }

  playWorld(id: string): void {
    void (async () => {
      const rec = await this.storage.getWorld(id);
      if (!rec) return;
      await this.launch(rec);
    })();
  }

  private async launch(record: WorldRecord): Promise<void> {
    this.audio.resume();
    this.panorama?.stop();
    this.loading = new LoadingScreen('Loading world');
    this.ui.open(this.loading);
    const game = new Game(this.renderer, this.input, this.ui, this.audio, this.storage, this.settings, {
      onPause: () => this.openPause(),
      onDeath: (msg, score) => this.ui.open(new DeathScreen(this, msg, score, record.meta.gameMode === 'hardcore')),
      onLoadingProgress: (title, p) => {
        if (!this.loading || this.ui.screen !== this.loading) {
          this.loading = new LoadingScreen(title);
          this.ui.open(this.loading);
        }
        this.loading.set(title, p);
      },
      onLoaded: () => {
        if (this.ui.screen === this.loading) this.ui.close();
        this.loading = null;
        this.input.requestLock();
      },
      onEnding: () => this.ui.open(new EndingScreen(() => this.finishEnding())),
      onQuit: () => undefined,
    }, record);
    game.player.displayName = 'Player';
    this.game = game;
    this.applySettings();
    await game.begin(record);
  }

  private finishEnding(): void {
    const g = this.game;
    if (!g) return;
    this.ui.close();
    g.state = 'playing';
    g.changeDimension(0, 'exit');
  }

  openPause(): void {
    if (!this.game || this.game.state !== 'playing') return;
    this.game.paused = true;
    void this.game.save();
    this.ui.open(new PauseScreen(this));
  }

  resumeGamePause(): void {
    this.openPause();
  }

  resumeGame(): void {
    if (!this.game) return;
    this.ui.close();
    this.game.paused = false;
    this.input.requestLock();
  }

  respawn(): void {
    if (!this.game) return;
    this.ui.close();
    this.game.respawn();
  }

  saveAndQuit(): void {
    const g = this.game;
    if (!g) return;
    void (async () => {
      const hardcoreDead = g.world.meta.gameMode === 'hardcore' && g.player.dead;
      this.loading = new LoadingScreen('Saving world');
      this.ui.open(this.loading);
      if (hardcoreDead) await this.storage.deleteWorld(g.world.meta.id);
      else await g.save();
      g.dispose();
      this.game = null;
      this.loading = null;
      this.panorama?.start();
      this.openMainMenu();
    })();
  }

  // --- Input -----------------------------------------------------------------
  private onKey(code: string): boolean {
    const g = this.game;
    if (code === 'Escape') {
      if (this.ui.screen) {
        if (this.ui.onKey(code)) return true;
        if (!g) return false;
        if (this.ui.screen instanceof PauseScreen) { this.resumeGame(); return true; }
        if (this.ui.screen.closable && g.state === 'playing') { this.ui.close(); return true; }
        return false;
      }
      if (g && g.state === 'playing') { this.openPause(); return true; }
      return false;
    }
    if (g) return g.onKey(code);
    return this.ui.onKey(code);
  }

  private onLockChange(locked: boolean): void {
    const g = this.game;
    // Losing pointer lock while playing (ESC, alt-tab) opens the pause menu.
    if (!locked && g && g.state === 'playing' && !this.ui.screen) this.openPause();
  }

  // --- Frame loop ----------------------------------------------------------------
  private frame(t: number): void {
    requestAnimationFrame((n) => this.frame(n));
    const dt = this.lastTime ? Math.min(250, t - this.lastTime) : 16;
    this.lastTime = t;
    if (this.game) {
      try {
        this.game.frame(t);
      } catch (err) {
        console.error(err);
      }
    } else {
      this.ui.setHudVisible(false);
      this.panorama?.render(dt);
    }
    this.ui.update(dt);
  }
}
