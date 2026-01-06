// DOM要素
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const resultsList = document.getElementById('resultsList');
const resultsTitle = document.getElementById('resultsTitle');
const resultsCount = document.getElementById('resultsCount');
const noResults = document.getElementById('noResults');
const welcomeMessage = document.getElementById('welcomeMessage');
const statusText = document.getElementById('statusText');
const statsText = document.getElementById('statsText');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');

// モーダル
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeModal = document.getElementById('closeModal');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const dropboxPathInput = document.getElementById('dropboxPath');
const selectFolderBtn = document.getElementById('selectFolderBtn');
const reindexBtn = document.getElementById('reindexBtn');
const totalFilesSpan = document.getElementById('totalFiles');
const lastIndexedSpan = document.getElementById('lastIndexed');

// 初期化
let indexedFiles = 0;
let totalToIndex = 0;

async function init() {
  // Dropboxパスの確認
  const dropboxPath = await window.electronAPI.getDropboxPath();

  if (dropboxPath) {
    dropboxPathInput.value = dropboxPath;
    statusText.textContent = `監視中: ${dropboxPath}`;
    welcomeMessage.style.display = 'none';
    updateStats();
  } else {
    statusText.textContent = 'Dropboxフォルダを設定してください';
    welcomeMessage.style.display = 'block';
  }
}

// 統計情報更新
async function updateStats() {
  const stats = await window.electronAPI.getStats();
  totalFilesSpan.textContent = stats.totalFiles.toLocaleString();

  if (stats.lastIndexed) {
    const date = new Date(stats.lastIndexed);
    lastIndexedSpan.textContent = date.toLocaleString('ja-JP');
  } else {
    lastIndexedSpan.textContent = '未実行';
  }

  statsText.textContent = `登録済み: ${stats.totalFiles.toLocaleString()}件`;
}

// 検索実行
async function performSearch() {
  const query = searchInput.value.trim();

  // ローディング表示
  resultsList.innerHTML = '<div style="text-align: center; padding: 40px; color: #999;">検索中...</div>';
  noResults.style.display = 'none';
  welcomeMessage.style.display = 'none';

  try {
    const results = await window.electronAPI.search(query);

    if (results.length === 0) {
      resultsList.innerHTML = '';
      noResults.style.display = 'block';
      resultsCount.textContent = '';
      return;
    }

    // 検索結果を表示
    displayResults(results);
    resultsCount.textContent = `${results.length}件`;

  } catch (error) {
    console.error('Search error:', error);
    resultsList.innerHTML = '<div style="text-align: center; padding: 40px; color: #f44336;">検索エラーが発生しました</div>';
  }
}

// 検索結果を表示
function displayResults(results) {
  resultsList.innerHTML = '';

  results.forEach(result => {
    const item = createResultItem(result);
    resultsList.appendChild(item);
  });
}

// 検索結果アイテムを作成
function createResultItem(result) {
  const div = document.createElement('div');
  div.className = 'result-item';

  // ファイルアイコン
  const icon = getFileIcon(result.file_type);

  // メタデータ
  const metaItems = [];

  if (result.drawing_number) {
    metaItems.push(`<div class="meta-item"><span class="meta-label">図版:</span>${escapeHtml(result.drawing_number)}</div>`);
  }

  if (result.product_name) {
    metaItems.push(`<div class="meta-item"><span class="meta-label">品名:</span>${escapeHtml(result.product_name)}</div>`);
  }

  if (result.part_name) {
    metaItems.push(`<div class="meta-item"><span class="meta-label">部品名:</span>${escapeHtml(result.part_name)}</div>`);
  }

  if (result.client_name) {
    metaItems.push(`<div class="meta-item"><span class="meta-label">施主:</span>${escapeHtml(result.client_name)}</div>`);
  }

  if (result.updated_at) {
    const date = new Date(result.updated_at);
    metaItems.push(`<div class="meta-item"><span class="meta-label">更新:</span>${date.toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })}</div>`);
  }

  const fileSize = result.file_size ? formatFileSize(result.file_size) : '';
  if (fileSize) {
    metaItems.push(`<div class="meta-item"><span class="meta-label">サイズ:</span>${fileSize}</div>`);
  }

  div.innerHTML = `
    <div class="result-header">
      <div class="file-icon">${icon}</div>
      <div class="result-title">
        <h3>${escapeHtml(result.file_name)}</h3>
      </div>
    </div>
    <div class="result-meta">
      ${metaItems.join('')}
    </div>
    <div class="result-path">${escapeHtml(result.file_path)}</div>
    <div class="result-actions">
      <button class="action-btn open-file-btn">📄 開く</button>
      <button class="action-btn action-btn-secondary open-folder-btn">📁 フォルダを開く</button>
    </div>
  `;

  // イベントリスナー
  const openFileBtn = div.querySelector('.open-file-btn');
  const openFolderBtn = div.querySelector('.open-folder-btn');

  openFileBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const response = await window.electronAPI.openFile(result.file_path);
    if (!response.success) {
      alert('ファイルを開けませんでした: ' + response.error);
    }
  });

  openFolderBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const response = await window.electronAPI.openFolder(result.file_path);
    if (!response.success) {
      alert('フォルダを開けませんでした: ' + response.error);
    }
  });

  // アイテム全体をクリックしてもファイルを開く
  div.addEventListener('click', async () => {
    const response = await window.electronAPI.openFile(result.file_path);
    if (!response.success) {
      alert('ファイルを開けませんでした: ' + response.error);
    }
  });

  return div;
}

// ファイルタイプに応じたアイコン
function getFileIcon(fileType) {
  const icons = {
    'pdf': '📄',
    'dwg': '📐',
    'dxf': '📐',
    'jpg': '🖼️',
    'jpeg': '🖼️',
    'png': '🖼️',
    'tiff': '🖼️',
    'tif': '🖼️'
  };
  return icons[fileType] || '📄';
}

// ファイルサイズをフォーマット
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

// HTMLエスケープ
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// イベントリスナー設定

// 検索ボタン
searchBtn.addEventListener('click', performSearch);

// Enterキーで検索
searchInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    performSearch();
  }
});

// 設定モーダル
settingsBtn.addEventListener('click', () => {
  settingsModal.style.display = 'block';
  updateStats();
});

closeModal.addEventListener('click', () => {
  settingsModal.style.display = 'none';
});

closeSettingsBtn.addEventListener('click', () => {
  settingsModal.style.display = 'none';
});

// モーダル外クリックで閉じる
window.addEventListener('click', (e) => {
  if (e.target === settingsModal) {
    settingsModal.style.display = 'none';
  }
});

// フォルダ選択
selectFolderBtn.addEventListener('click', async () => {
  const result = await window.electronAPI.selectFolder();

  if (result.success) {
    dropboxPathInput.value = result.path;
    statusText.textContent = `監視中: ${result.path}`;
    welcomeMessage.style.display = 'none';
    progressContainer.style.display = 'block';
    progressText.textContent = 'インデックス作成を開始しています...';
  }
});

// 再インデックス
reindexBtn.addEventListener('click', async () => {
  if (!confirm('再インデックスを実行しますか？\n全てのファイルを再スキャンします。（30分〜1時間程度かかります）')) {
    return;
  }

  const result = await window.electronAPI.reindex();

  if (result.success) {
    alert('再インデックスを開始しました。\n完了までしばらくお待ちください。');
    progressContainer.style.display = 'block';
    progressText.textContent = 'インデックス作成を開始しています...';
    settingsModal.style.display = 'none';
  } else {
    alert('エラー: ' + result.error);
  }
});

// ファイルインデックス完了イベント
window.electronAPI.onFileIndexed((data) => {
  indexedFiles++;
  progressContainer.style.display = 'block';
  progressText.textContent = `インデックス作成中... ${indexedFiles}件処理済み (残り: ${data.remaining}件)`;

  // 進捗バーの更新（おおよそ）
  if (data.remaining > 0) {
    const total = indexedFiles + data.remaining;
    const percent = (indexedFiles / total) * 100;
    progressFill.style.width = percent + '%';
  }

  // 統計更新
  updateStats();
});

// インデックス完了イベント
window.electronAPI.onIndexingComplete(() => {
  progressContainer.style.display = 'none';
  statusText.textContent = 'インデックス作成完了';
  indexedFiles = 0;
  updateStats();

  // 完了通知
  setTimeout(() => {
    statusText.textContent = `監視中: ${dropboxPathInput.value}`;
  }, 3000);
});

// インデックスエラー
window.electronAPI.onIndexError((data) => {
  console.error('Index error:', data);
});

// 初期化実行
init();
