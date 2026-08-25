import type { PreviewRuntimeCapability } from '@open-design/contracts/runtime/preview-runtime';
import type { PreviewRuntimeModuleSource } from './preview-runtime-bootstrap.js';

function scriptBody(scriptTag: string): string {
  const match = scriptTag.match(/^<script\b[^>]*>([\s\S]*)<\/script>$/iu);
  if (!match?.[1]) throw new TypeError('preview runtime module must be built from one script element');
  return match[1];
}

/** Install a passive bridge before authored startup and expose its negotiated identity. */
export function buildInstalledScriptRuntimeModule(
  capability: PreviewRuntimeCapability,
  scriptTag: string,
  marker: string,
): PreviewRuntimeModuleSource {
  return {
    capabilities: [capability],
    source: `/* ${marker} */\n${scriptBody(scriptTag)}\n`
      + `register(${JSON.stringify(capability)},function(){return {enable:function(){},disable:function(){}};});`,
  };
}

/** Install an interaction bridge at first enable; subsequent toggles never reinstall listeners. */
export function buildLazyScriptRuntimeModule(
  capability: PreviewRuntimeCapability,
  scriptTag: string,
  marker: string,
): PreviewRuntimeModuleSource {
  return {
    capabilities: [capability],
    source: `/* ${marker} */\nregister(${JSON.stringify(capability)},function(){\n`
      + `var installed=false;return {enable:function(){if(installed)return;installed=true;\n`
      + `${scriptBody(scriptTag)}\n},disable:function(){}};});`,
  };
}

/**
 * Scroll restoration and content measurement share DOM observers, so they are
 * installed as one module while retaining independently negotiated switches.
 */
export function buildScrollAndMeasurementRuntimeModule(): PreviewRuntimeModuleSource {
  return {
    capabilities: ['content_measurement', 'scroll'],
    source: String.raw`
var scrollEnabled=false;
var measurementEnabled=false;
var scrollPending=false;
var measurementPending=false;
var lastMeasurementRequest=null;
var documentEpoch='';
try{documentEpoch=new URLSearchParams(window.location.search).get('odPreviewEpoch')||'';}catch(_){}
function numberValue(value){var next=Number(value||0);return Number.isFinite(next)?next:0;}
function scrollElement(){return document.querySelector('.design-canvas')||document.scrollingElement||document.documentElement;}
function postScroll(){
  if(!scrollEnabled)return;
  var canvas=scrollElement();
  if(!canvas)return;
  var frame=document.scrollingElement||document.documentElement;
  send('od:preview-scroll',{
    canvasLeft:Math.round(canvas.scrollLeft||0),canvasTop:Math.round(canvas.scrollTop||0),
    frameLeft:Math.round(frame.scrollLeft||0),frameTop:Math.round(frame.scrollTop||0)
  });
}

function scheduleScroll(){
  if(!scrollEnabled||scrollPending)return;
  scrollPending=true;
  requestAnimationFrame(function(){scrollPending=false;postScroll();});
}
function measureContentSize(){
  var root=document.documentElement;
  var body=document.body||root;
  if(!root)return null;
  var scrollWidth=Math.max(numberValue(root.scrollWidth),numberValue(body&&body.scrollWidth));
  var clientWidth=Math.max(numberValue(root.clientWidth),numberValue(body&&body.clientWidth));
  return {
    scrollWidth:scrollWidth>0?Math.ceil(scrollWidth):null,
    clientWidth:clientWidth>0?Math.ceil(clientWidth):null
  };
}

function postMeasurement(){
  if(!measurementEnabled||!lastMeasurementRequest)return;
  var size=measureContentSize();
  send('od:preview-content-size',{
    measurementId:lastMeasurementRequest.measurementId,
    generation:lastMeasurementRequest.generation,
    documentEpoch:documentEpoch,
    scrollWidth:size&&size.scrollWidth,
    clientWidth:size&&size.clientWidth
  });
}
function scheduleMeasurement(){
  if(!measurementEnabled||measurementPending)return;
  measurementPending=true;
  requestAnimationFrame(function(){measurementPending=false;postMeasurement();});
}
function setScroll(el,left,top){
  if(!el)return;
  if(typeof el.scrollTo==='function')el.scrollTo(numberValue(left),numberValue(top));
  else{el.scrollLeft=numberValue(left);el.scrollTop=numberValue(top);}
}
function moveScroll(el,left,top){
  if(!el)return;
  var dx=numberValue(left),dy=numberValue(top);
  if(!dx&&!dy)return;
  if(typeof el.scrollBy==='function')el.scrollBy({left:dx,top:dy,behavior:'auto'});
  else{el.scrollLeft=(el.scrollLeft||0)+dx;el.scrollTop=(el.scrollTop||0)+dy;}
}
function requestRestore(){if(scrollEnabled)send('od:preview-scroll-request');}
window.addEventListener('message',function(event){
  if(event.source!==parent)return;
  var data=event.data;
  if(!data||!data.type)return;
  if(data.type==='od:preview-scroll-restore'&&scrollEnabled){
    setScroll(document.scrollingElement||document.documentElement,data.frameLeft,data.frameTop);
    setScroll(scrollElement(),data.canvasLeft,data.canvasTop);
    setTimeout(postScroll,0);
    return;
  }
  if(data.type==='od:preview-scroll-by'&&scrollEnabled){
    moveScroll(scrollElement(),data.left,data.top);
    scheduleScroll();
    scheduleMeasurement();
    return;
  }
  if(data.type==='od:preview-content-size-request'&&measurementEnabled){
    if(typeof data.measurementId!=='string'||typeof data.generation!=='string')return;
    lastMeasurementRequest={measurementId:data.measurementId,generation:data.generation};
    scheduleMeasurement();
  }
});
window.addEventListener('scroll',scheduleScroll,true);
document.addEventListener('scroll',scheduleScroll,true);
window.addEventListener('resize',function(){scheduleScroll();scheduleMeasurement();});
if(typeof ResizeObserver!=='undefined'){
  try{
    var observer=new ResizeObserver(scheduleMeasurement);
    observer.observe(document.documentElement);
    if(document.body)observer.observe(document.body);
    else document.addEventListener('DOMContentLoaded',function(){if(document.body)observer.observe(document.body);},{once:true});
  }catch(_){}
}
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(scheduleMeasurement).catch(function(){});
register('scroll',function(){return {
  enable:function(){scrollEnabled=true;requestRestore();scheduleScroll();},
  disable:function(){scrollEnabled=false;}
};});
register('content_measurement',function(){return {
  enable:function(){measurementEnabled=true;scheduleMeasurement();setTimeout(scheduleMeasurement,80);setTimeout(scheduleMeasurement,260);},
  disable:function(){measurementEnabled=false;lastMeasurementRequest=null;}
};});
`,
  };
}

/**
 * Tweaks must install its hide style before the authored body parses, otherwise
 * a default-visible panel flashes before the host can negotiate capabilities.
 */
export function buildTweaksRuntimeModule(): PreviewRuntimeModuleSource {
  return {
    capabilities: ['tweaks'],
    source: String.raw`
var tweaksEnabled=false;
var tweaksReady=false;
var suppressTweaksEcho=false;
var tweaksObserver=null;
var tweaksStyle=document.createElement('style');
tweaksStyle.setAttribute('data-od-tweaks-bridge-style','');
tweaksStyle.textContent='[data-od-tweaks-hidden] .tw-panel{transform:translateX(calc(100% + 32px))!important;opacity:0!important;pointer-events:none!important}.tw-restore{display:none!important}';
(document.head||document.documentElement).appendChild(tweaksStyle);
document.documentElement.setAttribute('data-od-tweaks-hidden','');
function tweaksPanel(){return document.querySelector('.tw-panel');}
function applyTweaksPanelClass(visible){var panel=tweaksPanel();if(panel)panel.classList.toggle('tw-hidden',!visible);}
function postTweaksAvailability(){
  if(!tweaksEnabled||!tweaksReady)return;
  send('od:tweaks-available',{available:!!tweaksPanel()});
}
function postTweaksState(){
  if(!tweaksEnabled||!tweaksReady)return;
  var panel=tweaksPanel();
  if(panel)send('od:tweaks-panel-state',{visible:!panel.classList.contains('tw-hidden')});
}
function setTweaksPanelVisible(visible){
  suppressTweaksEcho=true;
  document.documentElement.toggleAttribute('data-od-tweaks-hidden',!visible);
  applyTweaksPanelClass(visible);
  Promise.resolve().then(function(){suppressTweaksEcho=false;});
}
function attachTweaksObserver(){
  var panel=tweaksPanel();
  if(!panel||tweaksObserver)return;
  tweaksObserver=new MutationObserver(function(){if(!suppressTweaksEcho)postTweaksState();});
  tweaksObserver.observe(panel,{attributes:true,attributeFilter:['class']});
}
function prepareTweaks(){
  var panel=tweaksPanel();
  var initialVisible=!!panel&&!panel.classList.contains('tw-hidden');
  document.documentElement.toggleAttribute('data-od-tweaks-hidden',!initialVisible);
  applyTweaksPanelClass(initialVisible);
  tweaksReady=true;
  attachTweaksObserver();
  postTweaksAvailability();
  postTweaksState();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',prepareTweaks,{once:true});else prepareTweaks();
window.addEventListener('message',function(event){
  if(event.source!==parent||!tweaksEnabled)return;
  var data=event.data;
  if(!data||data.type!=='od:tweaks-panel-visible')return;
  setTweaksPanelVisible(!!data.visible);
});
register('tweaks',function(){return {
  enable:function(){tweaksEnabled=true;postTweaksAvailability();postTweaksState();},
  disable:function(){tweaksEnabled=false;}
};});
`,
  };
}
