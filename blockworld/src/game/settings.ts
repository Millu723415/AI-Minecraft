/** Player options, persisted in localStorage. */

export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'sneak' | 'sprint'
  | 'inventory' | 'drop' | 'chat' | 'debug' | 'perspective' | 'hideGui' | 'screenshot';

export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Forward', back: 'Back', left: 'Left', right: 'Right', jump: 'Jump', sneak: 'Sneak',
  sprint: 'Sprint', inventory: 'Inventory', drop: 'Drop Item', chat: 'Chat', debug: 'Debug Info',
  perspective: 'Toggle Perspective', hideGui: 'Hide HUD', screenshot: 'Screenshot',
};

export const DEFAULT_KEYS: Record<Action, string> = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sneak: 'ShiftLeft',
  sprint: 'ControlLeft', inventory: 'KeyE', drop: 'KeyQ', chat: 'KeyT', debug: 'F3',
  perspective: 'F5', hideGui: 'F1', screenshot: 'F2',
};

export interface Settings {
  masterVolume: number;
  musicVolume: number;
  soundVolume: number;
  sensitivity: number;
  invertMouse: boolean;
  fov: number;
  renderDistance: number;
  fancyGraphics: boolean;
  smoothLighting: boolean;
  clouds: boolean;
  particles: 0 | 1 | 2; // all, decreased, minimal
  viewBobbing: boolean;
  brightness: number;
  guiScale: number; // 0 = auto
  showFps: boolean;
  keys: Record<Action, string>;
}

export const DEFAULT_SETTINGS: Settings = {
  masterVolume: 0.8,
  musicVolume: 0.5,
  soundVolume: 1,
  sensitivity: 0.5,
  invertMouse: false,
  fov: 70,
  renderDistance: 8,
  fancyGraphics: true,
  smoothLighting: true,
  clouds: true,
  particles: 0,
  viewBobbing: true,
  brightness: 0.3,
  guiScale: 0,
  showFps: false,
  keys: { ...DEFAULT_KEYS },
};

const STORAGE_KEY = 'blockworld.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      return { ...DEFAULT_SETTINGS, ...parsed, keys: { ...DEFAULT_KEYS, ...(parsed.keys ?? {}) } };
    }
  } catch {
    // Storage may be unavailable (private mode); fall back to defaults.
  }
  return { ...DEFAULT_SETTINGS, keys: { ...DEFAULT_KEYS } };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

/** Human readable key name for the controls screen. */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    Space: 'SPACE', ShiftLeft: 'LSHIFT', ShiftRight: 'RSHIFT', ControlLeft: 'LCTRL', ControlRight: 'RCTRL',
    AltLeft: 'LALT', AltRight: 'RALT', Tab: 'TAB', Enter: 'ENTER', Backspace: 'BACK', ArrowUp: 'UP',
    ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', CapsLock: 'CAPS', Mouse0: 'BUTTON 1',
    Mouse1: 'BUTTON 3', Mouse2: 'BUTTON 2', Mouse3: 'BUTTON 4', Mouse4: 'BUTTON 5',
  };
  return map[code] ?? code.toUpperCase();
}
