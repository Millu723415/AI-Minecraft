/**
 * The ending: a slowly scrolling, original conversation between two voices
 * about the world and the one who explored it, followed by credits.
 * Skippable with ESC or the button.
 */

import { button, clearChildren, el } from '../dom';
import { Screen } from '../screen';

// Original text written for BLOCKWORLD. 'a' and 'b' alternate voices.
const POEM: [string, string][] = [
  ['a', 'Look. The lantern-bearer has come home.'],
  ['b', 'Through the dark door at the edge of everything. Yes, I see them.'],
  ['a', 'They began with nothing. Bare hands against the bark of the first tree.'],
  ['b', 'And the tree gave. It always gives, to those who ask it patiently.'],
  ['a', 'Wood became planks. Planks became a table. The table became a way of thinking.'],
  ['b', 'That is how every world is built. One small certainty stacked on another.'],
  ['a', 'Do you remember the first night? How the ground went quiet, and the shadows learned to walk?'],
  ['b', 'They dug a hole in a hillside and waited for the sun. Everyone does, the first time.'],
  ['a', 'And the next morning they came out braver.'],
  ['b', 'Not braver. Curious. Curiosity only looks like courage from the outside.'],
  ['a', 'They followed the stone down. Past the coal, past the iron, into the places where the rock is warm.'],
  ['b', 'They found the blue glimmer in the deep and held it up to the torchlight as if it were a star.'],
  ['a', 'They cooled fire with water and made a door out of the result.'],
  ['b', 'A door to the world beneath the world. Red and roaring and full of old stone halls.'],
  ['a', 'They fought the burning sentinels and carried their embers home.'],
  ['b', 'They followed the eyes. The eyes knew the way, even when the lantern-bearer did not.'],
  ['a', 'And here, at the end, a great winged shadow circled over a pale island in the void.'],
  ['b', 'It is gone now. The island is quiet. The stars have not moved.'],
  ['a', 'Should we tell them that the dragon was never the point?'],
  ['b', 'They already know. They knew when they placed the first block that was not strictly necessary.'],
  ['a', 'A window where a wall would do. A garden where a field would do. A tower just to see farther.'],
  ['b', 'That is the part of them the world remembers. Not the victory. The extra block.'],
  ['a', 'The world does not end here.'],
  ['b', 'No. It never ended anywhere. The seed they planted keeps unfolding, chunk after chunk, past every horizon.'],
  ['a', 'There are mountains they have not climbed. Caves no torch has touched.'],
  ['b', 'Villages asleep in valleys. Oceans with nothing on their far side but more ocean.'],
  ['a', 'Will they go?'],
  ['b', 'They always go. That is what the world is for.'],
  ['a', 'Then let them wake.'],
  ['b', 'Wake, lantern-bearer. The sun is coming up over the place you started.'],
  ['a', 'The tree is still there.'],
  ['b', 'Go and build something that was not strictly necessary.'],
];

const CREDITS: [string, string][] = [
  ['h', 'BLOCKWORLD'],
  ['c', ''],
  ['h', 'Design, Code, Art & Sound'],
  ['c', 'Generated procedurally by the game itself'],
  ['c', ''],
  ['h', 'Built With'],
  ['c', 'TypeScript'],
  ['c', 'Three.js'],
  ['c', 'Vite'],
  ['c', ''],
  ['h', 'Inspired By'],
  ['c', 'The block-building games of 2011'],
  ['c', 'and everyone who ever punched a tree'],
  ['c', ''],
  ['h', 'Thank you for playing!'],
];

export class EndingScreen extends Screen {
  private scroll!: HTMLDivElement;
  private offset = 0;
  private height = 0;
  private done = false;

  constructor(private readonly onFinish: () => void) {
    super('ending');
    this.closable = false;
  }

  override onOpen(): void {
    const r = this.root;
    clearChildren(r);
    r.style.background = 'repeating-linear-gradient(45deg, #0b0b10 0 4px, #0e0e14 4px 8px)';
    this.scroll = el('div', 'ending-scroll', r);
    for (let i = 0; i < 6; i++) el('p', '', this.scroll, ' ');
    for (const [who, line] of POEM) el('p', who, this.scroll, line);
    for (let i = 0; i < 4; i++) el('p', '', this.scroll, ' ');
    for (const [cls, line] of CREDITS) el('p', cls, this.scroll, line || ' ');
    const skip = el('div', '', r);
    Object.assign(skip.style, { position: 'absolute', right: '6px', bottom: '6px' });
    button(skip, 'Skip', () => this.finish(), 60);
    this.offset = this.ui.height;
    this.height = 0;
  }

  override update(dt: number): void {
    if (this.done) return;
    if (!this.height) this.height = this.scroll.scrollHeight || this.scroll.offsetHeight;
    this.offset -= (dt / 1000) * 14;
    this.scroll.style.top = `${Math.round(this.offset)}px`;
    if (this.height > 0 && this.offset < -this.height - 20) this.finish();
  }

  override onKey(code: string): boolean {
    if (code === 'Escape' || code === 'Space') {
      this.finish();
      return true;
    }
    return false;
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    this.onFinish();
  }
}

export const ENDING_TEXT = POEM;
