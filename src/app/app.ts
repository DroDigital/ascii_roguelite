import * as THREE from 'three';
import { InputManager, type InputSnapshot } from '../core/input';
import { mulberry32 } from '../core/rng';
import { DEFAULT_SETTINGS, type Progress, type Settings, loadProgress, loadSettings, resetAll, saveProgress, saveSettings } from '../core/save';
import { AsciiRenderer, type AsciiConfig } from '../render/asciiRenderer';
import { Effects } from '../fx/effects';
import { Battle, type BattleEvent, type StepInput } from '../sim/battle';
import { Boss } from '../sim/boss';
import { type Enemy } from '../sim/enemies';
import { FirstPersonView } from '../sim/fpView';
import { EdgeBuffer, type Edges } from '../core/edges';
import { type Mods } from '../sim/mods';
import { glaiveSpec } from '../sim/weapons';
import { WorldView } from '../game/worldView';
import { type RunOutcome, applyOutcome } from '../game/meta';
import { type BoonId, type ModifierId, type RunConfig, type RunSummary, type WeaponId, RunDirector } from '../game/run';
import { type UpgradeId, upgradeById } from '../game/upgrades';
import { type RoomPlan } from '../world/route';
import { type Layout } from '../world/tiles';
import { type DoorLabel, Hud } from '../ui/hud';
import { Screens } from '../ui/screens';
import { Audio } from '../audio/audio';

export const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;
const TURN_RATE = 2.4;
const BASE_LOOK = 0.0022;
const ALTAR_REACH = 2;
const DEATH_DELAY = 1.2;
const VICTORY_DELAY = 1.6;

/** Glyph cell sizes for each density setting. Height is always twice the width. */
const DENSITY_CELL = { fine: { w: 6, h: 12 }, standard: { w: 8, h: 16 }, bold: { w: 10, h: 20 } } as const;
/** Sample density for each quality setting. */
const QUALITY_SAMPLES = { low: 1, medium: 2, high: 3 } as const;

export type AppState = 'title' | 'loadout' | 'settings' | 'codex' | 'controls' | 'run' | 'paused' | 'upgrade' | 'altar' | 'ending' | 'end';

const MENU_STATES: readonly AppState[] = ['title', 'loadout', 'settings', 'codex', 'controls', 'paused', 'upgrade', 'altar', 'end'];
/** States where the HUD is shown. The title and menus hide it. */
const HUD_STATES: readonly AppState[] = ['run', 'paused', 'upgrade', 'altar', 'ending'];

/**
 * The game shell and state machine. It owns the renderer, the run, the screens,
 * the HUD and the audio, and routes input to the active state. Only the run
 * state steps the simulation, so menus and pauses freeze the room.
 */
export class App {
  readonly canvas: HTMLCanvasElement;
  readonly ascii: AsciiRenderer;
  readonly input: InputManager;
  readonly world: WorldView;
  readonly view: FirstPersonView;
  readonly effects: Effects;
  readonly hud: Hud;
  readonly screens: Screens;
  readonly audio = new Audio();
  settings: Settings;
  progress: Progress;
  state: AppState = 'title';
  /** The loadout chosen on the loadout screen, used when a run begins. */
  loadout: { weapon: WeaponId; boon: BoonId | null; modifiers: ModifierId[] } = { weapon: 'glaive', boon: null, modifiers: [] };
  director: RunDirector | null = null;
  battle: Battle | null = null;
  layout: Layout | null = null;
  plan: RoomPlan | null = null;
  frameMs: number[] = [];
  /** Seconds of simulation time since the app started. Drives shader-free animation clocks. */
  simTime = 0;
  /** Seconds of the current run, for the end screen and the best-time record. */
  runTime = 0;
  /** Debug only: top-down camera for layout checks. */
  debugTopDown = false;
  /** Debug only: the player cannot die. Used by the end-to-end tests to reach the boss. */
  debugGod = false;
  /** Debug only: wait for GPU work to finish each frame, so frame timing includes it. */
  debugSyncGpu = false;
  private acc = 0;
  private hitStop = 0;
  private lastTs = 0;
  private running = false;
  private strafe = 0;
  private endTimer = 0;
  private endingWon = false;
  private runCounter = 0;
  private seedBase = 42;
  private seedOverride: number | null = null;
  private altarUsed = false;
  private roomKills = 0;
  private readonly projectScratch = new THREE.Vector3();
  /** One-shot presses waiting for a simulation step to take them. */
  private readonly edges = new EdgeBuffer();

  constructor(canvas: HTMLCanvasElement, ascii: AsciiConfig) {
    this.canvas = canvas;
    this.settings = loadSettings();
    this.progress = loadProgress();
    this.ascii = new AsciiRenderer(canvas, ascii);
    this.input = new InputManager(canvas);
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'run') this.pause();
    };
    this.world = new WorldView(this.ascii);
    this.view = new FirstPersonView(this.world.camera);
    this.effects = new Effects(this.ascii, this.world.camera, mulberry32(7), this.effectsSettings());
    const ui = document.getElementById('ui') as HTMLElement;
    this.hud = new Hud(ui);
    this.screens = new Screens(ui);
    this.hud.show(false);
    this.applySettings(this.settings);
  }

  async init(): Promise<void> {
    await this.ascii.init();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.showTitle();
  }

  resize(): void {
    this.ascii.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
    this.world.camera.aspect = this.ascii.aspect;
    this.world.camera.updateProjectionMatrix();
  }

  /** Applies settings to the renderer, effects and audio. Saves them when `persist` is set. */
  applySettings(s: Settings, persist = false): void {
    this.settings = s;
    if (persist) saveSettings(s);
    this.ascii.setConfig({
      cell: DENSITY_CELL[s.glyphDensity],
      sampleX: QUALITY_SAMPLES[s.quality] as 1 | 2 | 3,
      contrast: s.contrast,
    });
    this.resize();
    this.effects.setSettings(this.effectsSettings());
    this.audio.setVolumes(s);
  }

  private effectsSettings(): { intensity: number; motion: number } {
    const reduced = this.settings.reducedMotion;
    return {
      intensity: reduced ? Math.min(0.5, this.settings.effects) : this.settings.effects,
      motion: reduced ? 0 : this.settings.screenShake,
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTs = performance.now();
    requestAnimationFrame((ts) => this.frame(ts));
  }

  stop(): void {
    this.running = false;
  }

  /** Starts a run from the current loadout. Tests pass a fixed seed. */
  startRun(seed?: number): void {
    this.runCounter += 1;
    const config: RunConfig = {
      seed: seed ?? this.seedOverride ?? this.seedBase + this.runCounter * 7919,
      weapon: this.loadout.weapon,
      boon: this.loadout.boon,
      modifiers: [...this.loadout.modifiers],
    };
    this.director = new RunDirector(config);
    this.runTime = 0;
    this.altarUsed = false;
    this.audio.unlock();
    this.audio.startAmbience();
    const plan = this.director.begin();
    this.enterRoom(plan, this.director.startingPlayer(), this.director.startingShards);
    this.setState('run');
    this.input.captureMouse();
  }

  /** Builds the battle for a room and places the player at its start. */
  private enterRoom(plan: RoomPlan, player: ReturnType<RunDirector['startingPlayer']>, shards: number): void {
    const director = this.director;
    if (!director) return;
    this.plan = plan;
    this.layout = plan.layout;
    this.world.loadRoom(plan.layout);
    player.x = plan.layout.start.x + 0.5;
    player.z = plan.layout.start.y + 0.5;
    const battle = new Battle({
      layout: plan.layout,
      rng: mulberry32(director.config.seed + director.stage * 131 + director.roomsCleared * 17),
      mods: director.mods,
      weapon: director.config.weapon,
      player,
      shards,
    });
    const wave = director.wave();
    battle.queueWave(wave.kinds, wave.gilded);
    if (plan.option.kind === 'boss' && plan.layout.bossSpawn) {
      battle.addEnemy('boss', plan.layout.bossSpawn.x + 0.5, plan.layout.bossSpawn.y + 0.5);
    }
    battle.grid.setDoorsLocked(battle.pending.length > 0 || battle.enemies.length > 0);
    this.battle = battle;
    this.roomKills = 0;
    this.effects.reset();
    this.world.viewModel.setWeapon(director.config.weapon);
    const target = { x: plan.layout.w / 2, z: plan.layout.h / 2 };
    this.view.setLook(Math.atan2(-(target.x - player.x), -(target.z - player.z)), 0);
    this.hud.setStage(`${plan.option.label} · room ${director.stage + 1} of 6`);
    const quill = director.config.weapon === 'quill';
    this.hud.setWeapon(quill ? 'Glyph Quill' : 'Glaive', quill ? 'hold LMB to fire · hold RMB to Tear' : 'LMB combo · hold RMB to Tear');
    this.hud.setChips(director.owned.map((id) => upgradeById(id).name));
    this.hud.flash(plan.option.label, 'neutral', 2.2);
    this.audio.onRoomStart(plan.option.kind);
    this.acc = 0;
    this.hitStop = 0;
    this.edges.clear();
  }

  private setState(next: AppState): void {
    this.state = next;
    this.hud.show(HUD_STATES.includes(next));
    if (!MENU_STATES.includes(next)) this.screens.hide();
    // Menus need the cursor, so release pointer lock whenever gameplay is not the active state.
    if (next !== 'run' && next !== 'ending') this.input.releaseMouse();
  }

  showTitle(): void {
    this.setState('title');
    this.battle = null;
    this.screens.title(this.progress, {
      begin: () => {
        this.input.captureMouse();
        this.startRun();
      },
      loadout: () => this.showLoadout(),
      codex: () => this.showCodex(),
      settings: () => this.showSettings('title'),
      controls: () => this.showControls('title'),
    });
  }

  private showLoadout(): void {
    this.setState('loadout');
    this.screens.loadout(
      { weapon: this.loadout.weapon, boon: this.loadout.boon, modifiers: this.loadout.modifiers, progress: this.progress },
      {
        setWeapon: (w) => {
          this.loadout.weapon = w;
          this.showLoadout();
        },
        setBoon: (b) => {
          this.loadout.boon = b;
          this.showLoadout();
        },
        toggleModifier: (m) => {
          const on = this.loadout.modifiers.includes(m);
          this.loadout.modifiers = on ? this.loadout.modifiers.filter((x) => x !== m) : [...this.loadout.modifiers, m];
          this.showLoadout();
        },
        begin: () => {
          this.input.captureMouse();
          this.startRun();
        },
        back: () => this.showTitle(),
      },
    );
  }

  private showCodex(): void {
    this.setState('codex');
    this.screens.codex(this.progress, { back: () => this.showTitle() });
  }

  private showControls(from: 'title' | 'pause'): void {
    this.setState('controls');
    this.screens.controls({ back: () => (from === 'title' ? this.showTitle() : this.showPause()) });
  }

  private showSettings(from: 'title' | 'pause'): void {
    this.setState('settings');
    this.screens.settings(this.settings, {
      change: (patch) => this.applySettings({ ...this.settings, ...patch }, true),
      back: () => (from === 'title' ? this.showTitle() : this.showPause()),
      reset: () => {
        if (!window.confirm('Erase all progress and settings stored in this browser?')) return;
        resetAll();
        this.progress = loadProgress();
        this.applySettings({ ...DEFAULT_SETTINGS }, false);
        this.showTitle();
      },
    });
  }

  /** Opens the pause menu. Releases the mouse and quiets the ambience. */
  pause(): void {
    if (this.state !== 'run') return;
    this.edges.clear();
    this.input.releaseMouse();
    this.audio.setAmbienceDucked(true);
    this.showPause();
  }

  private showPause(): void {
    this.setState('paused');
    this.screens.pause({
      resume: () => this.resume(),
      settings: () => this.showSettings('pause'),
      controls: () => this.showControls('pause'),
      abandon: () => this.finishRun(false),
    });
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.setState('run');
    this.input.captureMouse();
    this.audio.setAmbienceDucked(false);
  }

  /** Clearing a room hands the decision to the director: upgrades, a rare gift, the boss or nothing. */
  private onRoomCleared(): void {
    const director = this.director;
    if (!director) return;
    const status = director.roomCleared(this.roomKills);
    // The room's kills are now credited to the run, so they must not be counted again.
    this.roomKills = 0;
    this.audio.onRoomCleared();
    if (status === 'upgrade') {
      this.hud.flash(director.rarePicks > 0 ? 'A rare gift awaits' : 'Choose an upgrade', 'amber', 2.5);
      this.showUpgrades();
    } else if (status === 'victory') {
      this.endingWon = true;
      this.endTimer = VICTORY_DELAY;
      this.setState('ending');
      this.hud.flash('The Scribe is silent', 'amber', 3);
    }
  }

  private showUpgrades(): void {
    const director = this.director;
    if (!director) return;
    this.setState('upgrade');
    const rare = director.rarePicks > 0;
    this.screens.upgrades(
      director.offers,
      rare ? 'A rare gift' : 'Choose an upgrade',
      rare ? 'Pick one. Keys 1 to 3, or click.' : 'Pick one. Keys 1 to 3, or click. Each trades something away.',
      (id) => this.takeUpgrade(id),
    );
  }

  private takeUpgrade(id: UpgradeId): void {
    const director = this.director;
    if (!director) return;
    const combos = director.pickUpgrade(id);
    this.audio.onUpgrade();
    if (combos.length) this.hud.flash(`Combo discovered: ${combos.join(', ')}`, 'cyan', 3.2);
    if (this.battle) this.battle.mods = director.mods;
    if (director.status === 'upgrade') {
      this.showUpgrades();
      return;
    }
    this.hud.setChips(director.owned.map((u) => upgradeById(u).name));
    this.setState('run');
    this.input.captureMouse();
  }

  private showAltar(): void {
    const director = this.director;
    if (!director) return;
    this.setState('altar');
    this.screens.altar('Trade 20 maximum health for one rare upgrade.', {
      mend: () => {
        const player = this.battle?.player;
        if (player) director.mend(player);
        this.audio.onMend();
        this.altarUsed = true;
        this.setState('run');
        this.input.captureMouse();
      },
      attune: () => {
        director.attune();
        this.altarUsed = true;
        if (this.battle) this.battle.mods = director.mods;
        this.showUpgrades();
      },
    });
  }

  /** The player walked through exit `exitIndex`: choose the next room and carry the state across. */
  private advanceThrough(exitIndex: number): void {
    const director = this.director;
    const battle = this.battle;
    if (!director || !battle) return;
    const option = director.nextOptions[exitIndex] ?? director.nextOptions[0];
    if (!option) {
      this.finishRun(true);
      return;
    }
    const player = director.carry(battle.player);
    const shards = battle.shards;
    const next = director.enter(exitIndex, option);
    this.enterRoom(next, player, shards);
  }

  /** Ends the run: folds the outcome into meta-progress and shows the end screen. */
  finishRun(won: boolean): void {
    const director = this.director;
    if (!director) return;
    const time = this.runTime;
    const summary: RunSummary = director.summary(won, time, this.roomKills);
    const outcome: RunOutcome = {
      won,
      time,
      kills: summary.kills,
      upgrades: [...director.owned],
      combos: summary.combos,
      visitedCistern: director.cisternVisited,
      clearedReliquary: director.reliquaryCleared,
      reachedBoss: director.stage >= 5,
    };
    const applied = applyOutcome(this.progress, outcome);
    this.progress = applied.progress;
    saveProgress(this.progress);
    this.lastSummary = summary;
    this.lastUnlocked = applied.unlocked;
    this.setState('end');
    this.input.releaseMouse();
    this.audio.stopAmbience();
    this.audio.onRunEnd(won);
    this.screens.end(summary, applied.unlocked, this.progress.bestWinTime, {
      restart: () => {
        this.input.captureMouse();
        this.startRun();
      },
      title: () => this.showTitle(),
    });
  }

  /** Summary of the most recent finished run, for tests. */
  lastSummary: RunSummary | null = null;
  lastUnlocked: string[] = [];

  /** Sets the seed for runs that start from now on. Tests use it for repeatable rooms. */
  setSeed(seed: number | null): void {
    this.seedOverride = seed;
  }

  private frame(ts: number): void {
    if (!this.running) return;
    const dt = Math.min(0.1, (ts - this.lastTs) / 1000);
    this.lastTs = ts;
    const t0 = performance.now();
    const snap = this.input.snapshot();
    this.route(snap, dt);
    this.render(dt);
    if (this.debugSyncGpu) this.ascii.gl.getContext().finish();
    this.frameMs.push(performance.now() - t0);
    if (this.frameMs.length > 600) this.frameMs.shift();
    requestAnimationFrame((next) => this.frame(next));
  }

  /** Routes this frame's input by state. */
  private route(snap: InputSnapshot, dt: number): void {
    switch (this.state) {
      case 'run':
        this.runStep(snap, dt);
        break;
      case 'ending':
        this.endTimer -= dt;
        if (this.endTimer <= 0) this.finishRun(this.endingWon);
        break;
      case 'end':
        if (snap.restartJust) {
          this.input.captureMouse();
          this.startRun();
        }
        this.menuInput(snap);
        break;
      case 'paused':
        if (snap.pauseJust || snap.backJust) this.resume();
        this.menuInput(snap);
        break;
      default:
        this.menuInput(snap);
        break;
    }
  }

  private menuInput(snap: InputSnapshot): void {
    if (snap.upJust) this.screens.navigate(-1);
    if (snap.downJust) this.screens.navigate(1);
    if (snap.confirmJust) this.screens.activate();
    if (snap.digitJust) this.screens.pickDigit(snap.digitJust);
  }

  /** One display frame of the run: look, fixed steps, events, and the altar prompt. */
  private runStep(snap: InputSnapshot, dt: number): void {
    const battle = this.battle;
    if (!battle) return;
    const sens = BASE_LOOK * this.settings.sensitivity;
    this.view.look(snap.lookDX, snap.lookDY, sens);
    this.view.yaw -= snap.turnKeys * TURN_RATE * dt;
    this.strafe = snap.moveX;
    if (snap.pauseJust) {
      this.pause();
      return;
    }
    if (snap.interactJust && this.nearAltar() && !this.altarUsed) {
      this.showAltar();
      return;
    }
    this.edges.record(snap);
    this.acc += dt;
    let steps = 0;
    while (this.acc >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.acc -= FIXED_DT;
      steps++;
      if (this.hitStop > 0) {
        this.hitStop -= FIXED_DT;
        continue;
      }
      battle.step(FIXED_DT, this.stepInput(snap, this.edges.take()));
      if (this.debugGod) battle.player.hp = battle.player.maxHp;
      this.simTime += FIXED_DT;
      this.runTime += FIXED_DT;
      this.handleBattleEvents(battle.drain());
      if (battle.exited || this.state !== 'run') break;
    }
    this.handleBattleEvents(battle.drain());
    if (this.effects.hitStopRequest > 0 && this.settings.hitStop && !this.settings.reducedMotion) {
      this.hitStop = Math.max(this.hitStop, this.effects.hitStopRequest);
    }
    this.effects.hitStopRequest = 0;
  }

  private nearAltar(): boolean {
    const battle = this.battle;
    if (!battle || !this.layout) return false;
    return this.layout.altars.some((a) => Math.hypot(a.x + 0.5 - battle.player.x, a.y + 0.5 - battle.player.z) <= ALTAR_REACH);
  }

  private stepInput(snap: InputSnapshot, edges: Edges): StepInput {
    return {
      move: {
        moveX: snap.moveX,
        moveY: snap.moveY,
        forward: this.view.forward(),
        right: this.view.right(),
        dodgePressed: edges.dodge,
      },
      fireJust: edges.fire,
      fireHeld: snap.fireHeld,
      tearHeld: snap.tearHeld,
      tearReleased: edges.tearRelease,
    };
  }

  private handleBattleEvents(events: BattleEvent[]): void {
    for (const ev of events) {
      this.effects.onEvent(ev);
      this.audio.onBattleEvent(ev);
      switch (ev.type) {
        case 'enemyDied':
          this.roomKills += 1;
          break;
        case 'roomCleared':
          this.onRoomCleared();
          break;
        case 'doorEntered':
          if (this.state === 'run') this.advanceThrough(ev.exitIndex);
          break;
        case 'dodge':
          if (ev.phase === 'start' && !this.settings.reducedMotion) {
            // The roll widens the view and tips it briefly, in the direction of the dodge.
            this.view.widen(0.8 * this.settings.effects);
            this.view.kick(0, 0, 0.1 * this.settings.screenShake * (this.strafe >= 0 ? -1 : 1));
          }
          break;
        case 'playerDied':
          this.hud.flash('The ink takes you', 'ember', 2.2);
          this.endingWon = false;
          this.endTimer = DEATH_DELAY;
          this.setState('ending');
          break;
        case 'bossPhase':
          this.hud.flash('The book tears open', 'ember', 2.4);
          break;
        default:
          break;
      }
    }
  }

  private render(dt: number): void {
    const battle = this.battle;
    const player = battle?.player;
    const eye = player ? { x: player.x, z: player.z } : { x: 0, z: 0 };
    const speed = player ? Math.hypot(player.vx, player.vz) : 0;
    const reduced = this.settings.reducedMotion;
    this.view.update(dt, eye.x, eye.z, speed, this.strafe, { shake: reduced ? 0 : this.settings.screenShake, bob: reduced ? 0 : 1 });
    if (battle && player) {
      this.feedViewModel(dt, battle, speed);
      this.world.sync(battle, dt, this.simTime, eye);
      this.effects.applyTo(this.view);
      const state = {
        enemies: battle.enemies,
        player: battle.player,
        projectiles: battle.projectiles,
        fragments: battle.tear.fragments,
        tearCharge: battle.tearCharge,
        charging: battle.tear.charging,
        pickups: battle.pickups,
        hazards: battle.hazards,
        layout: this.layout,
      };
      this.effects.update(dt, state);
      this.effects.draw(this.simTime, state);
      this.updateHud(dt, battle);
    }
    if (this.debugTopDown && battle) {
      this.world.camera.position.set(battle.player.x, 24, battle.player.z + 0.01);
      this.world.camera.lookAt(battle.player.x, 0, battle.player.z);
      this.world.camera.up.set(0, 0, -1);
      this.world.camera.fov = 40;
      this.world.camera.updateProjectionMatrix();
    }
    this.world.scene.fog = this.debugTopDown ? null : this.world.fog;
    this.ascii.render(this.world.scene, this.world.camera, { dt, distortions: this.effects.distortionsNow });
  }

  private feedViewModel(dt: number, battle: Battle, speed: number): void {
    const spec = glaiveSpec(battle.glaive.index, battle.mods);
    this.world.viewModel.update(dt, {
      weapon: battle.weapon,
      phase: battle.glaive.phase,
      phaseT: battle.glaive.t,
      windup: spec.windup,
      active: spec.active,
      recover: spec.recover,
      heavy: spec.heavy,
      speed,
      charging: battle.tearCharge,
      shotAge: 1,
    });
  }

  private updateHud(dt: number, battle: Battle): void {
    this.hud.update(dt, battle, battle.shards, this.settings.showStats, this.frameMs);
    const labels: DoorLabel[] = [];
    const director = this.director;
    if (battle.cleared && this.layout && director) {
      for (const door of this.layout.doors) {
        if (door.role !== 'exit') continue;
        const option = director.nextOptions[door.exitIndex] ?? director.nextOptions[0];
        if (option) labels.push({ door, text: option.label, sub: option.blurb });
      }
    }
    this.hud.setDoorLabels(labels, (x, y, z) => this.project(x, y, z));
    const prompt = this.state === 'run' && this.nearAltar() && !this.altarUsed;
    this.hud.setPrompt(prompt ? 'E · consult the altar' : null);
  }

  /** World point to CSS pixels for the HUD labels. Null when the point is behind the camera. */
  private project(x: number, y: number, z: number): { x: number; y: number } | null {
    const v = this.projectScratch.set(x, y, z).project(this.world.camera);
    if (v.z > 1 || v.z < -1) return null;
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  }

  /** The enemies still standing in the current room. */
  get enemiesAlive(): Enemy[] {
    return this.battle?.aliveEnemies ?? [];
  }

  /** The boss in the current room, if any. */
  get boss(): Boss | null {
    return (this.battle?.enemies.find((e): e is Boss => e instanceof Boss) ?? null) as Boss | null;
  }

  /** The mods in effect for the current run. */
  get mods(): Mods | null {
    return this.director?.mods ?? null;
  }

  /** Takes exit `index` as if the player had walked through it. Used by tests and the debug hook. */
  takeExit(index: number): void {
    if (this.state === 'run') this.advanceThrough(index);
  }

  /** Simulates `seconds` of run time without rendering. Used by tests. */
  advance(seconds: number): void {
    const steps = Math.round(seconds / FIXED_DT);
    for (let i = 0; i < steps; i++) this.runStep(this.input.snapshot(), FIXED_DT);
  }

  dispose(): void {
    this.stop();
    this.input.dispose();
    this.world.dispose();
    this.ascii.dispose();
  }

  get inMenu(): boolean {
    return MENU_STATES.includes(this.state);
  }
}
