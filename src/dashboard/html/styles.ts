export const STYLES = `
    :root { --pico-font-size: 14px; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin: 1rem 0; }
    .stat-card { text-align: center; padding: 1rem; border: 1px solid var(--pico-muted-border-color); border-radius: 8px; }
    .stat-card h3 { margin: 0; font-size: 2rem; }
    .stat-card small { color: var(--pico-muted-color); }
    .request-log { max-height: 60vh; overflow-y: auto; }
    .request-item { display: flex; gap: 1rem; padding: 0.5rem; border-bottom: 1px solid var(--pico-muted-border-color); font-family: monospace; font-size: 0.85rem; }
    .method { font-weight: bold; min-width: 60px; }
    .status-2xx { color: green; } .status-4xx { color: orange; } .status-5xx { color: red; }

    /* Tab navigation */
    .tab-nav { display: flex; gap: 0; border-bottom: 2px solid var(--pico-muted-border-color); margin-bottom: 1.5rem; }
    .tab-btn { background: none; border: none; border-bottom: 2px solid transparent; margin-bottom: -2px; padding: 0.5rem 1.25rem; cursor: pointer; font-size: 0.95rem; color: var(--pico-muted-color); }
    .tab-btn.active { color: var(--pico-primary); border-bottom-color: var(--pico-primary); font-weight: bold; }
    .tab-btn:hover:not(.active) { color: var(--pico-color); }

    /* Resource Explorer */
    .resource-layout { display: flex; gap: 1.5rem; align-items: flex-start; }
    .resource-sidebar { min-width: 200px; max-width: 220px; flex-shrink: 0; }
    .resource-sidebar ul { list-style: none; padding: 0; margin: 0; }
    .resource-sidebar li { padding: 0.4rem 0.75rem; cursor: pointer; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; }
    .resource-sidebar li:hover { background: var(--pico-muted-background); }
    .resource-sidebar li.active { background: var(--pico-primary-background); color: var(--pico-primary); font-weight: bold; }
    .resource-sidebar .badge { font-size: 0.75rem; color: var(--pico-muted-color); }
    .resource-sidebar li.active .badge { color: var(--pico-primary-hover); }
    .resource-main { flex: 1; min-width: 0; }
    .resource-table-wrap { overflow-x: auto; }
    .resource-table-wrap table { width: 100%; }
    .resource-table-wrap td, .resource-table-wrap th { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 260px; }
    .row-clickable { cursor: pointer; }
    .row-clickable:hover td { background: var(--pico-muted-background); }
    .detail-panel { margin-top: 1rem; }
    .detail-panel pre { background: var(--pico-code-background, #1e1e2e); color: var(--pico-code-color, #cdd6f4); padding: 1rem; border-radius: 8px; overflow-x: auto; font-size: 0.8rem; max-height: 60vh; }
    .pagination { display: flex; gap: 0.5rem; align-items: center; margin-top: 0.75rem; }
    .no-data { color: var(--pico-muted-color); font-style: italic; padding: 1rem 0; }
`;
