/* PULSE story selection: keep a visible, theme-aware selected report surface. */
(function(){
  "use strict";
  var main=document.getElementById("m");
  if(!main)return;
  main.addEventListener("click",function(event){
    var card=event.target.closest(".pulse-story-card");
    if(!card)return;
    main.querySelectorAll(".pulse-story-card.is-selected").forEach(function(item){
      if(item!==card)item.classList.remove("is-selected");
    });
    card.classList.toggle("is-selected");
  });
  /* Theme changes should update the browser chrome colour as well as the page. */
  var root=document.documentElement;
  var observer=new MutationObserver(function(){
    var meta=document.querySelector('meta[name="theme-color"]');
    if(meta)meta.setAttribute("content",getComputedStyle(root).getPropertyValue("--bg").trim()||"#F4F2EC");
  });
  observer.observe(root,{attributes:true,attributeFilter:["data-theme"]});
})();
