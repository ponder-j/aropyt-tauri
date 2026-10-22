// Safari/WebKit has no requestIdleCallback on several supported macOS versions.
if (!window.requestIdleCallback) {
  window.requestIdleCallback = (callback, options) => window.setTimeout(() => {
    const start = performance.now();
    callback({ didTimeout: false, timeRemaining: () => Math.max(0, 16 - (performance.now() - start)) });
  }, Math.min(options?.timeout ?? 16, 16));
  window.cancelIdleCallback = id => window.clearTimeout(id);
}

// Older WebKitGTK reports DOM geometry in the element's unzoomed coordinate
// space. CodeMirror, image tools and context menus require viewport CSS pixels.
// Detect the behavior rather than changing layout or relying on a user agent.
function installZoomGeometry(): void {
  const probe=document.createElement('div');
  probe.style.cssText='position:fixed;left:0;top:0;width:100px;height:100px;zoom:.5;visibility:hidden;pointer-events:none';
  document.body.append(probe);const unscaled=probe.getBoundingClientRect().width;probe.remove();
  if(Math.abs(unscaled-100)>.01)return;
  const zoomOf=(node:Node):number=>{
    let zoom=1;
    for(let element:Element|null=node instanceof Element?node:node.parentElement;element;element=element.parentElement){const value=getComputedStyle(element).getPropertyValue('zoom');const factor=value.endsWith('%')?parseFloat(value)/100:Number(value);if(Number.isFinite(factor)&&factor>0)zoom*=factor;}
    return zoom;
  };
  const scale=(rect:DOMRect,zoom:number)=>new DOMRect(rect.x*zoom,rect.y*zoom,rect.width*zoom,rect.height*zoom);
  const rect=Element.prototype.getBoundingClientRect,rects=Element.prototype.getClientRects;
  Element.prototype.getBoundingClientRect=function(){return scale(rect.call(this),zoomOf(this));};
  const list=(values:DOMRect[],zoom:number):DOMRectList=>{const result=values.map(r=>scale(r,zoom));return Object.assign(result,{item:(n:number)=>result[n]||null}) as unknown as DOMRectList;};
  Element.prototype.getClientRects=function(){return list(Array.from(rects.call(this)),zoomOf(this));};
  const rangeRect=Range.prototype.getBoundingClientRect,rangeRects=Range.prototype.getClientRects;
  Range.prototype.getBoundingClientRect=function(){return scale(rangeRect.call(this),zoomOf(this.commonAncestorContainer));};
  Range.prototype.getClientRects=function(){return list(Array.from(rangeRects.call(this)),zoomOf(this.commonAncestorContainer));};
}
if(document.body)installZoomGeometry();else addEventListener('DOMContentLoaded',installZoomGeometry,{once:true});
