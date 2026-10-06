(function (root) {
  'use strict';
  const MiB = 1024 * 1024;
  const endpoint = '/api/drive?action=';

  function attachmentId(attachment) {
    if (!attachment || typeof attachment.id !== 'string' || !attachment.id) throw new Error('사진 정보를 찾을 수 없습니다.');
    return attachment.id;
  }

  async function decode(file) {
    if (typeof createImageBitmap === 'function') return createImageBitmap(file);
    const url = URL.createObjectURL(file);
    try {
      return await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('사진을 읽을 수 없습니다.'));
        image.src = url;
      });
    } finally { URL.revokeObjectURL(url); }
  }

  async function preview(image, longest, budget) {
    const canvas = document.createElement('canvas');
    try {
      let scale = Math.min(1, longest / Math.max(image.width, image.height));
      for (let attempt = 0; attempt < 12; attempt++) {
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('사진 변환을 지원하지 않는 브라우저입니다.');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        for (const quality of [0.86, 0.72, 0.58, 0.44]) {
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
          if (!blob || blob.type !== 'image/webp') throw new Error('WebP 사진 변환을 지원하지 않는 브라우저입니다.');
          if (blob.size > 0 && blob.size <= budget) return blob;
        }
        scale *= 0.75;
      }
      throw new Error('열람용 사진 용량을 줄이지 못했습니다. 다른 사진을 선택해 주세요.');
    } finally { canvas.width = 0; canvas.height = 0; }
  }

  root.createBioSEMDrivePhotos = function ({ client }) {
    async function headers(required) {
      const current = typeof client === 'function' ? client() : null;
      const result = current ? await current.auth.getSession() : null;
      if (result && result.error) throw new Error('로그인 상태를 확인하지 못했습니다.');
      const token = result && result.data && result.data.session && result.data.session.access_token;
      if (required && !token) throw new Error('로그인 후 다시 시도해 주세요.');
      return token ? { Authorization: 'Bearer ' + token } : {};
    }

    async function write(action, body, extraHeaders) {
      const auth = await headers(true);
      const response = await fetch(endpoint + action, {
        method: 'POST', cache: 'no-store', credentials: 'same-origin',
        headers: Object.assign({ 'Content-Type': extraHeaders ? 'application/octet-stream' : 'application/json' }, auth, extraHeaders),
        body: extraHeaders ? body : JSON.stringify(body),
      });
      if (!response.ok) throw new Error('사진 저장 요청에 실패했습니다. 다시 시도해 주세요.');
      const data = await response.json();
      if (!data || data.error) throw new Error('사진 저장 요청에 실패했습니다.');
      return data;
    }

    return {
      async status() {
        try {
          const response = await fetch(endpoint + 'status', { cache: 'no-store', credentials: 'same-origin' });
          if (!response.ok) return { configured: false };
          const data = await response.json();
          return { configured: !!data && data.configured === true };
        } catch (_) { return { configured: false }; }
      },

      async upload(attachment, file, onProgress) {
        const id = attachmentId(attachment);
        if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 50 * MiB) {
          throw new Error('50MB 이하의 JPG, PNG, WebP 사진만 저장할 수 있습니다.');
        }
        const report = text => { if (typeof onProgress === 'function') onProgress(text); };
        report('열람용 사진을 만드는 중입니다.');
        const image = await decode(file);
        let display, thumb;
        try {
          if (!Number.isFinite(image.width) || !Number.isFinite(image.height) || image.width <= 0 || image.height <= 0 || image.width * image.height > 80000000) {
            throw new Error('사진 해상도가 너무 큽니다. 8천만 화소 이하의 사진을 선택해 주세요.');
          }
          display = await preview(image, 2048, MiB);
          thumb = await preview(image, 600, 256 * 1024);
        } finally { if (typeof image.close === 'function') image.close(); }

        const initialized = await write('init', { attachmentId: id, displayBytes: display.size, thumbBytes: thumb.size });
        for (const variant of ['original', 'display', 'thumb']) {
          if (!initialized.sessions || !initialized.sessions[variant] || typeof initialized.sessions[variant].ticket !== 'string' || !initialized.sessions[variant].ticket) {
            throw new Error('사진 저장 연결을 시작하지 못했습니다.');
          }
        }
        const variants = [['original', file, '원본'], ['display', display, '열람용 사진'], ['thumb', thumb, '미리보기']];
        for (const [variant, blob, label] of variants) {
          for (let offset = 0; offset < blob.size; offset += MiB) {
            const chunk = blob.slice(offset, Math.min(offset + MiB, blob.size));
            await write('chunk', chunk, { 'x-upload-ticket': initialized.sessions[variant].ticket, 'x-upload-offset': String(offset) });
            report(label + ' 저장 중 ' + Math.round(Math.min(offset + chunk.size, blob.size) / blob.size * 100) + '%');
          }
        }
        report('사진 저장을 확인하는 중입니다.');
        const result = await write('complete', { attachmentId: id });
        report('사진 저장이 완료되었습니다.');
        return result;
      },

      async download(attachment, variant = 'display') {
        try {
          if (variant !== 'display' && variant !== 'thumb') throw new Error('열람용 사진만 다운로드할 수 있습니다.');
          const id = attachmentId(attachment);
          const response = await fetch(endpoint + 'media&id=' + encodeURIComponent(id) + '&variant=' + variant, {
            headers: await headers(false), cache: 'no-store', credentials: 'same-origin',
          });
          if (!response.ok) throw new Error('사진을 불러오지 못했습니다.');
          const data = await response.blob();
          if (data.type !== 'image/webp') throw new Error('사진 응답을 확인하지 못했습니다.');
          return { data, error: null };
        } catch (error) { return { data: null, error }; }
      },

      async remove(attachments) {
        try {
          for (const attachment of attachments) await write('delete', { attachmentId: attachmentId(attachment) });
          return { error: null };
        } catch (error) { return { error }; }
      },
    };
  };
})(window);
