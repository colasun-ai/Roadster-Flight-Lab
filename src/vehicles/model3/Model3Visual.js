import * as THREE from 'three';

// A reusable, physics-independent view of the original GLB. No event handlers,
// animation loop, timers, physics bodies, or replacement geometry are created.
export class Model3Visual {
  constructor(root, metadata) {
    this.root = root;
    this.metadata = metadata;
    this.disposed = false;
    this.elapsed = 0;this.previousLightKey=null;this.scratchQuaternion=new THREE.Quaternion();
    this.lastSpeed = 0;
    this.lightState = {headlights: false, brake: false, reverse: false, indicator: 'off'};
    this.ownedMaterials = new Set();
    this.ownedObjects = new Set();
    this.materialHomes = new Map();
    this.shadowHomes = new Map();
    this.wheels = metadata.wheels.map(w => {
      const suspension = root.getObjectByName(w.suspensionNode || `Wheel_${w.id}_Suspension`);
      const steering = w.steeringNode ? root.getObjectByName(w.steeringNode) : null;
      const rotation = root.getObjectByName(w.rotationNode || `Wheel_${w.id}_Rotation`);
      if (!suspension || !rotation) throw new Error(`Model 3 wheel rig missing ${w.id}`);
      return {id: w.id, suspension, steering, rotation, homeY: suspension.position.y,
        steeringHome: steering?.quaternion.clone(), rotationHome: rotation.quaternion.clone()};
    });
    this.interactions = new Map();
    for (const [id, definition] of Object.entries(metadata.interactions || {})) {
      const node = root.getObjectByName(definition.node);
      if (!node) continue;
      this.interactions.set(id, {node, definition, home: node.quaternion.clone(),
        axis: new THREE.Vector3(...definition.axis).normalize(), angle: 0, target: 0});
    }
    // Only runtime light/glass materials are cloned. Shared cached GLB materials
    // are restored verbatim on disposal; maps/geometries are never disposed here.
    this.lightMeshes = {};
    for (const [kind, names] of Object.entries(metadata.lights || {})) {
      this.lightMeshes[kind] = names.map(name => root.getObjectByName(name)).filter(Boolean);
      for (const node of this.lightMeshes[kind]) {this.cloneMaterial(node);for(const material of (Array.isArray(node.material)?node.material:[node.material])){material.emissiveMap=null;material.emissiveIntensity=0;material.emissive?.setHex(0);material.needsUpdate=true;}}
    }
    root.traverse(node => {
      if (!node.isMesh) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      if (materials.some(m => m?.transparent||m?.transmission>0)) {
        this.shadowHomes.set(node, {castShadow:node.castShadow,receiveShadow:node.receiveShadow});
        node.castShadow = false; node.receiveShadow = false;
      }
      if (materials.some(m => /^glass\.|^tembus_red/.test(m?.name || ''))) {
        this.cloneMaterial(node);
        const clones = Array.isArray(node.material) ? node.material : [node.material];
        // The source windscreen has inner and outer transparent surfaces. A
        // 0.62–0.66 alpha on both makes the cockpit excessively opaque.
        clones.forEach(m => { if (m.transparent) { m.depthWrite = false; m.opacity = Math.min(m.opacity, /^tembus_red/.test(m.name)?0.18:0.24); } });
      }
    });
    const emitters = metadata.headlightEmitters || [-0.58, 0.58].map(x => ({position:[x,0.65,1.87]}));
    this.headlightBeams = emitters.map(({position}) => {
      const [x,y,z] = position;
      const beam = new THREE.SpotLight(0xe6f3ff, 38, 42, 0.31, 0.55, 1.5);
      beam.name = `Model3_Headlight_Beam_${x > 0 ? 'L' : 'R'}`;
      beam.position.set(x, y, z + 0.005);
      beam.target.position.set(x, 0.08, 24);
      beam.castShadow = false;
      root.add(beam, beam.target);
      this.ownedObjects.add(beam); this.ownedObjects.add(beam.target);
      return beam;
    });
    this.refreshLights();
  }

  cloneMaterial(node) {
    if (this.materialHomes.has(node) || !node.material) return;
    this.materialHomes.set(node, node.material);
    const clone = m => { const result = m.clone(); this.ownedMaterials.add(result); return result; };
    node.material = Array.isArray(node.material) ? node.material.map(clone) : clone(node.material);
  }

  setInteraction(id, open) {
    const aliases = {doorFL:'door_fl', doorFR:'door_fr', doorRL:'door_rl', doorRR:'door_rr'};
    id = aliases[id] || id;
    const part = this.interactions.get(id);
    if (this.disposed || !part || id === 'steering_wheel') return false;
    // A closing request is always allowed; opening is restricted to a parked car.
    if (open && this.lastSpeed > 0.5) return false;
    part.target = open ? THREE.MathUtils.degToRad(part.definition.maxAngleDegrees) : 0;
    return true;
  }

  setLights(state = {}) {
    if (this.disposed) return;
    this.lightState = {...this.lightState, ...state};
  }

  refreshLights() {
    const state = this.lightState;
    for (const beam of this.headlightBeams || []) beam.visible = !!state.headlights;
    const flashing = Math.floor(this.elapsed / 0.4) % 2 === 0;
    const left = state.indicator === 'left' || state.indicator === 'hazard' || state.indicator === 'both';
    const right = state.indicator === 'right' || state.indicator === 'hazard' || state.indicator === 'both';
    const settings = {
      headlights: [!!state.headlights, 0xe6f3ff, 3.4],
      brake: [!!state.brake, 0xff1806, 3.1],
      reverse: [!!state.reverse, 0xe8f1ff, 2.8],
      indicatorLeft: [left && flashing, 0xff8d04, 3.6],
      indicatorRight: [right && flashing, 0xff8d04, 3.6],
    };
    const key=[...Object.values(settings).flat()].join('|');if(key===this.previousLightKey)return;this.previousLightKey=key;
    for (const [kind, meshes] of Object.entries(this.lightMeshes)) {
      const setting = settings[kind];
      if (!setting) continue;
      for (const mesh of meshes) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const original = this.materialHomes.get(mesh);
        const originals = Array.isArray(original) ? original : [original];
        materials.forEach((material, i) => {
          if (!material.emissive) return;
          if (setting[0]) { material.emissive.setHex(setting[1]); material.emissiveIntensity = setting[2]; }
          else {
            material.emissive.setHex(0);material.emissiveIntensity=0;
          }
        });
      }
    }
  }

  update(vehicle, dt = 0) {
    if (this.disposed) return;
    this.elapsed += Math.max(0, dt);
    this.lastSpeed = Math.abs(vehicle.forwardSpeed?.() ?? 0);
    for (const rig of this.wheels) {
      const w = vehicle.wheels.find(wheel => wheel.id === rig.id);
      if (!w) continue;
      rig.suspension.position.y = rig.homeY + w.compression;
      rig.rotation.rotation.x = w.angle;
      if (rig.steering) rig.steering.rotation.y = w.steer;
    }
    const smoothing = 1 - Math.exp(-7 * Math.max(0, dt));
    for (const [id, part] of this.interactions) {
      if (id === 'steering_wheel') part.angle = -(vehicle.steer || 0) * 14;
      else {
        if (this.lastSpeed > 0.5) part.target = 0;
        part.angle += (part.target - part.angle) * smoothing;
      }
      part.node.quaternion.copy(part.home).multiply(this.scratchQuaternion.setFromAxisAngle(part.axis, part.angle));
    }
    this.refreshLights();
  }

  telemetry() {
    return {lampEmission:Object.fromEntries(Object.entries(this.lightMeshes).map(([kind,meshes])=>[kind,meshes.map(n=>({name:n.name,intensity:n.material.emissiveIntensity,color:n.material.emissive?.getHex()}))])),ownedMaterials: this.ownedMaterials.size, ownedObjects: this.ownedObjects.size, lights: {...this.lightState},
      interactions: Object.fromEntries([...this.interactions].map(([id,p]) => [id,{angleDegrees:THREE.MathUtils.radToDeg(p.angle),targetDegrees:THREE.MathUtils.radToDeg(p.target)}])),
      wheels:this.wheels.map(w => ({id:w.id,roll:w.rotation.rotation.x,steer:w.steering?.rotation.y || 0,suspension:w.suspension.position.y-w.homeY}))};
  }

  dispose() {
    if (this.disposed) return;
    for (const rig of this.wheels) {
      rig.suspension.position.y = rig.homeY;
      rig.rotation.quaternion.copy(rig.rotationHome);
      if (rig.steering) rig.steering.quaternion.copy(rig.steeringHome);
    }
    for (const part of this.interactions.values()) part.node.quaternion.copy(part.home);
    for (const [node, original] of this.materialHomes) node.material = original;
    for (const [node, original] of this.shadowHomes) Object.assign(node, original);
    for (const material of this.ownedMaterials) material.dispose();
    for (const object of this.ownedObjects) { object.removeFromParent(); object.dispose?.(); }
    this.materialHomes.clear(); this.ownedMaterials.clear();
    this.shadowHomes.clear();
    this.ownedObjects.clear();
    this.disposed = true;
  }
}

export default Model3Visual;
