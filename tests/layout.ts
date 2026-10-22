const layoutAssert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
const layoutSettle = async () => {
  await new Promise(resolve => setTimeout(resolve, 260));
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
};

(window as any).runLayoutChecks = async () => {
  const api = (window as any).__aropyt, editor = api.getEditor();
  const original = { text: editor.value, selection: editor.view.state.selection.main.toJSON(),
    theme: api.state.theme, source: api.state.sourceMode, sidebar: api.state.sidebarVisible,
    zoom: api.state.zoom, status: api.state.statusBar };
  const app = document.getElementById('app-body')!, footer = document.getElementById('ty-footer')!;
  const mode = async (source: boolean, sidebar: boolean) => {
    if (api.state.sourceMode !== source) await api.runAction('toggleSource');
    if (api.state.sidebarVisible !== sidebar) await api.runAction('toggleSidebar');
  };
  const zoom = async (value: number) => {
    await api.runAction('zoomReset');
    while (Math.abs(api.state.zoom - value) > .01) await api.runAction(api.state.zoom < value ? 'zoomIn' : 'zoomOut');
  };
  const boundary = (label: string) => {
    const bar = footer.getBoundingClientRect(), area = app.getBoundingClientRect();
    const content = document.getElementById('main-content')!.getBoundingClientRect();
    const scroller = editor.view.scrollDOM.getBoundingClientRect();
    layoutAssert(bar.height > 0 && Math.abs(bar.bottom - area.bottom) < 2 && bar.bottom <= innerHeight + 2, label + ': footer left its window boundary');
    layoutAssert(content.bottom <= bar.top + 1 && scroller.bottom <= bar.top + 1, label + ': editor extended across the footer');
    for (const fraction of [.04, .5, .96]) {
      const hit = document.elementFromPoint(bar.left + bar.width * fraction, bar.top + bar.height / 2);
      layoutAssert(hit && footer.contains(hit), label + ': footer was covered at ' + fraction + ' by ' + hit?.tagName + '#' + hit?.id);
    }
  };
  try {
    if (!api.state.statusBar) await api.runAction('toggleStatusBar');
    editor.setValue('# Layout boundary\n\n' + Array.from({ length: 120 }, (_, i) => `Paragraph ${i}: **text** and long document content.`).join('\n\n') + '\n\n```javascript\nconst tail = 1;\n```');
    for (const theme of ['github', 'night']) {
      await api.runAction('setTheme', theme);
      for (const [source, sidebar, scale] of [[false, false, 1], [false, true, .8], [false, true, 1.2], [true, false, 1]] as const) {
        await mode(source, sidebar); await zoom(scale); await layoutSettle();
        for (const end of [false, true]) {
          editor.view.scrollDOM.scrollTop = end ? editor.view.scrollDOM.scrollHeight : 0;
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
          boundary(`${theme}, source=${source}, sidebar=${sidebar}, zoom=${scale}, end=${end}`);
        }
      }
    }
    await api.runAction('toggleStatusBar'); await layoutSettle();
    const content = document.getElementById('main-content')!.getBoundingClientRect();
    layoutAssert(getComputedStyle(footer).display === 'none' && Math.abs(content.bottom - app.getBoundingClientRect().bottom) < 2,
      'Hiding the footer did not release its grid row');
    return ['Long-document editor scrolling, light/dark themes, sidebar transitions, source mode and zoom preserve footer boundaries and hit targets',
      'Hiding the status bar releases its layout space without leaving an overlay'];
  } finally {
    await api.runAction('setTheme', original.theme); await mode(original.source, original.sidebar); await zoom(original.zoom);
    if (api.state.statusBar !== original.status) await api.runAction('toggleStatusBar');
    editor.setValue(original.text); editor.view.dispatch({ selection: original.selection });
  }
};
