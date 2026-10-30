import * as THREE from 'three';
import type { Enemy } from '../sim/enemies';
import { cloneMat, geo, mats, part } from './materials';

const FLASH_TIME = 0.14;
const STRIDE = 0.34;
const LIFT = 0.16;

/** A two-bone leg solved in the sagittal plane, so each foot stays planted on the ground. */
interface Leg {
  hip: THREE.Group;
  thigh: THREE.Group;
  shin: THREE.Group;
  foot: THREE.Group;
  x: number;
  /** Phase offset: legs alternate. */
  offset: number;
  l1: number;
  l2: number;
}

/** Joint layout for one biped, in the enemy's own space. */
interface BipedSpec {
  hipY: number;
  legL1: number;
  legL2: number;
  legX: number;
  stride: number;
}

interface View {
  root: THREE.Group;
  hips: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legs: Leg[];
  eyes: THREE.Material[];
  flash: THREE.MeshLambertMaterial[];
  /** Extra animated pieces, for example the seal ring of an acolyte. */
  spin: THREE.Object3D[];
  /** Armour plates in the order they are torn off. */
  plates: THREE.Object3D[];
  core: THREE.Mesh | null;
  pose: { torsoLean: number; armPitch: number; armSpread: number };
}

function makeLeg(parent: THREE.Object3D, x: number, l1: number, l2: number, offset: number, thick: number, mat: THREE.Material): Leg {
  const hip = new THREE.Group();
  hip.position.set(x, 0, 0);
  const thigh = new THREE.Group();
  const shin = new THREE.Group();
  const foot = new THREE.Group();
  thigh.add(part(geo.unitCylinder, mat, [0, -l1 / 2, 0], [thick, l1, thick]));
  shin.position.set(0, -l1, 0);
  shin.add(part(geo.unitCylinder, mat, [0, -l2 / 2, 0], [thick * 0.9, l2, thick * 0.9]));
  foot.position.set(0, -l2, 0);
  foot.add(part(geo.unitBox, mat, [0, -0.04, -0.07], [thick * 1.6, 0.08, thick * 2.6]));
  shin.add(foot);
  thigh.add(shin);
  hip.add(thigh);
  parent.add(hip);
  return { hip, thigh, shin, foot, x, offset, l1, l2 };
}

/**
 * Solves the leg so its foot lands on (footY, footZ) relative to the hip.
 * The knee bends forward, which reads as a crouch to an observer.
 */
function solveLeg(leg: Leg, footY: number, footZ: number): void {
  const dy = footY;
  const dz = footZ;
  const d = Math.min(Math.hypot(dy, dz), leg.l1 + leg.l2 - 1e-3);
  const reach = Math.max(d, Math.abs(leg.l1 - leg.l2) + 1e-3);
  const thetaFoot = Math.atan2(-dz, -dy);
  const cosHip = (leg.l1 * leg.l1 + reach * reach - leg.l2 * leg.l2) / (2 * leg.l1 * reach);
  const cosFoot = (leg.l2 * leg.l2 + reach * reach - leg.l1 * leg.l1) / (2 * leg.l2 * reach);
  const g1 = Math.acos(Math.min(1, Math.max(-1, cosHip)));
  const g2 = Math.acos(Math.min(1, Math.max(-1, cosFoot)));
  leg.thigh.rotation.x = thetaFoot + g1;
  leg.shin.rotation.x = -(g1 + g2);
}

function biped(root: THREE.Group, spec: BipedSpec, mat: THREE.Material): {
  hips: THREE.Group;
  legs: Leg[];
} {
  const hips = new THREE.Group();
  hips.position.set(0, spec.hipY, 0);
  root.add(hips);
  const legs = [
    makeLeg(hips, -spec.legX, spec.legL1, spec.legL2, 0, 0.13, mat),
    makeLeg(hips, spec.legX, spec.legL1, spec.legL2, Math.PI, 0.13, mat),
  ];
  return { hips, legs };
}

function buildHusk(): View {
  const root = new THREE.Group();
  const body = cloneMat(mats.ivory());
  const flash: THREE.MeshLambertMaterial[] = [body as THREE.MeshLambertMaterial];
  const { hips, legs } = biped(root, { hipY: 0.9, legL1: 0.46, legL2: 0.44, legX: 0.16, stride: 0.3 }, body);
  const torso = new THREE.Group();
  torso.position.set(0, 0.04, 0);
  hips.add(torso);
  torso.add(part(geo.unitBox, body, [0, 0.46, 0], [0.44, 0.62, 0.28]));
  const head = new THREE.Group();
  head.position.set(0, 1.0, -0.04);
  torso.add(head);
  head.add(part(geo.unitSphere, body, [0, 0.12, 0], [0.19, 0.22, 0.19]));
  const eyeMat = cloneMat(mats.ember());
  head.add(part(geo.unitSphere, eyeMat, [-0.07, 0.14, -0.15], [0.04, 0.04, 0.04]));
  head.add(part(geo.unitSphere, eyeMat, [0.07, 0.14, -0.15], [0.04, 0.04, 0.04]));
  const armL = new THREE.Group();
  armL.position.set(-0.27, 0.9, 0);
  torso.add(armL);
  armL.add(part(geo.unitCylinder, body, [0, -0.3, 0], [0.09, 0.62, 0.09]));
  armL.add(part(geo.unitCone, mats.bone(), [0, -0.66, 0], [0.09, 0.2, 0.09], [Math.PI, 0, 0]));
  const armR = new THREE.Group();
  armR.position.set(0.27, 0.9, 0);
  torso.add(armR);
  armR.add(part(geo.unitCylinder, body, [0, -0.3, 0], [0.09, 0.62, 0.09]));
  armR.add(part(geo.unitCone, mats.bone(), [0, -0.66, 0], [0.09, 0.2, 0.09], [Math.PI, 0, 0]));
  return {
    root,
    hips,
    torso,
    head,
    armL,
    armR,
    legs,
    eyes: [eyeMat],
    flash,
    spin: [],
    plates: [],
    core: null,
    pose: { torsoLean: 0.35, armPitch: 0.25, armSpread: 0.1 },
  };
}

function buildBulwark(gilded: boolean): View {
  const root = new THREE.Group();
  const body = cloneMat(mats.stone());
  const flash: THREE.MeshLambertMaterial[] = [body as THREE.MeshLambertMaterial];
  const { hips, legs } = biped(root, { hipY: 0.95, legL1: 0.48, legL2: 0.46, legX: 0.3, stride: 0.22 }, body);
  const torso = new THREE.Group();
  torso.position.set(0, 0.06, 0);
  hips.add(torso);
  torso.add(part(geo.unitBox, body, [0, 0.52, 0], [0.94, 0.86, 0.7]));
  const plates: THREE.Object3D[] = [];
  const plateMat = gilded ? mats.gilded() : mats.ivoryBright();
  for (let i = 0; i < 3; i++) {
    const plate = part(geo.unitBox, plateMat, [0, 0.38 + i * 0.3, -0.38], [0.98, 0.14, 0.12]);
    torso.add(plate);
    plates.push(plate);
  }
  const core = part(geo.unitSphere, mats.cyan(), [0, 0.55, -0.41], [0.13, 0.13, 0.13]);
  core.visible = false;
  torso.add(core);
  const head = new THREE.Group();
  head.position.set(0, 1.18, 0.04);
  torso.add(head);
  head.add(part(geo.unitBox, body, [0, 0.12, 0], [0.4, 0.34, 0.38]));
  const eyeMat = cloneMat(mats.ember());
  head.add(part(geo.unitBox, eyeMat, [0, 0.14, -0.2], [0.26, 0.05, 0.04]));
  if (gilded) {
    for (let i = -1; i <= 1; i++) {
      head.add(part(geo.unitCone, mats.gilded(), [i * 0.14, 0.4, 0], [0.09, 0.26, 0.09]));
    }
  }
  const armL = new THREE.Group();
  armL.position.set(-0.6, 0.78, 0);
  torso.add(armL);
  armL.add(part(geo.unitCylinder, body, [0, -0.3, 0], [0.18, 0.6, 0.18]));
  const shield = part(geo.unitBox, plateMat, [0.12, -0.58, -0.16], [0.7, 1.0, 0.1]);
  armL.add(shield);
  const armR = new THREE.Group();
  armR.position.set(0.6, 0.78, 0);
  torso.add(armR);
  armR.add(part(geo.unitCylinder, body, [0, -0.3, 0], [0.18, 0.6, 0.18]));
  armR.add(part(geo.unitSphere, body, [0, -0.66, 0], [0.22, 0.22, 0.22]));
  return {
    root,
    hips,
    torso,
    head,
    armL,
    armR,
    legs,
    eyes: [eyeMat],
    flash,
    spin: [],
    plates,
    core,
    pose: { torsoLean: 0.12, armPitch: 0.2, armSpread: 0.05 },
  };
}

function buildAcolyte(): View {
  const root = new THREE.Group();
  const robe = cloneMat(mats.robe());
  const flash: THREE.MeshLambertMaterial[] = [robe as THREE.MeshLambertMaterial];
  const profile = [
    new THREE.Vector2(0.06, 0),
    new THREE.Vector2(0.3, 0),
    new THREE.Vector2(0.24, 0.5),
    new THREE.Vector2(0.17, 1.1),
    new THREE.Vector2(0.2, 1.6),
    new THREE.Vector2(0.14, 1.9),
    new THREE.Vector2(0.001, 2.0),
  ];
  const hips = new THREE.Group();
  root.add(hips);
  const torso = new THREE.Group();
  torso.position.set(0, 0.05, 0);
  hips.add(torso);
  torso.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 14), robe));
  const head = new THREE.Group();
  head.position.set(0, 1.85, 0);
  torso.add(head);
  head.add(part(geo.unitSphere, mats.robe(), [0, 0.1, 0], [0.2, 0.24, 0.2]));
  const eyeMat = cloneMat(mats.cyan());
  head.add(part(geo.unitSphere, eyeMat, [0, 0.08, -0.14], [0.05, 0.05, 0.05]));
  const armL = new THREE.Group();
  armL.position.set(-0.2, 1.45, 0);
  torso.add(armL);
  armL.add(part(geo.unitCylinder, robe, [0, -0.28, -0.12], [0.07, 0.6, 0.07], [-0.5, 0, 0]));
  const armR = new THREE.Group();
  armR.position.set(0.2, 1.45, 0);
  torso.add(armR);
  armR.add(part(geo.unitCylinder, robe, [0, -0.28, -0.12], [0.07, 0.6, 0.07], [-0.5, 0, 0]));
  const staff = new THREE.Group();
  staff.position.set(0.32, 0, -0.18);
  torso.add(staff);
  staff.add(part(geo.unitCylinder, mats.bone(), [0, 1.2, 0], [0.04, 2.3, 0.04]));
  const seal = part(geo.unitTorus, mats.cyan(), [0, 2.35, 0], [0.22, 0.22, 0.22], [Math.PI / 2, 0, 0]);
  staff.add(seal);
  return {
    root,
    hips,
    torso,
    head,
    armL,
    armR,
    legs: [],
    eyes: [eyeMat],
    flash,
    spin: [seal],
    plates: [],
    core: null,
    pose: { torsoLean: 0, armPitch: 0.1, armSpread: 0.1 },
  };
}

function buildView(enemy: Enemy): View {
  switch (enemy.def.kind) {
    case 'husk':
      return buildHusk();
    case 'acolyte':
      return buildAcolyte();
    case 'bulwark':
      return buildBulwark(false);
    case 'elite':
      return buildBulwark(true);
    case 'boss':
      return buildBoss();
  }
}

/** The Scribe: a tall robed figure with an open book, seal plates for armour, and pages that spin free in phase two. */
function buildBoss(): View {
  const root = new THREE.Group();
  const robe = cloneMat(mats.robe());
  const flash: THREE.MeshLambertMaterial[] = [robe as THREE.MeshLambertMaterial];
  const profile = [
    new THREE.Vector2(0.1, 0),
    new THREE.Vector2(0.42, 0),
    new THREE.Vector2(0.34, 0.8),
    new THREE.Vector2(0.26, 1.6),
    new THREE.Vector2(0.3, 2.2),
    new THREE.Vector2(0.2, 2.6),
    new THREE.Vector2(0.001, 2.75),
  ];
  const hips = new THREE.Group();
  root.add(hips);
  const torso = new THREE.Group();
  torso.position.set(0, 0.05, 0);
  hips.add(torso);
  torso.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 16), robe));
  const head = new THREE.Group();
  head.position.set(0, 2.45, 0);
  torso.add(head);
  head.add(part(geo.unitSphere, mats.robe(), [0, 0.08, 0], [0.22, 0.26, 0.22]));
  const eyeMat = cloneMat(mats.ember());
  head.add(part(geo.unitSphere, eyeMat, [0, 0.08, -0.17], [0.05, 0.05, 0.05]));
  const book = new THREE.Group();
  book.position.set(0, 1.45, -0.32);
  torso.add(book);
  book.add(part(geo.unitBox, mats.ivoryBright(), [-0.22, 0, 0], [0.44, 0.56, 0.04], [0, 0.4, 0]));
  book.add(part(geo.unitBox, mats.ivoryBright(), [0.22, 0, 0], [0.44, 0.56, 0.04], [0, -0.4, 0]));
  const plates: THREE.Object3D[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const plate = part(geo.unitBox, mats.cyan(), [Math.cos(a) * 0.62, 1.3, Math.sin(a) * 0.62], [0.16, 0.5, 0.06], [0, -a, 0]);
    torso.add(plate);
    plates.push(plate);
  }
  const core = part(geo.unitSphere, mats.ember(), [0, 1.5, -0.36], [0.16, 0.16, 0.16]);
  core.visible = false;
  torso.add(core);
  const pages: THREE.Object3D[] = [];
  for (let i = 0; i < 4; i++) {
    const page = part(geo.unitBox, mats.ivoryBright(), [0, 1.5, 0], [0.5, 0.7, 0.02]);
    page.visible = false;
    torso.add(page);
    pages.push(page);
  }
  const armL = new THREE.Group();
  armL.position.set(-0.3, 2.0, 0);
  torso.add(armL);
  armL.add(part(geo.unitCylinder, robe, [0, -0.5, -0.1], [0.08, 1.0, 0.08], [-0.6, 0, 0]));
  const armR = new THREE.Group();
  armR.position.set(0.3, 2.0, 0);
  torso.add(armR);
  armR.add(part(geo.unitCylinder, robe, [0, -0.5, -0.1], [0.08, 1.0, 0.08], [-0.6, 0, 0]));
  return {
    root,
    hips,
    torso,
    head,
    armL,
    armR,
    legs: [],
    eyes: [eyeMat],
    flash,
    spin: pages,
    plates,
    core,
    pose: { torsoLean: 0, armPitch: 0.1, armSpread: 0.1 },
  };
}

/**
 * A visible enemy. It mirrors the simulation's stage each frame and adds a
 * gait, telegraph glow, hit flash and collapse. The view never changes the sim.
 */
export class EnemyView {
  readonly root: THREE.Group;
  private readonly v: View;
  private readonly enemy: Enemy;
  private phase = Math.random() * Math.PI * 2;
  private armPitchNow = 0;
  private leanNow = 0;
  private collapse = 0;

  constructor(enemy: Enemy) {
    this.enemy = enemy;
    this.v = buildView(enemy);
    this.root = this.v.root;
    this.root.scale.setScalar(enemy.def.scale);
    this.root.add(this.v.hips);
    this.root.position.set(enemy.x, 0, enemy.z);
  }

  /** Mirrors the enemy's current state onto the rig. */
  sync(dt: number, now: number): void {
    const e = this.enemy;
    this.root.position.set(e.x, 0, e.z);
    this.root.rotation.y = e.yaw;

    // Spawning rises out of the floor, shrinking up from the ground.
    const spawn = e.stage === 'spawn' ? Math.min(1, e.t / 0.8) : 1;
    this.root.position.y = -(1 - spawn) * 1.2;
    this.root.scale.setScalar(e.def.scale * (0.4 + 0.6 * spawn));

    const hurt = Math.max(0, 1 - e.hurtT / FLASH_TIME);
    for (const m of this.v.flash) {
      m.emissive.setRGB(0.8 * hurt, 0.2 * hurt, 0.1 * hurt);
    }

    const moving = e.stage === 'chase' ? 1 : e.stage === 'spawn' ? 0 : 0.2;
    const speed = e.def.speed;
    if (this.v.legs.length > 0) {
      this.phase += dt * speed * 1.7 * moving;
      this.v.legs.forEach((leg) => {
        const phi = this.phase + leg.offset;
        const z = Math.sin(phi) * STRIDE * moving;
        const y = -this.v.hips.position.y + Math.max(0, Math.cos(phi)) * LIFT * moving;
        solveLeg(leg, y, z);
      });
    }

    // Pose targets come from the stage, so telegraphs read before the strike.
    let armTarget = 0.2;
    let lean = this.v.pose.torsoLean;
    let collapseTarget = 0;
    switch (e.stage) {
      case 'windup':
        armTarget = -1.25;
        lean = this.v.pose.torsoLean - 0.25;
        break;
      case 'active':
        armTarget = 1.5;
        lean = this.v.pose.torsoLean + 0.35;
        break;
      case 'recover':
        armTarget = 0.5;
        break;
      case 'stagger':
        lean = -0.3;
        armTarget = 0.6;
        break;
      case 'stun':
        lean = 0.9;
        armTarget = 0.9;
        break;
      case 'dead':
        collapseTarget = 1;
        break;
      default:
        break;
    }
    const rate = e.stage === 'active' ? 22 : 9;
    this.armPitchNow += (armTarget - this.armPitchNow) * (1 - Math.exp(-dt * rate));
    this.leanNow += (lean - this.leanNow) * (1 - Math.exp(-dt * 10));
    this.collapse += (collapseTarget - this.collapse) * (1 - Math.exp(-dt * 5));

    this.v.torso.rotation.x = this.leanNow + this.collapse * 1.2;
    this.v.armL.rotation.x = this.armPitchNow;
    this.v.armR.rotation.x = this.armPitchNow;
    this.v.head.rotation.x = -this.leanNow * 0.5;
    this.root.rotation.x = -this.collapse * 0.9;
    this.root.position.y -= this.collapse * 0.25 * e.def.scale;

    // Telegraph glow on the eyes while winding up.
    const glow = e.stage === 'windup' ? 0.6 + 0.4 * Math.sin(now * 28) : 0.15;
    for (const m of this.v.eyes) {
      if (m instanceof THREE.MeshBasicMaterial) m.color.setRGB(0.4 + glow, 0.2 * glow, 0.12 * glow);
    }

    // Armour plates disappear as layers are torn away, and the core shows when exposed.
    const layersLeft = e.armor;
    this.v.plates.forEach((p, i) => {
      p.visible = i < layersLeft;
    });
    if (this.v.core) this.v.core.visible = e.coreExposed;
    if (e.def.kind === 'boss') {
      // Phase two tears the book open: pages spin free around the chest.
      const unbound = (e as unknown as { phaseTwo?: boolean }).phaseTwo === true;
      this.v.spin.forEach((page, i) => {
        page.visible = unbound;
        page.rotation.set(0.2 * i, now * 2.6 + (i * Math.PI) / 2, 0.6 * Math.sin(now * 3 + i));
        page.position.set(Math.cos(now * 1.7 + i * 1.57) * 0.55, 1.5, Math.sin(now * 1.7 + i * 1.57) * 0.55);
      });
    } else {
      for (const s of this.v.spin) s.rotation.z = now * 2.2;
    }
  }

  dispose(): void {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        if (!(o.material instanceof THREE.Material)) return;
        if (!this.v.flash.includes(o.material as THREE.MeshLambertMaterial) && !this.v.eyes.includes(o.material)) return;
        o.material.dispose();
      }
    });
    this.root.removeFromParent();
  }
}
