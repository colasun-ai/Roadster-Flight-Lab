import {createVehicle} from './VehicleFactory.js';
// One Rapier world, at most one active dynamic chassis. Visual preparation may
// be cached; non-active physics sessions are always destroyed, never cached.
export class VehicleSwitcher{
  constructor(world,{prepare=async()=>null,mount=()=>{},unmount=()=>{},onPhase=()=>{}}={}){Object.assign(this,{world,prepare,mount,unmount,onPhase});this.active=null;this.sequence=Promise.resolve();this.busy=false;this.switches=[];this.disposed=false;this.generation=0;}
  switchTo(id,options={}){if(this.disposed)return Promise.reject(Error('Vehicle switcher disposed'));const next=this.sequence.then(()=>this.perform(id,options));this.sequence=next.catch(()=>{});return next;}
  async perform(id,options){
    if(this.disposed)throw Error('Vehicle switcher disposed');const generation=this.generation;
    this.busy=true;this.onPhase('loading',id);const start=performance.now(),previous=this.active;
    previous?.halt();
    try{
      const visual=await this.prepare(id);
      if(this.disposed||generation!==this.generation)throw Error('Vehicle switch cancelled');
      const oldHandle=previous?.vehicle.body.handle;
      if(previous){this.unmount(previous);previous.dispose();this.active=null;}
      // Rapier may reuse a freed numeric handle for the next chassis. Check
      // removal before creating it, rather than mistaking reuse for a leak.
      const oldHandleRemoved=oldHandle===undefined||!this.world.getRigidBody(oldHandle);
      const active=createVehicle(this.world,id,options);this.active=active;
      try{await this.mount(active,visual);if(this.disposed||generation!==this.generation)throw Error('Vehicle switch cancelled');}catch(error){if(!active.disposed){try{this.unmount(active);}finally{active.dispose();if(this.active===active)this.active=null;}}throw error;}
      const record={from:previous?.id??null,to:id,milliseconds:performance.now()-start,bodies:this.world.bodies.len(),colliders:this.world.colliders.len(),oldHandleRemoved};
      this.switches.push(record);if(this.switches.length>120)this.switches.shift();this.onPhase('ready',id);return active;
    }catch(error){if(!this.disposed)this.onPhase('error',id,error);throw error;}finally{this.busy=false;}
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.generation++;if(this.active){this.unmount(this.active);this.active.dispose();this.active=null;}}
}
