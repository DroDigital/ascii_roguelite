import * as THREE from 'three';
import { type DoorSpec, type Layout, T } from './tiles';

/** Height of a full wall. Eye height is 1.55, so walls always rise above the view. */
export const WALL_HEIGHT = 2.6;

const COLORS = {
  floor: 0x2b2823,
  ink: 0x07090c,
  wall: 0x5e584a,
  pillar: 0x7d7564,
  book: 0x4f3d2b,
  altar: 0x2d2b27,
  altarGlow: 0x5fe6e0,
  wax: 0xd8cfb4,
  flame: 0xffb84a,
  doorEntry: 0x6b6860,
  ash: 0x6b6860,
  doorExit: 0xefe6cf,
  gate: 0xff5a3c,
} as const;

/** Shared materials. Every room reuses them, so a room costs only a few draw calls. */
const materialCache = new Map<string, THREE.Material>();
function mat(key: string, make: () => THREE.Material): THREE.Material {
  let m = materialCache.get(key);
  if (!m) {
    m = make();
    materialCache.set(key, m);
  }
  return m;
}

export const roomMaterials = {
  floor: () => mat('floor', () => new THREE.MeshLambertMaterial({ color: COLORS.floor })),
  ink: () => mat('ink', () => new THREE.MeshLambertMaterial({ color: COLORS.ink })),
  wall: () => mat('wall', () => new THREE.MeshLambertMaterial({ color: COLORS.wall })),
  pillar: () => mat('pillar', () => new THREE.MeshLambertMaterial({ color: COLORS.pillar })),
  book: () => mat('book', () => new THREE.MeshLambertMaterial({ color: COLORS.book })),
  altar: () =>
    mat('altar', () => new THREE.MeshLambertMaterial({ color: COLORS.altar, emissive: COLORS.altarGlow, emissiveIntensity: 0.7 })),
  wax: () => mat('wax', () => new THREE.MeshLambertMaterial({ color: COLORS.wax })),
  flame: () => mat('flame', () => new THREE.MeshBasicMaterial({ color: COLORS.flame })),
  doorEntry: () => mat('doorEntry', () => new THREE.MeshBasicMaterial({ color: COLORS.ash, transparent: true, opacity: 0.22 })),
  doorExit: () => mat('doorExit', () => new THREE.MeshBasicMaterial({ color: COLORS.doorExit, transparent: true, opacity: 0.55 })),
  gate: () => mat('gate', () => new THREE.MeshBasicMaterial({ color: COLORS.gate, transparent: true, opacity: 0.8 })),
};

const shared = {
  tile: new THREE.BoxGeometry(1, 1, 1),
  floor: new THREE.BoxGeometry(1, 0.2, 1),
  ink: new THREE.BoxGeometry(1, 0.06, 1),
  wall: new THREE.BoxGeometry(1, WALL_HEIGHT, 1),
  book: new THREE.BoxGeometry(0.92, 1.7, 0.92),
  pillar: new THREE.CylinderGeometry(0.34, 0.38, WALL_HEIGHT, 12),
  altar: new THREE.BoxGeometry(0.7, 0.7, 0.7),
  candle: new THREE.CylinderGeometry(0.07, 0.08, 0.34, 6),
  flame: new THREE.SphereGeometry(0.06, 6, 5),
  doorPanel: new THREE.PlaneGeometry(1, 2.2),
  gateBar: new THREE.BoxGeometry(0.08, 2.4, 0.08),
};

export interface CandleLight {
  x: number;
  z: number;
}

export interface BuiltRoom {
  group: THREE.Group;
  candles: CandleLight[];
  /** Locks or opens the exits. A locked door is solid and shows its gate. */
  setDoorsLocked(locked: boolean): void;
  /** Remove geometry and detach from the scene. Shared resources stay cached. */
  dispose(): void;
}

/** World position of a tile centre. Tile (x, y) spans [x, x+1) × [y, y+1) on the floor plane. */
export function tileCentre(x: number, y: number): THREE.Vector3 {
  return new THREE.Vector3(x + 0.5, 0, y + 0.5);
}

function instanced(geo: THREE.BufferGeometry, material: THREE.Material, count: number): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, count));
  mesh.count = count;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/** Builds the 3D room for a layout: instanced floors, walls, shelves, pillars, altars, candles and doors. */
export function buildRoom(layout: Layout): BuiltRoom {
  const group = new THREE.Group();
  group.name = `room:${layout.templateId}`;
  const m = new THREE.Matrix4();

  const buckets = {
    floor: [] as Array<[number, number]>,
    ink: [] as Array<[number, number]>,
    wall: [] as Array<[number, number]>,
    book: [] as Array<[number, number]>,
    pillar: [] as Array<[number, number]>,
    altar: [] as Array<[number, number]>,
  };

  for (let y = 0; y < layout.h; y++) {
    for (let x = 0; x < layout.w; x++) {
      const code = layout.tiles[y * layout.w + x];
      switch (code) {
        case T.FLOOR:
        case T.DOOR:
          buckets.floor.push([x, y]);
          break;
        case T.INK:
          buckets.ink.push([x, y]);
          break;
        case T.WALL:
          buckets.wall.push([x, y]);
          break;
        case T.BOOK:
          buckets.book.push([x, y]);
          break;
        case T.PILLAR:
          buckets.pillar.push([x, y]);
          break;
        case T.ALTAR:
          buckets.altar.push([x, y]);
          buckets.floor.push([x, y]);
          break;
        default:
          break;
      }
    }
  }

  const fill = (
    list: Array<[number, number]>,
    geo: THREE.BufferGeometry,
    material: THREE.Material,
    yOffset: number,
  ): THREE.InstancedMesh => {
    const mesh = instanced(geo, material, list.length);
    list.forEach(([x, y], i) => {
      m.makeTranslation(x + 0.5, yOffset, y + 0.5);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.updateMatrixWorld(true);
    group.add(mesh);
    return mesh;
  };

  fill(buckets.floor, shared.floor, roomMaterials.floor(), -0.1).receiveShadow = true;
  fill(buckets.ink, shared.ink, roomMaterials.ink(), -0.03).castShadow = false;
  fill(buckets.wall, shared.wall, roomMaterials.wall(), WALL_HEIGHT / 2);
  fill(buckets.book, shared.book, roomMaterials.book(), 0.85);
  fill(buckets.pillar, shared.pillar, roomMaterials.pillar(), WALL_HEIGHT / 2);
  fill(buckets.altar, shared.altar, roomMaterials.altar(), 0.35);

  const candles: CandleLight[] = [];
  for (const c of layout.candles) {
    const candle = new THREE.Mesh(shared.candle, roomMaterials.wax());
    candle.position.set(c.x + 0.5, 0.17, c.y + 0.5);
    candle.castShadow = true;
    const flame = new THREE.Mesh(shared.flame, roomMaterials.flame());
    flame.position.set(c.x + 0.5, 0.42, c.y + 0.5);
    group.add(candle, flame);
    candles.push({ x: c.x + 0.5, z: c.y + 0.5 });
  }

  const doorMeshes: Array<{ door: DoorSpec; panel: THREE.Mesh; gate: THREE.Mesh }> = [];
  for (const door of layout.doors) {
    const panel = new THREE.Mesh(
      shared.doorPanel,
      door.role === 'entry' ? roomMaterials.doorEntry() : roomMaterials.doorExit(),
    );
    const gate = new THREE.Mesh(shared.gateBar, roomMaterials.gate());
    const place = (obj: THREE.Object3D): void => {
      obj.position.set(door.x + 0.5, 1.1, door.y + 0.5);
      group.add(obj);
    };
    // Panels sit on the threshold, facing into the room.
    // A plane faces +Z by default. Each rotation turns it to face into the room.
    const inwardRot = { N: 0, E: -Math.PI / 2, S: Math.PI, W: Math.PI / 2 }[door.side];
    place(panel);
    panel.rotation.y = inwardRot;
    panel.translateZ(0.02);
    place(gate);
    gate.visible = false;
    doorMeshes.push({ door, panel, gate });
  }

  return {
    group,
    candles,
    setDoorsLocked(locked: boolean): void {
      for (const d of doorMeshes) {
        d.gate.visible = locked;
        (d.panel.material as THREE.MeshBasicMaterial).opacity = locked ? 0.12 : 0.55;
      }
    },
    dispose(): void {
      group.traverse((obj) => {
        if (obj instanceof THREE.InstancedMesh) obj.dispose();
      });
      group.clear();
    },
  };
}
