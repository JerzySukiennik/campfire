// Rapier physics wrapper with fixed 60 Hz stepping.
import RAPIER from 'rapier';

export class Physics {
  static async create() {
    await RAPIER.init();
    return new Physics();
  }

  constructor() {
    this.R = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
    this.acc = 0;
    const ground = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(40, 0.5, 40).setFriction(0.9), ground);
  }

  fixedHull(points, friction = 0.8) {
    const b = this.world.createRigidBody(this.R.RigidBodyDesc.fixed());
    const d = this.R.ColliderDesc.convexHull(points);
    if (d) this.world.createCollider(d.setFriction(friction), b);
    return b;
  }

  fixedBox(pos, half, quat) {
    const bd = this.R.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z);
    if (quat) bd.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    const b = this.world.createRigidBody(bd);
    this.world.createCollider(this.R.ColliderDesc.cuboid(half.x, half.y, half.z).setFriction(0.8), b);
    return b;
  }

  fixedCylinder(pos, halfH, r, quat) {
    const bd = this.R.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z);
    if (quat) bd.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    const b = this.world.createRigidBody(bd);
    this.world.createCollider(this.R.ColliderDesc.cylinder(halfH, r).setFriction(0.8), b);
    return b;
  }

  step(dt, before) {
    this.acc += Math.min(dt, 0.1);
    let n = 0;
    while (this.acc >= 1 / 60 && n < 4) {
      before?.(1 / 60);
      this.world.step();
      this.acc -= 1 / 60;
      n++;
    }
    return n;
  }
}
