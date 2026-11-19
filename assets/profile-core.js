(function (root) {
  'use strict';
  const ACCOUNT_TYPES = ['username', 'uid'];
  function normalizeAccount(value, type) {
    if (!ACCOUNT_TYPES.includes(type)) throw new Error('Loại ID không hợp lệ.');
    if (typeof value !== 'string') throw new Error('Vui lòng nhập ID Locket.');
    let account = value.trim();
    if (type === 'username') account = account.replace(/^@/, '').toLowerCase();
    if (!account) throw new Error('Bạn chưa nhập ID Locket.');
    if (account.length > 64 || !/^[a-zA-Z0-9._-]+$/.test(account)) {
      throw new Error('ID cần có 1–64 ký tự: chữ, số, dấu chấm, gạch dưới hoặc gạch ngang.');
    }
    return account;
  }
  function escapeXml(value) {
    return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  }
  function plistValue(value) {
    if (typeof value === 'string') return `<string>${escapeXml(value)}</string>`;
    if (typeof value === 'boolean') return value ? '<true/>' : '<false/>';
    if (typeof value === 'number' && Number.isInteger(value)) return `<integer>${value}</integer>`;
    if (Array.isArray(value)) return `<array>${value.map(plistValue).join('')}</array>`;
    if (value && typeof value === 'object' && Object.keys(value).length === 1 && typeof value.__data === 'string') {
      if (!/^[A-Za-z0-9+/=\s]+$/.test(value.__data)) throw new Error('Dữ liệu chứng chỉ không hợp lệ.');
      return `<data>${value.__data}</data>`;
    }
    if (value && typeof value === 'object') return `<dict>${Object.entries(value).map(([key, v]) => `<key>${escapeXml(key)}</key>${plistValue(v)}`).join('')}</dict>`;
    throw new Error('Hồ sơ mẫu có dữ liệu không được hỗ trợ.');
  }
  function toXml(profile) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n' + plistValue(profile) + '\n</plist>\n';
  }
  function checkTemplate(template) {
    if (!template || template.PayloadType !== 'Configuration' || !Array.isArray(template.PayloadContent)) {
      throw new Error('Không đọc được hồ sơ mẫu. Vui lòng tải lại trang.');
    }
    const dns = template.PayloadContent.filter(p => p.PayloadType === 'com.apple.dnsSettings.managed');
    if (dns.length !== 1 || !dns[0].DNSSettings || !dns[0].DNSSettings.ServerURL) throw new Error('Hồ sơ thiếu cấu hình DNS.');
    const url = new URL(dns[0].DNSSettings.ServerURL);
    if (url.protocol !== 'https:') throw new Error('Máy chủ DNS phải sử dụng HTTPS.');
    return template;
  }
  async function buildProfile(template, value, type, cryptoApi) {
    const account = normalizeAccount(value, type);
    checkTemplate(template);
    const profile = JSON.parse(JSON.stringify(template));
    const label = type === 'username' ? '@' + account : account;
    const hashBytes = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(type + ':' + account));
    const hash = Array.from(new Uint8Array(hashBytes), b => b.toString(16).padStart(2, '0')).join('');
    profile.PayloadDisplayName = 'UpLocket · ' + label;
    profile.PayloadDescription = 'Cấu hình DNS-over-HTTPS UpLocket dành cho ' + label + '. Hồ sơ cá nhân hóa, không xác minh hay kích hoạt tài khoản Locket.';
    profile.PayloadIdentifier = 'com.uplocket.profile.' + hash.slice(0, 32);
    profile.PayloadUUID = cryptoApi.randomUUID().toUpperCase();
    profile.PayloadContent.forEach((payload, index) => {
      payload.PayloadUUID = cryptoApi.randomUUID().toUpperCase();
      payload.PayloadIdentifier = profile.PayloadIdentifier + '.payload' + index;
      if (payload.PayloadType === 'com.apple.dnsSettings.managed') {
        payload.PayloadDisplayName = 'UpLocket DNS · ' + label;
        payload.PayloadDescription = 'DNS theo hồ sơ mẫu. ID tài khoản: ' + label + '.';
      }
    });
    return { account, label, profile, xml: toXml(profile) };
  }
  function bytesToBinary(bytes) { return Array.from(new Uint8Array(bytes), b => String.fromCharCode(b)).join(''); }
  async function generateProfile(template, value, type, forge, cryptoApi) {
    if (!cryptoApi || !cryptoApi.subtle || !cryptoApi.randomUUID) throw new Error('Trình duyệt cần hỗ trợ Web Crypto. Hãy mở bằng Safari bản mới qua HTTPS.');
    const result = await buildProfile(template, value, type, cryptoApi);
    const pair = await cryptoApi.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    const [privateDer, publicDer] = await Promise.all([
      cryptoApi.subtle.exportKey('pkcs8', pair.privateKey), cryptoApi.subtle.exportKey('spki', pair.publicKey)
    ]);
    const key = forge.pki.privateKeyFromAsn1(forge.asn1.fromDer(bytesToBinary(privateDer)));
    const publicKey = forge.pki.publicKeyFromAsn1(forge.asn1.fromDer(bytesToBinary(publicDer)));
    const cert = forge.pki.createCertificate();
    cert.publicKey = publicKey;
    const serial = cryptoApi.getRandomValues(new Uint8Array(16));
    serial[0] = (serial[0] & 0x7f) | 1;
    cert.serialNumber = Array.from(serial, b => b.toString(16).padStart(2, '0')).join('');
    cert.validity.notBefore = new Date(Date.now() - 5 * 60 * 1000);
    cert.validity.notAfter = new Date(Date.now() + 365 * 86400 * 1000);
    const subject = [
      { name: 'commonName', value: ('UpLocket / ' + result.label).slice(0, 64), valueTagClass: forge.asn1.Type.UTF8 },
      { name: 'organizationName', value: 'UpLocket Network' },
      { name: 'organizationalUnitName', value: 'Personal profile - self-signed' }
    ];
    cert.setSubject(subject);
    cert.setIssuer(subject);
    cert.setExtensions([{ name: 'basicConstraints', cA: false, critical: true }, { name: 'keyUsage', digitalSignature: true, critical: true }]);
    cert.sign(key, forge.md.sha256.create());
    const cms = forge.pkcs7.createSignedData();
    cms.content = forge.util.createBuffer(result.xml, 'utf8');
    cms.addCertificate(cert);
    cms.addSigner({ key, certificate: cert, digestAlgorithm: forge.pki.oids.sha256, authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() }
    ] });
    cms.sign();
    const der = forge.asn1.toDer(cms.toAsn1()).getBytes();
    return {
      bytes: Uint8Array.from(der, c => c.charCodeAt(0)),
      filename: 'UpLocket_' + result.account + '.mobileconfig',
      account: result.account, label: result.label,
      signer: 'UpLocket / ' + result.label,
      expires: cert.validity.notAfter.toISOString(),
      uuid: result.profile.PayloadUUID
    };
  }
  const api = { normalizeAccount, escapeXml, toXml, checkTemplate, buildProfile, generateProfile };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UpLocketProfile = api;
})(typeof self !== 'undefined' ? self : globalThis);
