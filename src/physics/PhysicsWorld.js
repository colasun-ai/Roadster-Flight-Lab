import RAPIER from '@dimforge/rapier3d-compat';
import {config} from '../vehicle/VehicleConfig.js';
import {makeTrack} from '../world/TestTrack.js';
export async function createWorld(){
  await RAPIER.init();
  const world=new RAPIER.World({x:0,y:-config.gravity,z:0});world.timestep=config.dt;
  world.integrationParameters.numSolverIterations=8;
  const track=makeTrack(world);return {world,track};
}
