/**
 * 安全加密核心库 (基于现代 Web Crypto API)
 * - 密钥派生: PBKDF2 (SHA-256, 100,000次迭代)
 * - 对称加密: AES-GCM 256位, 每次随机生成 12 字节 IV
 * - 零知识架构: 服务端仅存密文和加盐 verifier，永远接触不到主密码和明文数据
 */

const CryptoEngine = {
  // 生成安全随机字节并转为 Base64
  getRandomBase64(bytes = 16) {
    const array = new Uint8Array(bytes);
    window.crypto.getRandomValues(array);
    return this.bufferToBase64(array.buffer);
  },

  bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  },

  base64ToBuffer(base64) {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  },

  // 从主密码生成主密钥 (AES-GCM key)
  async deriveKey(masterPassword, saltBase64) {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      "raw",
      enc.encode(masterPassword),
      "PBKDF2",
      false,
      ["deriveKey", "deriveBits"]
    );

    const salt = this.base64ToBuffer(saltBase64);

    const key = await window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: new Uint8Array(salt),
        iterations: 100000,
        hash: "SHA-256"
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );

    return key;
  },

  // 生成用于登录验证的特征码 verifier (二次哈希，避免服务端推算主密码)
  async generateVerifier(masterPassword, saltBase64) {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      "raw",
      enc.encode(masterPassword),
      "PBKDF2",
      false,
      ["deriveBits"]
    );

    const salt = this.base64ToBuffer(saltBase64);
    const bits = await window.crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: new Uint8Array(salt),
        iterations: 100000,
        hash: "SHA-256"
      },
      keyMaterial,
      256
    );

    // 再做一次 SHA-256 作为 verifier
    const hash = await window.crypto.subtle.digest("SHA-256", bits);
    return this.bufferToBase64(hash);
  },

  // 加密任意 JavaScript 对象或字符串
  async encrypt(dataObj, cryptoKey) {
    const enc = new TextEncoder();
    const rawData = enc.encode(JSON.stringify(dataObj));
    const iv = new Uint8Array(12);
    window.crypto.getRandomValues(iv);

    const encryptedContent = await window.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv
      },
      cryptoKey,
      rawData
    );

    return JSON.stringify({
      iv: this.bufferToBase64(iv.buffer),
      ciphertext: this.bufferToBase64(encryptedContent)
    });
  },

  // 解密密文
  async decrypt(payloadStr, cryptoKey) {
    try {
      const payload = JSON.parse(payloadStr);
      const iv = new Uint8Array(this.base64ToBuffer(payload.iv));
      const ciphertext = this.base64ToBuffer(payload.ciphertext);

      const decrypted = await window.crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: iv
        },
        cryptoKey,
        ciphertext
      );

      const dec = new TextDecoder();
      return JSON.parse(dec.decode(decrypted));
    } catch (e) {
      console.error("解密失败:", e);
      throw new Error("密码错误或密文被篡改");
    }
  },

  // 生成高强度随机密码
  generatePassword(options = {}) {
    const {
      length = 16,
      useUpper = true,
      useLower = true,
      useDigits = true,
      useSymbols = true,
      excludeSimilar = false
    } = options;

    let upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let lower = "abcdefghijklmnopqrstuvwxyz";
    let digits = "0123456789";
    let symbols = "!@#$%^&*()_+-=[]{}|;:,.<>?";

    if (excludeSimilar) {
      upper = upper.replace(/[IO]/g, "");
      lower = lower.replace(/[lo]/g, "");
      digits = digits.replace(/[01]/g, "");
      symbols = symbols.replace(/[|]/g, "");
    }

    let charPool = "";
    const mandatory = [];

    if (useUpper && upper) { charPool += upper; mandatory.push(upper[Math.floor(Math.random() * upper.length)]); }
    if (useLower && lower) { charPool += lower; mandatory.push(lower[Math.floor(Math.random() * lower.length)]); }
    if (useDigits && digits) { charPool += digits; mandatory.push(digits[Math.floor(Math.random() * digits.length)]); }
    if (useSymbols && symbols) { charPool += symbols; mandatory.push(symbols[Math.floor(Math.random() * symbols.length)]); }

    if (!charPool) charPool = lower + digits;

    const randomBytes = new Uint32Array(length);
    window.crypto.getRandomValues(randomBytes);

    const result = [];
    for (let i = 0; i < length - mandatory.length; i++) {
      result.push(charPool[randomBytes[i] % charPool.length]);
    }
    result.push(...mandatory);

    // 随机打乱
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }

    return result.join("");
  }
};
