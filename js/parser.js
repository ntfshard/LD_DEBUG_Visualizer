/**
 * parser.js - Pure client-side parser for ld.so debug logs
 * Parses output from: LD_DEBUG=all,unused,statistics LD_DEBUG_OUTPUT=...
 * Optimized for high performance on multi-megabyte logs (e.g. 70MB+).
 */

(function (global) {
  'use strict';

  function parseLdLog(logText) {
    const result = {
      pids: new Set(),
      dependencies: [],      // { from, to, type: 'needed' }
      searchPaths: [],       // { lib, path }
      linkmaps: {},          // { [file]: { dynamic, base, size, entry, phdr, phnum, resolvedPath } }
      versions: [],          // { version, file, requiredBy }
      scopes: {},            // { [object]: [scopeArray] }
      bindings: [],          // { from, to, rawFrom, rawTo, type, symbol, version, lookups: [], relocFile, lineNo }
      unusedDSOs: [],        // { file, reason }
      statistics: {},        // { [key]: value }
      initOrder: [],         // [file]
      finiOrder: [],         // [file]
      aliases: {},           // path -> soname / canonical
      summary: {
        totalLines: 0,
        totalRelocations: 0,
        uniqueSymbols: 0,
        librariesCount: 0,
        unusedCount: 0
      },
      allLibraries: []
    };

    if (!logText || typeof logText !== 'string') {
      return result;
    }

    const lines = logText.split(/\r?\n/);
    result.summary.totalLines = lines.length;

    // Helper: canonicalize library name (e.g. '/lib/x86_64-linux-gnu/libc.so.6' -> 'libc.so.6')
    function canonicalLib(rawName) {
      if (!rawName) return '';
      let clean = rawName.trim().replace(/\s*\[\d+\]$/, '');
      if (result.aliases[clean]) return result.aliases[clean];
      const base = clean.split('/').pop();
      if (base) {
        result.aliases[clean] = base;
        return base;
      }
      return clean;
    }

    let currentRelocFile = null;
    let currentSymbol = null;
    let currentLookups = [];
    let inStatsBlock = false;
    let currentMapFile = null;
    let currentScopeObject = null;
    let currentSearchLib = null;

    const symbolSet = new Set();
    const libSet = new Set();

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const lineNo = i + 1;

      // Fast skip for empty lines
      if (!rawLine || rawLine.length === 0) continue;

      // Extract PID if present
      let content = rawLine;
      const colonIdx = rawLine.indexOf(':');
      if (colonIdx > 0 && colonIdx < 12) {
        const potentialPid = rawLine.substring(0, colonIdx).trim();
        if (/^\d+$/.test(potentialPid)) {
          result.pids.add(potentialPid);
          content = rawLine.substring(colonIdx + 1);
        }
      }

      // Fast trim start
      let startIdx = 0;
      while (startIdx < content.length && (content.charCodeAt(startIdx) === 32 || content.charCodeAt(startIdx) === 9)) {
        startIdx++;
      }
      if (startIdx >= content.length) continue;
      const trimmed = content.substring(startIdx);

      // 1. Runtime Linker Statistics
      if (trimmed.includes('runtime linker statistics:')) {
        inStatsBlock = true;
        continue;
      }

      if (inStatsBlock) {
        if (trimmed.startsWith('calling init:') || trimmed.startsWith('calling fini:') || trimmed.startsWith('file=')) {
          inStatsBlock = false;
        } else {
          const statColon = trimmed.indexOf(':');
          if (statColon > 0) {
            const key = trimmed.substring(0, statColon).trim();
            const val = trimmed.substring(statColon + 1).trim();
            result.statistics[key] = val;
            continue;
          }
        }
      }

      // Fast path by prefix / key phrases
      // 2. Symbol lookup: symbol=foo;  lookup in file=bar [0]
      if (trimmed.startsWith('symbol=')) {
        const lookupIdx = trimmed.indexOf(';  lookup in file=');
        if (lookupIdx > 0) {
          const sym = trimmed.substring(7, lookupIdx).trim();
          let lkFile = trimmed.substring(lookupIdx + 18).trim();
          lkFile = canonicalLib(lkFile);
          libSet.add(lkFile);

          if (sym !== currentSymbol) {
            currentSymbol = sym;
            currentLookups = [lkFile];
          } else if (currentLookups.length < 50) { // cap at 50 lookups to prevent memory explosion on giant logs
            currentLookups.push(lkFile);
          }
          continue;
        }
      }

      // 3. Symbol Binding: binding file A [0] to B [0]: normal symbol `foo' [VER]
      if (trimmed.startsWith('binding file ')) {
        const bindMatch = trimmed.match(/^binding file ([^ \[\n]+).*? to ([^ :\[\n]+).*?:\s*([a-zA-Z0-9_ ]+)\s+symbol\s*[`']([^`']+)['`](?:\s*\[(.*?)\])?/);
        if (bindMatch) {
          const rawFrom = bindMatch[1].trim();
          const rawTo = bindMatch[2].trim();
          const bFrom = canonicalLib(rawFrom);
          const bTo = canonicalLib(rawTo);
          const bType = bindMatch[3].trim();
          const bSym = bindMatch[4].trim();
          const bVer = bindMatch[5] ? bindMatch[5].trim() : '';

          symbolSet.add(bSym);
          libSet.add(bFrom);
          libSet.add(bTo);

          const lookupsArr = (currentSymbol === bSym) ? [...currentLookups] : [];
          result.bindings.push({
            from: bFrom,
            to: bTo,
            rawFrom: rawFrom,
            rawTo: rawTo,
            type: bType,
            symbol: bSym,
            version: bVer,
            lookups: lookupsArr,
            probesCount: lookupsArr.length,
            relocFile: currentRelocFile ? canonicalLib(currentRelocFile) : bFrom,
            lineNo: lineNo
          });
          continue;
        }
      }

      // 4. File operations: file=...
      if (trimmed.startsWith('file=')) {
        // Unused DSO: file=libm.so.6 [0];  unused: does not satisfy any references
        if (trimmed.includes(';  unused:')) {
          const unusedMatch = trimmed.match(/^file=([^ ;\[]+)(?:\s*\[\d+\])?;\s+unused:\s*(.+)/);
          if (unusedMatch) {
            const rawFile = unusedMatch[1].trim();
            const unusedFile = canonicalLib(rawFile);
            result.unusedDSOs.push({
              file: unusedFile,
              rawFile: rawFile,
              reason: unusedMatch[2].trim()
            });
            libSet.add(unusedFile);
            continue;
          }
        }

        // Needed DSO: file=libtirpc.so.3 [0];  needed by lsof [0]
        if (trimmed.includes(';  needed by ')) {
          const neededMatch = trimmed.match(/^file=([^ ;\[]+)(?:\s*\[\d+\])?;\s+needed by ([^ \[\n\r]+)/);
          if (neededMatch) {
            const rawTo = neededMatch[1].trim();
            const rawFrom = neededMatch[2].trim();
            const toLib = canonicalLib(rawTo);
            const fromLib = canonicalLib(rawFrom);
            result.dependencies.push({ from: fromLib, to: toLib, rawFrom: rawFrom, rawTo: rawTo, type: 'needed' });
            libSet.add(toLib);
            libSet.add(fromLib);
            continue;
          }
        }

        // Generating link map: file=libc.so.6 [0];  generating link map
        if (trimmed.includes('generating link map')) {
          const mapMatch = trimmed.match(/^file=([^ ;\[]+)(?:\s*\[\d+\])?;\s+generating link map/);
          if (mapMatch) {
            const rawMapFile = mapMatch[1].trim();
            currentMapFile = canonicalLib(rawMapFile);
            libSet.add(currentMapFile);
            if (!result.linkmaps[currentMapFile]) {
              result.linkmaps[currentMapFile] = { file: currentMapFile, rawFile: rawMapFile };
            }
            continue;
          }
        }
      }

      // 5. Searching: find library=libc.so.6 [0]; searching
      if (trimmed.startsWith('find library=')) {
        const searchMatch = trimmed.match(/^find library=([^ ;\[]+)(?:\s*\[\d+\])?;\s+searching/);
        if (searchMatch) {
          currentSearchLib = canonicalLib(searchMatch[1].trim());
          libSet.add(currentSearchLib);
          continue;
        }
      }

      // trying file=/lib/...
      if (trimmed.startsWith('trying file=')) {
        const tryPath = trimmed.substring(12).trim();
        if (currentSearchLib) {
          result.searchPaths.push({
            lib: currentSearchLib,
            path: tryPath
          });
          result.aliases[tryPath] = currentSearchLib;
          if (result.linkmaps[currentSearchLib]) {
            result.linkmaps[currentSearchLib].resolvedPath = tryPath;
          }
        }
        continue;
      }

      // 6. Link map details (dynamic / base / size / entry)
      if (trimmed.startsWith('dynamic:')) {
        const dynMatch = trimmed.match(/dynamic:\s*(0x[0-9a-fA-F]+)\s+base:\s*(0x[0-9a-fA-F]+)\s+size:\s*(0x[0-9a-fA-F]+)/);
        if (dynMatch && currentMapFile && result.linkmaps[currentMapFile]) {
          result.linkmaps[currentMapFile].dynamic = dynMatch[1];
          result.linkmaps[currentMapFile].base = dynMatch[2];
          result.linkmaps[currentMapFile].size = dynMatch[3];
          continue;
        }
      }

      if (trimmed.startsWith('entry:')) {
        const entryMatch = trimmed.match(/entry:\s*(0x[0-9a-fA-F]+)\s+phdr:\s*(0x[0-9a-fA-F]+)\s+phnum:\s*(\d+)/);
        if (entryMatch && currentMapFile && result.linkmaps[currentMapFile]) {
          result.linkmaps[currentMapFile].entry = entryMatch[1];
          result.linkmaps[currentMapFile].phdr = entryMatch[2];
          result.linkmaps[currentMapFile].phnum = parseInt(entryMatch[3], 10);
          continue;
        }
      }

      // 7. Relocation processing header
      if (trimmed.startsWith('relocation processing:')) {
        const relocHeaderMatch = trimmed.match(/^relocation processing:\s*([^\s]+)/);
        if (relocHeaderMatch) {
          currentRelocFile = canonicalLib(relocHeaderMatch[1].trim());
          libSet.add(currentRelocFile);
          currentSymbol = null;
          currentLookups = [];
          continue;
        }
      }

      // 8. Version check
      if (trimmed.startsWith('checking for version ')) {
        const verMatch = trimmed.match(/^checking for version [`']([^`']+)['`] in file ([^ ]+)(?:\s*\[\d+\])? required by file ([^ \[\n]+)/);
        if (verMatch) {
          const targetLib = canonicalLib(verMatch[2].trim());
          const reqLib = canonicalLib(verMatch[3].trim());
          result.versions.push({
            version: verMatch[1],
            file: targetLib,
            requiredBy: reqLib
          });
          libSet.add(targetLib);
          libSet.add(reqLib);
          continue;
        }
      }

      // 9. Initial Object Scopes
      if (trimmed.startsWith('object=')) {
        const objMatch = trimmed.match(/^object=([^ \[\n]+)/);
        if (objMatch) {
          currentScopeObject = canonicalLib(objMatch[1].trim());
          libSet.add(currentScopeObject);
          if (!result.scopes[currentScopeObject]) {
            result.scopes[currentScopeObject] = [];
          }
          continue;
        }
      }

      if (trimmed.startsWith('scope ') && currentScopeObject) {
        const scopeEntriesMatch = trimmed.match(/^scope \d+:\s*(.+)$/);
        if (scopeEntriesMatch) {
          const scopeEntries = scopeEntriesMatch[1].trim().split(/\s+/).map(canonicalLib);
          result.scopes[currentScopeObject].push(scopeEntries);
          continue;
        }
      }

      // 10. Calling Init / Fini
      if (trimmed.startsWith('calling init:')) {
        const initPath = trimmed.substring(13).trim();
        const initFile = canonicalLib(initPath);
        result.initOrder.push(initFile);
        libSet.add(initFile);
        continue;
      }

      if (trimmed.startsWith('calling fini:')) {
        const finiPath = trimmed.substring(13).trim();
        const finiFile = canonicalLib(finiPath);
        result.finiOrder.push(finiFile);
        libSet.add(finiFile);
        continue;
      }
    }

    // Deduplicate dependencies (in case of multiple needed lines)
    const depKeySet = new Set();
    const dedupedDeps = [];
    for (const d of result.dependencies) {
      const k = `${d.from}->${d.to}`;
      if (!depKeySet.has(k)) {
        depKeySet.add(k);
        dedupedDeps.push(d);
      }
    }
    result.dependencies = dedupedDeps;

    // Attach search paths / resolved paths to linkmap
    for (const sp of result.searchPaths) {
      if (result.linkmaps[sp.lib] && !result.linkmaps[sp.lib].resolvedPath) {
        result.linkmaps[sp.lib].resolvedPath = sp.path;
      }
    }

    result.pids = Array.from(result.pids);
    result.summary.totalRelocations = result.bindings.length;
    result.summary.uniqueSymbols = symbolSet.size;
    result.summary.librariesCount = libSet.size;
    result.summary.unusedCount = result.unusedDSOs.length;
    result.allLibraries = Array.from(libSet).sort();

    return result;
  }

  // Export to global scope
  global.LdParser = {
    parse: parseLdLog
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseLdLog };
  }
})(typeof window !== 'undefined' ? window : globalThis);
