"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./BotBuilder.module.css";

type BlockKind = "purchase" | "condition" | "risk" | "restart" | "stop";
type StrategyBlock = { id: string; kind: BlockKind; title: string; detail: string; enabled: boolean };
type Draft = {
  name: string; symbol: string; contract: "DIGITOVER" | "DIGITUNDER" | "DIGITEVEN" | "DIGITODD" | "DIGITMATCH" | "DIGITDIFF";
  barrier: number; stake: number; duration: number; maxTrades: number; dailyLoss: number; maxLossStreak: number;
  blocks: StrategyBlock[];
};
const starters: StrategyBlock[] = [
  { id: "purchase", kind: "purchase", title: "Trade parameters", detail: "Choose market, digit contract, stake and duration.", enabled: true },
  { id: "condition", kind: "condition", title: "Purchase condition", detail: "Only consider entries when the configured signal rule is satisfied.", enabled: true },
  { id: "risk", kind: "risk", title: "Risk guard", detail: "Stop when the daily loss limit or trade count is reached.", enabled: true },
  { id: "restart", kind: "restart", title: "Restart conditions", detail: "Evaluate the next entry only after the previous contract settles.", enabled: true },
  { id: "stop", kind: "stop", title: "Stop conditions", detail: "Stop on the configured consecutive-loss limit.", enabled: true },
];
const defaultDraft: Draft = { name: "My digit strategy", symbol: "1HZ75V", contract: "DIGITOVER", barrier: 5, stake: 1, duration: 1, maxTrades: 10, dailyLoss: 5, maxLossStreak: 3, blocks: starters };
const palette: Array<{ kind: BlockKind; title: string; detail: string }> = [
  { kind: "purchase", title: "Trade parameters", detail: "Market, contract, stake and duration." },
  { kind: "condition", title: "Purchase condition", detail: "Entry rule and signal conditions." },
  { kind: "risk", title: "Risk guard", detail: "Daily loss and maximum trade limits." },
  { kind: "restart", title: "Restart conditions", detail: "Rules evaluated after a contract settles." },
  { kind: "stop", title: "Stop conditions", detail: "Stop after a loss streak or limit breach." },
];

function makeBlock(kind: BlockKind): StrategyBlock {
  const item = palette.find((entry) => entry.kind === kind)!;
  return { id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ...item, enabled: true };
}

export default function BotBuilder() {
  const [draft, setDraft] = useState<Draft>(defaultDraft);
  const [saved, setSaved] = useState<Draft[]>([]);
  const [notice, setNotice] = useState("Drafts are saved in this browser. Execution is not enabled from the visual editor yet.");
  const [search, setSearch] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("tradebridge_bot_builder_drafts_v1");
      if (raw) setSaved(JSON.parse(raw) as Draft[]);
      const active = localStorage.getItem("tradebridge_bot_builder_active_v1");
      if (active) setDraft(JSON.parse(active) as Draft);
    } catch { setNotice("Saved drafts could not be read. You can still create and export a new draft."); }
  }, []);

  const issues = useMemo(() => {
    const found: string[] = [];
    if (!draft.name.trim()) found.push("Give the strategy a name.");
    if (!/^[A-Za-z0-9_]{2,32}$/.test(draft.symbol)) found.push("Market symbol must contain 2–32 letters, numbers or underscores.");
    if (!Number.isFinite(draft.stake) || draft.stake <= 0 || draft.stake > 10000) found.push("Stake must be greater than 0 and no more than 10,000.");
    if (!Number.isInteger(draft.duration) || draft.duration < 1 || draft.duration > 10) found.push("Duration must be 1–10 ticks.");
    if (!Number.isInteger(draft.barrier) || draft.barrier < 0 || draft.barrier > 9) found.push("Digit barrier must be between 0 and 9.");
    if (!Number.isInteger(draft.maxTrades) || draft.maxTrades < 1 || draft.maxTrades > 100) found.push("Maximum trades must be between 1 and 100.");
    if (!Number.isFinite(draft.dailyLoss) || draft.dailyLoss <= 0) found.push("Daily loss limit must be greater than 0.");
    if (!Number.isInteger(draft.maxLossStreak) || draft.maxLossStreak < 1 || draft.maxLossStreak > 10) found.push("Maximum consecutive losses must be between 1 and 10.");
    for (const required of ["purchase", "condition", "risk", "restart", "stop"] as BlockKind[]) {
      if (!draft.blocks.some((block) => block.kind === required && block.enabled)) found.push(`Enable or add the ${palette.find((p) => p.kind === required)?.title.toLowerCase()} block.`);
    }
    return [...new Set(found)];
  }, [draft]);

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  function persist(nextSaved = saved, nextDraft = draft) {
    try {
      localStorage.setItem("tradebridge_bot_builder_drafts_v1", JSON.stringify(nextSaved));
      localStorage.setItem("tradebridge_bot_builder_active_v1", JSON.stringify(nextDraft));
      setSaved(nextSaved);
      setNotice("Draft saved in this browser. It has not been sent to the trading engine.");
    } catch { setNotice("Could not save locally. Export the strategy JSON to keep a copy."); }
  }
  function saveDraft() {
    const next = [draft, ...saved.filter((item) => item.name !== draft.name)].slice(0, 20);
    persist(next);
  }
  function loadDraft(item: Draft) {
    setDraft(item);
    try { localStorage.setItem("tradebridge_bot_builder_active_v1", JSON.stringify(item)); } catch {}
    setNotice(`Loaded “${item.name}”. Validate it before using it.`);
  }
  function addBlock(kind: BlockKind) {
    const next = [...draft.blocks, makeBlock(kind)];
    update("blocks", next);
    setNotice(`${palette.find((p) => p.kind === kind)?.title} block added.`);
  }
  function moveBlock(id: string, offset: number) {
    const from = draft.blocks.findIndex((block) => block.id === id);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= draft.blocks.length) return;
    const next = [...draft.blocks];
    [next[from], next[to]] = [next[to], next[from]];
    update("blocks", next);
  }
  function exportDraft() {
    const blob = new Blob([JSON.stringify({ format: "tradebridge-native-draft-v1", ...draft }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${draft.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "strategy"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("Strategy JSON exported. This file is a draft format, not executable bot code.");
  }
  async function importDraft(file?: File) {
    if (!file) return;
    try {
      if (file.size > 1_000_000) throw new Error("File is larger than 1 MB.");
      const parsed = JSON.parse(await file.text()) as Partial<Draft> & { format?: string };
      if (typeof parsed.name !== "string" || typeof parsed.symbol !== "string" || !Array.isArray(parsed.blocks)) throw new Error("This file does not look like a TradeBridge strategy draft.");
      const next: Draft = { ...defaultDraft, ...parsed, blocks: parsed.blocks.map((b) => ({ ...b, id: typeof b.id === "string" ? b.id : makeBlock(b.kind as BlockKind).id })) } as Draft;
      setDraft(next);
      setNotice("Imported draft. Review all settings and validation warnings before saving.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not import this file."); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }
  function validateDraft() {
    if (issues.length) setNotice(`Validation failed: ${issues.join(" ")}`);
    else setNotice("Validation passed for the draft structure. This does not test strategy profitability or authorize execution.");
  }

  return <div className={styles.root}>
    <div className={styles.hero}>
      <div><p className={styles.eyebrow}>AUTOMATION WORKSPACE / STRATEGY DESIGN</p><h1>Visual Bot Builder</h1><p>Assemble a strategy from configurable blocks, validate its parameters, and save or export the draft.</p></div>
      <div className={styles.heroActions}>
        <button className={styles.secondary} onClick={() => fileRef.current?.click()} type="button">Import JSON</button>
        <input ref={fileRef} className={styles.hidden} type="file" accept="application/json,.json" onChange={(e) => void importDraft(e.target.files?.[0])}/>
        <button className={styles.secondary} onClick={exportDraft} type="button">Export JSON</button>
        <button className={styles.primary} onClick={saveDraft} type="button">Save draft</button>
      </div>
    </div>

    <div className={styles.notice}><span className={styles.noticeDot}/><span>{notice}</span></div>

    <div className={styles.metrics}>
      <div><span>Draft status</span><strong>{issues.length ? "Needs review" : "Structurally valid"}</strong></div>
      <div><span>Strategy blocks</span><strong>{draft.blocks.length}</strong></div>
      <div><span>Execution</span><strong className={styles.locked}>Demo runtime gated</strong></div>
    </div>

    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <div className={styles.sectionHead}><div><p className={styles.eyebrow}>BLOCK LIBRARY</p><h2>Add a block</h2></div><span>{palette.length}</span></div>
        <input className={styles.search} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search blocks…" aria-label="Search blocks"/>
        <div className={styles.palette}>
          {palette.filter((item) => (item.title + " " + item.detail).toLowerCase().includes(search.toLowerCase())).map((item) => <button type="button" key={item.kind} className={styles.paletteItem} onClick={() => addBlock(item.kind)}><span className={styles.blockIcon}>{item.kind === "purchase" ? "↗" : item.kind === "condition" ? "◇" : item.kind === "risk" ? "⛨" : item.kind === "restart" ? "↻" : "■"}</span><span><strong>{item.title}</strong><small>{item.detail}</small></span><b>＋</b></button>)}
        </div>
        <div className={styles.savedPanel}><div className={styles.sectionHead}><h2>Saved drafts</h2><span>{saved.length}</span></div>
          {saved.length === 0 ? <p className={styles.empty}>Your saved strategies will appear here.</p> : saved.map((item, index) => <button type="button" key={item.name + index} className={styles.savedItem} onClick={() => loadDraft(item)}><span><strong>{item.name}</strong><small>{item.symbol} · {item.blocks.length} blocks</small></span><span>↗</span></button>)}
        </div>
      </aside>

      <section className={styles.canvasPanel}>
        <div className={styles.canvasHeader}><div><p className={styles.eyebrow}>WORKSPACE CANVAS</p><h2>Strategy flow</h2><small>Reorder blocks with the arrows or drag them into position.</small></div><span className={styles.canvasTag}>DRAFT</span></div>
        <div className={styles.canvas}>
          {draft.blocks.map((block, index) => <div key={block.id} className={styles.blockWrap}>
            {index > 0 && <div className={styles.connector}/>}
            <article className={`${styles.block} ${styles[block.kind]} ${!block.enabled ? styles.disabled : ""}`} draggable onDragStart={() => setDraggedId(block.id)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (draggedId && draggedId !== block.id) { const next = [...draft.blocks]; const from = next.findIndex((b) => b.id === draggedId); const to = next.findIndex((b) => b.id === block.id); if (from >= 0 && to >= 0) { const [moved] = next.splice(from, 1); next.splice(to, 0, moved); update("blocks", next); } } setDraggedId(null); }}>
              <div className={styles.blockTop}><span className={styles.blockNumber}>{String(index + 1).padStart(2, "0")}</span><span className={styles.blockType}>{block.kind}</span><div className={styles.blockTools}><button type="button" aria-label="Move block up" disabled={index === 0} onClick={() => moveBlock(block.id, -1)}>↑</button><button type="button" aria-label="Move block down" disabled={index === draft.blocks.length - 1} onClick={() => moveBlock(block.id, 1)}>↓</button><button type="button" aria-label="Remove block" onClick={() => update("blocks", draft.blocks.filter((b) => b.id !== block.id))}>×</button></div></div>
              <strong>{block.title}</strong><p>{block.detail}</p>
              <label className={styles.toggle}><input type="checkbox" checked={block.enabled} onChange={(e) => update("blocks", draft.blocks.map((b) => b.id === block.id ? { ...b, enabled: e.target.checked } : b))}/><span>{block.enabled ? "Enabled" : "Disabled"}</span></label>
            </article>
          </div>)}
          {draft.blocks.length === 0 && <div className={styles.emptyCanvas}>Add blocks from the library to begin building your strategy.</div>}
        </div>
        <div className={styles.canvasFooter}><span>{draft.blocks.filter((block) => block.enabled).length} enabled blocks</span><span>Drag a block to reorder</span></div>
      </section>

      <aside className={styles.configPanel}>
        <p className={styles.eyebrow}>STRATEGY SETTINGS</p><h2>Trade parameters</h2>
        <label className={styles.field}>Strategy name<input value={draft.name} maxLength={80} onChange={(e) => update("name", e.target.value)} /></label>
        <label className={styles.field}>Market symbol<input value={draft.symbol} maxLength={32} onChange={(e) => update("symbol", e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))} /><small>Must be an active market supported by the connected account.</small></label>
        <label className={styles.field}>Digit contract<select value={draft.contract} onChange={(e) => update("contract", e.target.value as Draft["contract"])}><option value="DIGITOVER">Over</option><option value="DIGITUNDER">Under</option><option value="DIGITEVEN">Even</option><option value="DIGITODD">Odd</option><option value="DIGITMATCH">Matches</option><option value="DIGITDIFF">Differs</option></select></label>
        {(draft.contract === "DIGITOVER" || draft.contract === "DIGITUNDER" || draft.contract === "DIGITMATCH" || draft.contract === "DIGITDIFF") && <label className={styles.field}>Prediction digit (0–9)<input type="number" min={0} max={9} step={1} value={draft.barrier} onChange={(e) => update("barrier", Number(e.target.value))}/></label>}
        <div className={styles.twoFields}><label className={styles.field}>Stake<input type="number" min={0.35} max={10000} step={0.01} value={draft.stake} onChange={(e) => update("stake", Number(e.target.value))}/></label><label className={styles.field}>Duration (ticks)<input type="number" min={1} max={10} step={1} value={draft.duration} onChange={(e) => update("duration", Number(e.target.value))}/></label></div>
        <div className={styles.ruleLine}/>
        <p className={styles.eyebrow}>RISK LIMITS</p>
        <div className={styles.twoFields}><label className={styles.field}>Max trades/day<input type="number" min={1} max={100} value={draft.maxTrades} onChange={(e) => update("maxTrades", Number(e.target.value))}/></label><label className={styles.field}>Loss streak stop<input type="number" min={1} max={10} value={draft.maxLossStreak} onChange={(e) => update("maxLossStreak", Number(e.target.value))}/></label></div>
        <label className={styles.field}>Daily loss limit (account currency)<input type="number" min={0.01} step={0.01} value={draft.dailyLoss} onChange={(e) => update("dailyLoss", Number(e.target.value))}/></label>
        <div className={styles.validation}><div className={styles.sectionHead}><strong>Validation</strong><span className={issues.length ? styles.errorBadge : styles.okBadge}>{issues.length ? `${issues.length} issues` : "Passed"}</span></div>
          {issues.length ? <ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : <p>Required blocks and parameter ranges look valid. Profitability is not assessed.</p>}
        </div>
        <button className={styles.primaryWide} type="button" onClick={validateDraft}>Validate strategy</button>
        <button className={styles.runButton} type="button" onClick={() => setNotice(issues.length ? "Cannot arm: resolve validation issues first." : "Not armed: the visual draft interpreter is not connected to the trusted Demo execution runner. No trade was placed.")}>▶ Run on Demo</button>
        <p className={styles.disclaimer}>The Run control is intentionally gated until a trusted interpreter can translate this block graph and the server verifies account, quote, risk and idempotency. No trades are placed from this screen.</p>
      </aside>
    </div>
  </div>;
}
