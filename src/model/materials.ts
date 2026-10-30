import * as THREE from 'three';

/**
 * Shared character and prop materials. Hue carries meaning: ivory is the world,
 * ember marks danger, amber marks gilded and resource pieces, and cyan marks
 * abilities. Per-enemy flash colours are cloned from these, so a hit on one
 * enemy never changes the others.
 */
const cache = new Map<string, THREE.Material>();

function shared<T extends THREE.Material>(key: string, make: () => T): T {
  let m = cache.get(key);
  if (!m) {
    m = make();
    cache.set(key, m);
  }
  return m as T;
}

export const mats = {
  ivory: () => shared('ivory', () => new THREE.MeshLambertMaterial({ color: 0xcfc6ab })),
  ivoryBright: () => shared('ivoryBright', () => new THREE.MeshLambertMaterial({ color: 0xf0e7d0, emissive: 0x3a3428, emissiveIntensity: 0.5 })),
  bone: () => shared('bone', () => new THREE.MeshLambertMaterial({ color: 0x9a927c })),
  robe: () => shared('robe', () => new THREE.MeshLambertMaterial({ color: 0x2f2a22 })),
  dark: () => shared('dark', () => new THREE.MeshLambertMaterial({ color: 0x17140f })),
  stone: () => shared('stone', () => new THREE.MeshLambertMaterial({ color: 0x6f695b })),
  gilded: () => shared('gilded', () => new THREE.MeshLambertMaterial({ color: 0xa67a2a, emissive: 0x3d2a08, emissiveIntensity: 0.9 })),
  ember: () => shared('ember', () => new THREE.MeshBasicMaterial({ color: 0xff5a3c })),
  cyan: () => shared('cyan', () => new THREE.MeshBasicMaterial({ color: 0x5fe6e0 })),
  amber: () => shared('amber', () => new THREE.MeshBasicMaterial({ color: 0xffb84a })),
};

/** A per-instance copy of a material, so flashes and fades touch one character only. */
export function cloneMat(base: THREE.Material): THREE.Material {
  return base.clone();
}

/** Shared geometries, built once. */
export const geo = {
  unitBox: new THREE.BoxGeometry(1, 1, 1),
  unitSphere: new THREE.SphereGeometry(1, 14, 10),
  unitCylinder: new THREE.CylinderGeometry(1, 1, 1, 10),
  unitCone: new THREE.ConeGeometry(1, 1, 8),
  unitTorus: new THREE.TorusGeometry(1, 0.08, 6, 20),
};

/** A mesh from a shared unit geometry, scaled and placed. */
export function part(
  g: THREE.BufferGeometry,
  m: THREE.Material,
  pos: [number, number, number] = [0, 0, 0],
  size: [number, number, number] = [1, 1, 1],
  rot: [number, number, number] = [0, 0, 0],
): THREE.Mesh {
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.scale.set(size[0], size[1], size[2]);
  mesh.rotation.set(rot[0], rot[1], rot[2]);
  mesh.castShadow = true;
  return mesh;
}
