(function(){
  var KEY='0x4AAAAAAFDSVkFD-ysdHC_H', boxes=[];
  var S={idle:['🛡️','اضغط للتحقق أنك لست روبوت'],load:['','جارٍ التحقق...'],ok:['✓','تم التحقق بنجاح'],err:['!','فشل التحقق، اضغط للمحاولة']};
  function set(b,st){b.btn.className='ts-btn ts-'+st;b.ic.textContent=S[st][0];b.tx.textContent=S[st][1];b.st=st;}
  document.querySelectorAll('.cf-turnstile').forEach(function(el){
    el.className='ts-wrap';el.removeAttribute('style');
    var btn=document.createElement('button');btn.type='button';
    btn.innerHTML='<span class="ts-ic"></span><span class="ts-tx"></span>';
    var w=document.createElement('div');w.className='ts-widget';
    el.appendChild(btn);el.appendChild(w);
    var b={btn:btn,ic:btn.firstChild,tx:btn.lastChild,w:w,id:null};set(b,'idle');boxes.push(b);
    btn.onclick=function(){if(b.st==='load'||b.st==='ok'||b.id===null)return;try{turnstile.reset(b.id);set(b,'load');turnstile.execute(b.id);}catch(e){set(b,'err');}};
  });
  window.tsInit=function(){
    boxes.forEach(function(b){
      b.id=turnstile.render(b.w,{sitekey:KEY,theme:'dark',execution:'execute',appearance:'interaction-only',
        callback:function(){set(b,'ok');},'error-callback':function(){set(b,'err');},'expired-callback':function(){set(b,'idle');}});
    });
    var r=turnstile.reset.bind(turnstile);
    turnstile.reset=function(id){boxes.forEach(function(b){if(b.id!==null&&(id==null||id===b.id)){r(b.id);set(b,'idle');}});};
  };
})();
