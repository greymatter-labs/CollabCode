const Y = require('yjs');

function encodeUpdate(update) {
  return Buffer.from(update).toString('base64');
}

function getFiles(workspace) {
  return Object.values(workspace?.files || {}).filter(file => file?.id);
}

function buildCollabState(workspace, fileSnapshots = {}, timestamp = Date.now()) {
  const ydoc = new Y.Doc();

  getFiles(workspace).forEach(file => {
    if (file.hidden || file.role === 'runtime') return;
    const content = String(fileSnapshots?.[file.id]?.content || '');
    const text = ydoc.getText(`file:${file.id}`);
    if (content) text.insert(0, content);
  });

  const baseState = encodeUpdate(Y.encodeStateAsUpdate(ydoc));
  ydoc.destroy();

  return {
    version: 1,
    provider: 'firebase-yjs',
    createdAt: timestamp,
    yjs: {
      baseState,
      updates: null
    },
    awareness: null
  };
}

module.exports = {
  buildCollabState
};
