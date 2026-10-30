import type { PlayerState } from '../sim/player';
import { isInvulnerable } from '../sim/player';
import type { Battle } from '../sim/battle';
import type { DoorSpec } from '../world/tiles';
import { el } from './dom';

export interface DoorLabel {
  door: DoorSpec;
  text: string;
  sub: string;
}

/**
 * Heads-up display. All text is DOM, so it stays crisp at any render scale. The
 * HUD only reads state and never changes the simulation.
 */
export class Hud {
  readonly root: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly shards: HTMLElement;
  private readonly weapon: HTMLElement;
  private readonly tearRing: SVGCircleElement;
  private readonly tearLabel: HTMLElement;
  private readonly dodge: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly chips: HTMLElement;
  private readonly boss: HTMLElement;
  private readonly bossFill: HTMLElement;
  private readonly bossName: HTMLElement;
  private readonly bossPips: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly labels: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly prompt: HTMLElement;
  private labelEls: HTMLElement[] = [];
  private bannerTimer = 0;
  private hpFlash = 0;
  private lastHp = -1;

  constructor(parent: HTMLElement) {
    this.root = el('div', { class: 'hud', id: 'hud' });
    const topLeft = el('div', { class: 'hud-tl' });
    const hpWrap = el('div', { class: 'hp' });
    this.hpText = el('div', { class: 'hp-text' });
    const hpBar = el('div', { class: 'bar hp-bar' });
    this.hpFill = el('div', { class: 'bar-fill' });
    hpBar.append(this.hpFill);
    hpWrap.append(this.hpText, hpBar);
    this.shards = el('div', { class: 'shards' });
    this.stage = el('div', { class: 'stage' });
    this.chips = el('div', { class: 'chips' });
    topLeft.append(hpWrap, this.shards, this.stage, this.chips);

    const bottomRight = el('div', { class: 'hud-br' });
    this.weapon = el('div', { class: 'weapon' });
    const ringSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ringSvg.setAttribute('viewBox', '0 0 64 64');
    ringSvg.setAttribute('class', 'tear-ring');
    const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    track.setAttribute('cx', '32');
    track.setAttribute('cy', '32');
    track.setAttribute('r', '26');
    track.setAttribute('class', 'ring-track');
    this.tearRing = document.createElementNS('http://www.w3.org/2000/svg', 'circle') as SVGCircleElement;
    this.tearRing.setAttribute('cx', '32');
    this.tearRing.setAttribute('cy', '32');
    this.tearRing.setAttribute('r', '26');
    this.tearRing.setAttribute('class', 'ring-fill');
    ringSvg.append(track, this.tearRing);
    this.tearLabel = el('div', { class: 'tear-label' }, 'TEAR');
    const tear = el('div', { class: 'tear' }, ringSvg, this.tearLabel);
    this.dodge = el('div', { class: 'dodge' });
    bottomRight.append(this.weapon, tear, this.dodge);

    this.boss = el('div', { class: 'boss hidden' });
    this.bossName = el('div', { class: 'boss-name' });
    const bossBar = el('div', { class: 'bar boss-bar' });
    this.bossFill = el('div', { class: 'bar-fill' });
    bossBar.append(this.bossFill);
    this.bossPips = el('div', { class: 'boss-pips' });
    this.boss.append(this.bossName, bossBar, this.bossPips);

    this.banner = el('div', { class: 'banner hidden' });
    this.prompt = el('div', { class: 'prompt hidden' });
    this.labels = el('div', { class: 'labels' });
    this.stats = el('div', { class: 'stats hidden' });
    this.root.append(topLeft, bottomRight, this.boss, this.banner, this.prompt, this.labels, this.stats);
    parent.append(this.root);
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
  }

  /** Stage line, such as "Room 2 of 5 · The Choir". */
  setStage(text: string): void {
    this.stage.textContent = text;
  }

  setWeapon(name: string, keys: string): void {
    this.weapon.textContent = '';
    this.weapon.append(el('span', { class: 'weapon-name' }, name), el('span', { class: 'weapon-keys' }, keys));
  }

  setChips(names: string[]): void {
    this.chips.textContent = '';
    for (const n of names) this.chips.append(el('span', { class: 'chip' }, n));
  }

  /** Per-frame update from the battle state. Cheap: only text and style changes. */
  update(dt: number, battle: Battle, shardsNow: number, showStats: boolean, frameMs: number[]): void {
    const p = battle.player;
    this.updateHealth(dt, p);
    this.shards.textContent = `* ${shardsNow}`;
    const ring = battle.tearCharge;
    const circumference = 2 * Math.PI * 26;
    const cooling = battle.tear.cooldown > 0 ? 1 - battle.tear.cooldown / (2.2 * battle.mods.tear.cooldownMul) : 1;
    this.tearRing.setAttribute('stroke-dasharray', `${circumference * (battle.tear.charging ? ring : cooling)} ${circumference}`);
    this.tearRing.classList.toggle('ready', !battle.tear.charging && battle.tear.cooldown <= 0);
    this.tearRing.classList.toggle('full', battle.tear.charging && ring >= 1);
    this.tearLabel.textContent = battle.tear.cooldown > 0 ? `${battle.tear.cooldown.toFixed(1)}` : 'TEAR';
    this.dodge.textContent = '';
    for (let i = 0; i < p.dodgeMaxCharges; i++) {
      this.dodge.append(el('span', { class: i < p.dodgeCharges ? 'pip on' : 'pip' }));
    }
    this.dodge.classList.toggle('iframes', isInvulnerable(p));
    this.updateBoss(battle);
    if (showStats) {
      const avg = frameMs.length ? frameMs.reduce((a, b) => a + b, 0) / frameMs.length : 0;
      this.stats.textContent = `cpu ${avg.toFixed(1)} ms · ${(1000 / Math.max(avg, 0.01)).toFixed(0)} fps (cpu-side)`;
      this.stats.classList.remove('hidden');
    } else {
      this.stats.classList.add('hidden');
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.add('hidden');
    }
  }

  private updateHealth(dt: number, p: PlayerState): void {
    const frac = Math.max(0, p.hp / p.maxHp);
    this.hpFill.style.width = `${(frac * 100).toFixed(1)}%`;
    this.hpFill.classList.toggle('low', frac < 0.3);
    this.hpText.textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;
    if (this.lastHp >= 0 && p.hp < this.lastHp) this.hpFlash = 0.35;
    this.lastHp = p.hp;
    this.hpFlash = Math.max(0, this.hpFlash - dt);
    this.root.classList.toggle('hurt', this.hpFlash > 0);
  }

  private updateBoss(battle: Battle): void {
    const boss = battle.enemies.find((e) => e.def.kind === 'boss' && e.alive);
    if (!boss) {
      this.boss.classList.add('hidden');
      return;
    }
    this.boss.classList.remove('hidden');
    const phaseTwo = (boss as unknown as { phaseTwo?: boolean }).phaseTwo ?? false;
    this.bossName.textContent = `The Scribe  ·  ${phaseTwo ? 'Unbound' : 'Seal Keeper'}`;
    this.bossFill.style.width = `${Math.max(0, (boss.hp / boss.def.hp) * 100).toFixed(1)}%`;
    this.boss.classList.toggle('phase-two', phaseTwo);
    this.bossPips.textContent = '';
    for (let i = 0; i < 3; i++) this.bossPips.append(el('span', { class: i < boss.armor ? 'pip armour on' : 'pip armour' }));
  }

  /** Shows a short banner centred near the bottom of the screen. */
  flash(text: string, tone: 'neutral' | 'ember' | 'cyan' | 'amber' = 'neutral', seconds = 2.6): void {
    this.banner.textContent = text;
    this.banner.className = `banner tone-${tone}`;
    this.bannerTimer = seconds;
  }

  /** A prompt near the screen centre, such as "E to consult the altar". Pass null to hide it. */
  setPrompt(text: string | null): void {
    if (text === null) {
      this.prompt.classList.add('hidden');
      return;
    }
    this.prompt.textContent = text;
    this.prompt.classList.remove('hidden');
  }

  /**
   * Places each door's route label above its threshold. `project` converts a
   * world point to CSS pixels, or returns null when the point is off screen.
   */
  setDoorLabels(items: DoorLabel[], project: (x: number, y: number, z: number) => { x: number; y: number } | null): void {
    while (this.labelEls.length < items.length) {
      const node = el('div', { class: 'door-label' });
      this.labels.append(node);
      this.labelEls.push(node);
    }
    this.labelEls.forEach((node, i) => {
      const item = items[i];
      if (!item) {
        node.classList.add('hidden');
        return;
      }
      const pos = project(item.door.x + 0.5, 1.6, item.door.y + 0.5);
      if (!pos) {
        node.classList.add('hidden');
        return;
      }
      node.classList.remove('hidden');
      node.style.transform = `translate(${pos.x.toFixed(0)}px, ${pos.y.toFixed(0)}px)`;
      node.textContent = '';
      node.append(el('div', { class: 'door-title' }, item.text), el('div', { class: 'door-sub' }, item.sub));
    });
  }

  clearDoorLabels(): void {
    this.labelEls.forEach((n) => n.classList.add('hidden'));
  }

  dispose(): void {
    this.root.remove();
  }
}
