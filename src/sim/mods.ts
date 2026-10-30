/**
 * Every number an upgrade can change, with its base value. Upgrades write into
 * a fresh Mods object each time one is picked, so combinations stay derived
 * and never accumulate drift.
 */
export interface Mods {
  maxHp: number;
  dodgeCharges: number;
  damageMul: number;
  glaive: {
    damageMul: number;
    arcMul: number;
    rangeMul: number;
    recoverMul: number;
    /** Hits set enemies burning. */
    ignite: boolean;
    /** Hits remove one armour layer. */
    breakArmor: boolean;
    /** The first swing after a dodge deals bonus damage and staggers. */
    riposte: boolean;
    /** Breaking armour with the glaive also exposes the core for two seconds (Unshelled). */
    unshelled: boolean;
  };
  quill: {
    damageMul: number;
    cadenceMul: number;
    pierce: number;
    fan: number;
    /** Starfall: the fan spreads wider, and bolts pierce. */
    starfall: boolean;
  };
  /** Burning enemies burst on death. */
  kindling: boolean;
  /** Pyre: ignited enemies that die detonate and spread ignition (needs Ember Edge and Kindling). */
  pyre: boolean;
  tear: {
    cooldownMul: number;
    chargeMul: number;
    fragments: number;
    fragmentLifeAdd: number;
    fragmentIntervalMul: number;
    coreMul: number;
    /** Orbit Storm: fragments fire the moment the tear is released. */
    orbitStorm: boolean;
  };
  dodge: {
    cooldownMul: number;
    distanceMul: number;
    /** Blank Step: the dodge trail damages enemies it crosses. */
    trailDamage: number;
    /** Mirror Step: trail hits count as dodges for Riposte. */
    mirrorStep: boolean;
  };
  shardMul: number;
  /** Ink Famine: no healing except Mend, and no health motes drop. */
  inkFamine: boolean;
}

export function baseMods(): Mods {
  return {
    maxHp: 100,
    dodgeCharges: 1,
    damageMul: 1,
    glaive: {
      damageMul: 1,
      arcMul: 1,
      rangeMul: 1,
      recoverMul: 1,
      ignite: false,
      breakArmor: false,
      riposte: false,
      unshelled: false,
    },
    quill: { damageMul: 1, cadenceMul: 1, pierce: 0, fan: 1, starfall: false },
    kindling: false,
    pyre: false,
    tear: {
      cooldownMul: 1,
      chargeMul: 1,
      fragments: 4,
      fragmentLifeAdd: 0,
      fragmentIntervalMul: 1,
      coreMul: 1.4,
      orbitStorm: false,
    },
    dodge: { cooldownMul: 1, distanceMul: 1, trailDamage: 0, mirrorStep: false },
    shardMul: 1,
    inkFamine: false,
  };
}
