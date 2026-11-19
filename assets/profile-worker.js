'use strict';
let initialized = false;
self.onmessage = async function (event) {
  try {
    if (!initialized) {
      // Isolate the UMD export without enabling window.postMessage polyfills.
      self.window = {};
      try {
        importScripts('./forge.min.js');
        self.forge = self.window.forge;
      } finally { delete self.window; }
      importScripts('./profile-core.js');
      initialized = true;
    }
    const { template, account, type } = event.data;
    const result = await self.UpLocketProfile.generateProfile(template, account, type, self.forge, self.crypto);
    self.postMessage({ ok: true, result }, [result.bytes.buffer]);
  } catch (error) {
    self.postMessage({ ok: false, error: error.message || 'Không thể tạo hồ sơ. Vui lòng thử lại.' });
  }
};
