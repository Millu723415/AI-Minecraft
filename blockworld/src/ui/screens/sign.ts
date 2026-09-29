/** Sign text editor. */

import type { SignTile } from '../../world/tileentity';
import { button, el } from '../dom';
import { Screen } from '../screen';

export class SignScreen extends Screen {
  constructor(private readonly tile: SignTile, private readonly onDone: () => void) {
    super('screen dim');
  }

  override onOpen(): void {
    this.root.textContent = '';
    el('div', 'title', this.root, 'Edit sign message:');
    const board = el('div', 'center-col', this.root);
    board.style.background = '#9c7c4c';
    board.style.padding = '6px';
    board.style.border = '1px solid #3a2a14';
    const inputs: HTMLInputElement[] = [];
    for (let i = 0; i < 4; i++) {
      const inp = el('input', 'mc-input', board) as HTMLInputElement;
      inp.maxLength = 15;
      inp.value = this.tile.lines[i] ?? '';
      inp.style.textAlign = 'center';
      inp.style.background = 'transparent';
      inp.style.border = 'none';
      inp.style.color = '#000';
      inp.addEventListener('input', () => { this.tile.lines[i] = inp.value; });
      inp.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') inputs[(i + 1) % 4].focus();
        if (e.key === 'Escape') this.finish();
      });
      inputs.push(inp);
    }
    const row = el('div', 'row', this.root);
    row.style.marginTop = '12px';
    button(row, 'Done', () => this.finish(), 200);
    setTimeout(() => inputs[0].focus(), 50);
  }

  private finish(): void {
    this.ui.close();
    this.onDone();
  }
}
