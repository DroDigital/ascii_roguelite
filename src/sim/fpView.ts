import * as THREE from 'three';

/** Eye height above the floor, in world units. */
export const EYE_HEIGHT = 1.55;
const PITCH_LIMIT = (70 * Math.PI) / 180;

export interface ViewScales {
  /** Multiplies shake amplitude. Zero under reduced motion. */
  shake: number;
  /** Multiplies head bob and strafe roll. */
  bob: number;
}

/**
 * First-person camera rig. Holds yaw and pitch, and layers head bob, strafe
 * roll, dodge FOV and deterministic shake on top. Shake uses sines rather
 * than random numbers so a replayed run looks the same.
 */
export class FirstPersonView {
  yaw = 0;
  pitch = 0;
  readonly baseFov = 60;
  private kickPitch = 0;
  private kickYaw = 0;
  private kickRoll = 0;
  private shakeLevel = 0;
  private time = 0;
  private bobPhase = 0;
  private bobLevel = 0;
  private strafeRoll = 0;
  private fovExtra = 0;
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(readonly camera: THREE.PerspectiveCamera) {
    camera.fov = this.baseFov;
    camera.updateProjectionMatrix();
  }

  /** Turns the view. Positive dx turns right, positive dy looks down. */
  look(dx: number, dy: number, sensitivity: number): void {
    this.yaw -= dx * sensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * sensitivity, -PITCH_LIMIT, PITCH_LIMIT);
  }

  setLook(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = THREE.MathUtils.clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT);
  }

  /** Unit vector on the ground plane in the direction the player faces. */
  forward(): { x: number; z: number } {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }

  /** Unit vector on the ground plane to the player's right. */
  right(): { x: number; z: number } {
    return { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) };
  }

  /** Brief camera kick from a hit or a heavy swing. Angles in radians. */
  kick(pitch: number, yaw: number, roll: number): void {
    this.kickPitch += pitch;
    this.kickYaw += yaw;
    this.kickRoll += roll;
  }

  /** Adds shake. Levels combine by taking the larger value. */
  shake(level: number): void {
    this.shakeLevel = Math.max(this.shakeLevel, level);
  }

  /** Widens the FOV by `extra` degrees, which decays on its own. */
  widen(extra: number): void {
    this.fovExtra = Math.max(this.fovExtra, extra);
  }

  update(dt: number, eyeX: number, eyeZ: number, speed: number, strafe: number, scales: ViewScales): void {
    this.time += dt;
    const decay = (v: number, rate: number): number => v * Math.exp(-dt * rate);
    this.kickPitch = decay(this.kickPitch, 9);
    this.kickYaw = decay(this.kickYaw, 9);
    this.kickRoll = decay(this.kickRoll, 9);
    this.shakeLevel = decay(this.shakeLevel, 6);
    this.fovExtra = decay(this.fovExtra, 7);
    this.strafeRoll = THREE.MathUtils.lerp(this.strafeRoll, strafe, 1 - Math.exp(-dt * 10));

    const moving = speed > 0.3 ? 1 : 0;
    this.bobLevel = THREE.MathUtils.lerp(this.bobLevel, moving, 1 - Math.exp(-dt * 8));
    this.bobPhase += dt * (6 + speed * 0.9) * this.bobLevel;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.05 * this.bobLevel * scales.bob;

    const s = this.shakeLevel * scales.shake;
    const shakeX = (Math.sin(this.time * 61.3) + Math.sin(this.time * 37.7) * 0.6) * 0.04 * s;
    const shakeY = (Math.sin(this.time * 53.9) + Math.cos(this.time * 29.1)) * 0.03 * s;
    const shakeYaw = Math.sin(this.time * 44.1) * 0.02 * s;

    const cam = this.camera;
    cam.position.set(eyeX + shakeX, EYE_HEIGHT + bobY + shakeY, eyeZ);
    this.euler.set(
      this.pitch + this.kickPitch + shakeY * 0.2,
      this.yaw + this.kickYaw + shakeYaw,
      this.kickRoll - this.strafeRoll * 0.035 * scales.bob,
      'YXZ',
    );
    cam.quaternion.setFromEuler(this.euler);
    const fov = this.baseFov + this.fovExtra * 10;
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }
}
