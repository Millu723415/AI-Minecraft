/**
 * Keyboard and mouse input with pointer lock. Game code polls the state each
 * frame/tick; UI code subscribes to key events.
 */

import type { Action, Settings } from './settings';

export class Input {
  private down = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  leftDown = false;
  rightDown = false;
  middleDown = false;
  /** Set on the frame a button was pressed (consumed by the game). */
  leftPressed = false;
  rightPressed = false;
  middlePressed = false;
  locked = false;
  private lastForwardTap = 0;
  sprintTap = false;
  private keyListeners: ((code: string, e: KeyboardEvent) => boolean | void)[] = [];
  private lockListeners: ((locked: boolean) => void)[] = [];

  constructor(private readonly canvas: HTMLCanvasElement, private settings: Settings) {
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mouseup', (e) => this.onMouseUp(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => {
      if (this.locked) this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.releaseAll();
      if (was !== this.locked) for (const l of this.lockListeners) l(this.locked);
    });
  }

  setSettings(s: Settings): void {
    this.settings = s;
  }

  onKey(listener: (code: string, e: KeyboardEvent) => boolean | void): () => void {
    this.keyListeners.push(listener);
    return () => { this.keyListeners = this.keyListeners.filter((l) => l !== listener); };
  }

  onLockChange(listener: (locked: boolean) => void): void {
    this.lockListeners.push(listener);
  }

  requestLock(): void {
    if (this.locked) return;
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => undefined);
    } catch {
      // Some browsers throw if called too soon after an exit.
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
    this.releaseAll();
  }

  isDown(action: Action): boolean {
    const code = this.settings.keys[action];
    if (code.startsWith('Mouse')) {
      const b = Number(code.slice(5));
      return b === 0 ? this.leftDown : b === 2 ? this.rightDown : b === 1 ? this.middleDown : false;
    }
    return this.down.has(code);
  }

  isCodeDown(code: string): boolean {
    return this.down.has(code);
  }

  consumeMouse(): [number, number] {
    const d: [number, number] = [this.mouseDX, this.mouseDY];
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  consumeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  releaseAll(): void {
    this.down.clear();
    this.leftDown = false;
    this.rightDown = false;
    this.middleDown = false;
    this.leftPressed = false;
    this.rightPressed = false;
    this.middlePressed = false;
    this.sprintTap = false;
  }

  private onKeyDown(e: KeyboardEvent): void {
    // Keep browser shortcuts from firing while playing.
    if (this.locked && (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab' || e.code === 'F3' || e.code === 'F1' || e.code === 'F5' || e.code === 'F2')) {
      e.preventDefault();
    }
    if (!e.repeat && e.code === this.settings.keys.forward && this.locked) {
      const now = performance.now();
      if (now - this.lastForwardTap < 300) this.sprintTap = true;
      this.lastForwardTap = now;
    }
    if (!e.repeat) {
      for (const l of Array.from(this.keyListeners).reverse()) {
        if (l(e.code, e)) {
          e.preventDefault();
          return;
        }
      }
    }
    if (this.locked) this.down.add(e.code);
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.down.delete(e.code);
    if (e.code === this.settings.keys.forward) this.sprintTap = false;
  }

  private onMouseDown(e: MouseEvent): void {
    if (!this.locked) return;
    if (e.button === 0) { this.leftDown = true; this.leftPressed = true; }
    if (e.button === 2) { this.rightDown = true; this.rightPressed = true; }
    if (e.button === 1) { this.middleDown = true; this.middlePressed = true; e.preventDefault(); }
  }

  private onMouseUp(e: MouseEvent): void {
    if (e.button === 0) this.leftDown = false;
    if (e.button === 2) this.rightDown = false;
    if (e.button === 1) this.middleDown = false;
  }
}
