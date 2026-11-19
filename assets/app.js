'use strict';
const form = document.getElementById('profile-form');
const accountInput = document.getElementById('account-id');
const errorBox = document.getElementById('form-error');
const createButton = document.getElementById('create-button');
const statusBox = document.getElementById('generation-status');
const resultBox = document.getElementById('result');
const consent = document.getElementById('profile-consent');
let worker = null, workerTimer = null, downloadUrl = null, generating = false, templatePromise = null;
function clearResult() {
  resultBox.hidden = true;
  if (downloadUrl) { URL.revokeObjectURL(downloadUrl); downloadUrl = null; }
  document.getElementById('download-profile').removeAttribute('href');
}
function updatePreview() {
  clearResult(); errorBox.hidden = true; accountInput.removeAttribute('aria-invalid');
  const account = accountInput.value.trim().replace(/^@/, '').toLowerCase();
  document.getElementById('preview-name').textContent = 'UpLocket · @' + (account || 'bạn');
}
accountInput.addEventListener('input', updatePreview);
consent.addEventListener('change', () => { if (!consent.checked) clearResult(); errorBox.hidden = true; consent.removeAttribute('aria-invalid'); });
function setBusy(busy) {
  generating = busy; createButton.disabled = busy; accountInput.disabled = busy; consent.disabled = busy;
  createButton.querySelector('span').textContent = busy ? 'Đang chuẩn bị hồ sơ…' : 'Tạo hồ sơ theo ID';
  form.setAttribute('aria-busy', String(busy)); statusBox.hidden = !busy;
  statusBox.textContent = busy ? 'Đang tạo khóa, chứng chỉ và ký hồ sơ trên thiết bị của bạn. Vui lòng giữ tab này mở.' : '';
}
function showError(message, field) {
  errorBox.textContent = message; errorBox.hidden = false;
  if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
}
function loadTemplate() {
  if (!templatePromise) templatePromise = fetch('./assets/profile-template.json', { cache: 'no-cache', credentials: 'same-origin' })
    .then(response => { if (!response.ok) throw new Error('Không tải được hồ sơ mẫu. Kiểm tra kết nối rồi thử lại.'); return response.json(); })
    .catch(error => { templatePromise = null; throw error; });
  return templatePromise;
}
function stopWorker() { if (worker) { worker.terminate(); worker = null; } if (workerTimer) { clearTimeout(workerTimer); workerTimer = null; } }
form.addEventListener('submit', async event => {
  event.preventDefault(); if (generating) return; errorBox.hidden = true; clearResult();
  let account; const type = 'username';
  try { account = UpLocketProfile.normalizeAccount(accountInput.value, type); }
  catch (error) { showError(error.message, accountInput); return; }
  if (!consent.checked) { showError('Vui lòng xác nhận bạn đã đọc thông tin về DNS và chứng chỉ CA.', consent); return; }
  consent.removeAttribute('aria-invalid');
  if (!window.isSecureContext || !window.crypto?.subtle || !window.Worker) { showError('Thiết bị cần trình duyệt hỗ trợ Web Crypto qua HTTPS. Hãy mở bằng Safari bản mới.'); return; }
  setBusy(true);
  try {
    const template = await loadTemplate(); UpLocketProfile.checkTemplate(template);
    const result = await new Promise((resolve, reject) => {
      stopWorker(); worker = new Worker('./assets/profile-worker.js');
      workerTimer = setTimeout(() => { stopWorker(); reject(new Error('Tạo hồ sơ mất quá lâu. Hãy thử lại hoặc dùng trình duyệt mới hơn.')); }, 60000);
      worker.onmessage = event => { stopWorker(); event.data.ok ? resolve(event.data.result) : reject(new Error(event.data.error)); };
      worker.onerror = () => { stopWorker(); reject(new Error('Không khởi chạy được bộ ký. Hãy tải lại trang rồi thử lại.')); };
      worker.postMessage({ template, account, type });
    });
    downloadUrl = URL.createObjectURL(new Blob([result.bytes], { type: 'application/x-apple-aspen-config' }));
    const download = document.getElementById('download-profile'); download.href = downloadUrl; download.download = result.filename;
    document.getElementById('result-account').textContent = result.label;
    document.getElementById('result-signer').textContent = result.signer;
    document.getElementById('result-size').textContent = (result.bytes.byteLength / 1024).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' KB';
    setBusy(false); resultBox.hidden = false; resultBox.focus({ preventScroll: true });
    resultBox.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
  } catch (error) { stopWorker(); setBusy(false); showError(error.message || 'Có lỗi khi tạo hồ sơ. Vui lòng thử lại.'); }
});
window.addEventListener('pagehide', () => { stopWorker(); setBusy(false); clearResult(); });
