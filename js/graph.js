/**
 * graph.js - Standalone, zero-dependency interactive SVG graph visualizer
 * Features:
 * - Sugiyama-style Layered Graph Drawing (topological levels, barycenter crossing reduction, layer lanes)
 * - Organic Force-directed layout with strong repulsion forces and generous node spacing
 * - Precise arrowhead placement touching node boundaries cleanly (fixed-size, sleek arrows)
 * - Pan, zoom, drag nodes, edge weighting, tooltips
 */

(function (global) {
  'use strict';

  class LdGraphVisualizer {
    constructor(containerId, options = {}) {
      this.container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
      if (!this.container) {
        throw new Error(`Container element not found: ${containerId}`);
      }

      this.options = Object.assign({
        onNodeClick: null,
        mode: 'dependencies',   // 'dependencies' or 'symbol_flow'
        layoutType: 'layered',  // 'layered' or 'force'
      }, options);

      this.nodes = new Map(); // id -> nodeObj
      this.edges = [];        // [ edgeObj ]
      this.layers = [];       // array of layer arrays for layered drawing

      // Pan & Zoom state
      this.viewBox = { x: 0, y: 0, width: 800, height: 600 };
      this.scale = 1;
      this.panOffset = { x: 0, y: 0 };
      this.isPanning = false;
      this.startPan = { x: 0, y: 0 };
      this.draggedNode = null;
      this.dragStartPos = null;   // Track where drag started (SVG coords)
      this.hasDragged = false;    // True if mouse moved >5px during drag
      this.selectedNodeId = null;

      this.initDom();
      this.attachEvents();
    }

    initDom() {
      this.container.innerHTML = '';
      this.container.style.position = 'relative';
      this.container.style.overflow = 'hidden';
      this.container.style.userSelect = 'none';
      this.container.style.width = '100%';
      this.container.style.height = '100%';

      // SVG Element
      this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.svg.setAttribute('width', '100%');
      this.svg.setAttribute('height', '100%');
      this.svg.style.cursor = 'grab';
      this.svg.style.display = 'block';

      // Defs (Arrowheads with userSpaceOnUse and refX=10 at arrow tip)
      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      defs.innerHTML = `
        <marker id="arrow-default" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M 0 2 L 10 5 L 0 8 z" fill="var(--color-edge, #64748b)" />
        </marker>
        <marker id="arrow-highlight" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="9" markerHeight="9" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M 0 2 L 10 5 L 0 8 z" fill="var(--color-primary, #38bdf8)" />
        </marker>
        <marker id="arrow-unused" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M 0 2 L 10 5 L 0 8 z" fill="var(--color-danger, #ef4444)" />
        </marker>
        <filter id="node-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="3" stdDeviation="4" flood-opacity="0.25" />
        </filter>
      `;
      this.svg.appendChild(defs);

      // Main viewport group for pan/zoom
      this.viewport = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      this.viewport.setAttribute('class', 'graph-viewport');
      this.svg.appendChild(this.viewport);

      // Background guides group (for layer lanes)
      this.laneGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      this.laneGroup.setAttribute('class', 'lane-group');
      this.viewport.appendChild(this.laneGroup);

      // Edge group
      this.edgeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      this.edgeGroup.setAttribute('class', 'edge-group');
      this.viewport.appendChild(this.edgeGroup);

      // Node group
      this.nodeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      this.nodeGroup.setAttribute('class', 'node-group');
      this.viewport.appendChild(this.nodeGroup);

      this.container.appendChild(this.svg);

      // Floating Tooltip
      this.tooltip = document.createElement('div');
      this.tooltip.className = 'graph-tooltip';
      this.tooltip.style.display = 'none';
      this.container.appendChild(this.tooltip);

      // Floating Zoom Controls Overlay
      this.createToolbar();
      this.updateViewDimensions();
    }

    createToolbar() {
      const tb = document.createElement('div');
      tb.className = 'graph-controls';
      tb.innerHTML = `
        <button type="button" class="ctrl-btn" id="graph-zoom-in" title="Zoom In">+</button>
        <button type="button" class="ctrl-btn" id="graph-zoom-out" title="Zoom Out">−</button>
        <button type="button" class="ctrl-btn" id="graph-zoom-reset" title="Fit to Screen">⛶</button>
      `;
      this.container.appendChild(tb);

      tb.querySelector('#graph-zoom-in').addEventListener('click', () => this.zoom(1.25));
      tb.querySelector('#graph-zoom-out').addEventListener('click', () => this.zoom(0.8));
      tb.querySelector('#graph-zoom-reset').addEventListener('click', () => this.fitToView());
    }

    attachEvents() {
      // Pan with Mouse
      this.svg.addEventListener('mousedown', (e) => {
        if (e.target.closest('.graph-node')) return; // handled by node drag
        this.isPanning = true;
        this.svg.style.cursor = 'grabbing';
        this.startPan = { x: e.clientX, y: e.clientY };
      });

      window.addEventListener('mousemove', (e) => {
        if (this.isPanning) {
          const dx = (e.clientX - this.startPan.x) / this.scale;
          const dy = (e.clientY - this.startPan.y) / this.scale;
          this.panOffset.x += dx;
          this.panOffset.y += dy;
          this.startPan = { x: e.clientX, y: e.clientY };
          this.updateTransform();
        } else if (this.draggedNode) {
          const rect = this.svg.getBoundingClientRect();
          const svgX = (e.clientX - rect.left) / this.scale - this.panOffset.x;
          const svgY = (e.clientY - rect.top) / this.scale - this.panOffset.y;
          // Detect actual drag (threshold: 5px in SVG coords)
          if (!this.hasDragged && this.dragStartPos) {
            const ddx = svgX - this.dragStartPos.x;
            const ddy = svgY - this.dragStartPos.y;
            if (Math.sqrt(ddx * ddx + ddy * ddy) > 5) {
              this.hasDragged = true;
            }
          }
          this.draggedNode.x = svgX;
          this.draggedNode.y = svgY;
          this.updateNodePositions();
        }
      });

      window.addEventListener('mouseup', () => {
        if (this.isPanning) {
          this.isPanning = false;
          this.svg.style.cursor = 'grab';
        }
        if (this.draggedNode) {
          this.draggedNode = null;
          this.dragStartPos = null;
          // hasDragged intentionally NOT reset here; click fires after mouseup
        }
      });

      // Zoom with wheel
      this.svg.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
        const rect = this.svg.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        this.zoomAtPoint(zoomFactor, mouseX, mouseY);
      }, { passive: false });

      if (window.ResizeObserver) {
        new ResizeObserver(() => {
          this.updateViewDimensions();
        }).observe(this.container);
      }
    }

    updateViewDimensions() {
      const rect = this.container.getBoundingClientRect();
      this.viewBox.width = Math.max(300, rect.width || 800);
      this.viewBox.height = Math.max(300, rect.height || 600);
      this.updateTransform();
    }

    zoom(factor) {
      this.zoomAtPoint(factor, this.viewBox.width / 2, this.viewBox.height / 2);
    }

    zoomAtPoint(factor, clientX, clientY) {
      const oldScale = this.scale;
      const newScale = Math.min(Math.max(0.12, this.scale * factor), 4);
      if (newScale === oldScale) return;

      const pX = clientX / oldScale - this.panOffset.x;
      const pY = clientY / oldScale - this.panOffset.y;

      this.scale = newScale;
      this.panOffset.x = clientX / newScale - pX;
      this.panOffset.y = clientY / newScale - pY;

      this.updateTransform();
    }

    updateTransform() {
      this.viewport.setAttribute(
        'transform',
        `scale(${this.scale}) translate(${this.panOffset.x}, ${this.panOffset.y})`
      );
    }

    fitToView() {
      if (this.nodes.size === 0) return;

      const nodeList = Array.from(this.nodes.values());
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

      nodeList.forEach(n => {
        minX = Math.min(minX, n.x - n.width / 2);
        maxX = Math.max(maxX, n.x + n.width / 2);
        minY = Math.min(minY, n.y - n.height / 2);
        maxY = Math.max(maxY, n.y + n.height / 2);
      });

      const pad = 80;
      minX -= pad; minY -= pad; maxX += pad; maxY += pad;

      const graphWidth = Math.max(120, maxX - minX);
      const graphHeight = Math.max(120, maxY - minY);
      const viewW = this.container.clientWidth || this.viewBox.width || 800;
      const viewH = this.container.clientHeight || this.viewBox.height || 600;

      const scaleX = (viewW - 40) / graphWidth;
      const scaleY = (viewH - 40) / graphHeight;
      this.scale = Math.min(1.4, Math.max(0.2, Math.min(scaleX, scaleY)));

      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      this.panOffset.x = (viewW / this.scale) / 2 - centerX;
      this.panOffset.y = (viewH / this.scale) / 2 - centerY;

      this.updateTransform();
    }

    setLayoutType(type) {
      this.options.layoutType = type;
      this.computeLayout();
      this.render();
      setTimeout(() => this.fitToView(), 30);
    }

    setData(data, mode = 'dependencies') {
      this.options.mode = mode;
      this.nodes.clear();
      this.edges = [];

      if (!data) return;

      const unusedSet = new Set((data.unusedDSOs || []).map(u => u.file));
      const linkmap = data.linkmaps || {};

      const allLibs = new Set();
      (data.dependencies || []).forEach(dep => {
        allLibs.add(dep.from);
        allLibs.add(dep.to);
      });
      (data.bindings || []).forEach(b => {
        allLibs.add(b.from);
        allLibs.add(b.to);
      });
      Object.keys(linkmap).forEach(lib => allLibs.add(lib));

      allLibs.forEach(lib => {
        const basename = lib.split('/').pop() || lib;
        const mapInfo = linkmap[lib] || linkmap[basename] || {};
        const isUnused = unusedSet.has(lib) || unusedSet.has(basename);

        const incomingSymbols = (data.bindings || []).filter(b => b.to === lib).length;
        const outgoingSymbols = (data.bindings || []).filter(b => b.from === lib).length;

        const isRoot = (data.dependencies || []).some(d => d.from === lib) &&
                       !(data.dependencies || []).some(d => d.to === lib) &&
                       !lib.includes('.so');

        this.nodes.set(lib, {
          id: lib,
          label: basename,
          fullPath: mapInfo.resolvedPath || mapInfo.rawFile || lib,
          isRoot: isRoot,
          isUnused: isUnused,
          baseAddr: mapInfo.base || null,
          size: mapInfo.size || null,
          entry: mapInfo.entry || null,
          incomingSymbols,
          outgoingSymbols,
          width: 180,
          height: 52,
          x: 0,
          y: 0,
          layer: 0
        });
      });

      if (mode === 'dependencies') {
        (data.dependencies || []).forEach(dep => {
          this.edges.push({
            source: dep.from,
            target: dep.to,
            type: 'needed',
            weight: 1,
            label: 'needed'
          });
        });
      } else {
        const flowMap = new Map();
        (data.bindings || []).forEach(b => {
          const key = `${b.from}->${b.to}`;
          flowMap.set(key, (flowMap.get(key) || 0) + 1);
        });

        flowMap.forEach((count, key) => {
          const [source, target] = key.split('->');
          this.edges.push({
            source: source,
            target: target,
            type: 'binding',
            weight: count,
            label: `${count} sym${count > 1 ? 's' : ''}`
          });
        });
      }

      this.computeLayout();
      this.render();
      setTimeout(() => this.fitToView(), 30);
    }

    computeLayout() {
      const nodeList = Array.from(this.nodes.values());
      if (nodeList.length === 0) return;

      if (this.options.layoutType === 'force') {
        this.computeForceLayout(nodeList);
        return;
      }

      // Sugiyama Layered Graph Drawing
      this.computeLayeredLayout(nodeList);
    }

    computeLayeredLayout(nodeList) {
      const adj = new Map();
      const revAdj = new Map();
      const inDegree = new Map();

      nodeList.forEach(n => {
        adj.set(n.id, []);
        revAdj.set(n.id, []);
        inDegree.set(n.id, 0);
      });

      this.edges.forEach(e => {
        if (e.source !== e.target && adj.has(e.source) && inDegree.has(e.target)) {
          adj.get(e.source).push(e.target);
          revAdj.get(e.target).push(e.source);
          inDegree.set(e.target, inDegree.get(e.target) + 1);
        }
      });

      // 1. Layer Assignment (Longest Path Ranking)
      let roots = nodeList.filter(n => inDegree.get(n.id) === 0 || n.isRoot);
      if (roots.length === 0) roots = [nodeList[0]];

      const nodeLayerMap = new Map();
      roots.forEach(r => nodeLayerMap.set(r.id, 0));

      const queue = [...roots];
      while (queue.length > 0) {
        const u = queue.shift();
        const uLvl = nodeLayerMap.get(u.id);
        (adj.get(u.id) || []).forEach(vId => {
          const currLvl = nodeLayerMap.get(vId) || 0;
          if (uLvl + 1 > currLvl) {
            nodeLayerMap.set(vId, uLvl + 1);
            const vNode = this.nodes.get(vId);
            if (vNode) queue.push(vNode);
          }
        });
      }

      // Find max layer
      let maxLayer = 0;
      nodeLayerMap.forEach(lvl => {
        if (lvl > maxLayer) maxLayer = lvl;
      });

      // Group nodes into layers
      this.layers = [];
      for (let i = 0; i <= maxLayer; i++) this.layers.push([]);

      nodeList.forEach(n => {
        const lvl = nodeLayerMap.get(n.id) || 0;
        n.layer = lvl;
        this.layers[lvl].push(n);
      });

      // 2. Crossing Reduction via Barycenter Ordering
      for (let l = 1; l <= maxLayer; l++) {
        const prevLayer = this.layers[l - 1];
        const prevPosMap = new Map();
        prevLayer.forEach((n, idx) => prevPosMap.set(n.id, idx));

        this.layers[l].sort((nA, nB) => {
          const parentsA = revAdj.get(nA.id) || [];
          const parentsB = revAdj.get(nB.id) || [];

          const baryA = parentsA.length > 0
            ? parentsA.reduce((sum, pId) => sum + (prevPosMap.get(pId) || 0), 0) / parentsA.length
            : 0;
          const baryB = parentsB.length > 0
            ? parentsB.reduce((sum, pId) => sum + (prevPosMap.get(pId) || 0), 0) / parentsB.length
            : 0;

          return baryA - baryB;
        });
      }

      // 3. Coordinate Assignment with Generous Spacing
      // Generous spacing between layers (vertical) and between nodes (horizontal)
      const layerSpacingY = 210; // ample vertical breathing room
      const nodeSpacingX = 310;  // 180px node width + 130px clear gap

      this.layers.forEach((layerNodes, lIdx) => {
        const totalW = (layerNodes.length - 1) * nodeSpacingX;
        const startX = -totalW / 2;
        layerNodes.forEach((node, nIdx) => {
          node.x = startX + nIdx * nodeSpacingX;
          node.y = lIdx * layerSpacingY;
        });
      });
    }

    computeForceLayout(nodeList) {
      // High-dispersion force simulation with strong repulsion
      const N = nodeList.length;
      if (N === 0) return;

      const initRadius = Math.max(300, Math.sqrt(N) * 160);
      nodeList.forEach((node, i) => {
        const angle = (i / N) * 2 * Math.PI;
        node.x = Math.cos(angle) * initRadius;
        node.y = Math.sin(angle) * initRadius;
        node.vx = 0;
        node.vy = 0;
      });

      // 80 simulation steps with strong repulsion and generous spring length
      for (let iter = 0; iter < 80; iter++) {
        // Strong Coulomb repulsion
        for (let i = 0; i < N; i++) {
          for (let j = i + 1; j < N; j++) {
            const nA = nodeList[i];
            const nB = nodeList[j];
            const dx = nB.x - nA.x;
            const dy = nB.y - nA.y;
            const dist = Math.max(30, Math.sqrt(dx * dx + dy * dy));
            // Stronger repulsion constant (180,000)
            const force = 180000 / (dist * dist);
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            nA.vx -= fx;
            nA.vy -= fy;
            nB.vx += fx;
            nB.vy += fy;
          }
        }

        // Hooke spring attraction along edges with large rest length (280px)
        this.edges.forEach(edge => {
          const nA = this.nodes.get(edge.source);
          const nB = this.nodes.get(edge.target);
          if (nA && nB && nA !== nB) {
            const dx = nB.x - nA.x;
            const dy = nB.y - nA.y;
            const dist = Math.max(10, Math.sqrt(dx * dx + dy * dy));
            const force = (dist - 280) * 0.04;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            nA.vx += fx;
            nA.vy += fy;
            nB.vx -= fx;
            nB.vy -= fy;
          }
        });

        const damp = 0.88;
        nodeList.forEach(n => {
          n.x += n.vx * 0.1;
          n.y += n.vy * 0.1;
          n.vx *= damp;
          n.vy *= damp;
        });
      }
    }

    render() {
      this.laneGroup.innerHTML = '';
      this.edgeGroup.innerHTML = '';
      this.nodeGroup.innerHTML = '';

      const isLayered = this.options.layoutType === 'layered';

      // 1. Render Layer Guidance Lanes in background (if layered)
      if (isLayered && this.layers.length > 0) {
        const nodeList = Array.from(this.nodes.values());
        let minX = Infinity, maxX = -Infinity;
        nodeList.forEach(n => {
          minX = Math.min(minX, n.x - n.width / 2);
          maxX = Math.max(maxX, n.x + n.width / 2);
        });
        const laneW = Math.max(800, (maxX - minX) + 180);
        const laneLeft = (minX + maxX) / 2 - laneW / 2;

        this.layers.forEach((layerNodes, lIdx) => {
          if (layerNodes.length === 0) return;
          const y = lIdx * 210;

          // Lane guide group
          const laneG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          laneG.setAttribute('class', 'layer-lane');

          // Subtle dashed guide line
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', laneLeft);
          line.setAttribute('y1', y);
          line.setAttribute('x2', laneLeft + laneW);
          line.setAttribute('y2', y);
          line.setAttribute('stroke', 'var(--border-color, #334155)');
          line.setAttribute('stroke-dasharray', '4 6');
          line.setAttribute('stroke-width', '1');
          line.setAttribute('opacity', '0.45');
          laneG.appendChild(line);

          // Layer title badge
          let titleText = `Layer ${lIdx}`;
          if (lIdx === 0) titleText = `Layer 0: Application Root`;
          else if (lIdx === 1) titleText = `Layer 1: Direct Dependencies`;
          else if (lIdx === this.layers.length - 1) titleText = `Layer ${lIdx}: Core / Leaf Runtime`;
          else titleText = `Layer ${lIdx}: Transitive Dependencies`;

          const tag = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          tag.setAttribute('x', laneLeft - 15);
          tag.setAttribute('y', y + 4);
          tag.setAttribute('class', 'layer-tag');
          tag.setAttribute('text-anchor', 'end');
          tag.textContent = titleText;
          laneG.appendChild(tag);

          this.laneGroup.appendChild(laneG);
        });
      }

      // 2. Render Edges with precise boundary intersection
      this.edges.forEach((edge, idx) => {
        const sourceNode = this.nodes.get(edge.source);
        const targetNode = this.nodes.get(edge.target);
        if (!sourceNode || !targetNode) return;

        const isSelf = edge.source === edge.target;
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', `graph-edge edge-${idx}`);
        g.setAttribute('data-source', edge.source);
        g.setAttribute('data-target', edge.target);

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', 'edge-line');
        path.setAttribute('marker-end', targetNode.isUnused ? 'url(#arrow-unused)' : 'url(#arrow-default)');
        // Sleek stroke width (never thick)
        path.style.strokeWidth = Math.min(2.4, Math.max(1.2, Math.log2(edge.weight + 1) * 0.7));
        g.appendChild(path);

        if (edge.label && this.options.mode === 'symbol_flow') {
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('class', 'edge-label');
          text.textContent = edge.label;
          g.appendChild(text);
        }

        this.edgeGroup.appendChild(g);
      });

      // 3. Render Nodes
      this.nodes.forEach(node => {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', `graph-node ${node.isUnused ? 'is-unused' : ''} ${node.isRoot ? 'is-root' : ''}`);
        g.setAttribute('data-id', node.id);
        g.setAttribute('transform', `translate(${node.x}, ${node.y})`);

        // Node card box
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', -node.width / 2);
        rect.setAttribute('y', -node.height / 2);
        rect.setAttribute('width', node.width);
        rect.setAttribute('height', node.height);
        rect.setAttribute('rx', 8);
        rect.setAttribute('class', 'node-box');
        rect.setAttribute('filter', 'url(#node-shadow)');
        g.appendChild(rect);

        // Top Accent Bar
        const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bar.setAttribute('x', -node.width / 2);
        bar.setAttribute('y', -node.height / 2);
        bar.setAttribute('width', node.width);
        bar.setAttribute('height', 4);
        bar.setAttribute('rx', 2);
        bar.setAttribute('class', node.isUnused ? 'node-bar-unused' : (node.isRoot ? 'node-bar-root' : 'node-bar-lib'));
        g.appendChild(bar);

        // Label Text
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        title.setAttribute('x', 0);
        title.setAttribute('y', -2);
        title.setAttribute('class', 'node-title');
        title.textContent = node.label.length > 21 ? node.label.slice(0, 19) + '…' : node.label;
        g.appendChild(title);

        // Subtitle / Address / Badge
        const sub = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        sub.setAttribute('x', 0);
        sub.setAttribute('y', 15);
        sub.setAttribute('class', 'node-subtitle');
        if (node.isUnused) {
          sub.textContent = '⚠ UNUSED DSO';
          sub.style.fill = 'var(--color-danger, #ef4444)';
          sub.style.fontWeight = '700';
        } else if (node.baseAddr) {
          sub.textContent = `${node.baseAddr.slice(0, 10)}…`;
        } else {
          sub.textContent = `${node.incomingSymbols} syms resolved`;
        }
        g.appendChild(sub);

        // Node Drag Events
        g.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          this.draggedNode = node;
          this.hasDragged = false;
          // Record start position in SVG coords
          const rect = this.svg.getBoundingClientRect();
          this.dragStartPos = {
            x: (e.clientX - rect.left) / this.scale - this.panOffset.x,
            y: (e.clientY - rect.top) / this.scale - this.panOffset.y
          };
        });

        // Click Event (select node & filter table) — only if user didn't drag
        g.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.hasDragged) {
            this.hasDragged = false; // reset for next interaction
            return;
          }
          this.selectNode(node.id);
          if (typeof this.options.onNodeClick === 'function') {
            this.options.onNodeClick(node);
          }
        });

        // Tooltip events
        g.addEventListener('mouseenter', (e) => this.showTooltip(node, e));
        g.addEventListener('mouseleave', () => this.hideTooltip());

        this.nodeGroup.appendChild(g);
      });

      this.updateNodePositions();
    }

    /**
     * Calculates the exact border intersection point on a node rectangle
     * so that arrowheads cleanly touch the boundary with zero displacement.
     */
    getNodeBorderPoint(fromX, fromY, toNode) {
      const dx = toNode.x - fromX;
      const dy = toNode.y - fromY;
      if (dx === 0 && dy === 0) return { x: toNode.x, y: toNode.y };

      const hw = toNode.width / 2;
      const hh = toNode.height / 2;

      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      let scale = 1;
      if (absDx * hh > absDy * hw) {
        scale = hw / absDx;
      } else {
        scale = hh / absDy;
      }

      return {
        x: toNode.x - dx * scale,
        y: toNode.y - dy * scale
      };
    }

    updateNodePositions() {
      const isLayered = this.options.layoutType === 'layered';

      // Update Node translations
      const nodeElements = this.nodeGroup.querySelectorAll('.graph-node');
      nodeElements.forEach(el => {
        const id = el.getAttribute('data-id');
        const node = this.nodes.get(id);
        if (node) {
          el.setAttribute('transform', `translate(${node.x}, ${node.y})`);
        }
      });

      // Update Edges
      const edgeElements = this.edgeGroup.querySelectorAll('.graph-edge');
      edgeElements.forEach(el => {
        const sourceId = el.getAttribute('data-source');
        const targetId = el.getAttribute('data-target');
        const sourceNode = this.nodes.get(sourceId);
        const targetNode = this.nodes.get(targetId);
        if (!sourceNode || !targetNode) return;

        const path = el.querySelector('.edge-line');
        const label = el.querySelector('.edge-label');
        const isSelf = sourceId === targetId;

        if (isSelf) {
          const x = sourceNode.x + sourceNode.width / 2;
          const y = sourceNode.y;
          path.setAttribute('d', `M ${x} ${y - 10} C ${x + 40} ${y - 30}, ${x + 40} ${y + 30}, ${x} ${y + 10}`);
          if (label) {
            label.setAttribute('x', x + 35);
            label.setAttribute('y', y);
          }
        } else if (isLayered && targetNode.y > sourceNode.y) {
          // Standard downward hierarchical flow
          const startX = sourceNode.x;
          const startY = sourceNode.y + sourceNode.height / 2;
          const endX = targetNode.x;
          const endY = targetNode.y - targetNode.height / 2; // Exact top border of target node

          const cY = (startY + endY) / 2;
          path.setAttribute('d', `M ${startX} ${startY} C ${startX} ${cY}, ${endX} ${cY}, ${endX} ${endY}`);
          if (label) {
            label.setAttribute('x', (startX + endX) / 2);
            label.setAttribute('y', cY - 4);
          }
        } else {
          // Force layout or non-downward edge: compute exact rectangle boundary intersection
          const startPt = this.getNodeBorderPoint(targetNode.x, targetNode.y, sourceNode);
          const endPt = this.getNodeBorderPoint(sourceNode.x, sourceNode.y, targetNode);

          const cX = (startPt.x + endPt.x) / 2;
          const cY = (startPt.y + endPt.y) / 2;
          path.setAttribute('d', `M ${startPt.x} ${startPt.y} Q ${cX} ${cY}, ${endPt.x} ${endPt.y}`);
          if (label) {
            label.setAttribute('x', cX);
            label.setAttribute('y', cY - 4);
          }
        }
      });
    }

    selectNode(nodeId) {
      this.selectedNodeId = nodeId;

      const allNodeEls = this.nodeGroup.querySelectorAll('.graph-node');
      allNodeEls.forEach(el => {
        const id = el.getAttribute('data-id');
        if (id === nodeId) {
          el.classList.add('is-selected');
        } else {
          el.classList.remove('is-selected');
        }
      });

      const allEdgeEls = this.edgeGroup.querySelectorAll('.graph-edge');
      allEdgeEls.forEach(el => {
        const s = el.getAttribute('data-source');
        const t = el.getAttribute('data-target');
        if (s === nodeId || t === nodeId) {
          el.classList.add('is-highlighted');
          el.querySelector('.edge-line').setAttribute('marker-end', 'url(#arrow-highlight)');
        } else {
          el.classList.remove('is-highlighted');
          el.querySelector('.edge-line').setAttribute('marker-end', 'url(#arrow-default)');
        }
      });
    }

    showTooltip(node, event) {
      let content = `
        <div class="tt-header">
          <strong>${node.label}</strong>
          ${node.isUnused ? '<span class="tt-badge tt-badge-danger">UNUSED</span>' : ''}
          ${node.isRoot ? '<span class="tt-badge tt-badge-primary">MAIN APP</span>' : ''}
        </div>
        <div class="tt-body">
          <div class="tt-row"><span class="tt-key">Path:</span> <span class="tt-val">${node.fullPath}</span></div>
      `;

      if (node.baseAddr) {
        content += `<div class="tt-row"><span class="tt-key">Base Address:</span> <span class="tt-val font-mono">${node.baseAddr}</span></div>`;
      }
      if (node.size) {
        const sizeBytes = parseInt(node.size, 16);
        const sizeFormatted = !isNaN(sizeBytes) ? `${(sizeBytes / 1024).toFixed(1)} KB` : node.size;
        content += `<div class="tt-row"><span class="tt-key">Memory Size:</span> <span class="tt-val font-mono">${sizeFormatted} (${node.size})</span></div>`;
      }
      if (node.entry) {
        content += `<div class="tt-row"><span class="tt-key">Entry Point:</span> <span class="tt-val font-mono">${node.entry}</span></div>`;
      }

      content += `
          <div class="tt-row"><span class="tt-key">Symbols Bound (In):</span> <span class="tt-val">${node.incomingSymbols}</span></div>
          <div class="tt-row"><span class="tt-key">Symbols Used (Out):</span> <span class="tt-val">${node.outgoingSymbols}</span></div>
          <div class="tt-hint">Click node to filter bindings table</div>
        </div>
      `;

      this.tooltip.innerHTML = content;
      this.tooltip.style.display = 'block';

      const rect = this.container.getBoundingClientRect();
      let left = event.clientX - rect.left + 15;
      let top = event.clientY - rect.top + 15;

      if (left + 260 > rect.width) left = rect.width - 270;
      if (top + 180 > rect.height) top = rect.height - 190;

      this.tooltip.style.left = `${Math.max(10, left)}px`;
      this.tooltip.style.top = `${Math.max(10, top)}px`;
    }

    hideTooltip() {
      this.tooltip.style.display = 'none';
    }
  }

  global.LdGraphVisualizer = LdGraphVisualizer;
})(typeof window !== 'undefined' ? window : globalThis);
