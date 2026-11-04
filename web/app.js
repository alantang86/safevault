// SafeVault 前端主逻辑

let currentMasterKey = null; // 内存中的派生 AES-GCM 密钥，锁定或刷新后清空
let vaultSalt = null;
let vaultVerifier = null;
let isInitialized = false;

let allEntries = [];
let currentFilter = {
  nav: 'all',     // all, favorite
  type: 'all',    // website, app, server, card, wifi, secret
  search: ''
};

const TYPE_CONFIG = {
  website: { label: '网站 / Web', icon: '🌐', color: '#3b82f6' },
  app:     { label: '软件 / APP', icon: '📱', color: '#8b5cf6' },
  server:  { label: '服务器 / DB', icon: '💻', color: '#10b981' },
  card:    { label: '银行卡 / 支付', icon: '💳', color: '#f59e0b' },
  wifi:    { label: 'Wi-Fi 密码', icon: '📶', color: '#06b6d4' },
  secret:  { label: '秘密备忘', icon: '📝', color: '#ec4899' }
};

// 初始化检查
window.addEventListener('DOMContentLoaded', async () => {
  await checkVaultStatus();
});

async function checkVaultStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    isInitialized = data.initialized;
    vaultSalt = data.salt;
    vaultVerifier = data.verifier;

    const lockTitle = document.getElementById('lock-title');
    const lockDesc = document.getElementById('lock-desc');
    const confirmGroup = document.getElementById('confirm-pwd-group');
    const submitBtn = document.getElementById('auth-submit-btn');

    if (!isInitialized) {
      lockTitle.innerText = "创建并初始化 SafeVault";
      lockDesc.innerText = "首次使用，请设置您的主密码（Master Password）。请务必牢记，丢失无法找回！";
      confirmGroup.style.display = "block";
      document.getElementById('confirm-pwd-input').required = true;
      submitBtn.innerText = "✨ 设置主密码并开启";
    } else {
      lockTitle.innerText = "SafeVault 已锁定";
      lockDesc.innerText = "请输入主密码以解密本地密码数据库。";
      confirmGroup.style.display = "none";
      document.getElementById('confirm-pwd-input').required = false;
      submitBtn.innerText = "🔓 解锁保险库";
    }

    document.getElementById('lock-screen').style.display = "flex";
  } catch (err) {
    showToast("无法连接本地服务: " + err.message, "error");
  }
}

// 主密码提交认证
async function handleMasterAuth(e) {
  e.preventDefault();
  const pwd = document.getElementById('master-pwd-input').value;
  if (!pwd) return;

  if (!isInitialized) {
    // 首次初始化
    const confirmPwd = document.getElementById('confirm-pwd-input').value;
    if (pwd !== confirmPwd) {
      showToast("两次输入的密码不一致！", "error");
      return;
    }
    if (pwd.length < 6) {
      showToast("为了安全，主密码建议至少6位以上！", "error");
      return;
    }

    const salt = CryptoEngine.getRandomBase64(16);
    const verifier = await CryptoEngine.generateVerifier(pwd, salt);

    const res = await fetch('/api/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ salt, verifier })
    });

    if (res.ok) {
      vaultSalt = salt;
      vaultVerifier = verifier;
      isInitialized = true;
      currentMasterKey = await CryptoEngine.deriveKey(pwd, salt);
      document.getElementById('lock-screen').style.display = "none";
      showToast("密码库初始化成功！");
      await loadEntries();
    } else {
      showToast("初始化失败", "error");
    }
  } else {
    // 解锁验证
    const testVerifier = await CryptoEngine.generateVerifier(pwd, vaultSalt);
    if (testVerifier === vaultVerifier) {
      currentMasterKey = await CryptoEngine.deriveKey(pwd, vaultSalt);
      document.getElementById('lock-screen').style.display = "none";
      document.getElementById('master-pwd-input').value = "";
      showToast("解锁成功");
      await loadEntries();
    } else {
      showToast("主密码错误，请重试！", "error");
      document.getElementById('master-pwd-input').select();
    }
  }
}

// 锁定保险库
function lockVault() {
  currentMasterKey = null;
  document.getElementById('master-pwd-input').value = "";
  document.getElementById('lock-screen').style.display = "flex";
  allEntries = [];
  renderEntries();
  showToast("保险库已锁定");
}

// 加载条目
async function loadEntries() {
  try {
    const res = await fetch('/api/entries');
    const data = await res.json();
    allEntries = data.entries || [];
    updateBadges();
    renderEntries();
  } catch (err) {
    showToast("获取条目失败: " + err.message, "error");
  }
}

// 侧边栏计数
function updateBadges() {
  document.getElementById('badge-all').innerText = allEntries.length;
  document.getElementById('badge-fav').innerText = allEntries.filter(e => e.is_favorite).length;

  for (const type of Object.keys(TYPE_CONFIG)) {
    const el = document.getElementById(`badge-${type}`);
    if (el) {
      el.innerText = allEntries.filter(e => e.type === type).length;
    }
  }
}

// 切换导航筛选
function selectNav(nav) {
  currentFilter.nav = nav;
  currentFilter.type = 'all';

  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const activeNav = document.querySelector(`.nav-item[data-filter-type="${nav}"]`);
  if (activeNav) activeNav.classList.add('active');

  const titleEl = document.getElementById('current-view-title');
  if (nav === 'all') titleEl.innerHTML = '<span>📦 全部条目</span>';
  if (nav === 'favorite') titleEl.innerHTML = '<span>⭐ 星标收藏</span>';

  renderEntries();
}

function filterByType(type) {
  currentFilter.type = type;
  currentFilter.nav = 'all';

  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const activeNav = document.querySelector(`.nav-item[data-type="${type}"]`);
  if (activeNav) activeNav.classList.add('active');

  const conf = TYPE_CONFIG[type];
  document.getElementById('current-view-title').innerHTML = `<span>${conf.icon} ${conf.label}</span>`;

  renderEntries();
}

function handleSearch(val) {
  currentFilter.search = val.trim().toLowerCase();
  renderEntries();
}

// 渲染列表卡片
function renderEntries() {
  const container = document.getElementById('cards-container');
  const emptyState = document.getElementById('empty-state');
  container.innerHTML = '';

  let list = allEntries.filter(entry => {
    if (currentFilter.nav === 'favorite' && !entry.is_favorite) return false;
    if (currentFilter.type !== 'all' && entry.type !== currentFilter.type) return false;
    if (currentFilter.search) {
      const q = currentFilter.search;
      const t = (entry.title || '').toLowerCase();
      const u = (entry.username_preview || '').toLowerCase();
      const w = (entry.website_url || '').toLowerCase();
      const c = (entry.category || '').toLowerCase();
      if (!t.includes(q) && !u.includes(q) && !w.includes(q) && !c.includes(q)) return false;
    }
    return true;
  });

  document.getElementById('current-count-info').innerText = `共 ${list.length} 个条目`;

  if (list.length === 0) {
    emptyState.style.display = 'flex';
    return;
  }
  emptyState.style.display = 'none';

  list.forEach(item => {
    const typeInfo = TYPE_CONFIG[item.type] || { icon: '🔑', label: '账号' };
    const card = document.createElement('div');
    card.className = 'vault-card';
    card.onclick = (e) => {
      // 避免点击卡片内部按钮时触发整个卡片点击
      if (e.target.closest('button')) return;
      viewEntryDetails(item.id);
    };

    card.innerHTML = `
      <div class="card-header">
        <div class="card-icon-title">
          <div class="type-avatar">${typeInfo.icon}</div>
          <div class="card-meta">
            <h4>${escapeHtml(item.title)}</h4>
            <span>${item.category ? escapeHtml(item.category) : typeInfo.label}</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="icon-btn favorite ${item.is_favorite ? 'active' : ''}" onclick="toggleFavorite('${item.id}', ${!item.is_favorite})" title="收藏">
            ${item.is_favorite ? '★' : '☆'}
          </button>
        </div>
      </div>

      <div class="card-details">
        ${item.username_preview ? `
          <div class="detail-row">
            <span class="detail-label">账号</span>
            <span class="detail-value">
              ${escapeHtml(item.username_preview)}
              <button class="icon-btn" onclick="copyText('${escapeHtml(item.username_preview)}', '账号已复制')" title="复制账号">📋</button>
            </span>
          </div>
        ` : ''}
        ${item.website_url ? `
          <div class="detail-row">
            <span class="detail-label">网址</span>
            <span class="detail-value" style="max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              <a href="${escapeHtml(item.website_url)}" target="_blank" onclick="event.stopPropagation();" style="color: var(--primary); text-decoration: none;">
                ${escapeHtml(item.website_url)} ↗
              </a>
            </span>
          </div>
        ` : ''}
        <div class="detail-row">
          <span class="detail-label">密码</span>
          <span class="detail-value">
            ••••••••
            <button class="btn btn-secondary btn-sm" onclick="copyDecryptedPassword('${item.id}')" title="解密并复制密码">复制密码</button>
          </span>
        </div>
      </div>
    `;

    container.appendChild(card);
  });
}

// 快速解密并复制密码
async function copyDecryptedPassword(id) {
  const item = allEntries.find(e => e.id === id);
  if (!item || !currentMasterKey) return;
  try {
    const data = await CryptoEngine.decrypt(item.encrypted_payload, currentMasterKey);
    if (data.password) {
      await copyText(data.password, "密码已成功解密并复制到剪贴板！");
    } else {
      showToast("条目中无密码字段", "error");
    }
  } catch (err) {
    showToast("解密失败: " + err.message, "error");
  }
}

// 查看详情并解密完整信息
async function viewEntryDetails(id) {
  const item = allEntries.find(e => e.id === id);
  if (!item || !currentMasterKey) return;

  try {
    const data = await CryptoEngine.decrypt(item.encrypted_payload, currentMasterKey);
    const modalBody = document.getElementById('detail-body');
    const typeInfo = TYPE_CONFIG[item.type] || { icon: '🔑', label: '账号' };

    document.getElementById('detail-title').innerHTML = `${typeInfo.icon} ${escapeHtml(item.title)}`;

    modalBody.innerHTML = `
      <div class="form-group">
        <label class="form-label">类型 / 分类</label>
        <div>
          <span class="badge badge-category">${typeInfo.label}</span>
          ${item.category ? `<span class="badge badge-category" style="margin-left: 6px;">${escapeHtml(item.category)}</span>` : ''}
        </div>
      </div>

      ${item.username_preview ? `
        <div class="form-group">
          <label class="form-label">账号 / 用户名</label>
          <div class="input-with-action">
            <input type="text" class="form-input" value="${escapeHtml(item.username_preview)}" readonly>
            <button class="btn btn-secondary" onclick="copyText('${escapeHtml(item.username_preview)}', '账号已复制')">📋 复制</button>
          </div>
        </div>
      ` : ''}

      <div class="form-group">
        <label class="form-label">密码 / 密钥</label>
        <div class="input-with-action">
          <input type="password" id="detail-pwd-field" class="form-input" value="${escapeHtml(data.password || '')}" readonly>
          <button class="btn btn-secondary" onclick="togglePasswordVisibility('detail-pwd-field')">👁️</button>
          <button class="btn btn-primary" onclick="copyText('${escapeHtml(data.password || '')}', '密码已复制')">📋 复制</button>
        </div>
      </div>

      ${item.website_url ? `
        <div class="form-group">
          <label class="form-label">网址 / 访问链接</label>
          <div class="input-with-action">
            <input type="text" class="form-input" value="${escapeHtml(item.website_url)}" readonly>
            <a href="${escapeHtml(item.website_url)}" target="_blank" class="btn btn-secondary">🌐 打开</a>
          </div>
        </div>
      ` : ''}

      ${data.notes ? `
        <div class="form-group">
          <label class="form-label">安全备忘 / 补充数据</label>
          <textarea class="form-textarea" rows="4" readonly>${escapeHtml(data.notes)}</textarea>
        </div>
      ` : ''}

      <div style="font-size: 11px; color: var(--text-muted); margin-top: 10px;">
        更新时间: ${item.updated_at || item.created_at}
      </div>
    `;

    document.getElementById('detail-delete-btn').onclick = () => deleteEntry(item.id);
    document.getElementById('detail-edit-btn').onclick = () => {
      closeModal('detail-modal');
      openEditEntryModal(item, data);
    };

    openModal('detail-modal');
  } catch (err) {
    showToast("解密条目详情失败: " + err.message, "error");
  }
}

// 打开新建条目弹窗
function openEntryModal() {
  document.getElementById('entry-modal-title').innerText = "新建密码条目";
  document.getElementById('entry-id').value = "";
  document.getElementById('entry-title').value = "";
  document.getElementById('entry-type').value = currentFilter.type !== 'all' ? currentFilter.type : "website";
  document.getElementById('entry-category').value = "";
  document.getElementById('entry-username').value = "";
  document.getElementById('entry-password').value = "";
  document.getElementById('entry-url').value = "";
  document.getElementById('entry-notes').value = "";
  openModal('entry-modal');
}

// 打开编辑条目弹窗
function openEditEntryModal(item, decryptedData) {
  document.getElementById('entry-modal-title').innerText = "编辑密码条目";
  document.getElementById('entry-id').value = item.id;
  document.getElementById('entry-title').value = item.title;
  document.getElementById('entry-type').value = item.type;
  document.getElementById('entry-category').value = item.category || "";
  document.getElementById('entry-username').value = item.username_preview || "";
  document.getElementById('entry-password').value = decryptedData.password || "";
  document.getElementById('entry-url').value = item.website_url || "";
  document.getElementById('entry-notes').value = decryptedData.notes || "";
  openModal('entry-modal');
}

// 保存条目 (新建或更新)
async function saveEntry() {
  const id = document.getElementById('entry-id').value || 'entry_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  const title = document.getElementById('entry-title').value.trim();
  const type = document.getElementById('entry-type').value;
  const category = document.getElementById('entry-category').value.trim();
  const username = document.getElementById('entry-username').value.trim();
  const password = document.getElementById('entry-password').value;
  const website_url = document.getElementById('entry-url').value.trim();
  const notes = document.getElementById('entry-notes').value;

  if (!title) {
    showToast("请输入标题/服务名称", "error");
    return;
  }
  if (!password) {
    showToast("请输入密码", "error");
    return;
  }
  if (!currentMasterKey) {
    showToast("保险库未解锁", "error");
    return;
  }

  try {
    // 端到端加密详细机密数据
    const secretPayload = {
      username: username,
      password: password,
      notes: notes,
      updated_at: new Date().toISOString()
    };

    const encrypted_payload = await CryptoEngine.encrypt(secretPayload, currentMasterKey);

    const isEditing = !!document.getElementById('entry-id').value;
    const url = isEditing ? `/api/entries/${id}` : `/api/entries`;
    const method = isEditing ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        title,
        type,
        category,
        username_preview: username,
        website_url,
        encrypted_payload
      })
    });

    if (res.ok) {
      closeModal('entry-modal');
      showToast(isEditing ? "条目已更新" : "新建条目成功");
      await loadEntries();
    } else {
      showToast("保存失败", "error");
    }
  } catch (err) {
    showToast("保存出错: " + err.message, "error");
  }
}

// 切换收藏
async function toggleFavorite(id, isFav) {
  try {
    const res = await fetch(`/api/entries/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_favorite: isFav })
    });
    if (res.ok) {
      const item = allEntries.find(e => e.id === id);
      if (item) item.is_favorite = isFav;
      updateBadges();
      renderEntries();
    }
  } catch (err) {
    showToast("切换收藏失败", "error");
  }
}

// 删除条目
async function deleteEntry(id) {
  if (!confirm("确定要永久删除此条目吗？此操作无法撤销。")) return;
  try {
    const res = await fetch(`/api/entries/${id}`, { method: 'DELETE' });
    if (res.ok) {
      closeModal('detail-modal');
      showToast("条目已删除");
      await loadEntries();
    }
  } catch (err) {
    showToast("删除失败", "error");
  }
}

// 导出备份 (含加盐验证和加密密文，可安全离线存储)
async function exportVaultData() {
  try {
    const res = await fetch('/api/export');
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SafeVault_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("备份文件已下载保存");
  } catch (err) {
    showToast("导出备份失败: " + err.message, "error");
  }
}

// 触发导入
function triggerImport() {
  document.getElementById('import-file-input').click();
}

async function handleImportFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.entries || !Array.isArray(data.entries)) {
        showToast("无效的备份文件结构", "error");
        return;
      }

      const res = await fetch('/api/entries/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: data.entries })
      });

      if (res.ok) {
        const result = await res.json();
        showToast(`成功恢复/导入 ${result.count} 条记录`);
        await loadEntries();
      } else {
        showToast("导入失败", "error");
      }
    } catch (err) {
      showToast("解析备份文件错误: " + err.message, "error");
    }
    event.target.value = '';
  };
  reader.readAsText(file);
}

// 密码生成器模块
function openGeneratorModal() {
  regeneratePassword();
  openModal('gen-modal');
}

function updateGenLength(val) {
  document.getElementById('gen-length-val').innerText = val;
  regeneratePassword();
}

function regeneratePassword() {
  const length = parseInt(document.getElementById('gen-length').value, 10);
  const useUpper = document.getElementById('gen-upper').checked;
  const useLower = document.getElementById('gen-lower').checked;
  const useDigits = document.getElementById('gen-digits').checked;
  const useSymbols = document.getElementById('gen-symbols').checked;
  const excludeSimilar = document.getElementById('gen-exclude-similar').checked;

  const pwd = CryptoEngine.generatePassword({
    length,
    useUpper,
    useLower,
    useDigits,
    useSymbols,
    excludeSimilar
  });

  document.getElementById('gen-result').value = pwd;
}

function quickGeneratePassword(targetInputId) {
  const pwd = CryptoEngine.generatePassword({ length: 16 });
  const el = document.getElementById(targetInputId);
  el.value = pwd;
  el.type = 'text';
  showToast("已自动生成16位强密码");
}

function togglePasswordVisibility(inputId) {
  const el = document.getElementById(inputId);
  el.type = el.type === 'password' ? 'text' : 'password';
}

// 复制文字助手
async function copyText(text, successMsg = "已复制到剪贴板") {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMsg);
  } catch (err) {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    showToast(successMsg);
  }
}

// 弹窗通用控制
function openModal(id) {
  document.getElementById(id).classList.add('show');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('show');
}

// Toast
function showToast(msg, type = "info") {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span>${type === 'error' ? '❌' : '✅'}</span> <span>${escapeHtml(msg)}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 2500);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
