/**
 * table.js - Virtualized/Paginated High-Performance Bindings Table
 * Features separate Filename and Symbol Name filters, lookup trails, and CSV export
 */

(function (global) {
  'use strict';

  class LdBindingsTable {
    constructor(containerId, options = {}) {
      this.container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
      if (!this.container) {
        throw new Error(`Table container not found: ${containerId}`);
      }

      this.options = Object.assign({
        pageSize: 50,
        onSymbolClick: null,
        onFileClick: null
      }, options);

      this.rawData = [];
      this.filteredData = [];
      this.currentPage = 1;
      this.pageSize = this.options.pageSize;
      this.sortColumn = 'lineNo';
      this.sortAsc = true;

      // Filter states
      this.filters = {
        filename: '',
        symbol: '',
        crossOnly: false,
        caseSensitive: false,
        useRegex: false
      };

      this.initDom();
    }

    initDom() {
      this.container.innerHTML = `
        <div class="table-toolbar">
          <div class="filter-group">
            <div class="filter-input-wrap">
              <label for="filter-file-input" title="Filter bindings by caller or provider library filename">
                Filename Filter <span class="term-help-icon" title="Filter by library name (caller or provider)">ℹ</span>
              </label>
              <input type="text" id="filter-file-input" class="filter-input" placeholder="e.g. libc, libtirpc, ld-linux" title="Type a library name or pattern to filter caller or provider" />
              <button type="button" class="clear-btn" id="clear-file-btn" title="Clear filename filter">×</button>
            </div>

            <div class="filter-input-wrap">
              <label for="filter-sym-input" title="Filter bindings by symbol identifier">
                Symbol Name Filter <span class="term-help-icon" title="Filter by function, variable, or TLS symbol identifier">ℹ</span>
              </label>
              <input type="text" id="filter-sym-input" class="filter-input" placeholder="e.g. malloc, pthread, getpid" title="Type a symbol name or pattern to filter" />
              <button type="button" class="clear-btn" id="clear-sym-btn" title="Clear symbol name filter">×</button>
            </div>
          </div>

          <div class="filter-options">
            <label class="checkbox-label" title="Show only cross-DSO bindings where caller and provider are different files">
              <input type="checkbox" id="chk-cross-only" /> Cross-library only
            </label>
            <label class="checkbox-label" title="Perform exact case-sensitive string matching for filename and symbol queries">
              <input type="checkbox" id="chk-case-sens" /> Case-sensitive
            </label>
            <label class="checkbox-label" title="Enable JavaScript Regular Expression evaluation for search inputs">
              <input type="checkbox" id="chk-use-regex" /> Regex
            </label>
            <button type="button" class="btn btn-secondary btn-sm" id="btn-export-csv" title="Export currently filtered bindings to a CSV spreadsheet file">Export CSV</button>
          </div>
        </div>

        <div class="table-responsive">
          <table class="data-table" id="bindings-data-table">
            <thead>
              <tr>
                <th class="th-sortable th-line" data-col="lineNo" title="Line: Sequential line number in the original ld.so trace where this binding was logged">
                  Line <span class="th-info-icon" title="Original line in ld.so debug trace">ℹ</span>
                </th>
                <th class="th-sortable th-sym" data-col="symbol" title="Symbol: The function, variable, or TLS symbol being referenced and resolved">
                  Symbol <span class="th-info-icon" title="Function, variable, or TLS symbol identifier">ℹ</span>
                </th>
                <th class="th-sortable th-from" data-col="from" title="Requesting Object: The DSO or executable containing the unresolved reference (GOT/PLT call site)">
                  Requesting Object <span class="th-info-icon" title="Caller object requiring symbol resolution">ℹ</span>
                </th>
                <th class="th-sortable th-to" data-col="to" title="Bound Provider: The DSO providing the definition where code/data was located">
                  Bound Provider <span class="th-info-icon" title="Target object providing definition">ℹ</span>
                </th>
                <th class="th-sortable th-type" data-col="type" title="Type & Version: ELF symbol type and required/provided symbol version tag">
                  Type & Version <span class="th-info-icon" title="Binding type (normal, TLS, etc.) and version">ℹ</span>
                </th>
                <th class="th-sortable th-probes" data-col="probesCount" title="Probes: Number of library scopes searched before finding this symbol. 0 = direct binding without search loop">
                  Probes <span class="th-info-icon" title="Candidate library scopes searched before resolution">ℹ</span>
                </th>
                <th class="th-lookups" title="Lookup Chain: Ordered sequence of libraries probed in the global search scope until resolved">
                  Lookup Chain <span class="th-info-icon" title="Sequential search trail across candidate DSOs">ℹ</span>
                </th>
              </tr>
            </thead>
            <tbody id="bindings-tbody">
              <!-- Rows injected here -->
            </tbody>
          </table>
        </div>

        <div class="table-footer">
          <div class="table-info" id="table-info">No data loaded</div>
          <div class="pagination-controls" id="pagination-controls">
            <button type="button" class="pg-btn" id="pg-first">« First</button>
            <button type="button" class="pg-btn" id="pg-prev">‹ Prev</button>
            <span class="pg-status" id="pg-status">Page 1 / 1</span>
            <button type="button" class="pg-btn" id="pg-next">Next ›</button>
            <button type="button" class="pg-btn" id="pg-last">Last »</button>
            <select class="pg-select" id="pg-size-select">
              <option value="25">25 / page</option>
              <option value="50" selected>50 / page</option>
              <option value="100">100 / page</option>
              <option value="250">250 / page</option>
              <option value="1000">1000 / page</option>
            </select>
          </div>
        </div>
      `;

      // Cache elements
      this.fileInput = this.container.querySelector('#filter-file-input');
      this.symInput = this.container.querySelector('#filter-sym-input');
      this.clearFileBtn = this.container.querySelector('#clear-file-btn');
      this.clearSymBtn = this.container.querySelector('#clear-sym-btn');
      this.chkCross = this.container.querySelector('#chk-cross-only');
      this.chkCase = this.container.querySelector('#chk-case-sens');
      this.chkRegex = this.container.querySelector('#chk-use-regex');
      this.btnExport = this.container.querySelector('#btn-export-csv');

      this.tbody = this.container.querySelector('#bindings-tbody');
      this.tableInfo = this.container.querySelector('#table-info');
      this.pgStatus = this.container.querySelector('#pg-status');
      this.pgSizeSelect = this.container.querySelector('#pg-size-select');

      this.pgFirst = this.container.querySelector('#pg-first');
      this.pgPrev = this.container.querySelector('#pg-prev');
      this.pgNext = this.container.querySelector('#pg-next');
      this.pgLast = this.container.querySelector('#pg-last');

      this.attachEvents();
    }

    attachEvents() {
      // Filename filter input with debouncing
      let fTimer = null;
      this.fileInput.addEventListener('input', () => {
        clearTimeout(fTimer);
        fTimer = setTimeout(() => {
          this.filters.filename = this.fileInput.value.trim();
          this.applyFilters();
        }, 150);
      });

      // Symbol filter input with debouncing
      let sTimer = null;
      this.symInput.addEventListener('input', () => {
        clearTimeout(sTimer);
        sTimer = setTimeout(() => {
          this.filters.symbol = this.symInput.value.trim();
          this.applyFilters();
        }, 150);
      });

      // Clear buttons
      this.clearFileBtn.addEventListener('click', () => {
        this.fileInput.value = '';
        this.filters.filename = '';
        this.applyFilters();
      });

      this.clearSymBtn.addEventListener('click', () => {
        this.symInput.value = '';
        this.filters.symbol = '';
        this.applyFilters();
      });

      // Checkboxes
      this.chkCross.addEventListener('change', () => {
        this.filters.crossOnly = this.chkCross.checked;
        this.applyFilters();
      });

      this.chkCase.addEventListener('change', () => {
        this.filters.caseSensitive = this.chkCase.checked;
        this.applyFilters();
      });

      this.chkRegex.addEventListener('change', () => {
        this.filters.useRegex = this.chkRegex.checked;
        this.applyFilters();
      });

      // Export CSV
      this.btnExport.addEventListener('click', () => this.exportCsv());

      // Sorting
      this.container.querySelectorAll('.th-sortable').forEach(th => {
        th.addEventListener('click', () => {
          const col = th.getAttribute('data-col');
          if (this.sortColumn === col) {
            this.sortAsc = !this.sortAsc;
          } else {
            this.sortColumn = col;
            this.sortAsc = true;
          }
          this.updateSortHeaders();
          this.sortAndRender();
        });
      });

      // Pagination
      this.pgFirst.addEventListener('click', () => this.goToPage(1));
      this.pgPrev.addEventListener('click', () => this.goToPage(this.currentPage - 1));
      this.pgNext.addEventListener('click', () => this.goToPage(this.currentPage + 1));
      this.pgLast.addEventListener('click', () => {
        const maxPages = Math.ceil(this.filteredData.length / this.pageSize) || 1;
        this.goToPage(maxPages);
      });

      this.pgSizeSelect.addEventListener('change', () => {
        this.pageSize = parseInt(this.pgSizeSelect.value, 10);
        this.currentPage = 1;
        this.renderRows();
      });
    }

    setData(bindings) {
      this.rawData = Array.isArray(bindings) ? bindings.map(b => {
        if (b.probesCount === undefined) {
          b.probesCount = (b.lookups && b.lookups.length) || 0;
        }
        return b;
      }) : [];
      this.applyFilters();
    }

    setFilenameFilter(val) {
      this.fileInput.value = val;
      this.filters.filename = val;
      this.applyFilters();
    }

    setSymbolFilter(val) {
      this.symInput.value = val;
      this.filters.symbol = val;
      this.applyFilters();
    }

    applyFilters() {
      const { filename, symbol, crossOnly, caseSensitive, useRegex } = this.filters;

      let fileMatcher = null;
      let symMatcher = null;

      try {
        if (filename) {
          fileMatcher = useRegex
            ? new RegExp(filename, caseSensitive ? '' : 'i')
            : (str) => caseSensitive ? str.includes(filename) : str.toLowerCase().includes(filename.toLowerCase());
        }

        if (symbol) {
          symMatcher = useRegex
            ? new RegExp(symbol, caseSensitive ? '' : 'i')
            : (str) => caseSensitive ? str.includes(symbol) : str.toLowerCase().includes(symbol.toLowerCase());
        }
      } catch (err) {
        console.warn('Regex compilation error:', err);
      }

      this.filteredData = this.rawData.filter(item => {
        // Cross-library check
        if (crossOnly && item.from === item.to) {
          return false;
        }

        // Filename filter (matches 'from' or 'to' or relocFile)
        if (fileMatcher) {
          const fromMatch = typeof fileMatcher === 'function' ? fileMatcher(item.from) : fileMatcher.test(item.from);
          const toMatch = typeof fileMatcher === 'function' ? fileMatcher(item.to) : fileMatcher.test(item.to);
          const relocMatch = item.relocFile ? (typeof fileMatcher === 'function' ? fileMatcher(item.relocFile) : fileMatcher.test(item.relocFile)) : false;
          if (!fromMatch && !toMatch && !relocMatch) return false;
        }

        // Symbol filter
        if (symMatcher) {
          const matches = typeof symMatcher === 'function' ? symMatcher(item.symbol) : symMatcher.test(item.symbol);
          if (!matches) return false;
        }

        return true;
      });

      this.currentPage = 1;
      this.sortAndRender();
    }

    sortAndRender() {
      const col = this.sortColumn;
      const asc = this.sortAsc ? 1 : -1;

      this.filteredData.sort((a, b) => {
        let valA = a[col];
        let valB = b[col];

        if (typeof valA === 'string') {
          return valA.localeCompare(valB) * asc;
        }
        return ((valA || 0) - (valB || 0)) * asc;
      });

      this.renderRows();
    }

    updateSortHeaders() {
      this.container.querySelectorAll('.th-sortable').forEach(th => {
        const col = th.getAttribute('data-col');
        th.classList.remove('th-asc', 'th-desc');
        if (col === this.sortColumn) {
          th.classList.add(this.sortAsc ? 'th-asc' : 'th-desc');
        }
      });
    }

    goToPage(pg) {
      const maxPages = Math.ceil(this.filteredData.length / this.pageSize) || 1;
      this.currentPage = Math.max(1, Math.min(pg, maxPages));
      this.renderRows();
    }

    renderRows() {
      const total = this.filteredData.length;
      const maxPages = Math.ceil(total / this.pageSize) || 1;
      if (this.currentPage > maxPages) this.currentPage = maxPages;

      const startIndex = (this.currentPage - 1) * this.pageSize;
      const endIndex = Math.min(startIndex + this.pageSize, total);
      const pageRows = this.filteredData.slice(startIndex, endIndex);

      this.tbody.innerHTML = '';

      if (pageRows.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="7" class="table-empty">No matching symbol bindings found</td>`;
        this.tbody.appendChild(tr);
      } else {
        const fragment = document.createDocumentFragment();

        pageRows.forEach(row => {
          const tr = document.createElement('tr');
          const isCross = row.from !== row.to;
          if (isCross) tr.classList.add('tr-cross-lib');

          // Highlight matching symbol parts if filter active
          let symDisplay = row.symbol;
          if (this.filters.symbol && !this.filters.useRegex) {
            const symQuery = this.filters.symbol;
            const idx = symDisplay.toLowerCase().indexOf(symQuery.toLowerCase());
            if (idx !== -1) {
              symDisplay = `${symDisplay.substring(0, idx)}<mark>${symDisplay.substring(idx, idx + symQuery.length)}</mark>${symDisplay.substring(idx + symQuery.length)}`;
            }
          }

          const probesCount = row.probesCount !== undefined ? row.probesCount : (row.lookups ? row.lookups.length : 0);

          // Probes Badge
          let probesBadge = '';
          if (probesCount === 0) {
            probesBadge = `<span class="probe-badge probe-direct" title="Direct binding (0 lookup probes in search loop)">Direct</span>`;
          } else {
            const highClass = probesCount >= 4 ? 'probe-high' : 'probe-multi';
            probesBadge = `<span class="probe-badge ${highClass}" title="Probed ${probesCount} library scope${probesCount > 1 ? 's' : ''} in search scope before resolving">${probesCount} probe${probesCount > 1 ? 's' : ''}</span>`;
          }

          // Format lookup chain
          let lookupHtml = '';
          if (row.lookups && row.lookups.length > 0) {
            const count = row.lookups.length;
            const shortNames = row.lookups.map(l => l.split('/').pop());
            const fullChainTooltip = `Search sequence (${count} probes):&#10;` + row.lookups.map((l, i) => `${i + 1}. ${l}`).join('&#10;');

            if (count <= 2) {
              lookupHtml = `
                <div class="lookup-trail-wrap">
                  <span class="lookup-trail font-mono" title="${fullChainTooltip}">
                    ${shortNames.join(' → ')}
                  </span>
                </div>
              `;
            } else {
              const firstLib = shortNames[0];
              const lastLib = shortNames[shortNames.length - 1];
              lookupHtml = `
                <div class="lookup-trail-wrap">
                  <span class="lookup-trail font-mono lookup-compact" title="${fullChainTooltip}">
                    ${firstLib} → … → ${lastLib}
                  </span>
                  <button type="button" class="lookup-expand-btn" title="Click to show full ${count}-step search chain" aria-label="Toggle search chain">…</button>
                  <span class="lookup-trail font-mono lookup-full" style="display: none;" title="${fullChainTooltip}">
                    ${shortNames.join(' → ')}
                  </span>
                </div>
              `;
            }
          } else {
            lookupHtml = `<span class="lookup-direct text-muted" title="Direct resolution without traversing search list">—</span>`;
          }

          const fromBase = row.from.split('/').pop();
          const toBase = row.to.split('/').pop();
          const isLongSym = row.symbol.length > 24;

          tr.innerHTML = `
            <td class="td-line font-mono">${row.lineNo}</td>
            <td class="td-sym">
              <div class="sym-cell">
                <span class="sym-name font-mono" title="Symbol: ${row.symbol}&#10;Click to filter by this symbol">${symDisplay}</span>
                ${isLongSym ? `<button type="button" class="sym-tool-btn sym-toggle-btn" title="Toggle expand/collapse full symbol name" aria-label="Expand symbol name">↔</button>` : ''}
                <button type="button" class="sym-tool-btn sym-copy-btn" title="Copy full symbol name to clipboard" aria-label="Copy symbol name">📋</button>
              </div>
            </td>
            <td class="td-from">
              <span class="lib-pill lib-pill-from" title="Requesting object: ${row.from}&#10;Click to filter by this library">${fromBase}</span>
            </td>
            <td class="td-to">
              <span class="lib-pill lib-pill-to" title="Bound provider: ${row.to}&#10;Click to filter by this library">${toBase}</span>
            </td>
            <td class="td-type">
              <span class="type-tag" title="Symbol binding type: ${row.type}">${row.type}</span>
              ${row.version ? `<span class="ver-tag font-mono" title="Required ELF symbol version: ${row.version}">[${row.version}]</span>` : ''}
            </td>
            <td class="td-probes">${probesBadge}</td>
            <td class="td-lookups">${lookupHtml}</td>
          `;

          // Click on symbol text to filter
          const symEl = tr.querySelector('.sym-name');
          symEl.addEventListener('click', (e) => {
            e.stopPropagation();
            this.setSymbolFilter(row.symbol);
          });

          // Toggle expand/collapse long symbol
          const symToggleBtn = tr.querySelector('.sym-toggle-btn');
          if (symToggleBtn) {
            symToggleBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              symEl.classList.toggle('is-expanded');
              symToggleBtn.classList.toggle('is-active');
            });
          }

          // Copy symbol button
          const symCopyBtn = tr.querySelector('.sym-copy-btn');
          if (symCopyBtn) {
            symCopyBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(row.symbol).then(() => {
                const origText = symCopyBtn.textContent;
                symCopyBtn.textContent = '✓';
                symCopyBtn.classList.add('btn-copied');
                setTimeout(() => {
                  symCopyBtn.textContent = origText;
                  symCopyBtn.classList.remove('btn-copied');
                }, 1500);
              });
            });
          }

          // Toggle lookup chain expansion
          const lookupExpandBtn = tr.querySelector('.lookup-expand-btn');
          if (lookupExpandBtn) {
            lookupExpandBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              const compactEl = tr.querySelector('.lookup-compact');
              const fullEl = tr.querySelector('.lookup-full');
              if (compactEl && fullEl) {
                const isFullVisible = fullEl.style.display !== 'none';
                fullEl.style.display = isFullVisible ? 'none' : 'inline';
                compactEl.style.display = isFullVisible ? 'inline' : 'none';
                lookupExpandBtn.textContent = isFullVisible ? '…' : '‹›';
                lookupExpandBtn.title = isFullVisible ? `Click to show full ${row.lookups.length}-step search chain` : 'Click to collapse chain';
              }
            });
          }

          // Click on from/to pills to filter
          tr.querySelector('.lib-pill-from').addEventListener('click', (e) => {
            e.stopPropagation();
            this.setFilenameFilter(fromBase);
          });
          tr.querySelector('.lib-pill-to').addEventListener('click', (e) => {
            e.stopPropagation();
            this.setFilenameFilter(toBase);
          });

          fragment.appendChild(tr);
        });

        this.tbody.appendChild(fragment);
      }

      // Update Pagination & Info
      this.tableInfo.innerHTML = `Showing <strong>${total > 0 ? startIndex + 1 : 0}–${endIndex}</strong> of <strong>${total}</strong> bindings (filtered from ${this.rawData.length} total)`;
      this.pgStatus.textContent = `Page ${this.currentPage} / ${maxPages}`;
      this.pgFirst.disabled = this.currentPage <= 1;
      this.pgPrev.disabled = this.currentPage <= 1;
      this.pgNext.disabled = this.currentPage >= maxPages;
      this.pgLast.disabled = this.currentPage >= maxPages;
    }

    exportCsv() {
      if (this.filteredData.length === 0) {
        alert('No rows to export.');
        return;
      }

      const headers = ['Line', 'Symbol', 'Requesting_Object', 'Bound_Provider', 'Type', 'Version', 'Probes_Count', 'Lookup_Chain'];
      const rows = this.filteredData.map(r => [
        r.lineNo,
        `"${r.symbol.replace(/"/g, '""')}"`,
        `"${r.from.replace(/"/g, '""')}"`,
        `"${r.to.replace(/"/g, '""')}"`,
        `"${r.type.replace(/"/g, '""')}"`,
        `"${(r.version || '').replace(/"/g, '""')}"`,
        r.probesCount !== undefined ? r.probesCount : (r.lookups ? r.lookups.length : 0),
        `"${(r.lookups || []).join(' -> ').replace(/"/g, '""')}"`
      ]);

      const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ld_bindings_export_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }

  global.LdBindingsTable = LdBindingsTable;
})(typeof window !== 'undefined' ? window : globalThis);
