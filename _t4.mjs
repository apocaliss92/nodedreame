import { readFileSync } from 'node:fs'
import { Nodreame, VacuumDevice } from './dist/index.js'
function le(p){const o={};for(const l of readFileSync(p,'utf8').split('\n')){const m=l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);if(m&&!l.trim().startsWith('#'))o[m[1]]=m[2]}return o}
const e=le('./.env'); const r=(e.DREAME_COUNTRY??'eu').toLowerCase()
const c=new Nodreame({username:e.DREAME_USERNAME,password:e.DREAME_PASSWORD,region:['eu','us','cn'].includes(r)?r:'eu',fetchInitialValues:false})
await c.login(); const ds=await c.discoverDevices()
const d=ds.find(x=>x instanceof VacuumDevice && x.deviceId==='996872505') || ds.find(x=>x instanceof VacuumDevice)
await d.refreshCachedProperties([{siid:6,piid:3}]); console.log('file:', d.mapFilename)
try{ const m=await d.fetchLatestMap(); console.log('DECODED:', m && {w:m.width,h:m.height,seg:m.segments?.length,ft:m.frameType}) }catch(err){ console.log('threw:', err.message) }
