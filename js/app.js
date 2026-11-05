/**
 * app.js - Main Application Coordinator for ld_debug_viewer
 * Manages State, UI tabs, File upload / Drag & Drop, KPI Cards, and Views
 */

(function () {
  'use strict';

  // Global App State
  const state = {
    currentRawLog: '',
    parsedData: null,
    graph: null,
    table: null,
    activeTab: 'tab-graph',
    graphMode: 'dependencies',   // 'dependencies' or 'symbol_flow'
    graphLayout: 'layered',       // 'layered' or 'force'
    theme: localStorage.getItem('ld_viewer_theme') || 'dark',
    rawLinesCache: []
  };

  // DOM Elements Cache
  const elements = {};

  function initElements() {
    elements.fileInput = document.getElementById('file-input');
    elements.btnLoadSample = document.getElementById('btn-load-sample');
    elements.dropZone = document.getElementById('drop-zone');
    elements.themeToggle = document.getElementById('theme-toggle');
    elements.themeIcon = document.getElementById('theme-icon');
    elements.helpBtn = document.getElementById('help-btn');
    elements.helpModal = document.getElementById('help-modal');
    elements.modalClose = document.getElementById('modal-close');
    elements.btnCopyCmd = document.getElementById('btn-copy-cmd');
    elements.cmdText = document.getElementById('cmd-text');

    // KPI Elements
    elements.kpiRelocs = document.getElementById('kpi-relocs');
    elements.kpiSymbols = document.getElementById('kpi-symbols');
    elements.kpiLibs = document.getElementById('kpi-libs');
    elements.kpiCycles = document.getElementById('kpi-cycles');
    elements.kpiRelocTime = document.getElementById('kpi-reloc-time');
    elements.kpiUnused = document.getElementById('kpi-unused');
    elements.kpiUnusedBadge = document.getElementById('kpi-unused-badge');

    // Tab Buttons & Panels
    elements.tabBtns = document.querySelectorAll('.nav-tab');
    elements.tabPanels = document.querySelectorAll('.tab-panel');

    // Graph controls
    elements.graphModeDeps = document.getElementById('graph-mode-deps');
    elements.graphModeSymbols = document.getElementById('graph-mode-symbols');
    elements.layoutModeLayered = document.getElementById('layout-mode-layered');
    elements.layoutModeForce = document.getElementById('layout-mode-force');
    elements.graphFitBtn = document.getElementById('btn-graph-fit');

    // Overview specific
    elements.statsTableBody = document.getElementById('stats-table-body');
    elements.unusedAlertSection = document.getElementById('unused-alert-section');
    elements.linkmapTableBody = document.getElementById('linkmap-table-body');
    elements.initsList = document.getElementById('inits-list');

    // Raw Log specific
    elements.rawLogContent = document.getElementById('raw-log-content');
    elements.rawLogSearch = document.getElementById('raw-log-search');
    elements.rawLogNotice = document.getElementById('raw-log-notice');
  }

  function initApp() {
    initElements();
    applyTheme(state.theme);

    // Initialize Table
    state.table = new LdBindingsTable('bindings-table-container', {
      pageSize: 50
    });

    // Initialize Graph with Layered Layout
    state.graph = new LdGraphVisualizer('dependency-graph-container', {
      layoutType: 'layered',
      onNodeClick: (node) => {
        // When clicking a node in graph, switch to table and filter by that file!
        switchTab('tab-table');
        state.table.setFilenameFilter(node.label);
      }
    });

    attachEvents();

    // Restore tab from URL hash (browser back/forward support)
    const initialHash = location.hash.replace('#', '');
    const validTabs = ['tab-graph', 'tab-table', 'tab-overview', 'tab-raw'];
    if (initialHash && validTabs.includes(initialHash)) {
      switchTab(initialHash, false);
    }

    // Popstate: handle back/forward navigation within the app
    window.addEventListener('popstate', (e) => {
      const tabId = e.state && e.state.tab;
      if (tabId) {
        switchTab(tabId, false); // false = don't push another history entry
      }
    });

    // Automatically load default sample log (ldlog.4430) on startup
    if (window.DEFAULT_SAMPLE_LOG) {
      loadLogText(window.DEFAULT_SAMPLE_LOG, 'ldlog.4430 (Default Sample)');
    }
  }

  function attachEvents() {
    // Theme Toggle
    elements.themeToggle.addEventListener('click', () => {
      const newTheme = state.theme === 'dark' ? 'light' : 'dark';
      applyTheme(newTheme);
    });

    // Help Modal
    elements.helpBtn.addEventListener('click', () => {
      elements.helpModal.classList.add('is-open');
    });
    elements.modalClose.addEventListener('click', () => {
      elements.helpModal.classList.remove('is-open');
    });
    elements.helpModal.addEventListener('click', (e) => {
      if (e.target === elements.helpModal) {
        elements.helpModal.classList.remove('is-open');
      }
    });

    // Copy command
    elements.btnCopyCmd.addEventListener('click', () => {
      const text = elements.cmdText.textContent;
      navigator.clipboard.writeText(text).then(() => {
        elements.btnCopyCmd.textContent = 'Copied!';
        setTimeout(() => {
          elements.btnCopyCmd.textContent = 'Copy Command';
        }, 2000);
      });
    });

    // File Input
    elements.fileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        readFile(file);
      }
    });

    // Load Sample Button
    elements.btnLoadSample.addEventListener('click', () => {
      if (window.DEFAULT_SAMPLE_LOG) {
        loadLogText(window.DEFAULT_SAMPLE_LOG, 'ldlog.4430 (Sample)');
      } else {
        alert('Sample log not available.');
      }
    });

    // Drag and Drop
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      elements.dropZone.classList.add('is-active');
    });

    window.addEventListener('dragleave', (e) => {
      if (e.clientX <= 0 || e.clientY <= 0) {
        elements.dropZone.classList.remove('is-active');
      }
    });

    window.addEventListener('drop', (e) => {
      e.preventDefault();
      elements.dropZone.classList.remove('is-active');
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length > 0) {
        readFile(files[0]);
      }
    });

    // Tab Navigation
    elements.tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        switchTab(targetTab);
      });
    });

    // Graph Data Modes (Dependencies vs Symbol Flows)
    elements.graphModeDeps.addEventListener('click', () => {
      elements.graphModeDeps.classList.add('btn-active');
      elements.graphModeSymbols.classList.remove('btn-active');
      state.graphMode = 'dependencies';
      state.graph.setData(state.parsedData, 'dependencies');
    });

    elements.graphModeSymbols.addEventListener('click', () => {
      elements.graphModeSymbols.classList.add('btn-active');
      elements.graphModeDeps.classList.remove('btn-active');
      state.graphMode = 'symbol_flow';
      state.graph.setData(state.parsedData, 'symbol_flow');
    });

    // Graph Drawing Modes (Layered Graph vs Force Network)
    elements.layoutModeLayered.addEventListener('click', () => {
      setLayoutMode('layered');
    });
    elements.layoutModeForce.addEventListener('click', () => {
      setLayoutMode('force');
    });

    elements.graphFitBtn.addEventListener('click', () => {
      state.graph.fitToView();
    });

    // Raw Log Search
    let rawTimer = null;
    elements.rawLogSearch.addEventListener('input', () => {
      clearTimeout(rawTimer);
      rawTimer = setTimeout(() => {
        filterRawLog(elements.rawLogSearch.value.trim());
      }, 200);
    });
  }

  function setLayoutMode(mode) {
    state.graphLayout = mode;
    elements.layoutModeLayered.classList.toggle('btn-active', mode === 'layered');
    elements.layoutModeForce.classList.toggle('btn-active', mode === 'force');
    state.graph.setLayoutType(mode);
  }

  function applyTheme(theme) {
    state.theme = theme;
    localStorage.setItem('ld_viewer_theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    elements.themeIcon.textContent = theme === 'dark' ? '☀' : '🌙';
  }

  function switchTab(tabId, pushHistory = true) {
    state.activeTab = tabId;

    // Push browser history so back/forward keys navigate tabs
    if (pushHistory) {
      history.pushState({ tab: tabId }, '', '#' + tabId);
    }

    elements.tabBtns.forEach(btn => {
      if (btn.getAttribute('data-tab') === tabId) {
        btn.classList.add('is-active');
      } else {
        btn.classList.remove('is-active');
      }
    });

    elements.tabPanels.forEach(panel => {
      if (panel.id === tabId) {
        panel.classList.add('is-active');
      } else {
        panel.classList.remove('is-active');
      }
    });

    if (tabId === 'tab-graph' && state.graph) {
      setTimeout(() => {
        state.graph.updateViewDimensions();
        state.graph.fitToView();
      }, 50);
    }
  }

  function readFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      loadLogText(text, file.name);
    };
    reader.onerror = () => {
      alert(`Error reading file: ${file.name}`);
    };
    reader.readAsText(file);
  }

  function loadLogText(text, sourceName) {
    state.currentRawLog = text;
    state.parsedData = LdParser.parse(text);

    // Update KPIs
    updateKPIs(state.parsedData);

    // Update Overview & Statistics
    renderOverview(state.parsedData);

    // Update Graph
    state.graph.setData(state.parsedData, state.graphMode);

    // Update Table
    state.table.setData(state.parsedData.bindings);

    // Update Raw Log Viewer
    renderRawLog(text);

    // Update Document Subtitle
    document.getElementById('current-file-label').textContent = sourceName;
  }

  function updateKPIs(data) {
    elements.kpiRelocs.textContent = data.summary.totalRelocations.toLocaleString();
    elements.kpiSymbols.textContent = data.summary.uniqueSymbols.toLocaleString();
    elements.kpiLibs.textContent = data.summary.librariesCount.toLocaleString();

    // Loader Startup Cycles
    const startupCycles = data.statistics['total startup time in dynamic loader'] || '—';
    elements.kpiCycles.textContent = startupCycles;

    // Relocation overhead
    const relocOverhead = data.statistics['time needed for relocation'] || '—';
    elements.kpiRelocTime.textContent = relocOverhead;

    // Unused DSOs
    const unusedCount = data.unusedDSOs.length;
    elements.kpiUnused.textContent = unusedCount;

    if (unusedCount > 0) {
      elements.kpiUnusedBadge.className = 'kpi-badge kpi-badge-danger';
      elements.kpiUnusedBadge.textContent = 'Warning';
    } else {
      elements.kpiUnusedBadge.className = 'kpi-badge kpi-badge-success';
      elements.kpiUnusedBadge.textContent = 'Clean';
    }
  }

  // Glbic dynamic linker statistics dictionary with beginner-friendly explanations
  const LD_STATS_EXPLANATIONS = {
    'total startup time in dynamic loader': 'Total CPU clock cycles spent executing the dynamic linker (ld.so) before control transfers to the application\'s entry point (main).',
    'time needed for relocation': 'CPU clock cycles and percentage of startup time spent resolving symbolic references, patching GOT/PLT entries, and updating pointer offsets in memory.',
    'number of relocations': 'Total dynamic symbol relocations processed across all loaded objects (e.g. global function calls, extern variable bindings).',
    'number of relocations from cache': 'Relocations satisfied directly from internal lookup caches without needing a full traversal of the symbol search scope.',
    'number of relative relocations': 'Count of R_*_RELATIVE relocations that only require adding the base load address to a pointer without any symbol name lookup. Highly optimized.',
    'time needed to load objects': 'CPU clock cycles and percentage of startup time spent locating files on disk, executing open/mmap system calls, and loading ELF segments into address space.',
    'cumulative time for relocation': 'Cumulative time spent performing relocations across initial dependencies and dynamically loaded modules.',
    'final number of relocations': 'Total relocations performed after all DT_NEEDED dependencies and lazy PLT bindings were resolved.',
    'time needed for cache check': 'Time spent checking the dynamic linker system cache (/etc/ld.so.cache) to locate library paths on disk.'
  };

  function renderOverview(data) {
    // 1. Unused DSO Alerts
    if (data.unusedDSOs.length > 0) {
      elements.unusedAlertSection.style.display = 'block';
      let html = '<div class="alert alert-warning"><div class="alert-title">⚠ Detected Unused Direct Dependencies / DSOs</div><ul>';
      data.unusedDSOs.forEach(u => {
        html += `<li><strong>${escapeHtml(u.file)}</strong> (${escapeHtml(u.rawFile)}): ${escapeHtml(u.reason)}</li>`;
      });
      html += '</ul><div class="alert-hint">These shared libraries were loaded into memory via DT_NEEDED tags, but none of their symbols were required or referenced during execution. Removing them via <code>-Wl,--as-needed</code> saves load time and memory.</div></div>';
      elements.unusedAlertSection.innerHTML = html;
    } else {
      elements.unusedAlertSection.style.display = 'none';
    }

    // 2. Linker Performance Statistics Table with Alt-Text & Tooltip Explanations
    elements.statsTableBody.innerHTML = '';
    const statsEntries = Object.entries(data.statistics);
    if (statsEntries.length === 0) {
      elements.statsTableBody.innerHTML = `<tr><td colspan="2" class="table-empty">No statistics block found in log. Run with LD_DEBUG=statistics</td></tr>`;
    } else {
      statsEntries.forEach(([key, val]) => {
        const cleanKey = key.trim().toLowerCase();
        const explanation = LD_STATS_EXPLANATIONS[cleanKey] ||
          'Dynamic linker runtime diagnostic performance metric recorded by glibc ld.so.';

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="stat-key-cell">
            <div class="stat-key-title" title="${escapeHtml(explanation)}">
              <span class="stat-key-name">${escapeHtml(key)}</span>
              <span class="term-help-icon" title="${escapeHtml(explanation)}" aria-label="Explanation: ${escapeHtml(explanation)}">ℹ</span>
            </div>
            <div class="stat-key-desc" title="${escapeHtml(explanation)}">${escapeHtml(explanation)}</div>
          </td>
          <td class="stat-val font-mono">${escapeHtml(val)}</td>
        `;
        elements.statsTableBody.appendChild(tr);
      });
    }

    // 3. Link Map / Memory Layout Table
    elements.linkmapTableBody.innerHTML = '';
    const linkmapEntries = Object.entries(data.linkmaps);
    if (linkmapEntries.length === 0) {
      elements.linkmapTableBody.innerHTML = `<tr><td colspan="6" class="table-empty">No link map records found</td></tr>`;
    } else {
      linkmapEntries.forEach(([file, info]) => {
        const tr = document.createElement('tr');
        const sizeBytes = parseInt(info.size, 16);
        const formattedSize = !isNaN(sizeBytes) ? `${(sizeBytes / 1024).toFixed(1)} KB` : (info.size || '—');
        const resPath = info.resolvedPath || info.rawFile || file;

        tr.innerHTML = `
          <td><strong title="Canonical SONAME: ${escapeHtml(file)}">${escapeHtml(file)}</strong></td>
          <td class="font-mono text-muted" title="Real filesystem path: ${escapeHtml(resPath)}">${escapeHtml(resPath)}</td>
          <td class="font-mono" title="Virtual memory base address (ASLR offset): ${escapeHtml(info.base || '—')}">${escapeHtml(info.base || '—')}</td>
          <td class="font-mono" title="Loaded segment virtual memory size: ${escapeHtml(formattedSize)} (${escapeHtml(info.size || '')})">${escapeHtml(formattedSize)}</td>
          <td class="font-mono" title="Virtual address of ELF _DYNAMIC section: ${escapeHtml(info.dynamic || '—')}">${escapeHtml(info.dynamic || '—')}</td>
          <td class="font-mono" title="Virtual address of ELF entry point or init handler: ${escapeHtml(info.entry || '—')}">${escapeHtml(info.entry || '—')}</td>
        `;
        elements.linkmapTableBody.appendChild(tr);
      });
    }

    // 4. Initializers Execution Order
    elements.initsList.innerHTML = '';
    if (data.initOrder.length === 0) {
      elements.initsList.innerHTML = `<li class="text-muted">No init calls recorded</li>`;
    } else {
      data.initOrder.forEach((initFile, idx) => {
        const li = document.createElement('li');
        li.innerHTML = `
          <span class="init-step" title="Initialization execution step #${idx + 1}">${idx + 1}</span>
          <span class="font-mono" title="DT_INIT / DT_INIT_ARRAY constructor routine executed for ${escapeHtml(initFile)}">${escapeHtml(initFile)}</span>
        `;
        elements.initsList.appendChild(li);
      });
    }
  }

  function renderRawLog(text) {
    state.rawLinesCache = text.split(/\r?\n/);
    const totalLines = state.rawLinesCache.length;
    const maxRender = 1500;

    if (totalLines > maxRender) {
      elements.rawLogNotice.style.display = 'block';
      elements.rawLogNotice.textContent = `Showing first ${maxRender.toLocaleString()} of ${totalLines.toLocaleString()} lines for smooth performance. Use the search input above to query any line across the entire log.`;
    } else {
      elements.rawLogNotice.style.display = 'none';
    }

    renderRawLogChunk(state.rawLinesCache.slice(0, maxRender), 0);
  }

  function renderRawLogChunk(lines, offset = 0) {
    const htmlLines = lines.map((line, idx) => {
      let lineClass = 'raw-line';
      if (line.includes('binding file')) lineClass += ' line-binding';
      else if (line.includes('needed by')) lineClass += ' line-needed';
      else if (line.includes('unused:')) lineClass += ' line-unused';
      else if (line.includes('runtime linker statistics:')) lineClass += ' line-stat';

      const escaped = escapeHtml(line);
      return `<div class="${lineClass}"><span class="line-num">${offset + idx + 1}</span><span class="line-text">${escaped}</span></div>`;
    });

    elements.rawLogContent.innerHTML = htmlLines.join('');
  }

  function filterRawLog(query) {
    if (!query) {
      renderRawLog(state.currentRawLog);
      return;
    }

    const qLower = query.toLowerCase();
    const matches = [];
    const maxMatches = 1500;

    for (let i = 0; i < state.rawLinesCache.length; i++) {
      const line = state.rawLinesCache[i];
      if (line.toLowerCase().includes(qLower)) {
        matches.push({ line, num: i + 1 });
        if (matches.length >= maxMatches) break;
      }
    }

    elements.rawLogNotice.style.display = 'block';
    elements.rawLogNotice.textContent = `Found ${matches.length >= maxMatches ? 'more than ' + maxMatches : matches.length} matching lines for "${query}".`;

    const htmlLines = matches.map(m => {
      let lineClass = 'raw-line';
      if (m.line.includes('binding file')) lineClass += ' line-binding';
      else if (m.line.includes('needed by')) lineClass += ' line-needed';
      else if (m.line.includes('unused:')) lineClass += ' line-unused';
      else if (m.line.includes('runtime linker statistics:')) lineClass += ' line-stat';

      const escaped = escapeHtml(m.line);
      return `<div class="${lineClass}"><span class="line-num">${m.num}</span><span class="line-text">${escaped}</span></div>`;
    });

    elements.rawLogContent.innerHTML = htmlLines.join('');
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})();
