import {
  PREVIEW_RUNTIME_PROTOCOL_VERSION,
  normalizePreviewRuntimeCapabilities,
  type PreviewRuntimeCapability,
  type PreviewRuntimeDocumentIdentity,
} from '@open-design/contracts/runtime/preview-runtime';

export const PREVIEW_RUNTIME_BOOTSTRAP_MARKER = 'data-od-preview-runtime';

export interface PreviewRuntimeBootstrapOptions extends PreviewRuntimeDocumentIdentity {
  availableCapabilities?: readonly PreviewRuntimeCapability[];
}

function safeInlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</gu, '\\u003c')
    .replace(/\u2028/gu, '\\u2028')
    .replace(/\u2029/gu, '\\u2029');
}

function assertIdentity(value: string, field: string): void {
  if (!value || value.length > 200 || value.trim() !== value) {
    throw new TypeError(`${field} must be a non-empty bounded string`);
  }
}

/**
 * Build the transport-independent bootstrap injected before authored startup
 * scripts. Capability modules are deliberately supplied separately: until a
 * module has URL-runtime parity, it must not appear in availableCapabilities.
 */
export function buildPreviewRuntimeBootstrap(
  options: PreviewRuntimeBootstrapOptions,
): string {
  assertIdentity(options.sessionId, 'sessionId');
  assertIdentity(options.documentVersion, 'documentVersion');
  const identity = {
    protocolVersion: PREVIEW_RUNTIME_PROTOCOL_VERSION,
    sessionId: options.sessionId,
    documentVersion: options.documentVersion,
  };
  const availableCapabilities = normalizePreviewRuntimeCapabilities(
    options.availableCapabilities ?? [],
  );

  return `<script ${PREVIEW_RUNTIME_BOOTSTRAP_MARKER}>(function(){
var identity=${safeInlineJson(identity)};
var available=${safeInlineJson(availableCapabilities)};
var availableSet=new Set(available);
function send(type,extra){parent.postMessage(Object.assign({type:type},identity,extra||{}),'*');}
function normalize(input){if(!Array.isArray(input))return [];return available.filter(function(capability){return input.indexOf(capability)!==-1&&availableSet.has(capability);});}
window.addEventListener('message',function(event){
  if(event.source!==parent)return;
  var data=event.data;
  if(!data||data.type!=='od:preview:set-capabilities'||data.protocolVersion!==identity.protocolVersion||data.sessionId!==identity.sessionId||data.documentVersion!==identity.documentVersion)return;
  send('od:preview:capabilities-applied',{enabledCapabilities:normalize(data.enabledCapabilities)});
});
send('od:preview:hello',{availableCapabilities:available});
function ready(){
  send('od:preview:ready');
  requestAnimationFrame(function(){requestAnimationFrame(function(){send('od:preview:visible-paint');});});
}
if(document.readyState==='loading')window.addEventListener('DOMContentLoaded',ready,{once:true});else queueMicrotask(ready);
})();</script>`;
}
