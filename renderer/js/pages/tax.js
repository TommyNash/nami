async function renderTaxPage(root, data) {
    window.NamiLifecycle.destroy('tax');
    const aid = activeAccountIdFrom(data) || null;
    let sheet = { rate: 6, shift: 1, rows: [], stats: {} };
    try {
      sheet = (await window.NamiServices.tax.sheet(aid)) || sheet;
    } catch (err) {
      console.warn('[tax] tax_sheet:', err);
    }
    const rate = Number(sheet.rate);
    const shift = Number(sheet.shift);
    const stats = sheet.stats || {};
    const rows = Array.isArray(sheet.rows) ? sheet.rows : [];

    root.innerHTML = taxPageHtml({ rate, shift, stats, rows });

    const rerender = () => window.FoundersPages.tax(root, window.FoundersApp.state);
    const savedRate = String(rate);
    const savedShift = String(shift);

    const currentRate = () => {
      const n = parseMoneyInput(root.querySelector('#taxRate') && root.querySelector('#taxRate').value);
      return n == null ? rate : n;
    };

    const normMoney = (raw) => {
      const n = parseMoneyInput(raw);
      if (n == null || n < 0) return '';
      if (n === 0) return '';
      return formatMoneyInputValue(n);
    };

    const draftChron = () => {
      const r = currentRate();
      return [...root.querySelectorAll('tr[data-earn-month]')]
        .map((tr) => {
          const inp = tr.querySelector('[data-tax-earn]');
          const taxEarn = parseMoneyInput(inp && inp.value);
          const hasTax = taxEarn != null && taxEarn > 0;
          const consoleRaw = tr.dataset.console;
          const consoleEarn =
            consoleRaw !== '' && consoleRaw != null && Number.isFinite(Number(consoleRaw))
              ? Number(consoleRaw)
              : null;
          const due = hasTax ? (taxEarn * r) / 100 : null;
          return {
            earnMonth: tr.dataset.earnMonth || '',
            taxEarn: hasTax ? taxEarn : null,
            consoleEarn,
            taxDue: due,
            net: hasTax ? taxEarn - due : null
          };
        })
        .sort((a, b) => String(a.earnMonth).localeCompare(String(b.earnMonth)));
    };

    const paintTaxCharts = () => {
      const chron = draftChron().filter((r) => r.taxEarn != null || r.consoleEarn != null);
      const factHost = root.querySelector('#taxFactChart');
      const splitHost = root.querySelector('#taxSplitChart');
      const factBars = chron
        .filter((r) => r.taxEarn != null)
        .map((r) => ({
          label: formatMonthShort(r.earnMonth),
          title: formatMonthLabel(r.earnMonth),
          value: Number(r.taxEarn) || 0
        }));
      if (factHost) {
        if (factBars.length) {
          C().bars(factHost, factBars, {
            color: '#1e7a50',
            highlightColor: '#3dd68c',
            showAvg: true,
            trend: true,
            yAxis: true,
            allXLabels: true,
            height: 320,
            gapRatio: 0.12,
            formatY: moneyFmt,
            hideValueLabels: true,
            toolsHost: root.querySelector('#taxFactChartTools')
          });
        } else {
          factHost.innerHTML = `<div class="empty">${T('tax.chart.empty')}</div>`;
        }
      }
      const stacks = chron
        .filter((r) => r.taxEarn != null)
        .map((r) => ({
          label: formatMonthShort(r.earnMonth),
          title: formatMonthLabel(r.earnMonth),
          segments: [
            { key: 'net', label: T('tax.net'), value: Number(r.net) || 0, color: '#3dd68c' },
            { key: 'tax', label: T('tax.tax'), value: Number(r.taxDue) || 0, color: '#e3a93a' }
          ]
        }));
      if (splitHost) {
        if (stacks.length) {
          C().stackedBars(splitHost, stacks, {
            height: 320,
            yAxis: true,
            gapRatio: 0.16,
            formatY: moneyFmt,
            legend: [
              { label: T('tax.net'), color: '#3dd68c' },
              { label: T('tax.tax'), color: '#e3a93a' }
            ]
          });
        } else {
          splitHost.innerHTML = `<div class="empty">${T('tax.chart.empty')}</div>`;
        }
      }
    };

    const patchKpisFromRows = () => {
      const chron = draftChron();
      const vals = chron.map((r) => r.taxEarn).filter((n) => n != null && n > 0);
      const sum = vals.reduce((a, b) => a + b, 0);
      const avg = vals.length ? sum / vals.length : 0;
      const min = vals.length ? Math.min(...vals) : null;
      const max = vals.length ? Math.max(...vals) : null;
      const r = currentRate();
      const due = (sum * r) / 100;
      const net = sum - due;
      const setCard = (id, value, note) => {
        const card = root.querySelector(`[data-tax-kpi="${id}"]`);
        if (!card) return;
        const valEl = card.querySelector('.tax-kpi-value');
        const noteEl = card.querySelector('[data-tax-note]');
        if (valEl) {
          valEl.dataset.countup = String(value || 0);
          valEl.textContent = moneyOrDash(value);
        }
        if (noteEl && note != null) noteEl.textContent = note;
      };
      setCard('sum', sum, T('tax.months', { value: vals.length }));
      setCard('avg', avg, T('tax.avgRange', { min: moneyOrDash(min), max: moneyOrDash(max) }));
      setCard('due', due, T('tax.ofSum', { rate: r }));
      setCard('net', net, T('tax.afterTax'));
      const headMeta = root.querySelector('[data-tax-head-meta]');
      if (headMeta) {
        const shiftSel = root.querySelector('#taxShift');
        const s = shiftSel ? Number(shiftSel.value) : shift;
        headMeta.textContent = T('tax.headMeta', { rate: r, shift: shiftLabel(s), count: vals.length });
      }
      scheduleTaxCharts();
    };

    let taxChartTimer = null;
    window.NamiLifecycle.on('tax', () => {
      if (taxChartTimer) clearTimeout(taxChartTimer);
      taxChartTimer = null;
    });
    const scheduleTaxCharts = () => {
      if (taxChartTimer) clearTimeout(taxChartTimer);
      taxChartTimer = setTimeout(() => {
        taxChartTimer = null;
        paintTaxCharts();
      }, 280);
    };

    const patchRowComputed = (tr, taxEarn) => {
      const hasTax = taxEarn != null && taxEarn > 0;
      const r = currentRate();
      const due = hasTax ? (taxEarn * r) / 100 : null;
      const dueEl = tr.querySelector('[data-col="due"]');
      if (dueEl) dueEl.textContent = moneyOrDash(due);
    };

    const settingsDirty = () => {
      const rateInp = root.querySelector('#taxRate');
      const shiftSel = root.querySelector('#taxShift');
      const r = rateInp ? String(rateInp.value || '').trim() : savedRate;
      const s = shiftSel ? String(shiftSel.value) : savedShift;
      return r !== savedRate || s !== savedShift;
    };

    const rowsDirty = () =>
      [...root.querySelectorAll('[data-tax-earn]')].some((inp) => {
        const now = normMoney(inp.value);
        const was = normMoney(inp.dataset.saved || '');
        return now !== was;
      });

    const isDirty = () => settingsDirty() || rowsDirty();

    const syncSaveBar = () => {
      const mount = document.getElementById('chromeActions');
      if (!mount) return;
      const dirty = isDirty();
      if (!dirty) {
        mount.innerHTML = '';
        mount.setAttribute('aria-hidden', 'true');
        return;
      }
      mount.removeAttribute('aria-hidden');
      if (!mount.querySelector('#taxSaveBtn')) {
        mount.innerHTML = `<button type="button" class="chrome-tax-save" id="taxSaveBtn">${T('tax.save')}</button>`;
        const btn = mount.querySelector('#taxSaveBtn');
        if (btn) btn.onclick = () => saveAll();
      }
    };

    const markRowPreview = (tr, inp) => {
      const n = parseMoneyInput(inp.value);
      const empty = !String(inp.value || '').trim();
      patchRowComputed(tr, empty ? null : n);
      const now = normMoney(inp.value);
      const was = normMoney(inp.dataset.saved || '');
      inp.classList.toggle('is-dirty', now !== was);
    };

    const saveAll = async () => {
      const btn = document.getElementById('taxSaveBtn');
      if (btn) {
        btn.disabled = true;
        btn.textContent = T('tax.saving');
      }
      const shiftSel = root.querySelector('#taxShift');
      const shiftChanged = !!(shiftSel && String(shiftSel.value) !== savedShift);
      try {
        if (settingsDirty()) {
          const rateInp = root.querySelector('#taxRate');
          const nextRate = parseMoneyInput(rateInp && rateInp.value);
          const nextShift = Number(shiftSel && shiftSel.value);
          await window.NamiServices.tax.setSettings(
            nextRate == null ? rate : nextRate,
            Number.isFinite(nextShift) ? nextShift : shift
          );
        }
        const jobs = [];
        root.querySelectorAll('tr[data-earn-month]').forEach((tr) => {
          const inp = tr.querySelector('[data-tax-earn]');
          if (!inp) return;
          const now = normMoney(inp.value);
          const was = normMoney(inp.dataset.saved || '');
          if (now === was) return;
          const earnKey = tr.dataset.earnMonth;
          if (!now) {
            jobs.push(
              window.NamiServices.tax.deleteMonth(aid, earnKey).then(() => {
                inp.dataset.saved = '';
                inp.value = '';
                inp.classList.remove('is-dirty');
                patchRowComputed(tr, null);
              })
            );
            return;
          }
          const n = parseMoneyInput(inp.value);
          if (n == null || n < 0) return;
          jobs.push(
            window.NamiServices.tax.upsertMonth(aid, earnKey, n, null).then(() => {
              inp.dataset.saved = formatMoneyInputValue(n);
              inp.value = formatMoneyInputValue(n);
              inp.classList.remove('is-dirty');
              patchRowComputed(tr, n);
            })
          );
        });
        await Promise.all(jobs);
        // Сдвиг меняет подписи «выплата» — пересоберём экран.
        if (shiftChanged) {
          await rerender();
          return;
        }
        patchKpisFromRows();
        syncSaveBar();
      } catch (err) {
        console.warn('[tax] save:', err);
        if (btn) {
          btn.disabled = false;
          btn.textContent = T('tax.save');
        }
      }
    };

    const onDraftChange = () => {
      root.querySelectorAll('tr[data-earn-month]').forEach((tr) => {
        const inp = tr.querySelector('[data-tax-earn]');
        if (inp) markRowPreview(tr, inp);
      });
      patchKpisFromRows();
      syncSaveBar();
    };

    const settingsBtn = root.querySelector('#taxSettingsBtn');
    const settingsPop = root.querySelector('#taxSettingsPop');
    const setSettingsOpen = (open) => {
      if (!settingsPop || !settingsBtn) return;
      settingsPop.hidden = !open;
      settingsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      settingsBtn.classList.toggle('is-open', open);
    };
    if (settingsBtn && settingsPop) {
      settingsBtn.onclick = (e) => {
        e.stopPropagation();
        setSettingsOpen(settingsPop.hidden);
      };
      settingsPop.onclick = (e) => e.stopPropagation();
      const onDocClose = (e) => {
        if (!root.contains(settingsBtn)) {
          document.removeEventListener('click', onDocClose);
          return;
        }
        if (
          !settingsPop.hidden &&
          !settingsPop.contains(e.target) &&
          !settingsBtn.contains(e.target)
        ) {
          setSettingsOpen(false);
        }
      };
      window.NamiLifecycle.listen('tax', document, 'click', onDocClose);
    }

    const rateInp = root.querySelector('#taxRate');
    const shiftSel = root.querySelector('#taxShift');
    if (rateInp) {
      rateInp.oninput = onDraftChange;
      rateInp.onchange = onDraftChange;
    }
    if (shiftSel) shiftSel.onchange = onDraftChange;

    root.querySelectorAll('tr[data-earn-month]').forEach((tr) => {
      const inp = tr.querySelector('[data-tax-earn]');
      if (!inp) return;
      inp.oninput = () => {
        setMoneyInputFormatted(inp, formatMoneyInputLive(inp.value));
        markRowPreview(tr, inp);
        patchKpisFromRows();
        syncSaveBar();
      };
      inp.onblur = () => {
        const n = parseMoneyInput(inp.value);
        if (n != null && n > 0) {
          setMoneyInputFormatted(inp, formatMoneyInputValue(n));
        } else if (!String(inp.value || '').trim()) {
          inp.value = '';
        }
        markRowPreview(tr, inp);
        syncSaveBar();
      };
      inp.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const list = [...root.querySelectorAll('tr[data-earn-month]')];
          const i = list.indexOf(tr);
          const next = list[i + 1];
          const nextInp = next && next.querySelector('[data-tax-earn]');
          if (nextInp) nextInp.focus();
          else if (isDirty()) saveAll();
        }
      };
    });

    const exportBtn = root.querySelector('#taxExportBtn');
    if (exportBtn && window.FoundersExport) {
      exportBtn.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const liveRows = draftChron().map((r) => ({
          earnMonth: r.earnMonth,
          payMonth: '',
          consoleEarn: r.consoleEarn,
          taxEarn: r.taxEarn,
          taxDue: r.taxDue
        }));
        const byEarn = new Map(rows.map((r) => [String(r.earnMonth || ''), r]));
        liveRows.forEach((r) => {
          const src = byEarn.get(String(r.earnMonth || ''));
          if (src) r.payMonth = src.payMonth || src.taxMonth || '';
        });
        window.FoundersExport.open(
          exportBtn,
          taxExportSpec({ rate: currentRate(), shift: Number(root.querySelector('#taxShift')?.value) || shift, rows: liveRows })
        );
      };
    }

    syncSaveBar();
    paintTaxCharts();
    animateCounters(root, { enabled: data.animateNumbers !== false });
    if (window.FoundersSquircle && typeof window.FoundersSquircle.refresh === 'function') {
      window.FoundersSquircle.refresh(root);
    }
}
