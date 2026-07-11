const Dialog = (() => {
  let rootEl = null;
  let cardEl = null;
  let titleEl = null;
  let bodyEl = null;
  let footerEl = null;
  let resolveFn = null;
  let queue = Promise.resolve();
  let backdropMouseDown = false;

  function ensureRoot() {
    if (rootEl) return;

    rootEl = document.createElement('div');
    rootEl.id = 'app-dialog';
    rootEl.className = 'app-dialog hidden';
    rootEl.setAttribute('role', 'presentation');
    rootEl.innerHTML = `
      <div class="app-dialog-card" role="dialog" aria-modal="true" aria-labelledby="app-dialog-title">
        <div class="app-dialog-header">
          <span id="app-dialog-title" class="app-dialog-title"></span>
          <button type="button" class="app-dialog-close" aria-label="Close">✕</button>
        </div>
        <div class="app-dialog-body"></div>
        <div class="app-dialog-footer"></div>
      </div>
    `;
    document.body.appendChild(rootEl);

    cardEl = rootEl.querySelector('.app-dialog-card');
    titleEl = rootEl.querySelector('.app-dialog-title');
    bodyEl = rootEl.querySelector('.app-dialog-body');
    footerEl = rootEl.querySelector('.app-dialog-footer');

    rootEl.addEventListener('mousedown', (e) => {
      backdropMouseDown = e.target === rootEl;
    });
    rootEl.addEventListener('click', (e) => {
      if (backdropMouseDown && e.target === rootEl) finish(null);
      backdropMouseDown = false;
    });
    cardEl.addEventListener('mousedown', (e) => e.stopPropagation());
    cardEl.addEventListener('click', (e) => e.stopPropagation());
    rootEl.querySelector('.app-dialog-close')?.addEventListener('click', () => finish(null));
    document.addEventListener('keydown', onKeydown);
  }

  function onKeydown(e) {
    if (!rootEl || rootEl.classList.contains('hidden')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      finish(null);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      const primary = footerEl.querySelector('.btn-primary:not([disabled])');
      const inTextarea = e.target.tagName === 'TEXTAREA';
      if (primary && !inTextarea) {
        e.preventDefault();
        primary.click();
      }
    }
  }

  function finish(value) {
    if (!resolveFn) return;
    const resolve = resolveFn;
    resolveFn = null;
    rootEl.classList.add('hidden');
    document.body.classList.remove('dialog-open');
    resolve(value);
  }

  function button(label, className, value) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.textContent = label;
    btn.addEventListener('click', () => finish(value));
    return btn;
  }

  function runExclusive(task) {
    const run = () => task();
    queue = queue.then(run, run);
    return queue;
  }

  function show(config) {
    ensureRoot();
    titleEl.textContent = config.title || '';
    bodyEl.innerHTML = '';
    footerEl.innerHTML = '';

    if (config.messageHtml || config.message) {
      const msg = document.createElement(config.messageHtml ? 'div' : 'p');
      msg.className = config.messageHtml ? 'app-dialog-message app-dialog-message--html' : 'app-dialog-message';
      if (config.messageHtml) {
        msg.innerHTML = config.messageHtml;
        cardEl.classList.add('app-dialog-card--wide');
      } else {
        msg.textContent = config.message;
        cardEl.classList.remove('app-dialog-card--wide');
      }
      bodyEl.appendChild(msg);
    } else {
      cardEl.classList.remove('app-dialog-card--wide');
    }

    const focusables = [];

    if (config.type === 'prompt' || config.type === 'form') {
      const fields = config.type === 'prompt'
        ? [{ id: 'value', label: config.label || config.message || '', value: config.defaultValue || '' }]
        : config.fields || [];

      const form = document.createElement('div');
      form.className = 'app-dialog-form';

      fields.forEach((field) => {
        const wrap = document.createElement('div');
        wrap.className = 'app-dialog-field';

        const label = document.createElement('label');
        label.className = 'app-dialog-label';
        label.htmlFor = `app-dialog-${field.id}`;
        label.textContent = field.label || '';
        wrap.appendChild(label);

        if (field.hint) {
          const hint = document.createElement('span');
          hint.className = 'app-dialog-hint';
          hint.textContent = field.hint;
          wrap.appendChild(hint);
        }

        if (field.type === 'file') {
          const input = document.createElement('input');
          input.type = 'file';
          input.id = `app-dialog-${field.id}`;
          input.className = 'app-dialog-input';
          if (field.accept) input.accept = field.accept;
          wrap.appendChild(input);
          form.appendChild(wrap);
          return;
        }

        if (field.type === 'range') {
          const row = document.createElement('div');
          row.className = 'app-dialog-range-row';

          const range = document.createElement('input');
          range.type = 'range';
          range.id = `app-dialog-${field.id}`;
          range.className = 'app-dialog-range';
          range.min = String(field.min ?? 0);
          range.max = String(field.max ?? 100);
          range.step = String(field.step ?? 1);
          range.value = String(field.value ?? field.min ?? 0);

          const valEl = document.createElement('span');
          valEl.className = 'app-dialog-range-value';
          const formatValue = field.formatValue || ((v) => String(v));
          const syncValue = () => {
            valEl.textContent = formatValue(Number(range.value));
          };
          range.addEventListener('input', syncValue);
          syncValue();

          row.appendChild(range);
          row.appendChild(valEl);
          wrap.appendChild(row);
          form.appendChild(wrap);
          focusables.push(range);
          return;
        }

        const input = document.createElement('input');
        input.type = field.type || 'text';
        input.id = `app-dialog-${field.id}`;
        input.className = 'app-dialog-input';
        input.value = field.value ?? '';
        if (field.placeholder) input.placeholder = field.placeholder;
        if (field.min != null) input.min = String(field.min);
        if (field.max != null) input.max = String(field.max);
        if (field.step != null) input.step = String(field.step);
        wrap.appendChild(input);
        form.appendChild(wrap);
        focusables.push(input);
      });

      bodyEl.appendChild(form);
    }

    if (config.type === 'alert') {
      footerEl.appendChild(button(config.okLabel || 'OK', 'btn-primary', true));
    } else if (config.type === 'confirm') {
      footerEl.appendChild(button(config.cancelLabel || 'Cancel', 'btn-dialog', false));
      footerEl.appendChild(
        button(
          config.confirmLabel || 'OK',
          config.danger ? 'btn-primary btn-danger' : 'btn-primary',
          true
        )
      );
    } else if (config.type === 'prompt' || config.type === 'form') {
      footerEl.appendChild(button(config.cancelLabel || 'Cancel', 'btn-dialog', null));
      const submit = document.createElement('button');
      submit.type = 'button';
      submit.className = 'btn-primary';
      submit.textContent = config.submitLabel || 'OK';
      submit.addEventListener('click', async () => {
        if (config.type === 'prompt') {
          const input = bodyEl.querySelector('.app-dialog-input');
          finish(input?.value ?? '');
          return;
        }
        const values = {};
        for (const fieldEl of bodyEl.querySelectorAll('.app-dialog-field')) {
          const input = fieldEl.querySelector('[id^="app-dialog-"]');
          if (!input) continue;
          const key = input.id.replace('app-dialog-', '');
          if (input.type === 'file') {
            values[key] = input.files?.[0] || null;
          } else {
            values[key] = input.value;
          }
        }
        finish(values);
      });
      footerEl.appendChild(submit);
      focusables[0]?.focus();
    } else if (config.type === 'choose') {
      (config.buttons || []).forEach((btnCfg, index) => {
        const cls = btnCfg.primary
          ? (btnCfg.danger ? 'btn-primary btn-danger' : 'btn-primary')
          : 'btn-dialog';
        const btn = button(btnCfg.label, cls, btnCfg.id);
        if (index === 0 && !config.buttons.some((b) => b.primary)) {
          btn.classList.add('btn-primary');
        }
        footerEl.appendChild(btn);
      });
    }

    return new Promise((resolve) => {
      resolveFn = resolve;
      rootEl.classList.remove('hidden');
      document.body.classList.add('dialog-open');

      if (config.type === 'alert' || config.type === 'confirm') {
        const primary = footerEl.querySelector('.btn-primary');
        primary?.focus();
      } else if (config.type === 'choose') {
        footerEl.querySelector('button')?.focus();
      }
    });
  }

  function init() {
    ensureRoot();
  }

  function alert(message, options = {}) {
    return runExclusive(() =>
      show({
        type: 'alert',
        title: options.title || (typeof SITE !== 'undefined' ? SITE.name : 'Storage Hub'),
        message,
        okLabel: options.okLabel || 'OK',
      })
    );
  }

  function confirm(message, options = {}) {
    return runExclusive(() =>
      show({
        type: 'confirm',
        title: options.title || 'Confirm',
        message,
        confirmLabel: options.confirmLabel || 'OK',
        cancelLabel: options.cancelLabel || 'Cancel',
        danger: !!options.danger,
      })
    );
  }

  function prompt(label, defaultValue = '', options = {}) {
    return runExclusive(() =>
      show({
        type: 'prompt',
        title: options.title || label,
        label: options.fieldLabel || label,
        defaultValue,
        submitLabel: options.submitLabel || 'OK',
        cancelLabel: options.cancelLabel || 'Cancel',
      })
    );
  }

  function form(options) {
    return runExclusive(() =>
      show({
        type: 'form',
        title: options.title || 'Input',
        message: options.message || '',
        messageHtml: options.messageHtml || '',
        fields: options.fields || [],
        submitLabel: options.submitLabel || 'OK',
        cancelLabel: options.cancelLabel || 'Cancel',
      })
    );
  }

  function choose(options) {
    return runExclusive(() =>
      show({
        type: 'choose',
        title: options.title || 'Choose',
        message: options.message || '',
        messageHtml: options.messageHtml || '',
        buttons: options.buttons || [],
      })
    );
  }

  function resolveNameConflict({ name, isFolder = false, allowReplace = true, suggestAlternative }) {
    return runExclusive(async () => {
      const kind = isFolder ? 'folder' : 'file';
      const choice = await show({
        type: 'choose',
        title: isFolder ? 'Folder already exists' : 'File already exists',
        message: `A ${kind} named "${name}" already exists in this location.`,
        buttons: [
          ...(allowReplace && !isFolder
            ? [{ id: 'replace', label: 'Replace existing', primary: true }]
            : []),
          { id: 'rename', label: 'Choose another name', primary: isFolder },
          { id: 'alternative', label: 'Use alternative name' },
          { id: 'cancel', label: 'Cancel' },
        ],
      });

      if (!choice || choice === 'cancel') return null;
      if (choice === 'replace') return { action: 'replace' };
      if (choice === 'alternative') {
        const alt = typeof suggestAlternative === 'function'
          ? suggestAlternative()
          : `${name} (2)`;
        return { action: 'create', name: alt };
      }
      if (choice === 'rename') {
        const renamed = await show({
          type: 'prompt',
          title: isFolder ? 'New folder' : 'New file',
          label: 'Name:',
          defaultValue: name,
          submitLabel: 'Create',
          cancelLabel: 'Cancel',
        });
        const trimmed = renamed?.trim();
        return trimmed ? { action: 'create', name: trimmed } : null;
      }
      return null;
    });
  }

  return { init, alert, confirm, prompt, form, choose, resolveNameConflict };
})();
