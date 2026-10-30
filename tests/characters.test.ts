import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EnemyView } from '../src/model/characters';
import { mats } from '../src/model/materials';
import { Enemy } from '../src/sim/enemies';

/** Colours of the basic (unlit) materials under a view, which are its glowing parts. */
function glowColours(view: EnemyView): number[] {
  const colours: number[] = [];
  view.root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshBasicMaterial) colours.push(o.material.color.getHex());
  });
  return colours;
}

describe('enemy views', () => {
  it('each husk keeps its own eye glow when several are on screen', () => {
    const winding = new Enemy('husk', 0, 0);
    winding.setStage('windup');
    const calm = new Enemy('husk', 1, 0);
    calm.setStage('chase');
    const a = new EnemyView(winding);
    const b = new EnemyView(calm);
    a.sync(1 / 60, 0);
    b.sync(1 / 60, 0);
    // Each view writes its own glow, so the windup stays visible after the calm husk syncs last.
    expect(glowColours(a)[0]).not.toBe(glowColours(b)[0]);
  });

  it('an acolyte does not recolour the cyan material shared with other parts', () => {
    const before = mats.cyan().color.getHex();
    const acolyte = new Enemy('acolyte', 0, 0);
    acolyte.setStage('windup');
    new EnemyView(acolyte).sync(1 / 60, 0);
    expect(mats.cyan().color.getHex()).toBe(before);
  });
});
