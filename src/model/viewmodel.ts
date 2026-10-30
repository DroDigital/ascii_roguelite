import * as THREE from 'three';
import { geo, mats, part } from './materials';

export type WeaponKind = 'glaive' | 'quill';

export interface ViewModelState {
  weapon: WeaponKind;
  /** Glaive phase while a swing is in progress. */
  phase: 'idle' | 'windup' | 'active' | 'recover';
  /** Seconds into the current phase. */
  phaseT: number;
  /** Phase durations, so the swing reads at its real timing. */
  windup: number;
  active: number;
  recover: number;
  heavy: boolean;
  /** Ground speed for the walk bob. */
  speed: number;
  charging: number;
  /** Seconds since the last quill shot, for recoil. */
  shotAge: number;
}

/**
 * The hand and weapon in the lower right of the view. It is parented to the
 * camera. Swings sweep through windup, active and recovery in step with the
 * simulation, so the animation shows what the hit will do.
 */
export class ViewModel {
  readonly root = new THREE.Group();
  private readonly hand: THREE.Group;
  private readonly glaive: THREE.Group;
  private readonly quill: THREE.Group;
  private readonly feather: THREE.Mesh;
  private rot = { x: 0, y: 0, z: 0 };
  private bobPhase = 0;
  private recoil = 0;

  constructor() {
    this.root.position.set(0.3, -0.36, -0.55);
    this.hand = new THREE.Group();
    this.root.add(this.hand);
    this.hand.add(part(geo.unitSphere, mats.ivoryBright(), [0, 0, 0], [0.09, 0.09, 0.09]));
    this.hand.add(part(geo.unitCylinder, mats.ivory(), [0, -0.16, 0.12], [0.1, 0.34, 0.1], [0.5, 0, 0]));

    this.glaive = new THREE.Group();
    this.glaive.position.set(0, 0.02, 0);
    this.hand.add(this.glaive);
    this.glaive.add(part(geo.unitCylinder, mats.bone(), [0, 0.95, 0], [0.035, 2.1, 0.035]));
    this.glaive.add(part(geo.unitBox, mats.ivoryBright(), [0.12, 1.92, 0], [0.22, 0.56, 0.035], [0, 0, -0.35]));
    this.glaive.add(part(geo.unitBox, mats.ivoryBright(), [0.22, 1.66, 0], [0.12, 0.24, 0.03], [0, 0, -0.6]));

    this.quill = new THREE.Group();
    this.quill.position.set(0, 0.02, 0);
    this.quill.visible = false;
    this.hand.add(this.quill);
    this.quill.add(part(geo.unitCylinder, mats.bone(), [0, 0.7, 0], [0.04, 1.5, 0.04]));
    this.feather = part(geo.unitCone, mats.cyan(), [0, 1.52, 0], [0.09, 0.3, 0.09]);
    this.quill.add(this.feather);
    this.root.visible = true;
  }

  attachTo(camera: THREE.Camera): void {
    if (this.root.parent !== camera) camera.add(this.root);
  }

  setWeapon(w: WeaponKind): void {
    this.glaive.visible = w === 'glaive';
    this.quill.visible = w === 'quill';
  }

  /** Steps the pose one display frame. */
  update(dt: number, s: ViewModelState): void {
    this.bobPhase += dt * (4 + s.speed * 1.4);
    const bob = Math.sin(this.bobPhase) * 0.012 * Math.min(1, s.speed / 3);
    this.recoil = Math.max(0, this.recoil - dt * 6);
    if (s.shotAge < 0.05 && s.weapon === 'quill') this.recoil = 1;

    let tx = 0.12;
    let ty = 0;
    let tz = 0;
    if (s.weapon === 'glaive') {
      const sw = swingPose(s);
      tx = sw.x;
      ty = sw.y;
      tz = sw.z;
    } else {
      tx = -0.1 - this.recoil * 0.25;
      ty = 0.1 * s.charging;
      tz = this.recoil * 0.12;
    }
    const k = 1 - Math.exp(-dt * (s.phase === 'active' ? 30 : 14));
    this.rot.x += (tx - this.rot.x) * k;
    this.rot.y += (ty - this.rot.y) * k;
    this.rot.z += (tz - this.rot.z) * k;
    this.hand.rotation.set(this.rot.x + bob, this.rot.y, this.rot.z);
    this.root.position.y = -0.36 + bob * 0.5;
    this.feather.scale.setScalar(1 + s.charging * 0.35);
    (this.feather.material as THREE.MeshBasicMaterial).color.setRGB(0.37 + s.charging * 0.6, 0.9, 0.88);
  }
}

/** Glaive pose for each swing phase. Windup pulls back, active sweeps through, recovery settles. */
function swingPose(s: ViewModelState): { x: number; y: number; z: number } {
  const amp = s.heavy ? 1.25 : 1;
  switch (s.phase) {
    case 'windup': {
      const f = Math.min(1, s.phaseT / Math.max(0.01, s.windup));
      return { x: 0.12 - 0.5 * f * amp, y: -0.6 * f * amp, z: 0.5 * f * amp };
    }
    case 'active': {
      const f = Math.min(1, s.phaseT / Math.max(0.01, s.active));
      return { x: -0.4 + 0.9 * f * amp, y: -0.6 + 1.2 * f * amp, z: 0.5 - 1.9 * f * amp };
    }
    case 'recover': {
      const f = Math.min(1, s.phaseT / Math.max(0.01, s.recover));
      return { x: 0.5 - 0.38 * f, y: 0.6 - 0.6 * f, z: -1.4 + 1.54 * f };
    }
    default:
      return { x: 0.12, y: 0, z: 0 };
  }
}
