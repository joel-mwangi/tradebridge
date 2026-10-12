"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "../../lib/supabase/client";

type ContractType = "DIGITOVER" | "DIGITUNDER" | "DIGITEVEN" | "DIGITODD" | "DIGITMATCH" | "DIGITDIFF";
type StrategyDraft = {
  version: 1;
  market: string;
  contract_type: ContractType;
  barrier: number | null;
  duration_ticks: number;
  stake: number;
  entry_rule: "manual_review" | "last_digit_frequency";
  frequency_window: number;
  max_session_loss: number;
  session_profit_target: number;
};

const CONTRACTS: Array<{ value: ContractType; label: string; needsBarrier: boolean }> = [
  { value: "DIGITOVER", label: "Over", needsBarrier: true },
  { value: "DIGITUNDER", label: "Under", needsBarrier: true },
  { value: "DIGITEVEN", label: "Even", needsBarrier: false },
  { value: "DIGITODD", label: "Odd", needsBarrier: false },
  { value: "DIGITMATCH", label: "Matches", needsBarrier: true },
  { value: "DIGITDIFF", label: "Differs", needsBarrier: true },
];

const SUPPORTED_XML_BLOCKS = new Set([
  "trade", "trade_definition", "market", "contract", "contract_type", "trade_options",
  "math_number", "math_integer", "logic_compare", "logic_operation", "logic_boolean",
  "controls_if", "controls_repeat_ext", "variables_get", "variables_set", "text",
  "math_arithmetic", "math_single", "lists_getIndex", "lists_length",
]);

function validateDraft(value: unknown): { draft?: StrategyDraft; errors: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { errors: ["Strategy JSON must be an object."] };
  const v = value as Record<string, unknown>;
  const errors: string[] = [];
  if (v.version !== 1) errors.push("version must be 1.");
  if (typeof v.market !== "string" || !/^[A-Za-z0-9_]{2,32}$/.test(v.market)) errors.push("market must be a valid Deriv symbol.");
  if (!CONTRACTS.some((item) => item.value === v.contract_type)) errors.push("contract_type is not supported.");
  const contract = CONTRACTS.find((item) => item.value === v.contract_type);
  const barrier = v.barrier === null ? null : Number(v.barrier);
  if (contract?.needsBarrier && (!Number.isInteger(barrier) || barrier! < 0 || barrier! > 9)) errors.push("This contract requires an integer barrier from 0 to 9.");
  if (!contract?.needsBarrier && v.barrier !== null) errors.push("Even and Odd contracts must have barrier set to null.");
  if (!Number.isInteger(v.duration_ticks) || Number(v.duration_ticks) < 1 || Number(v.duration_ticks) > 10_000) errors.push("duration_ticks must be an integer between 1 and 10000.");
  if (typeof v.stake !== "number" || !Number.isFinite(v.stake) || v.stake <= 0 || v.stake > 10000) errors.push("stake must be a positive number no greater than 10000.");
  if (v.entry_rule !== "manual_review" && v.entry_rule !== "last_digit_frequency") errors.push("entry_rule is not supported.");
  if (!Number.isInteger(v.frequency_window) || Number(v.frequency_window) < 10 || Number(v.frequency_window) > 5000) errors.push("frequency_window must be between 10 and 5000 ticks.");
  for (const key of ["max_session_loss", "session_profit_target"] as const) {
    if (typeof v[key] !== "number" || !Number.isFinite(v[key]) || v[key] < 0 || v[key] > 100000) errors.push(key + " must be a non-negative account-currency amount.");
  }
  if (errors.length) return { errors };
  return { draft: { version: 1, market: v.market as string, contract_type: v.contract_type as ContractType, barrier, duration_ticks: Number(v.duration_ticks), stake: Number(v.stake), entry_rule: v.entry_rule as StrategyDraft["entry_rule"], frequency_window: Number(v.frequency_window), max_session_loss: Number(v.max_session_loss), session_profit_target: Number(v.session_profit_target) }, errors: [] };
}

type SavedDraft = { id: string; name: string; source_format: string; status: string; created_at: string };

export default function BotStrategyBuilder({ userId }: { userId: string | null }) {
  const [savedDrafts, setSavedDrafts] = useState<SavedDraft[]>([]);
  const [name, setName] = useState("Digit strategy draft");
  const [market, setMarket] = useState("1HZ75V");
  const [contractType, setContractType] = useState<ContractType>("DIGITOVER");
  const [barrier, setBarrier] = useState("5");
  const [durationTicks, setDurationTicks] = useState("1");
  const [stake, setStake] = useState("1");
  const [entryRule, setEntryRule] = useState<StrategyDraft["entry_rule"]>("manual_review");
  const [windowSize, setWindowSize] = useState("100");
  const [maxLoss, setMaxLoss] = useState("5");
  const [profitTarget, setProfitTarget] = useState("5");
  const [fileName, setFileName] = useState("");
  const [sourceFormat, setSourceFormat] = useState<"native" | "json" | "xml">("native");
  const [sourceContent, setSourceContent] = useState("");
  const [draft, setDraft] = useState<StrategyDraft | null>(null);
  const [xmlBlocks, setXmlBlocks] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const contract = CONTRACTS.find((item) => item.value === contractType)!;

  useEffect(() => {
    let alive = true;
    async function loadDrafts() {
      if (!userId) { setSavedDrafts([]); return; }
      const supabase = createClient();
      const { data, error } = await supabase.from("bot_strategy_definitions")
        .select("id,name,source_format,status,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (alive && !error) setSavedDrafts((data ?? []) as SavedDraft[]);
    }
    void loadDrafts();
    return () => { alive = false; };
  }, [userId]);

  const nativeCandidate = useMemo(() => ({
    version: 1,
    market: market.trim(),
    contract_type: contractType,
    barrier: contract.needsBarrier ? Number(barrier) : null,
    duration_ticks: Number(durationTicks),
    stake: Number(stake),
    entry_rule: entryRule,
    frequency_window: Number(windowSize),
    max_session_loss: Number(maxLoss),
    session_profit_target: Number(profitTarget),
  }), [market, contractType, contract.needsBarrier, barrier, durationTicks, stake, entryRule, windowSize, maxLoss, profitTarget]);

  async function handleFile(file?: File) {
    if (!file) return;
    setErrors([]);
    setNotice("");
    setDraft(null);
    setXmlBlocks([]);
    if (file.size > 1024 * 1024) {
      setErrors(["File exceeds 1 MB. Choose a smaller strategy file."]);
      return;
    }
    const content = await file.text();
    const ext = file.name.toLowerCase().split(".").pop();
    setFileName(file.name);
    setSourceContent(content);
    if (ext === "json") {
      setSourceFormat("json");
      try {
        const parsed = JSON.parse(content) as unknown;
        const result = validateDraft(parsed);
        setErrors(result.errors);
        if (result.draft) {
          setDraft(result.draft);
          setNotice("TradeBridge strategy schema accepted. This is a saved draft only; it is not connected to the execution runner.");
        }
      } catch {
        setErrors(["The JSON file is malformed."]);
      }
      return;
    }
    if (ext === "xml") {
      setSourceFormat("xml");
      if (!content.trim().startsWith("<")) {
        setErrors(["The XML file does not appear to be valid XML."]);
        return;
      }
      const doc = new DOMParser().parseFromString(content, "application/xml");
      if (doc.querySelector("parsererror")) {
        setErrors(["The XML file is malformed."]);
        return;
      }
      const blocks = Array.from(doc.querySelectorAll("block, shadow")).map((node) => node.getAttribute("type") || "(unnamed)");
      if (!blocks.length) {
        setErrors(["No Blockly blocks were found in this XML."]);
        return;
      }
      const unsupported = [...new Set(blocks.filter((block) => !SUPPORTED_XML_BLOCKS.has(block)))];
      setXmlBlocks(blocks);
      if (unsupported.length) setErrors(["Unsupported Blockly block types: " + unsupported.slice(0, 20).join(", ") + (unsupported.length > 20 ? ", …" : "") + ". This file is retained as a non-executable draft."]);
      else setNotice("Blockly XML parsed and block types recognized. This does not yet prove semantic compatibility or make the strategy executable; it will be stored as an import draft.");
      return;
    }
    setErrors(["Choose a .json TradeBridge strategy or a .xml Blockly file."]);
  }

  async function saveDraft() {
    if (!userId) {
      setErrors(["Sign in before saving a strategy."]);
      return;
    }
    const candidate = sourceFormat === "native" ? nativeCandidate : draft;
    const validation = validateDraft(candidate);
    if (sourceFormat !== "xml" && !validation.draft) {
      setErrors(validation.errors);
      return;
    }
    if (!name.trim()) {
      setErrors(["Enter a name for this strategy."]);
      return;
    }
    setSaving(true);
    setErrors([]);
    setNotice("");
    try {
      const supabase = createClient();
      const { error } = await supabase.from("bot_strategy_definitions").insert({
        user_id: userId,
        name: name.trim(),
        source_format: sourceFormat,
        source_file_name: fileName || null,
        source_content: sourceFormat === "native" ? null : sourceContent,
        strategy_definition: validation.draft ?? (sourceFormat === "xml" ? { version: 1, import_status: "not_executable", recognized_blocks: xmlBlocks, validation_errors: errors } : {}),
        status: "draft",
      });
      if (error) throw error;
      setNotice("Strategy draft saved. It is not executable and will not place trades until the digit runner explicitly supports this schema.");
      const { data } = await createClient().from("bot_strategy_definitions")
        .select("id,name,source_format,status,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(10);
      setSavedDrafts((data ?? []) as SavedDraft[]);
    } catch (e) {
      setErrors([e instanceof Error ? e.message : "Could not save strategy draft. Apply the bot strategy migration and try again."]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel strategyBuilder" aria-labelledby="strategy-builder-title">
      <div className="heading">
        <div>
          <h2 id="strategy-builder-title">Strategy builder &amp; import</h2>
          <p className="sub">Create a digit-contract draft or inspect Deriv Blockly XML. Saving here never starts a bot.</p>
        </div>
        <span className="draftBadge">DRAFT ONLY</span>
      </div>
      <div className="builderGrid">
        <div className="builderField full">
          <label htmlFor="strategy-name">Strategy name</label>
          <input id="strategy-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="builderField">
          <label htmlFor="strategy-market">Deriv market symbol</label>
          <input id="strategy-market" value={market} maxLength={32} onChange={(e) => setMarket(e.target.value)} />
        </div>
        <div className="builderField">
          <label htmlFor="strategy-contract">Contract family</label>
          <select id="strategy-contract" value={contractType} onChange={(e) => setContractType(e.target.value as ContractType)}>
            {CONTRACTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>
        {contract.needsBarrier && <div className="builderField">
          <label htmlFor="strategy-barrier">{contractType === "DIGITMATCH" || contractType === "DIGITDIFF" ? "Target digit (0–9)" : "Barrier digit (0–9)"}</label>
          <input id="strategy-barrier" type="number" min="0" max="9" step="1" value={barrier} onChange={(e) => setBarrier(e.target.value)} />
        </div>}
        <div className="builderField">
          <label htmlFor="strategy-duration">Duration (ticks)</label>
          <input id="strategy-duration" type="number" min="1" max="10000" step="1" value={durationTicks} onChange={(e) => setDurationTicks(e.target.value)} />
        </div>
        <div className="builderField">
          <label htmlFor="strategy-stake">Stake (account currency)</label>
          <input id="strategy-stake" type="number" min="0.01" max="10000" step="0.01" value={stake} onChange={(e) => setStake(e.target.value)} />
        </div>
        <div className="builderField">
          <label htmlFor="strategy-entry">Entry condition</label>
          <select id="strategy-entry" value={entryRule} onChange={(e) => setEntryRule(e.target.value as StrategyDraft["entry_rule"])}>
            <option value="manual_review">Manual review — no automatic entries</option>
            <option value="last_digit_frequency">Last-digit frequency rule (draft)</option>
          </select>
        </div>
        <div className="builderField">
          <label htmlFor="strategy-window">Frequency window (ticks)</label>
          <input id="strategy-window" type="number" min="10" max="5000" step="1" value={windowSize} onChange={(e) => setWindowSize(e.target.value)} />
        </div>
        <div className="builderField">
          <label htmlFor="strategy-loss">Session loss limit</label>
          <input id="strategy-loss" type="number" min="0" max="100000" step="0.01" value={maxLoss} onChange={(e) => setMaxLoss(e.target.value)} />
        </div>
        <div className="builderField">
          <label htmlFor="strategy-profit">Session profit target</label>
          <input id="strategy-profit" type="number" min="0" max="100000" step="0.01" value={profitTarget} onChange={(e) => setProfitTarget(e.target.value)} />
        </div>
      </div>
      <div className="importRow">
        <label htmlFor="strategy-import">Import Deriv Bot XML or TradeBridge JSON</label>
        <input id="strategy-import" type="file" accept=".xml,.json,application/json,application/xml,text/xml" onChange={(e) => void handleFile(e.target.files?.[0])} />
        <p className="hint">{fileName ? `Selected: ${fileName}` : "XML is parsed for Blockly block compatibility; JSON must match the documented TradeBridge schema."}</p>
      </div>
      {xmlBlocks.length > 0 && <div className="blockSummary"><strong>Recognized block inventory</strong><p>{[...new Set(xmlBlocks)].join(", ")}</p><small>Block recognition is not the same as translating the strategy into executable rules.</small></div>}
      {errors.length > 0 && <div className="builderErrors" role="alert">{errors.map((item) => <p key={item}>{item}</p>)}</div>}
      {notice && <div className="builderNotice" role="status">{notice}</div>}
      <div className="savedDrafts">
        <div className="savedHeading"><strong>Saved strategy drafts</strong><span>{savedDrafts.length} recent</span></div>
        {savedDrafts.length === 0 ? <p className="hint">No saved strategy drafts yet.</p> : savedDrafts.map((item) => (
          <div className="savedDraft" key={item.id}>
            <div><strong>{item.name}</strong><small>{item.source_format.toUpperCase()} · {new Date(item.created_at).toLocaleString()}</small></div>
            <span>{item.status.toUpperCase()}</span>
          </div>
        ))}
      </div>
      <div className="builderActions">
        <button className="secondary" type="button" onClick={() => { setSourceFormat("native"); setSourceContent(""); setFileName(""); setDraft(null); setXmlBlocks([]); setErrors([]); setNotice(""); }}>Use native builder</button>
        <button className="primary" type="button" onClick={() => void saveDraft()} disabled={saving || !userId}>{saving ? "Saving draft…" : "Save strategy draft"}</button>
      </div>
      <style jsx>{`
        .strategyBuilder { grid-column: 1 / -1; background:var(--bot-panel); border:1px solid var(--bot-line); border-radius:14px; padding:20px; min-width:0; }
        .heading { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:18px; }
        .heading h2 { margin:0; color:var(--bot-ink); font-size:18px; font-weight:750; }
        .sub { color:var(--bot-muted); margin:6px 0 0; font-size:13px; line-height:1.5; }
        .primary,.secondary { border-radius:9px; padding:10px 14px; font:inherit; font-size:13px; font-weight:700; cursor:pointer; }
        .primary { border:1px solid var(--bot-teal); color:#052e24; background:var(--bot-teal); }
        .secondary { border:1px solid var(--bot-border); color:var(--bot-ink); background:var(--bot-surface); }
        .primary:disabled { opacity:.55; cursor:not-allowed; }
        .draftBadge { white-space:nowrap; border:1px solid #b45309; color:#fbbf24; border-radius:999px; padding:5px 9px; font-size:11px; font-weight:800; letter-spacing:.06em; }
        .builderGrid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }
        .builderField { min-width:0; display:flex; flex-direction:column; gap:7px; }
        .builderField.full { grid-column:1 / -1; }
        .builderField label,.importRow label { color:var(--bot-label); font-size:13px; font-weight:650; }
        .builderField input,.builderField select,.importRow input[type=file] { box-sizing:border-box; width:100%; min-width:0; border:1px solid var(--bot-border); border-radius:9px; background:var(--bot-card); color:var(--bot-ink); padding:11px 12px; font:inherit; }
        .savedDrafts { margin-top:18px; border-top:1px solid var(--bot-line); padding-top:14px; }
        .savedHeading,.savedDraft { display:flex; align-items:center; justify-content:space-between; gap:12px; }
        .savedHeading { color:var(--bot-ink); font-size:13px; margin-bottom:8px; }
        .savedHeading span,.savedDraft small { color:var(--bot-muted); font-size:11px; }
        .savedDraft { padding:9px 0; border-bottom:1px solid var(--bot-line); }
        .savedDraft div { min-width:0; display:grid; gap:4px; overflow-wrap:anywhere; }
        .savedDraft strong { font-size:13px; color:var(--bot-ink); }
        .savedDraft > span { flex-shrink:0; color:#fbbf24; font-size:10px; font-weight:800; }
        .importRow { display:grid; gap:8px; margin-top:18px; padding-top:16px; border-top:1px solid var(--bot-line); }
        .importRow input[type=file] { padding:9px; }
        .hint,.blockSummary small { color:var(--bot-muted); font-size:12px; margin:0; line-height:1.5; }
        .blockSummary { margin-top:12px; padding:12px; border:1px solid var(--bot-line); border-radius:10px; overflow-wrap:anywhere; }
        .blockSummary p { margin:6px 0; font-size:12px; }
        .builderErrors,.builderNotice { margin-top:12px; border-radius:9px; padding:10px 12px; font-size:13px; }
        .builderErrors { color:#fecaca; background:var(--bot-danger-bg); border:1px solid var(--bot-danger-border); }
        .builderErrors p { margin:3px 0; }
        .builderNotice { color:var(--bot-success); background:var(--bot-teal-soft); border:1px solid var(--bot-success-border); }
        .builderActions { display:flex; justify-content:flex-end; gap:10px; flex-wrap:wrap; margin-top:16px; }
        @media(max-width:680px) { .builderGrid { grid-template-columns:1fr; } .builderField.full { grid-column:auto; } .heading { align-items:flex-start; } }
      `}</style>
    </section>
  );
}
