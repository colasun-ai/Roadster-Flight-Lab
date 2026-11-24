import assert from 'node:assert/strict';
import fs from 'node:fs';
import {InputController} from '../src/input/InputController.js';
import {VehicleSwitcher} from '../src/vehicles/VehicleSwitcher.js';
import {createWorld} from '../src/physics/PhysicsWorld.js';
const tests=[];
const test=async(name,fn)=>{try{await fn();tests.push({name,passed:true});}catch(e){tests.push({name,passed:false,error:e.stack});}};
const windowMock=new EventTarget(),documentMock=new EventTarget();documentMock.activeElement=null;documentMock.hidden=false;
globalThis.window=windowMock;globalThis.document=documentMock;
let actions=0;const canvas={tagName:'CANVAS'},input=new InputController(canvas,{garage:()=>actions++});
function emit(type,code,extra={}){const event=new Event(type,{cancelable:true});Object.assign(event,{code,repeat:false,shiftKey:false,...extra});Object.defineProperty(event,'target',{value:extra.target||canvas});windowMock.dispatchEvent(event);return event;}
await test('escape repeat only opens once',()=>{emit('keydown','Escape');for(let i=0;i<9;i++)emit('keydown','Escape',{repeat:true});assert.equal(actions,1);});
await test('Meta/Ctrl/Alt shortcuts release drive without consuming shortcut',()=>{for(const modifier of ['metaKey','ctrlKey','altKey']){emit('keydown','KeyW');assert.equal(input.read().drive,1);const e=emit('keydown','KeyW',{[modifier]:true});assert.equal(e.defaultPrevented,false);assert.equal(input.read().drive,0);}});
await test('focus/hidden/blur/pagehide release throttle',()=>{for(const type of ['focusin','visibilitychange','blur','pagehide']){emit('keydown','KeyW');assert.equal(input.read().drive,1);if(type==='focusin'){const e=new Event(type);Object.defineProperty(e,'target',{value:{tagName:'INPUT'}});documentMock.dispatchEvent(e);}else if(type==='visibilitychange'){documentMock.hidden=true;documentMock.dispatchEvent(new Event(type));documentMock.hidden=false;}else windowMock.dispatchEvent(new Event(type));assert.equal(input.read().drive,0);}});
await test('Shift modifier flag supports rear boost, releases on keyup, disabled for ground-only car',()=>{emit('keydown','KeyW',{shiftKey:true});assert.equal(input.read().boost,true);emit('keyup','KeyW');assert.equal(input.read().boost,false);input.setCapabilities({flight:false});emit('keydown','KeyW',{shiftKey:true});assert.equal(input.read().drive,1);assert.equal(input.read().boost,false);});
await test('input disposal removes all registered listeners exactly once',()=>{assert.equal(input.telemetry().controllers,1);assert.equal(input.telemetry().listeners,6);input.dispose();input.dispose();assert.equal(InputController.instances,0);assert.equal(InputController.listeners,0);});
await test('switch disposal during pending load never resurrects a body',async()=>{const {world}=await createWorld();let resolve;const base=world.colliders.len();const s=new VehicleSwitcher(world,{prepare:()=>new Promise(r=>resolve=r)});const pending=s.switchTo('roadster');await new Promise(r=>setTimeout(r,0));s.dispose();resolve({});await assert.rejects(pending,/cancelled/);assert.equal(s.active,null);assert.equal(world.bodies.len(),0);assert.equal(world.colliders.len(),base);await assert.rejects(s.switchTo('roadster'),/disposed/);world.free();});
const report={at:new Date().toISOString(),passed:tests.every(t=>t.passed),tests};fs.writeFileSync('reports/input-lifecycle-v07.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
