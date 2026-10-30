import { type Settings, type Progress } from '../core/save';
import { type BoonId, type ModifierId, type RunSummary, type WeaponId } from '../game/run';
import { UPGRADES, COMBOS, type UpgradeDef, type UpgradeId, upgradeById } from '../game/upgrades';
import { UNLOCK_RULES } from '../game/meta';
import { button, el } from './dom';

export type ScreenId = 'title' | 'loadout' | 'pause' | 'settings' | 'upgrade' | 'altar' | 'end' | 'codex' | 'controls' | null;

export interface TitleHandlers {
  begin: () => void;
  loadout: () => void;
  codex: () => void;
  settings: () => void;
  controls: () => void;
}

export interface LoadoutState {
  weapon: WeaponId;
  boon: BoonId | null;
  modifiers: ModifierId[];
  progress: Progress;
}

const BOONS: Array<{ id: BoonId; name: string; text: string }> = [
  { id: 'ash-ward', name: 'Ash Ward', text: 'Start with 25 extra maximum health.' },
  { id: 'scribes-pouch', name: "Scribe's Pouch", text: 'Start with 12 shards.' },
  { id: 'dust-step', name: 'Dust Step', text: 'Start with one extra dodge charge.' },
];

const MODIFIERS: Array<{ id: ModifierId; name: string; text: string }> = [
  { id: 'ink-famine', name: 'Ink Famine', text: 'Healing only from the cistern. Shards drop 40% more.' },
  { id: 'gilded-path', name: 'Gilded Path', text: 'Gilded elites join the middle rooms, with one extra rare pick.' },
];

/**
 * Every menu and end screen. One screen is visible at a time, and each one is
 * plain HTML with buttons. Keyboard support lives in the App, which calls the
 * `key*` methods here for the current screen.
 */
export class Screens {
  readonly root: HTMLElement;
  current: ScreenId = null;
  private readonly panels = new Map<string, HTMLElement>();
  private focus = 0;
  private focusables: HTMLButtonElement[] = [];
  private cardIds: UpgradeId[] = [];
  private cardPick: ((id: UpgradeId) => void) | null = null;
  private altarPick: ((choice: 'mend' | 'attune') => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = el('div', { class: 'screens hidden', id: 'screens' });
    parent.append(this.root);
  }

  private panel(id: string, cls = ''): HTMLElement {
    let p = this.panels.get(id);
    if (!p) {
      p = el('section', { class: `panel ${cls}`.trim(), 'data-screen': id });
      this.panels.set(id, p);
      this.root.append(p);
    }
    p.textContent = '';
    return p;
  }

  /** Shows one screen and hides the rest. Pass null to hide all. */
  private show(id: ScreenId, panel: HTMLElement | null): void {
    this.current = id;
    this.root.classList.toggle('hidden', id === null);
    for (const [key, node] of this.panels) node.classList.toggle('active', panel !== null && node === panel && key === id);
    this.focus = 0;
    this.focusables = panel ? [...panel.querySelectorAll<HTMLButtonElement>('button:not([disabled])')] : [];
    this.focusables[0]?.classList.add('focus');
  }

  hide(): void {
    this.show(null, null);
  }

  private menuButtons(p: HTMLElement): void {
    this.focusables = [...p.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
    this.focusables.forEach((b, i) => b.classList.toggle('focus', i === this.focus));
  }

  title(progress: Progress, h: TitleHandlers): void {
    const p = this.panel('title', 'title-panel');
    p.append(
      el('div', { class: 'title-mark' }, 'VELLUM'),
      el('div', { class: 'title-sub' }, 'A roguelite written in characters. The archive is awake.'),
      el(
        'div',
        { class: 'title-stats' },
        `Runs ${progress.runs} · Wins ${progress.wins}` +
          (progress.bestWinTime !== null ? ` · Best ${formatTime(progress.bestWinTime)}` : ''),
      ),
    );
    const menu = el('div', { class: 'menu' });
    menu.append(
      button('Begin run', h.begin, 'primary'),
      button('Loadout', h.loadout),
      button('Codex', h.codex),
      button('Settings', h.settings),
      button('Controls', h.controls),
    );
    p.append(menu);
    p.append(el('div', { class: 'hint' }, 'Arrows move · Enter selects · Mouse also works'));
    this.show('title', p);
    this.menuButtons(p);
  }

  loadout(state: LoadoutState, h: { setWeapon: (w: WeaponId) => void; setBoon: (b: BoonId | null) => void; toggleModifier: (m: ModifierId) => void; begin: () => void; back: () => void }): void {
    const p = this.panel('loadout', 'wide');
    p.append(el('h2', {}, 'Loadout'));
    const quillOk = state.progress.unlocks.weapons.includes('quill');
    const weapons = el('div', { class: 'row' });
    weapons.append(
      choice('Glaive', 'Three-hit melee arc. Commit close.', state.weapon === 'glaive', () => h.setWeapon('glaive')),
      choice('Glyph Quill', quillOk ? 'Auto-fire bolts. Keep your distance.' : 'Locked. Finish a run to recover it.', state.weapon === 'quill', () => quillOk && h.setWeapon('quill'), !quillOk),
    );
    p.append(el('div', { class: 'label' }, 'Weapon'), weapons);

    const boons = el('div', { class: 'row' });
    boons.append(choice('None', 'Start as you are.', state.boon === null, () => h.setBoon(null)));
    for (const b of BOONS) {
      const unlocked = state.progress.unlocks.boons.includes(b.id);
      boons.append(choice(b.name, unlocked ? b.text : lockedText(b.id), state.boon === b.id, () => unlocked && h.setBoon(b.id), !unlocked));
    }
    p.append(el('div', { class: 'label' }, 'Starting boon'), boons);

    const mods = el('div', { class: 'row' });
    for (const m of MODIFIERS) {
      const unlocked = state.progress.unlocks.modifiers.includes(m.id);
      const on = state.modifiers.includes(m.id);
      mods.append(choice(m.name, unlocked ? m.text : 'Locked. ' + unlockHow(m.id), on, () => unlocked && h.toggleModifier(m.id), !unlocked));
    }
    p.append(el('div', { class: 'label' }, 'Modifiers (optional)'), mods);

    const menu = el('div', { class: 'menu row-menu' });
    menu.append(button('Begin run', h.begin, 'primary'), button('Back', h.back));
    p.append(menu);
    this.show('loadout', p);
    this.menuButtons(p);
  }

  pause(h: { resume: () => void; settings: () => void; controls: () => void; abandon: () => void }): void {
    const p = this.panel('pause', 'narrow');
    p.append(el('h2', {}, 'Paused'), el('div', { class: 'hint' }, 'The archive waits. Esc or P resumes.'));
    const menu = el('div', { class: 'menu' });
    menu.append(button('Resume', h.resume, 'primary'), button('Settings', h.settings), button('Controls', h.controls), button('Abandon run', h.abandon));
    p.append(menu);
    this.show('pause', p);
    this.menuButtons(p);
  }

  settings(s: Settings, h: { change: (patch: Partial<Settings>) => void; back: () => void; reset: () => void }): void {
    const p = this.panel('settings', 'wide');
    p.append(el('h2', {}, 'Settings'));
    const grid = el('div', { class: 'settings' });
    grid.append(slider('Master volume', s.masterVolume, 0, 1, (v) => h.change({ masterVolume: v })));
    grid.append(slider('Effects volume', s.sfxVolume, 0, 1, (v) => h.change({ sfxVolume: v })));
    grid.append(slider('Ambience volume', s.ambienceVolume, 0, 1, (v) => h.change({ ambienceVolume: v })));
    grid.append(slider('Screen shake', s.screenShake, 0, 1, (v) => h.change({ screenShake: v })));
    grid.append(slider('Effects intensity', s.effects, 0, 1, (v) => h.change({ effects: v })));
    grid.append(slider('Contrast', s.contrast, 0.6, 1.6, (v) => h.change({ contrast: v }), 2));
    grid.append(slider('Mouse sensitivity', s.sensitivity, 0.4, 2.5, (v) => h.change({ sensitivity: v }), 2));
    grid.append(segmented('Glyph density', ['fine', 'standard', 'bold'], s.glyphDensity, (v) => h.change({ glyphDensity: v as Settings['glyphDensity'] })));
    grid.append(segmented('Render quality', ['low', 'medium', 'high'], s.quality, (v) => h.change({ quality: v as Settings['quality'] })));
    grid.append(toggle('Hit-stop', s.hitStop, (v) => h.change({ hitStop: v })));
    grid.append(toggle('Reduced motion', s.reducedMotion, (v) => h.change({ reducedMotion: v })));
    grid.append(toggle('Frame stats', s.showStats, (v) => h.change({ showStats: v })));
    p.append(grid);
    const menu = el('div', { class: 'menu row-menu' });
    menu.append(button('Back', h.back, 'primary'), button('Reset progress and settings', h.reset, 'danger'));
    p.append(menu);
    this.show('settings', p);
    this.menuButtons(p);
  }

  /** Upgrade choice. Digit keys and clicks both pick a card. */
  upgrades(offers: UpgradeId[], title: string, subtitle: string, pick: (id: UpgradeId) => void, completed: string[] = []): void {
    const p = this.panel('upgrade', 'wide');
    p.append(el('h2', {}, title), el('div', { class: 'hint' }, subtitle));
    const row = el('div', { class: 'cards' });
    offers.forEach((id, i) => {
      const u = upgradeById(id);
      row.append(card(u, i + 1, () => pick(id)));
    });
    p.append(row);
    if (completed.length) {
      p.append(el('div', { class: 'combo-note' }, `Combo complete: ${completed.map(comboName).join(', ')}`));
    }
    this.cardIds = [...offers];
    this.cardPick = pick;
    this.show('upgrade', p);
    this.focusables = [...p.querySelectorAll<HTMLButtonElement>('button')];
    this.focusables[0]?.classList.add('focus');
  }

  altar(attuneText: string, h: { mend: () => void; attune: () => void }): void {
    const p = this.panel('altar', 'narrow');
    p.append(el('h2', {}, 'The Cistern altar'), el('div', { class: 'hint' }, 'Water remembers every word spoken over it.'));
    const row = el('div', { class: 'cards' });
    row.append(
      cardSimple('1', 'Mend', 'Restore 45% of maximum health.', h.mend),
      cardSimple('2', 'Attune', attuneText, h.attune),
    );
    p.append(row);
    this.altarPick = (c) => (c === 'mend' ? h.mend() : h.attune());
    this.show('altar', p);
    this.focusables = [...p.querySelectorAll<HTMLButtonElement>('button')];
    this.focusables[0]?.classList.add('focus');
  }

  end(summary: RunSummary, unlocked: string[], best: number | null, h: { restart: () => void; title: () => void }): void {
    const p = this.panel('end', 'narrow');
    p.append(
      el('h2', { class: summary.won ? 'win' : 'loss' }, summary.won ? 'The Scribe is silent' : 'The ink takes you'),
      el(
        'div',
        { class: 'summary' },
        `Time ${formatTime(summary.time)}`,
        el('br'),
        `Kills ${summary.kills} · Rooms ${summary.roomsCleared}`,
        el('br'),
        `Upgrades: ${summary.upgrades.length ? summary.upgrades.map((u) => upgradeById(u).name).join(', ') : 'none'}`,
        el('br'),
        `Combos: ${summary.combos.length ? summary.combos.map(comboName).join(', ') : 'none'}`,
        el('br'),
        `Seed ${summary.seed}` + (best !== null ? ` · Best win ${formatTime(best)}` : ''),
      ),
    );
    if (unlocked.length) p.append(el('div', { class: 'unlocked' }, `Unlocked: ${unlocked.join(', ')}`));
    const menu = el('div', { class: 'menu row-menu' });
    menu.append(button('Restart run (Enter)', h.restart, 'primary'), button('Title', h.title));
    p.append(menu);
    this.show('end', p);
    this.menuButtons(p);
  }

  codex(progress: Progress, h: { back: () => void }): void {
    const p = this.panel('codex', 'wide');
    p.append(el('h2', {}, 'Codex'));
    const seen = new Set(progress.upgrades);
    const list = el('div', { class: 'codex' });
    for (const u of UPGRADES) {
      list.append(el('div', { class: seen.has(u.id) ? 'entry seen' : 'entry' }, el('strong', {}, seen.has(u.id) ? u.name : '???'), seen.has(u.id) ? ` · ${u.text}` : ' · Not yet found.'));
    }
    const combos = new Set(progress.combos);
    for (const c of COMBOS) {
      list.append(
        el(
          'div',
          { class: combos.has(c.id) ? 'entry seen' : 'entry' },
          el('strong', {}, combos.has(c.id) ? c.name : '??? combo'),
          combos.has(c.id) ? ` · ${c.text}` : ` · Own ${upgradeById(c.needs[0]).name} and ${upgradeById(c.needs[1]).name} together.`,
        ),
      );
    }
    p.append(list);
    const unlockList = el('div', { class: 'codex' });
    for (const r of UNLOCK_RULES) {
      const have = progress.unlocks[r.kind].includes(r.id);
      unlockList.append(el('div', { class: have ? 'entry seen' : 'entry' }, el('strong', {}, have ? r.label : '???'), have ? '' : ` · ${r.how}`));
    }
    p.append(el('h3', {}, 'Unlocks'), unlockList);
    p.append(button('Back', h.back, 'primary'));
    this.show('codex', p);
    this.menuButtons(p);
  }

  controls(h: { back: () => void }): void {
    const p = this.panel('controls', 'narrow');
    p.append(
      el('h2', {}, 'Controls'),
      el(
        'div',
        { class: 'controls' },
        el('div', {}, 'W A S D · move, strafe'),
        el('div', {}, 'Mouse · look (click to capture; Esc releases)'),
        el('div', {}, 'Arrow keys · turn'),
        el('div', {}, 'Left mouse · attack (Glaive combo, or hold for the Quill)'),
        el('div', {}, 'Right mouse, hold and release · the Tear'),
        el('div', {}, 'Space · dodge (invulnerable for a short window)'),
        el('div', {}, 'E · consult the altar'),
        el('div', {}, 'P or Esc · pause'),
        el('div', {}, 'Enter or R · restart from the end screens'),
      ),
    );
    p.append(button('Back', h.back, 'primary'));
    this.show('controls', p);
    this.menuButtons(p);
  }

  /** Arrow key navigation across the current screen's buttons. */
  navigate(delta: number): void {
    if (this.focusables.length === 0) return;
    this.focus = (this.focus + delta + this.focusables.length) % this.focusables.length;
    this.focusables.forEach((b, i) => b.classList.toggle('focus', i === this.focus));
  }

  /** Enter on the focused button. */
  activate(): void {
    this.focusables[this.focus]?.click();
  }

  /** Digit keys pick the matching card or altar option. */
  pickDigit(n: number): void {
    if (this.current === 'upgrade' && this.cardPick && this.cardIds[n - 1]) this.cardPick(this.cardIds[n - 1]);
    if (this.current === 'altar' && this.altarPick && (n === 1 || n === 2)) this.altarPick(n === 1 ? 'mend' : 'attune');
  }
}

function choice(name: string, text: string, selected: boolean, onPick: () => void, locked = false): HTMLElement {
  const b = el('button', { type: 'button', class: `choice${selected ? ' selected' : ''}${locked ? ' locked' : ''}` });
  b.append(el('strong', {}, name), el('span', {}, text));
  b.addEventListener('click', onPick);
  return b;
}

function cardSimple(key: string, name: string, text: string, onPick: () => void): HTMLElement {
  const b = el('button', { type: 'button', class: 'card' });
  b.append(el('span', { class: 'card-key' }, key), el('strong', {}, name), el('span', { class: 'card-text' }, text));
  b.addEventListener('click', onPick);
  return b;
}

function card(u: UpgradeDef, key: number, onPick: () => void): HTMLElement {
  const b = el('button', { type: 'button', class: `card tag-${u.tag}${u.rare ? ' rare' : ''}` });
  b.append(
    el('span', { class: 'card-key' }, String(key)),
    el('span', { class: 'card-tag' }, u.rare ? `${u.tag} · rare` : u.tag),
    el('strong', {}, u.name),
    el('span', { class: 'card-text' }, u.text),
    el('span', { class: 'card-trade' }, u.tradeoff),
  );
  b.addEventListener('click', onPick);
  return b;
}

function slider(label: string, value: number, lo: number, hi: number, onChange: (v: number) => void, digits = 0): HTMLElement {
  const out = el('span', { class: 'value' }, value.toFixed(digits));
  const input = el('input', { type: 'range', min: String(lo), max: String(hi), step: String((hi - lo) / 100), value: String(value) });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = v.toFixed(digits);
    onChange(v);
  });
  return el('label', { class: 'setting' }, el('span', { class: 'name' }, label), input, out);
}

function toggle(label: string, on: boolean, onChange: (v: boolean) => void): HTMLElement {
  const b = el('button', { type: 'button', class: `toggle${on ? ' on' : ''}`, 'aria-pressed': String(on) }, on ? 'On' : 'Off');
  b.addEventListener('click', () => {
    const next = !b.classList.contains('on');
    b.classList.toggle('on', next);
    b.setAttribute('aria-pressed', String(next));
    b.textContent = next ? 'On' : 'Off';
    onChange(next);
  });
  return el('div', { class: 'setting' }, el('span', { class: 'name' }, label), b);
}

function segmented(label: string, options: string[], current: string, onChange: (v: string) => void): HTMLElement {
  const row = el('div', { class: 'segmented' });
  for (const opt of options) {
    const b = el('button', { type: 'button', class: opt === current ? 'seg on' : 'seg' }, opt);
    b.addEventListener('click', () => {
      row.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      onChange(opt);
    });
    row.append(b);
  }
  return el('div', { class: 'setting' }, el('span', { class: 'name' }, label), row);
}

function lockedText(id: string): string {
  return 'Locked. ' + unlockHow(id);
}

function unlockHow(id: string): string {
  return UNLOCK_RULES.find((r) => r.id === id)?.how ?? '';
}

export function comboName(id: string): string {
  return COMBOS.find((c) => c.id === id)?.name ?? id;
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
