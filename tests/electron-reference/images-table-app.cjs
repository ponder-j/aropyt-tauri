const assert = require('node:assert/strict');
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
const wait = async predicate => { for (let n = 0; n < 150; n++) { const value = await predicate(); if (value) return value; await pause(); } throw Error('Image/table application check timed out'); };
module.exports = async function checkImagesAndTable(win) {
  const js = source => win.webContents.executeJavaScript(source);
  const source = 'Before\n\n![Sample](size.svg "Caption")\n\nAfter';
  {
    await js(`window.__aropyt.getEditor().setValue(${JSON.stringify(source)})`);
    await wait(() => js(`document.querySelector('.cm-image-preview img')?.naturalWidth===400`));
    const open = async key => {
      await js(`document.querySelector('.cm-image-preview img').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:100,clientY:100}));document.querySelector('#context-menu button[data-key="${key}"]').dispatchEvent(new MouseEvent('mouseenter'))`);
    };
    await open('zoom-img');
    assert.equal(await js(`document.querySelectorAll('#zoom-img-menu button').length`), 8, 'DOM image menu lacks a reference zoom level');
    await js(`document.querySelector('#zoom-img-menu button[data-key="image:zoom:50"]').click()`);
    await wait(() => js(`window.__aropyt.getEditor().value.includes('zoom:50%;')`));
    const expected = 'Before\n\n<img src="size.svg" alt="Sample" title="Caption" style="zoom:50%;" />\n\nAfter';
    assert.equal(await js(`window.__aropyt.getEditor().value`), expected);
    assert.deepEqual(await js(`(()=>{const box=document.querySelector('.cm-image-preview img').getBoundingClientRect();return{width:box.width,height:box.height}})()`), {width:200,height:100});
    assert(await js(`!!document.querySelector('.cm-native-image-source')`), 'Zoom did not retain editable source and the preview');
    const exported = await js(`window.__aropyt.prepareExport()`);
    assert(exported.includes('data:image/svg+xml;base64,') && exported.includes('zoom:50%'), 'Export lost the local HTML image or its zoom');
    await js(`window.__aropyt.runAction('undo')`);
    assert.equal(await js(`window.__aropyt.getEditor().value`), source);
    await js(`window.__aropyt.runAction('redo')`);
    await wait(() => js(`!!document.querySelector('.cm-image-preview img')`));
    await open('switch-img-syntax');
    await js(`document.querySelector('#switch-img-syntax-menu button[data-key="image:markdown"]').click()`);
    await wait(() => js(`window.__aropyt.getEditor().value===${JSON.stringify(source)}`));
  }
  console.log('PASS DOM image-menu commands changes scale/syntax, retains a live correctly sized preview, embeds HTML image paths in export and supports undo');

  const cellText = 'Apple **bold** and *italic* and [link](https://example.com)';
  const table = '| Item | Count |\n| --- | --- |\n| '+cellText+' | 2 |';
  await js(`window.__aropyt.getEditor().setValue(${JSON.stringify(table)})`);
  await wait(() => js(`!!document.querySelector('.md-table-widget td')`));
  const select = async offset => js(`(()=>{const cell=document.querySelector('.md-table-widget td');cell.focus();let offset=${offset};const walker=document.createTreeWalker(cell,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const node=walker.currentNode;if(offset<=node.length){const range=document.createRange();range.setStart(node,offset);range.collapse(true);window.getSelection().removeAllRanges();window.getSelection().addRange(range);document.dispatchEvent(new Event('selectionchange'));return;}offset-=node.length;}})()`);
  await select(cellText.indexOf('bold')+2);
  await wait(() => js(`document.querySelector('.md-table-widget td').innerText.includes('**bold**')`));
  await win.webContents.insertText('X');
  await wait(() => js(`window.__aropyt.getEditor().value.includes('**boXld**')`));
  assert((await js(`window.__aropyt.getEditor().value`)).includes('*italic* and [link](https://example.com)'), 'Native typing lost hidden Markdown');
  assert.equal(await js(`document.querySelector('.md-table-widget td').innerText.includes('https://')`), false);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Right'}); win.webContents.sendInputEvent({type:'keyUp',keyCode:'Right'});
  await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  await win.webContents.insertText('Y');
  const moved = await js(`window.__aropyt.getEditor().value`);
  assert(moved.includes('**boXlYd**'), 'Arrow movement/native input changed the wrong source position: '+moved);
  await js(`window.__aropyt.runAction('undo')`);
  let undone = await js(`window.__aropyt.getEditor().value`);
  if (undone !== table) {
    assert.equal(undone, table.replace('**bold**', '**boXld**'), 'Undo changed unrelated table content');
    await js(`window.__aropyt.runAction('undo')`);
  }
  await wait(() => js(`window.__aropyt.getEditor().value===${JSON.stringify(table)}`));
  await select(cellText.indexOf('italic')+2);
  await win.webContents.insertText('中');
  await wait(() => js(`window.__aropyt.getEditor().value.includes('*it中alic*')`));
  assert(await js(`!!document.querySelector('.md-table-widget td .cm-md-strong') && !document.querySelector('.md-table-widget td').innerText.includes('**bold**')`), 'Typing in italic exposed the neighboring bold style');
  await js(`window.__aropyt.runAction('save')`);
  console.log('PASS Native Chromium typing and arrow movement edit styled table text without dropping hidden syntax, preserve adjacent formats, save and undo');

  const rich = '| A | B |\n| --- | --- |\n| **bold** and $x^2+1$ after | Other |';
  await js(`window.__aropyt.getEditor().setValue(${JSON.stringify(rich)})`);
  await wait(() => js(`!!document.querySelector('.md-table-math-preview svg')`));
  const point = await js(`(()=>{const r=document.querySelector('.md-table-math-preview').getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
  win.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1}); win.webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});
  await wait(() => js(`!!document.querySelector('.md-table-math-tooltip svg') && window.getSelection().toString()==='x^2+1'`));
  await win.webContents.insertText('y+2');
  await wait(() => js(`window.__aropyt.getEditor().value.includes('**bold** and $y+2$ after')`));
  assert(await js(`document.querySelector('.md-table-math-tooltip svg') && !document.querySelector('.md-table-widget td').innerText.includes('**bold**')`), 'Table TeX editing lost preview or exposed adjacent formatting');
  await js(`(()=>{const editor=window.__aropyt.getEditor();editor.view.dispatch({selection:{anchor:editor.value.length}});editor.focus()})()`);
  await wait(() => js(`!!document.querySelector('.md-table-math-preview svg') && !document.querySelector('.md-table-math-tooltip')`));
  await js(`window.__aropyt.runAction('save')`);
  assert.equal(await js(`window.__aropyt.getEditor().value`), rich.replace('$x^2+1$', '$y+2$'));
  assert((await js(`window.__aropyt.prepareExport()`)).includes('mjx-container'), 'Table formula disappeared from export');
  console.log('PASS Real MathJax table formulas open with native mouse input, select only TeX, accept native typing, retain neighboring styles, collapse on exit and export');
};
