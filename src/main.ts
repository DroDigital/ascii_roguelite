import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
import './ui/styles.css';
import { App } from './app/app';
import { PLAYER_TUNING } from './sim/player';

const params = new URLSearchParams(location.search);

const canvas = document.getElementById('world') as HTMLCanvasElement;
const app = new App(canvas, {
  cell: { w: 8, h: 16 },
  sampleX: 2,
  contrast: 0.8,
  exposure: 2.2,
  edgeThreshold: 0.12,
  glow: 0.6,
  vignette: 0.35,
});

void app.init().then(() => {
  const seed = Number(params.get('seed'));
  if (params.has('seed') && Number.isFinite(seed)) app.setSeed(seed);
  app.start();
  (window as unknown as { __ready?: boolean }).__ready = true;
});

/** Plain-data snapshot of the game state. Used by the end-to-end tests. */
function snapshot() {
  const b = app.battle;
  const d = app.director;
  return {
    state: app.state,
    runTime: app.runTime,
    room: app.plan
      ? {
          templateId: app.plan.layout.templateId,
          kind: app.plan.option.kind,
          label: app.plan.option.label,
          altars: app.plan.layout.altars.map((a) => ({ x: a.x + 0.5, z: a.y + 0.5 })),
          exits: app.plan.layout.doors.filter((d) => d.role === 'exit').map((d) => ({ index: d.exitIndex, x: d.x + 0.5, z: d.y + 0.5 })),
        }
      : null,
    director: d
      ? {
          stage: d.stage,
          status: d.status,
          owned: [...d.owned],
          combosSeen: [...d.combosSeen],
          kills: d.kills,
          roomsCleared: d.roomsCleared,
          rarePicks: d.rarePicks,
          offers: [...d.offers],
          nextLabels: d.nextOptions.map((o) => o.label),
        }
      : null,
    battle: b
      ? {
          time: b.time,
          hp: b.player.hp,
          maxHp: b.player.maxHp,
          alive: b.player.alive,
          dodging: b.player.dodging,
          dodgeCharges: b.player.dodgeCharges,
          invulnerable:
            b.player.dodging && b.player.dodgeT >= PLAYER_TUNING.dodge.iframeStart && b.player.dodgeT <= PLAYER_TUNING.dodge.iframeEnd,
          pos: { x: b.player.x, z: b.player.z },
          yaw: app.view.yaw,
          pitch: app.view.pitch,
          kills: b.kills,
          shards: b.shards,
          cleared: b.cleared,
          exited: b.exited,
          pending: b.pending.length,
          projectiles: b.projectiles.length,
          tearCharge: b.tearCharge,
          tearCooldown: b.tear.cooldown,
          glaivePhase: b.glaive.phase,
          enemies: b.enemies.map((e) => ({
            id: e.id,
            kind: e.def.kind,
            stage: e.stage,
            hp: Math.round(e.hp * 10) / 10,
            armor: e.armor,
            coreExposed: e.coreExposed,
            x: e.x,
            z: e.z,
          })),
        }
      : null,
    progress: app.progress,
    settings: app.settings,
  };
}

if (params.has('test')) {
  (window as unknown as { vellum: unknown }).vellum = {
    app,
    state: snapshot,
    /** Advances simulation time in seconds, without rendering. */
    advance: (seconds: number) => {
      app.advance(seconds);
      return snapshot();
    },
    startRun: (seed?: number) => {
      app.startRun(seed);
      return snapshot();
    },
    setLook: (yaw: number, pitch: number) => app.view.setLook(yaw, pitch),
    /** Walks through exit `index` of the current room, as the doors would. */
    takeExit: (index: number) => {
      app.takeExit(index);
      return snapshot();
    },
    setTopDown: (on: boolean) => {
      app.debugTopDown = on;
    },
    setGod: (on: boolean) => {
      app.debugGod = on;
    },
    /** Presses or releases a key, as the browser would deliver it. */
    key: (code: string, down: boolean) => {
      window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
    },
    /** Presses or releases a mouse button on the game canvas. */
    mouse: (button: number, down: boolean) => {
      if (down) canvas.dispatchEvent(new MouseEvent('mousedown', { button, bubbles: true }));
      else window.dispatchEvent(new MouseEvent('mouseup', { button, bubbles: true }));
    },
  };
}
