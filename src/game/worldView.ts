import * as THREE from 'three';
import type { AsciiRenderer } from '../render/asciiRenderer';
import type { Battle } from '../sim/battle';
import { EnemyView } from '../model/characters';
import { ViewModel } from '../model/viewmodel';
import { buildRoom, type BuiltRoom } from '../world/roomBuilder';
import type { Layout } from '../world/tiles';

const CANDLE_LIGHTS = 4;

/**
 * Owns the Three.js scene for a room: the room geometry, the lights, enemy
 * views and the viewmodel. It mirrors the simulation each frame. It never changes
 * the simulation state.
 */
export class WorldView {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly viewModel = new ViewModel();
  readonly fog: THREE.Fog;
  private room: BuiltRoom | null = null;
  private readonly enemyViews = new Map<number, EnemyView>();
  private readonly candleLights: THREE.PointLight[] = [];
  private readonly key: THREE.DirectionalLight;
  private readonly rim: THREE.DirectionalLight;

  constructor(ascii: AsciiRenderer) {
    ascii.gl.shadowMap.enabled = true;
    ascii.gl.shadowMap.type = THREE.PCFShadowMap;
    this.fog = new THREE.Fog(0x050507, 9, 30);
    this.scene.fog = this.fog;
    this.scene.add(new THREE.HemisphereLight(0xefe6cf, 0x0b0a08, 0.9));

    this.key = new THREE.DirectionalLight(0xfff1d6, 1.8);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    Object.assign(this.key.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 50 });
    this.key.shadow.bias = -0.0008;
    this.scene.add(this.key, this.key.target);

    this.rim = new THREE.DirectionalLight(0xfff5e0, 0.7);
    this.scene.add(this.rim, this.rim.target);

    for (let i = 0; i < CANDLE_LIGHTS; i++) {
      const l = new THREE.PointLight(0xffd9a0, 0, 9, 1.4);
      this.candleLights.push(l);
      this.scene.add(l);
    }

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 60);
    this.camera.add(this.viewModel.root);
    this.scene.add(this.camera);
    this.viewModel.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = false;
    });
  }

  /** Builds the room's geometry, replacing the previous room. */
  loadRoom(layout: Layout): BuiltRoom {
    this.room?.dispose();
    this.room?.group.removeFromParent();
    for (const v of this.enemyViews.values()) v.dispose();
    this.enemyViews.clear();
    this.room = buildRoom(layout);
    this.scene.add(this.room.group);
    return this.room;
  }

  get currentRoom(): BuiltRoom | null {
    return this.room;
  }

  /** Mirrors the battle onto the scene. Call once per display frame, after the sim steps. */
  sync(battle: Battle, dt: number, now: number, eye: { x: number; z: number }): void {
    // The gates follow the simulation's lock every frame, so they cannot drift from it.
    this.room?.setDoorsLocked(battle.grid.doorsLocked);
    const alive = new Set<number>();
    for (const e of battle.enemies) {
      alive.add(e.id);
      let view = this.enemyViews.get(e.id);
      if (!view) {
        view = new EnemyView(e);
        this.enemyViews.set(e.id, view);
        this.scene.add(view.root);
      }
      view.sync(dt, now);
    }
    for (const [id, view] of this.enemyViews) {
      if (!alive.has(id)) {
        view.dispose();
        this.enemyViews.delete(id);
      }
    }
    this.updateLights(eye);
  }

  /** Points the candle pool at the nearest candles and keeps the shadow frustum on the player. */
  private updateLights(eye: { x: number; z: number }): void {
    const candles = this.room?.candles ?? [];
    const sorted = candles
      .map((c) => ({ c, d: Math.hypot(c.x - eye.x, c.z - eye.z) }))
      .sort((a, b) => a.d - b.d);
    this.candleLights.forEach((light, i) => {
      const hit = sorted[i];
      if (hit) {
        light.position.set(hit.c.x, 1.1, hit.c.z);
        light.intensity = 3.2 * Math.max(0.3, 1 - hit.d / 14);
      } else {
        light.intensity = 0;
      }
    });
    this.key.position.set(eye.x - 6, 12, eye.z + 8);
    this.key.target.position.set(eye.x, 0, eye.z);
    this.rim.position.set(eye.x + 5, 4, eye.z - 9);
    this.rim.target.position.set(eye.x, 0.5, eye.z);
  }

  /** Releases the room and enemy geometry. The renderer belongs to the app and is disposed there. */
  dispose(): void {
    for (const v of this.enemyViews.values()) v.dispose();
    this.enemyViews.clear();
    this.room?.dispose();
    this.room = null;
  }
}
