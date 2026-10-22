const { Menu } = require('electron');
const assert = require('node:assert/strict');
const wait = async predicate => { for (let n=0;n<150;n++) { if(await predicate()) return; await new Promise(r=>setTimeout(r,20)); } throw Error('Range application check timed out'); };
module.exports = async function checkRanges(win) {
  const js = source => win.webContents.executeJavaScript(source);
  const menuItem = (labels) => {
    const find = menu => { for (const item of menu.items) { if (labels.includes(item.label)) return item; const nested=item.submenu&&find(item.submenu); if(nested) return nested; } };
    const item=find(Menu.getApplicationMenu()); assert(item,'Missing native range menu: '+labels.join('/')); return item;
  };
  const source = 'First sentence. Second sentence! Third sentence?\n\nAfter';
  await js(`(()=>{const e=window.__aropyt.getEditor();e.setValue(${JSON.stringify(source)});e.view.dispatch({selection:{anchor:20}});e.focus()})()`);
  const sentence = menuItem(['选中当前行或句','Select Line / Sentence']); sentence.click(sentence,win,{});
  await wait(()=>js(`(()=>{const e=window.__aropyt.getEditor(),s=e.view.state.selection.main;return e.value.slice(s.from,s.to)==='Second sentence! '})()`));
  const remove = menuItem(['删除当前行或句','Delete Line / Sentence']); remove.click(remove,win,{});
  await wait(()=>js(`window.__aropyt.getEditor().value===${JSON.stringify(source.replace('Second sentence! ',''))}`));
  await js(`window.__aropyt.runAction('undo')`);
  assert.equal(await js(`window.__aropyt.getEditor().value`),source);
  const styled = 'Before **bold scope** and *italic part*';
  await js(`(()=>{const e=window.__aropyt.getEditor();e.setValue(${JSON.stringify(styled)});e.view.dispatch({selection:{anchor:12}});e.focus()})()`);
  const scope=menuItem(['删除当前格式文本','Delete Styled Scope']); scope.click(scope,win,{});
  await wait(()=>js(`window.__aropyt.getEditor().value===${JSON.stringify(styled.replace('**bold scope**',''))}`));
  const table='| A | B |\n| --- | --- |\n| Remove | Row |\n| Keep | Tail |';
  await js(`window.__aropyt.getEditor().setValue(${JSON.stringify(table)});document.querySelector('.md-table-widget td').focus()`);
  const mod = process.platform === 'darwin' ? 'meta' : 'control';
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'L',modifiers:[mod,'alt','shift']}); win.webContents.sendInputEvent({type:'keyUp',keyCode:'L',modifiers:[mod,'alt','shift']});
  await wait(()=>js(`window.__aropyt.getEditor().value===${JSON.stringify('| A | B |\n| --- | --- |\n| Keep | Tail |')}`));
  console.log('PASS Native sentence/style menus change the intended range, support undo, and the delete-line shortcut removes a table row exactly once');
};
