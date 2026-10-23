// A fixed, offline document: note HTML is sent as bridge data, never interpolated
// into executable JavaScript. Keep the same execCommand semantics as the PWA.
export const RICH_EDITOR_DOCUMENT = String.raw`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'">
<style>
html,body{margin:0;background:#f8faf6;color:#20351d;font:16px/1.5 -apple-system,BlinkMacSystemFont,Arial,sans-serif;overflow-wrap:anywhere}
#editor{box-sizing:border-box;min-height:190px;padding:12px;outline:none;white-space:pre-wrap}
#editor:empty:before{content:attr(data-placeholder);color:#64748b;pointer-events:none}
p,div{margin:0}ul,ol{margin:0;padding-left:26px}a{color:#347b0a;text-decoration:underline}
</style></head><body><div id="editor" contenteditable="true" role="textbox" aria-label="Note body" aria-multiline="true" data-placeholder="What's on your mind?"></div>
<script>
(function(){
  var editor=document.getElementById('editor'), savedRange=null, lastId=null, applying=false;
  function send(value){window.ReactNativeWebView.postMessage(JSON.stringify(value));}
  function remember(){
    var s=window.getSelection();
    if(s && s.rangeCount && editor.contains(s.anchorNode) && editor.contains(s.focusNode)) savedRange=s.getRangeAt(0).cloneRange();
    send({type:'selection',bold:document.queryCommandState('bold'),italic:document.queryCommandState('italic'),unordered:document.queryCommandState('insertUnorderedList'),ordered:document.queryCommandState('insertOrderedList')});
  }
  function restore(){
    editor.focus();
    var s=window.getSelection();s.removeAllRanges();
    if(savedRange && editor.contains(savedRange.commonAncestorContainer)) s.addRange(savedRange);
    else {var r=document.createRange();r.selectNodeContents(editor);r.collapse(false);s.addRange(r);}
  }
  function content(type,id){send({type:type||'change',id:id,html:editor.innerHTML});}
  editor.addEventListener('input',function(){if(!applying){remember();content();}});
  document.addEventListener('selectionchange',remember);
  editor.addEventListener('blur',remember);
  // Paste plain text only: no remote resources, executable markup or hidden styles.
  editor.addEventListener('paste',function(e){e.preventDefault();document.execCommand('insertText',false,(e.clipboardData||window.clipboardData).getData('text/plain'));});
  editor.addEventListener('drop',function(e){e.preventDefault();});
  editor.addEventListener('click',function(e){if(e.target.closest('a'))e.preventDefault();});
  function checklist(){
    var selection=window.getSelection(),original=selection.getRangeAt(0).cloneRange();
    var starts=[{node:editor,offset:0}],hasContent=false,explicit=false,pending=false;
    function begin(node,offset){starts.push({node:node,offset:offset});hasContent=false;explicit=false;pending=false;}
    function visit(node){
      if(node.nodeType===3){
        if(pending)begin(node,0);
        for(var i=0;i<node.data.length;i++){
          if(node.data[i]==='\n')begin(node,i+1);else hasContent=true;
        }
        return;
      }
      if(node.nodeType!==1)return;
      var block=/^(DIV|P|LI)$/.test(node.tagName);
      if(block){
        if(hasContent||explicit)begin(node,0);
        else starts[starts.length-1]={node:node,offset:0};
        pending=false;
      }
      if(node.tagName==='BR'){
        if(hasContent||explicit)begin(node.parentNode,Array.prototype.indexOf.call(node.parentNode.childNodes,node)+1);
        else explicit=true;
        return;
      }
      Array.prototype.forEach.call(node.childNodes,visit);
      if(block)pending=true;
    }
    Array.prototype.forEach.call(editor.childNodes,visit);
    function compare(point,node,offset){
      var a=document.createRange(),b=document.createRange();
      a.setStart(point.node,point.offset);a.collapse(true);b.setStart(node,offset);b.collapse(true);
      return a.compareBoundaryPoints(Range.START_TO_START,b);
    }
    var first=0,last=0;
    for(var j=0;j<starts.length;j++){
      if(compare(starts[j],original.startContainer,original.startOffset)<=0)first=j;
      if(compare(starts[j],original.endContainer,original.endOffset)<0)last=j;
    }
    if(original.collapsed)last=first;
    for(var index=last;index>=first;index--){
      var point=starts[index],line=document.createRange();line.setStart(point.node,point.offset);
      if(starts[index+1])line.setEnd(starts[index+1].node,starts[index+1].offset);else line.setEnd(editor,editor.childNodes.length);
      if(/^\s*[☐☑](?:\s|$)/.test(line.toString()))continue;
      line.collapse(true);selection.removeAllRanges();selection.addRange(line);
      document.execCommand('insertText',false,'☐ ');
    }
  }
  function receive(event){
    var m;try{m=JSON.parse(event.data);}catch(_){return;}
    if(!m||m.id===lastId)return;lastId=m.id;
    if(m.type==='set-content'){
      applying=true;editor.innerHTML=m.html;editor.contentEditable=m.editable?'true':'false';savedRange=null;applying=false;return;
    }
    if(m.type==='editable'){editor.contentEditable=m.value?'true':'false';return;}
    if(m.type==='snapshot'){content('snapshot',m.id);return;}
    if(m.type==='remember'){remember();return;}
    if(m.type!=='command'||editor.contentEditable!=='true')return;
    restore();
    if(m.command==='checklist'){
      checklist();
    }else if(m.command==='link'){
      var url=m.url||'';
      if(!/^(https?:\/\/|mailto:)/i.test(url)||/[\u0000-\u0020\u007f]/.test(url))return;
      if(window.getSelection().isCollapsed){
        var a=document.createElement('a');a.setAttribute('href',url);a.textContent=m.label||url;
        document.execCommand('insertHTML',false,a.outerHTML);
      }else document.execCommand('createLink',false,url);
    }else if(['bold','italic','insertUnorderedList','insertOrderedList','undo','redo'].indexOf(m.command)!==-1){
      document.execCommand(m.command,false);
    }
    remember();content();
  }
  document.addEventListener('message',receive);window.addEventListener('message',receive);
  send({type:'ready'});
})();
</script></body></html>`;
