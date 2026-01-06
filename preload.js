const { contextBridge, ipcRenderer } = require('electron');

// レンダラープロセスに安全にAPIを公開
contextBridge.exposeInMainWorld('electronAPI', {
  // Dropboxフォルダ選択
  selectFolder: () => ipcRenderer.invoke('select-folder'),

  // Dropboxフォルダパス取得
  getDropboxPath: () => ipcRenderer.invoke('get-dropbox-path'),

  // 検索実行
  search: (query) => ipcRenderer.invoke('search', query),

  // ファイルを開く
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),

  // フォルダを開く
  openFolder: (filePath) => ipcRenderer.invoke('open-folder', filePath),

  // 統計情報取得
  getStats: () => ipcRenderer.invoke('get-stats'),

  // 再インデックス
  reindex: () => ipcRenderer.invoke('reindex'),

  // イベントリスナー
  onFileIndexed: (callback) => {
    ipcRenderer.on('file-indexed', (event, data) => callback(data));
  },

  onFileRemoved: (callback) => {
    ipcRenderer.on('file-removed', (event, data) => callback(data));
  },

  onIndexingComplete: (callback) => {
    ipcRenderer.on('indexing-complete', () => callback());
  },

  onIndexError: (callback) => {
    ipcRenderer.on('index-error', (event, data) => callback(data));
  }
});
