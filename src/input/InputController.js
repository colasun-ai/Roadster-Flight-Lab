const editable=target=>!!target&&(['INPUT','SELECT','TEXTAREA'].includes(target.tagName)||target.isContentEditable);
export class InputController{
  static instances=0;
  static listeners=0;
  constructor(canvas,actions){
    this.keys=new Set();this.canvas=canvas;this.enabled=true;this.flightEnabled=true;this.disposed=false;this.bindings=[];
    InputController.instances++;
    const hotkeys={KeyR:'reset',KeyC:'camera',KeyP:'pause',KeyH:'hover',KeyT:'mode',KeyG:'infinite',KeyL:'headlights',KeyZ:'leftIndicator',KeyX:'hazards',KeyV:'rightIndicator',Escape:'garage'};
    const flightKeys=new Set(['KeyH','KeyG','KeyJ','KeyK','KeyQ','KeyE','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyQ','KeyE','ShiftLeft','ShiftRight']);
    const controls=new Set(['KeyW','KeyA','KeyS','KeyD','Space',...flightKeys,...Object.keys(hotkeys)]);
    this.keydown=e=>{
      // Preserve OS shortcuts and release driving input if the OS consumes keyup.
      if(e.metaKey||e.ctrlKey||e.altKey){this.clear();return;}
      if(editable(e.target)){this.clear();return;}
      if(e.code==='Escape'){if(e.repeat)return;e.preventDefault();actions.garage?.();this.clear();return;}
      if(!this.enabled||(!this.flightEnabled&&flightKeys.has(e.code)))return;
      if(controls.has(e.code)){
        e.preventDefault();const held=this.keys.has(e.code);this.keys.add(e.code);
        // Some native platforms deliver the flag without a separate Shift event.
        if(this.flightEnabled&&e.shiftKey)this.keys.add('ShiftLeft');
        if(!e.repeat&&!held)actions[hotkeys[e.code]]?.();
      }
    };
    this.keyup=e=>{this.keys.delete(e.code);if(e.shiftKey===false){this.keys.delete('ShiftLeft');this.keys.delete('ShiftRight');}if(e.metaKey||e.ctrlKey||e.altKey)this.clear();};
    this.blur=()=>this.clear();this.focusin=e=>{if(e.target!==this.canvas)this.clear();};
    this.visibility=()=>{if(globalThis.document?.hidden)this.clear();};
    const bind=(target,type,handler)=>{if(!target?.addEventListener)return;target.addEventListener(type,handler);this.bindings.push([target,type,handler]);InputController.listeners++;};
    bind(window,'keydown',this.keydown);bind(window,'keyup',this.keyup);bind(window,'blur',this.blur);bind(window,'pagehide',this.blur);
    bind(globalThis.document,'focusin',this.focusin);bind(globalThis.document,'visibilitychange',this.visibility);
  }
  read(){if(!this.enabled||editable(globalThis.document?.activeElement))return {};const k=this.keys;return {drive:Number(k.has('KeyW'))-Number(k.has('KeyS')),steer:Number(k.has('KeyA'))-Number(k.has('KeyD')),handbrake:k.has('Space'),boost:this.flightEnabled&&(k.has('ShiftLeft')||k.has('ShiftRight')),lift:this.flightEnabled?Number(k.has('KeyJ')):0,descend:this.flightEnabled?Number(k.has('KeyK')):0,pitch:this.flightEnabled?Number(k.has('ArrowDown'))-Number(k.has('ArrowUp')):0,roll:this.flightEnabled?Number(k.has('ArrowRight'))-Number(k.has('ArrowLeft')):0,yaw:this.flightEnabled?Number(k.has('KeyQ'))-Number(k.has('KeyE')):0};}
  clear(){this.keys.clear();}
  setEnabled(value){this.enabled=value;this.clear();}
  setCapabilities(capabilities){this.flightEnabled=!!capabilities.flight;this.clear();}
  telemetry(){return {controllers:InputController.instances,listeners:InputController.listeners,enabled:this.enabled,heldKeys:[...this.keys]};}
  dispose(){if(this.disposed)return;for(const [target,type,fn]of this.bindings){target.removeEventListener(type,fn);InputController.listeners--;}this.bindings.length=0;InputController.instances--;this.clear();this.disposed=true;}
}
