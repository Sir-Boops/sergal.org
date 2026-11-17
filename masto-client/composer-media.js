const composerMedia = (() => {
  const panel = document.querySelector('#composerMedia');
  const picker = document.querySelector('#mediaPicker');
  const button = document.querySelector('#attachMedia');
  const list = document.querySelector('#mediaAttachments');
  const status = document.querySelector('#mediaStatus');
  const attachments = [];
  let configSession, configRequest, limits;
  let busy = false;

  function allowed(session) {
    return String(session?.scope || '').split(/\s+/).some(scope => scope === 'write:media' || scope === 'write');
  }

  function loadLimits(session) {
    if (configSession === session) return configRequest;
    configSession = session;
    limits = null;
    configRequest = request(session.origin, '/api/v2/instance', {timeout: 5000}).then(({data}) => {
      const config = data?.configuration;
      return {
        max: Number.isInteger(config?.statuses?.max_media_attachments) ? config.statuses.max_media_attachments : 4,
        ...config?.media_attachments,
      };
    }).catch(() => ({max: 4})).then(config => {
      if (configSession === session) limits = config;
      return config;
    });
    return configRequest;
  }

  function kind(file) {
    const type = file.type;
    if (type === 'image/gif' || /\.gif$/i.test(file.name)) return 'gif';
    if (/^(image|video|audio)\//.test(type)) return type.split('/')[0];
    if (type && type !== 'application/octet-stream') return '';
    if (/\.(png|jpe?g|heic|heif|webp|avif)$/i.test(file.name)) return 'image';
    if (/\.(mp4|m4v|mov|webm)$/i.test(file.name)) return 'video';
    if (/\.(mp3|ogg|wav|flac|opus|aac|m4a|3gp)$/i.test(file.name)) return 'audio';
    return '';
  }

  function validate(items, config) {
    const max = config?.max ?? 4;
    if (items.length > max) throw Error('Your server allows up to ' + max + ' attachments per post.');
    if (items.length > 1 && items.some(item => kind(item.file) !== 'image')) {
      throw Error('Attach several images or one video, GIF, or audio file.');
    }
    for (const {file} of items) {
      const type = kind(file);
      if (!type || !file.size) throw Error(file.name + ': choose a supported image, video, or audio file.');
      const supported = config?.supported_mime_types;
      if (Array.isArray(supported) && file.type && file.type !== 'application/octet-stream' &&
          !supported.includes(file.type)) throw Error(file.name + ': your server does not support this file type.');
      const maxBytes = type === 'image' || type === 'gif' ? config?.image_size_limit : config?.video_size_limit;
      if (maxBytes > 0 && file.size > maxBytes) {
        throw Error(file.name + ': this file exceeds your server’s size limit (' +
          (maxBytes / 1048576).toFixed(1) + ' MB).');
      }
    }
  }

  function render() {
    list.replaceChildren();
    for (const item of attachments) {
      const row = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = item.file.name;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', 'Remove ' + item.file.name);
      remove.onclick = () => {
        attachments.splice(attachments.indexOf(item), 1);
        status.textContent = '';
        render();
        button.focus();
      };
      const description = document.createElement('input');
      description.type = 'text';
      description.maxLength = 1500;
      description.placeholder = 'Alt text (optional)';
      description.setAttribute('aria-label', 'Alt text for ' + item.file.name);
      description.value = item.description;
      description.oninput = () => {
        item.description = description.value;
        item.id = null;
        item.ready = false;
      };
      row.append(name, remove, description);
      list.append(row);
    }
  }

  button.onclick = () => {
    if (!accountSession || busy) return;
    if (!allowed(accountSession)) {
      openAccount('media');
      return;
    }
    void loadLimits(accountSession);
    picker.click();
  };

  picker.onchange = () => {
    const selected = [...picker.files].map(file => ({file, description: '', id: null, ready: false}));
    picker.value = '';
    if (!selected.length || !accountSession || busy) return;
    try {
      validate([...attachments, ...selected], limits);
      attachments.push(...selected);
      status.textContent = '';
      render();
    } catch (error) {
      status.textContent = error.message;
    }
  };

  function setBusy(value) {
    busy = value;
    panel.disabled = value;
  }

  function reset() {
    attachments.length = 0;
    picker.value = '';
    status.textContent = '';
    render();
  }

  function report(message) {
    status.textContent = message;
  }

  function waitForPoll(signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, 1500);
      signal.addEventListener('abort', abort, {once: true});
    });
  }

  async function upload(session, signal) {
    if (!attachments.length) return [];
    if (!allowed(session)) throw Error('Reconnect your Mastodon account to enable media uploads.');
    const config = await loadLimits(session);
    signal.throwIfAborted();
    validate(attachments, config);
    const send = (path, options) => request(session.origin, path, {token: session.token, signal, ...options});

    for (const [index, item] of attachments.entries()) {
      signal.throwIfAborted();
      if (item.ready) continue;
      if (!item.id) {
        report('Uploading attachment ' + (index + 1) + ' of ' + attachments.length + '…');
        const form = new FormData();
        form.append('file', item.file);
        if (item.description.trim()) form.append('description', item.description.trim());
        const {data, response} = await send('/api/v2/media', {method: 'POST', body: form, timeout: 300000});
        signal.throwIfAborted();
        if (!validPostID(data?.id)) throw Error('Your server did not return an attachment ID.');
        item.id = data.id;
        item.ready = response.status !== 202 && !!data.url;
      }
      if (!item.ready) {
        report('Waiting for the server to process ' + item.file.name + '…');
        const deadline = Date.now() + 60000;
        while (!item.ready && Date.now() < deadline) {
          await waitForPoll(signal);
          try {
            const {data, response} = await send('/api/v1/media/' + item.id);
            item.ready = response.status === 200 && !!data?.url;
          } catch (error) {
            if ([404, 422].includes(error.status)) item.id = null;
            throw error;
          }
        }
        if (!item.ready) throw Error('Your server is still processing the file. Tap Post again to retry.');
      }
    }
    return attachments.map(item => item.id);
  }

  return {allowed, setBusy, reset, report, upload, hasFiles: () => attachments.length > 0};
})();
