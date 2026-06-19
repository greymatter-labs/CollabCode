import * as Y from 'yjs';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates
} from 'y-protocols/awareness';

const PROVIDER_VERSION = 1;
const PROVIDER_NAME = 'firebase-yjs';
const UPDATE_BATCH_MS = 100;
const BASE64_CHUNK_SIZE = 0x8000;

function serverTimestamp() {
  return window.firebase?.database?.ServerValue?.TIMESTAMP || Date.now();
}

function uint8ToBase64(update) {
  let binary = '';
  for (let index = 0; index < update.length; index += BASE64_CHUNK_SIZE) {
    const chunk = update.subarray(index, index + BASE64_CHUNK_SIZE);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return window.btoa(binary);
}

function base64ToUint8(value) {
  const binary = window.atob(String(value || ''));
  const update = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    update[index] = binary.charCodeAt(index);
  }
  return update;
}

function getFiles(workspace) {
  return Object.values(workspace?.files || {}).filter(file => file?.id);
}

function getSnapshotContent(snapshots, file, getDefaultContent) {
  const snapshot = snapshots?.[file.id];
  if (typeof snapshot?.content === 'string') return snapshot.content;
  if (file.role === 'runtime') return '';
  return getDefaultContent?.(file.language) || '';
}

function sortUpdates(entries) {
  return entries.sort((left, right) => {
    const leftTime = left[1]?.createdAt || 0;
    const rightTime = right[1]?.createdAt || 0;
    if (leftTime !== rightTime) return leftTime - rightTime;
    return String(left[0]).localeCompare(String(right[0]));
  });
}

export class FirebaseYjsProvider {
  constructor({
    sessionRef,
    currentUser,
    readOnly = false,
    initialWorkspace = null,
    initialSnapshots = {},
    getDefaultContent = null
  }) {
    this.sessionRef = sessionRef;
    this.currentUser = currentUser || {};
    this.readOnly = readOnly;
    this.initialWorkspace = initialWorkspace;
    this.initialSnapshots = initialSnapshots || {};
    this.getDefaultContent = getDefaultContent;

    this.ydoc = new Y.Doc();
    this.awareness = new Awareness(this.ydoc);
    this.clientId = String(this.ydoc.clientID);
    this.collabRef = sessionRef.child('collab');
    this.updatesRef = this.collabRef.child('yjs/updates');
    this.awarenessRef = this.collabRef.child('awareness');
    this.localAwarenessRef = this.awarenessRef.child(this.clientId);
    this.appliedUpdateKeys = new Set();
    this.knownFileIds = new Set(getFiles(initialWorkspace).map(file => file.id));
    this.pendingUpdates = [];
    this.flushTimer = null;
    this.destroyed = false;
    this.ready = false;
    this.hasCollabState = false;

    this.handleDocUpdate = this.handleDocUpdate.bind(this);
    this.handleRemoteUpdate = this.handleRemoteUpdate.bind(this);
    this.handleAwarenessUpdate = this.handleAwarenessUpdate.bind(this);
    this.handleRemoteAwareness = this.handleRemoteAwareness.bind(this);
    this.handleRemoteAwarenessRemoved = this.handleRemoteAwarenessRemoved.bind(this);
  }

  async init() {
    const snapshot = await this.collabRef.once('value');
    let collabState = snapshot.val() || {};

    if (!collabState.version && !this.readOnly) {
      await this.seedBaseState();
      collabState = (await this.collabRef.once('value')).val() || {};
    }

    this.hasCollabState = collabState.version === PROVIDER_VERSION;
    this.applyInitialState(collabState);
    this.ydoc.on('update', this.handleDocUpdate);
    this.updatesRef.on('child_added', this.handleRemoteUpdate);

    if (!this.readOnly) {
      this.setupAwareness();
    }

    this.ready = true;
    return this;
  }

  async seedBaseState() {
    const seedDoc = new Y.Doc();
    getFiles(this.initialWorkspace).forEach(file => {
      if (file.hidden || file.role === 'runtime') return;
      const text = seedDoc.getText(`file:${file.id}`);
      const content = getSnapshotContent(this.initialSnapshots, file, this.getDefaultContent);
      if (content) text.insert(0, content);
    });

    const baseState = uint8ToBase64(Y.encodeStateAsUpdate(seedDoc));
    seedDoc.destroy();

    await this.collabRef.set({
      version: PROVIDER_VERSION,
      provider: PROVIDER_NAME,
      createdAt: serverTimestamp(),
      yjs: {
        baseState,
        updates: null
      },
      awareness: null
    });
  }

  applyInitialState(collabState) {
    const baseState = collabState?.yjs?.baseState;
    if (baseState) {
      Y.applyUpdate(this.ydoc, base64ToUint8(baseState), this);
    }

    const updates = collabState?.yjs?.updates || {};
    sortUpdates(Object.entries(updates)).forEach(([key, record]) => {
      if (!record?.update) return;
      this.appliedUpdateKeys.add(key);
      Y.applyUpdate(this.ydoc, base64ToUint8(record.update), this);
    });
  }

  handleDocUpdate(update, origin) {
    if (this.destroyed || this.readOnly || origin === this) return;

    this.pendingUpdates.push(update);
    window.clearTimeout(this.flushTimer);
    this.flushTimer = window.setTimeout(() => {
      this.flushUpdates().catch(error => {
        console.warn('Could not publish collaborative edit:', error);
      });
    }, UPDATE_BATCH_MS);
  }

  async flushUpdates() {
    if (this.destroyed || this.readOnly || !this.pendingUpdates.length) return;

    const updates = this.pendingUpdates.splice(0, this.pendingUpdates.length);
    const merged = updates.length === 1 ? updates[0] : Y.mergeUpdates(updates);
    const updateRef = this.updatesRef.push();
    await updateRef.set({
      update: uint8ToBase64(merged),
      clientId: this.clientId,
      userId: this.currentUser?.id || null,
      createdAt: serverTimestamp()
    });
  }

  handleRemoteUpdate(snapshot) {
    if (this.destroyed) return;
    const key = snapshot.key;
    if (!key || this.appliedUpdateKeys.has(key)) return;

    const record = snapshot.val();
    this.appliedUpdateKeys.add(key);
    if (!record?.update || record.clientId === this.clientId) return;

    try {
      Y.applyUpdate(this.ydoc, base64ToUint8(record.update), this);
    } catch (error) {
      console.warn('Could not apply collaborative edit:', error);
    }
  }

  setupAwareness() {
    const user = {
      id: this.currentUser?.id || this.clientId,
      name: this.currentUser?.displayName || this.currentUser?.name || 'Collaborator',
      color: this.currentUser?.color || '#7c87e8',
      role: this.currentUser?.role || 'collaborator'
    };

    this.awareness.setLocalStateField('user', user);
    this.awareness.on('update', this.handleAwarenessUpdate);
    this.awarenessRef.on('child_added', this.handleRemoteAwareness);
    this.awarenessRef.on('child_changed', this.handleRemoteAwareness);
    this.awarenessRef.on('child_removed', this.handleRemoteAwarenessRemoved);
    this.localAwarenessRef.onDisconnect().remove();
    this.publishLocalAwareness();
  }

  handleAwarenessUpdate({ added, updated, removed }, origin) {
    if (this.destroyed || this.readOnly || origin === this) return;
    const localId = this.awareness.clientID;
    const changedLocal = [...added, ...updated, ...removed].includes(localId);
    if (!changedLocal) return;
    this.publishLocalAwareness();
  }

  publishLocalAwareness() {
    if (this.destroyed || this.readOnly) return;
    const localId = this.awareness.clientID;
    const localState = this.awareness.getLocalState();

    if (localState === null) {
      this.localAwarenessRef.remove();
      return;
    }

    const update = encodeAwarenessUpdate(this.awareness, [localId]);
    this.localAwarenessRef.set({
      update: uint8ToBase64(update),
      userId: this.currentUser?.id || null,
      updatedAt: serverTimestamp()
    });
  }

  handleRemoteAwareness(snapshot) {
    if (this.destroyed) return;
    if (String(snapshot.key) === this.clientId) return;
    const record = snapshot.val();
    if (!record?.update) return;

    try {
      applyAwarenessUpdate(this.awareness, base64ToUint8(record.update), this);
    } catch (error) {
      console.warn('Could not apply remote cursor state:', error);
    }
  }

  handleRemoteAwarenessRemoved(snapshot) {
    if (this.destroyed) return;
    const clientId = Number(snapshot.key);
    if (!Number.isFinite(clientId) || String(clientId) === this.clientId) return;
    removeAwarenessStates(this.awareness, [clientId], this);
  }

  getTextForFile(fileId) {
    this.knownFileIds.add(fileId);
    return this.ydoc.getText(`file:${fileId}`);
  }

  getFileContent(fileId) {
    return this.ydoc.getText(`file:${fileId}`).toString();
  }

  insertFileContent(fileId, content = '') {
    const text = this.getTextForFile(fileId);
    if (text.length || !content) return text;
    text.insert(0, String(content));
    return text;
  }

  isReady() {
    return this.ready && this.hasCollabState;
  }

  destroy() {
    if (this.destroyed) return;
    window.clearTimeout(this.flushTimer);
    this.flushUpdates().catch(() => {});
    this.destroyed = true;

    this.ydoc.off('update', this.handleDocUpdate);
    this.updatesRef.off('child_added', this.handleRemoteUpdate);
    this.awarenessRef.off('child_added', this.handleRemoteAwareness);
    this.awarenessRef.off('child_changed', this.handleRemoteAwareness);
    this.awarenessRef.off('child_removed', this.handleRemoteAwarenessRemoved);

    if (!this.readOnly) {
      this.localAwarenessRef.remove();
    }

    this.awareness.destroy();
    this.ydoc.destroy();
  }
}
