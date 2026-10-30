import { Enemy, type AttackDef, type EnemyContext, type EnemyEvent, PHASE_TWO_ATTACKS, TRANSITION_TIME } from './enemies';

/**
 * The Scribe. Phase one is the Seal Keeper: three seal plates act as armour, and
 * the attacks are deliberate and telegraphed. Below half health the book tears
 * open (Unbound): the plates fall away, the core is exposed, and the attacks are
 * faster and more chaotic. A short invulnerable transition marks the change.
 */
export class Boss extends Enemy {
  phaseTwo = false;

  constructor(x: number, z: number) {
    super('boss', x, z);
  }

  protected attackList(): readonly AttackDef[] {
    return this.phaseTwo ? PHASE_TWO_ATTACKS : this.def.attacks;
  }

  get phaseName(): string {
    return this.phaseTwo ? 'Unbound' : 'Seal Keeper';
  }

  update(dt: number, ctx: EnemyContext): EnemyEvent[] {
    if (this.stage === 'dead') return [];
    if (!this.phaseTwo && this.hp <= this.def.hp * 0.5) {
      this.phaseTwo = true;
      this.attack = null;
      this.armor = 0;
      this.coreExposed = true;
      this.cooldowns.clear();
      this.setStage('transition');
      return [{ type: 'phase', enemy: this, phase: 2 }];
    }
    if (this.stage === 'transition') {
      this.t += dt;
      this.hurtT += dt;
      this.faceTowards(ctx.player.x, ctx.player.z, dt, 4);
      if (this.t >= TRANSITION_TIME) this.setStage('chase');
      return [];
    }
    return super.update(dt, ctx);
  }
}
