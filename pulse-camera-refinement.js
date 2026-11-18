/* PULSE camera refinement.
 * Uses CSS scroll timelines where supported; no animation loop or external dependency.
 */
(function(){
  "use strict";
  var reduced=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if(reduced)return;
  var root=document.documentElement;
  root.classList.add("pulse-camera-ready");
  // Older browsers retain the static hero; no scroll handler is needed.
})();
