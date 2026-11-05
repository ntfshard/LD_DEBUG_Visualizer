# LD_DEBUG Log Visualizer (`ld_debug_viewer`)

A lightweight, zero-dependency client-side web application designed to parse, filter, and visualize Linux dynamic linker (`ld.so`) logs. It can be hosted directly on **GitHub Pages** or opened locally in any modern browser without a backend or build step.

---

## Features

- **100% Front-End & Zero Dependencies**: Runs directly in the browser via native Web APIs, SVG, and ES6+. All required scripts and styles are stored in this repository (zero external CDNs).
- **Log Compatibility**: Tailored for logs generated with:
  ```bash
  LD_DEBUG=all,unused,statistics LD_DEBUG_OUTPUT=$MY_LOG_PATH ./my_application
  ```
- **High Performance on Giant Logs**: Fast-path streaming parser optimized to smoothly handle multi-megabyte logs (e.g. 70MB+ with 500,000+ lookups and 18,000+ bindings).
- **Canonical DSO Name Resolution**: Seamlessly resolves library paths (e.g. `/lib/x86_64-linux-gnu/libtirpc.so.3`) with soname dependencies (`libtirpc.so.3`) so the entire dependency tree links into an interconnected DAG.
- **Full Viewport Space Utilization**: The graph adapts to 100% of the canvas height and width with dynamic layer and node spacing (no stripe or cramped compression).
- **Sugiyama-Style Layered Graph Drawing**:
  - **Layered Graph (Default)**: Ranks libraries into distinct hierarchy tiers (Application Root &rarr; Direct Dependencies &rarr; Transitive Dependencies &rarr; Core Runtime). Uses barycenter crossing reduction so lines never tangle, accompanied by subtle layer lane guide indicators.
  - **Force Network**: Organic physics-based force simulation with high-repulsion physics for freeform exploration.
  - **Precise Boundary Arrowheads**: Fixed-size sleek arrowheads (`markerUnits="userSpaceOnUse"`) that terminate exactly at the node boundary with zero displacement.
  - **Generous Node & Layer Spacing**: Ample breathing room between nodes (310px X spacing, 210px Y spacing) ensuring clear readability.
  - **Modes**: Toggle between `DSO Dependencies (Needed)` and `Symbol Binding Flows` (weighted edges).
- **Independent Dual Filtering**:
  - **Filename Filter**: Filter symbol bindings by requesting or providing library/binary name.
  - **Symbol Name Filter**: Filter symbol bindings by function/variable symbol name (e.g., `malloc`, `pthread`, `__vdso`).
  - Options for Case-sensitivity, Regular Expressions, and Cross-library only bindings.
- **Dynamic Linker Statistics & KPIs**:
  - Total startup cycles, relocation processing cycles, and percentage overhead.
  - Number of relocations, cached relocations, and relative relocations.
  - Initializers (`calling init`) execution sequence.
  - Link map memory layout (base address, virtual size, entry point).
- **Data Export**: Export filtered bindings table to CSV.
- **Minimalist GUI**: Dark and Light theme toggle, responsive layout, drag-and-drop log file upload, and 1-click sample log loader preloaded with `ldlog.4430`.

---

## Quick Start / How to Run

### 1. View Locally
Simply open `index.html` in your web browser:
```bash
# On Windows
start index.html

# On Linux / macOS
xdg-open index.html   # or open index.html
```

Or run a local HTTP server using Python:
```bash
python -m http.server 8000
# Then visit http://localhost:8000
```

### 2. Host on GitHub Pages
1. Push this repository to GitHub.
2. In your repository on GitHub, navigate to **Settings** > **Pages**.
3. Under **Build and deployment** > **Source**, choose **Deploy from a branch**.
4. Select `main` (or your default branch) and `/ (root)` folder.
5. Click **Save**. Your viewer will be live at `https://<username>.github.io/<repo-name>/`.

---

## How to Collect Logs on Linux

Run your binary with `LD_DEBUG` configured:

```bash
LD_DEBUG=all,unused,statistics LD_DEBUG_OUTPUT=~/my_stats_log ./my_application
```

This will produce a log file named `my_stats_log.<PID>` (e.g., `my_stats_log.4430`). Drag and drop or upload this file into the viewer.

### Flag Descriptions:
- `all`: Traces symbol resolution, bindings, file lookups, link maps, and object scopes.
- `unused`: Analyzes and warns if any dynamically linked libraries were never actually referenced.
- `statistics`: Gathers detailed performance timing and cycle counts from the dynamic linker.
- `LD_DEBUG_OUTPUT`: Writes output to `<path>.<PID>` instead of standard error.

---

## Repository Structure

```
ld_debug_viewer/
├── index.html              # Main HTML entry point
├── css/
│   └── style.css           # Full-viewport minimalist styling with Dark/Light themes
├── js/
│   ├── parser.js           # High-performance streaming parser with canonical DSO resolution
│   ├── graph.js            # Standalone interactive SVG DAG & call graph (TB, LR, Force)
│   ├── table.js            # Paginated bindings table with dual filters & CSV export
│   ├── sample.js           # Embedded default sample log (ldlog.4430)
│   └── app.js              # Application coordinator & state manager
├── .gitignore              # Ignores giant/local logs (e.g. ldlog.4386)
├── ldlog.4430              # Default rich sample log
├── ldlog.2967              # Minimal sample log
├── SPEC.md                 # Technical specification document
├── README.md               # User guide & documentation
└── verify_all.py           # Verification and regression test suite
```

---

## License
MIT License.
