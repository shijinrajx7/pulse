/* PULSE motion controller — lightweight, dependency-free portfolio-style motion. */
(function(){
  "use strict";
  var main=document.getElementById("m");
  if(!main)return;
  var reduced=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var finePointer=window.matchMedia&&window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  var body=document.body;

  var progress=document.createElement("div");
  progress.id="pulse-scroll-progress";
  progress.setAttribute("aria-hidden","true");
  body.appendChild(progress);

  var glow=document.createElement("div");
  glow.id="pulse-pointer-glow";
  glow.setAttribute("aria-hidden","true");
  body.appendChild(glow);

  function updateProgress(){
    var doc=document.documentElement;
    var max=Math.max(1,doc.scrollHeight-window.innerHeight);
    var amount=Math.max(0,Math.min(1,window.scrollY/max));
    progress.style.width=(amount*100).toFixed(2)+"%";
  }
  var scrollQueued=false;
  window.addEventListener("scroll",function(){
    if(scrollQueued)return;
    scrollQueued=true;
    requestAnimationFrame(function(){updateProgress();scrollQueued=false});
  },{passive:true});
  window.addEventListener("resize",updateProgress,{passive:true});
  updateProgress();

  if(finePointer){
    window.addEventListener("pointermove",function(event){
      glow.style.left=event.clientX+"px";
      glow.style.top=event.clientY+"px";
      glow.style.opacity=".9";
    },{passive:true});
    document.addEventListener("pointerleave",function(){glow.style.opacity="0"});
  }

  if(!reduced){
    var canvas=document.createElement("canvas");
    canvas.id="pulse-particle-field";
    canvas.setAttribute("aria-hidden","true");
    body.appendChild(canvas);
    var ctx=canvas.getContext("2d");
    var points=[],width=0,height=0,dpr=1,raf=0;
    function resize(){
      width=window.innerWidth;height=window.innerHeight;
      dpr=Math.min(window.devicePixelRatio||1,1.5);
      canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
      canvas.style.width=width+"px";canvas.style.height=height+"px";
      ctx.setTransform(dpr,0,0,dpr,0,0);
      var count=Math.max(24,Math.min(68,Math.round(width/23)));
      points=Array.from({length:count},function(){
        return{x:Math.random()*width,y:Math.random()*height,vx:(Math.random()-.5)*.22,vy:(Math.random()-.5)*.22,r:Math.random()*1.4+.45};
      });
    }
    function draw(){
      ctx.clearRect(0,0,width,height);
      var accent=getComputedStyle(document.documentElement).getPropertyValue("--ac").trim()||"#ff2b2b";
      for(var i=0;i<points.length;i++){
        var p=points[i];p.x+=p.vx;p.y+=p.vy;
        if(p.x<0||p.x>width)p.vx*=-1;
        if(p.y<0||p.y>height)p.vy*=-1;
        ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
        ctx.fillStyle=accent;ctx.globalAlpha=.45;ctx.fill();
        for(var j=i+1;j<points.length;j++){
          var q=points[j],dx=p.x-q.x,dy=p.y-q.y,dist=Math.sqrt(dx*dx+dy*dy);
          if(dist<118){
            ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);
            ctx.strokeStyle=accent;ctx.globalAlpha=(1-dist/118)*.12;ctx.lineWidth=.7;ctx.stroke();
          }
        }
      }
      ctx.globalAlpha=1;
      raf=requestAnimationFrame(draw);
    }
    resize();draw();
    window.addEventListener("resize",resize,{passive:true});
    document.addEventListener("visibilitychange",function(){
      if(document.hidden){cancelAnimationFrame(raf);raf=0}else if(!raf)draw();
    });
  }

  var revealObserver=null;
  if("IntersectionObserver" in window&&!reduced){
    revealObserver=new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if(entry.isIntersecting){
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      });
    },{threshold:.08,rootMargin:"0px 0px -36px 0px"});
  }
  var revealSelector=[
    ".pulse-hero",".pulse-metrics",".pulse-metric",".pulse-editorial-row",".pulse-ai-note",
    ".pulse-block-heading",".pulse-story-card",".card",".pulse-notification-hero",
    ".pulse-settings-section",".poster-shell",".map-visual",".globe-shell"
  ].join(",");
  var tiltSelector=".pulse-hero-visual,.pulse-ai-note,.pulse-metric,.card";
  var tiltBound=new WeakSet();

  function addTilt(element){
    if(reduced||!finePointer||tiltBound.has(element))return;
    tiltBound.add(element);
    element.addEventListener("pointermove",function(event){
      if(event.pointerType==="touch")return;
      var rect=element.getBoundingClientRect();
      var x=(event.clientX-rect.left)/Math.max(1,rect.width);
      var y=(event.clientY-rect.top)/Math.max(1,rect.height);
      var ry=(x-.5)*5.5,rx=(.5-y)*4.5;
      element.style.transform="perspective(1000px) rotateX("+rx.toFixed(2)+"deg) rotateY("+ry.toFixed(2)+"deg) translateY(-2px)";
    });
    element.addEventListener("pointerleave",function(){element.style.transform=""});
  }

  function addMarquee(){
    var hero=main.querySelector(".pulse-hero");
    if(!hero||main.querySelector(".pulse-motion-marquee"))return;
    var band=document.createElement("div");
    band.className="pulse-motion-marquee";
    band.setAttribute("aria-hidden","true");
    var labels=["Artificial Intelligence","Cybersecurity","Global Signals","Emerging Technology","Independent Sources","Digital Culture"];
    var track=document.createElement("div");
    track.className="pulse-motion-marquee-track";
    labels.concat(labels).forEach(function(label){
      var item=document.createElement("span");item.textContent=label;track.appendChild(item);
    });
    band.appendChild(track);
    hero.insertAdjacentElement("afterend",band);
  }

  function enhance(){
    addMarquee();
    if(revealObserver){
      main.querySelectorAll(revealSelector).forEach(function(element,index){
        if(element.classList.contains("pulse-reveal"))return;
        element.classList.add("pulse-reveal");
        element.style.setProperty("--pulse-delay",((index%6)*65)+"ms");
        revealObserver.observe(element);
      });
    }else{
      main.querySelectorAll(revealSelector).forEach(function(element){element.classList.add("is-visible")});
    }
    main.querySelectorAll(tiltSelector).forEach(addTilt);
    updateProgress();
  }
  enhance();
  if("MutationObserver" in window){
    var mutationTimer=0;
    var observer=new MutationObserver(function(){
      if(mutationTimer)cancelAnimationFrame(mutationTimer);
      mutationTimer=requestAnimationFrame(enhance);
    });
    observer.observe(main,{childList:true,subtree:true});
  }

  body.classList.add("pulse-motion-ready");
})();