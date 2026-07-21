import { useState, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceArea, ResponsiveContainer
} from "recharts";

/* ── Global CSS ───────────────────────────────────────── */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Playfair+Display:ital,wght@0,600;1,400&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
input[type=range]{-webkit-appearance:none;appearance:none;height:3px;border-radius:2px;outline:none;cursor:pointer;width:100%}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:#16C9A8;cursor:pointer;border:2px solid #05101E;box-shadow:0 0 7px rgba(22,201,168,.55);transition:box-shadow .15s}
input[type=range]:hover::-webkit-slider-thumb{box-shadow:0 0 11px rgba(22,201,168,.75)}
input[type=range]::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#16C9A8;border:2px solid #05101E;box-sizing:border-box}
::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#1A2E45;border-radius:2px}
`;

/* ── Constants ────────────────────────────────────────── */
const CEIL = 8000;
const FRS0 = 213000;

/* ── Helpers ──────────────────────────────────────────── */
const S = n => `S$${Math.round(Math.max(0, n)).toLocaleString("en-SG")}`;
const Sk = n => {
  const a = Math.abs(n), sign = n < 0 ? "-" : "";
  if (a >= 1e6) return `${sign}S$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}S$${(a / 1e3).toFixed(0)}K`;
  return `${sign}S$${Math.round(a)}`;
};

const cpfR = a => {
  if (a <= 55) return { emp: .20, er: .17, oa: .23, sa: .06, ma: .08 };
  if (a <= 60) return { emp: .17, er: .155, oa: .145, sa: .02, ma: .16 };
  if (a <= 65) return { emp: .115, er: .12, oa: .11, sa: .015, ma: .11 };
  if (a <= 70) return { emp: .075, er: .09, oa: .07, sa: .015, ma: .08 };
  return { emp: .05, er: .075, oa: .04, sa: 0, ma: .085 };
};

const leaseF = y => {
  if (y >= 60) return 1;
  if (y >= 40) return .75 + (y - 40) * .0125;
  if (y >= 20) return .30 + (y - 20) * .0225;
  return Math.max(0, y * .015);
};

/* ── Simulation ───────────────────────────────────────── */
function simulate(p) {
  const M = p.couple ? 2 : 1;
  let bank = p.bankBal * M, inv = p.invBal * M;
  let oa = p.cpfOA * M;
  let sa = p.age >= 55 ? 0 : p.cpfSA * M;
  let ra = p.age >= 55 ? p.cpfSA * M : 0;
  let ma = p.cpfMA * M;
  let srs = p.srsBal * M;
  let prop = p.hdbV, mort = p.mortBal;
  let ret = p.age >= 65, sold = false, cpfLP = 0, a55 = p.age >= 55;
  if (ret) cpfLP = p.cpfLO > 0 ? p.cpfLO * M : (ra / 240) * M;
  const out = [];

  for (let age = p.age; age <= 85; age++) {
    const yr = age - p.age;
    const expM = p.expM * Math.pow(1 + p.infl / 100, yr);
    const sal1 = p.sal * Math.pow(1 + p.salG / 100, yr);
    const c1 = Math.min(sal1, CEIL);
    const r = cpfR(age);

    // Age 55: SA → RA up to FRS
    if (age === 55 && !a55) {
      a55 = true;
      const frs = FRS0 * Math.pow(1.035, yr) * M;
      const toRA = Math.min(sa, frs);
      ra = toRA; oa += sa - toRA; sa = 0;
    }

    // Age 65: retire
    if (age === 65 && !ret) {
      ret = true;
      cpfLP = p.cpfLO > 0 ? p.cpfLO * M : (ra / 240) * M;
    }

    // Pre-retirement contributions
    if (!ret) {
      oa += c1 * r.oa * 12 * M;
      if (age <= 55) sa += c1 * r.sa * 12 * M;
      else ra += c1 * r.sa * 12 * M; // post-55: SA alloc → RA
      ma += c1 * r.ma * 12 * M;
      srs += p.srsAnn * M;
      bank += p.savM * M * 12;
      inv += p.invM * M * 12;
      if (mort > 0) {
        const ap = p.mortM * 12;
        mort = Math.max(0, mort - ap * 0.6);
        bank -= ap;
      }
    }

    // Property sale event
    if (p.sale && !sold && age === p.saleAge) {
      const net = p.saleP * 0.965 - mort;
      bank += Math.max(0, net); mort = 0;
      if (p.newP > 0) { prop = p.newP; mort = p.newMort; }
      else { prop = 0; sold = true; }
    }

    // CPF interest with extra 1% bonus
    const cpfTot = oa + sa + ra + ma;
    const oaBonus = Math.min(oa, 20000 * M) * 0.01;
    const restBase = cpfTot > 0 ? Math.max(0, Math.min(cpfTot, 60000 * M) - Math.min(oa, 20000 * M)) * 0.01 : 0;
    oa = oa * 1.025 + oaBonus;
    sa = sa * 1.04 + (cpfTot > 0 ? restBase * sa / cpfTot : 0);
    ra = ra * 1.04 + (cpfTot > 0 ? restBase * ra / cpfTot : 0);
    ma = ma * 1.04 + (cpfTot > 0 ? restBase * ma / cpfTot : 0);

    // Growth
    srs *= 1 + p.srsRet / 100;
    inv *= 1 + p.invRet / 100;
    bank *= 1 + p.bankInt / 100;

    // Property appreciation + leasehold decay
    if (prop > 0) {
      prop *= 1 + p.hdbApp / 100;
      const rem = p.hdbLease - yr;
      if (rem < 60 && rem > 0) prop *= leaseF(rem) / Math.max(.001, leaseF(rem + 1));
    }

    // Post-retirement drawdown
    if (ret) {
      let srsInc = 0;
      const yir = age - 65;
      if (srs > 0 && yir < p.srsDraw) {
        srsInc = Math.min(srs, srs / Math.max(1, p.srsDraw - yir));
        srs = Math.max(0, srs - srsInc);
      }
      const surp = cpfLP * 12 + srsInc - expM * 12;
      if (surp >= 0) bank += surp;
      else {
        const need = -surp;
        if (bank >= need) bank -= need;
        else { inv = Math.max(0, inv - (need - bank)); bank = 0; }
      }
    }
    bank = Math.max(0, bank); inv = Math.max(0, inv);

    const eq = Math.max(0, prop - mort);
    const nTotal = bank + inv + oa + sa + ra + srs + eq;
    let nLiq = bank + inv;
    if (age >= 65) nLiq += oa;
    if (age >= 63) nLiq += srs;

    const adj = p.real ? Math.pow(1 + p.infl / 100, -yr) : 1;

    out.push({
      age, ret,
      total: nTotal * adj, liq: nLiq * adj,
      nTotal, nLiq, srsNom: srs,
      bank: bank * adj, inv: inv * adj,
      oa: oa * adj, sa: sa * adj, ra: ra * adj,
      srs: srs * adj, eq: eq * adj, ma: ma * adj,
      cpfLP, expM,
    });
  }
  return out;
}

/* ── Slider ───────────────────────────────────────────── */
function Sl({ label, val, min, max, step = 1, set, f, note, warn }) {
  const pct = ((val - min) / (max - min) * 100).toFixed(1);
  return (
    <div style={{ marginBottom: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
        <span style={{ fontSize: 12, color: "#7A90A7", fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "#16C9A8" }}>{f ? f(val) : val}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={val}
        onChange={e => set(+e.target.value)}
        style={{ background: `linear-gradient(to right,#16C9A8 ${pct}%,#1A2E45 ${pct}%)` }} />
      {note && <p style={{ fontSize: 10.5, color: "#7A90A7", marginTop: 3, lineHeight: 1.4 }}>{note}</p>}
      {warn && <p style={{ fontSize: 10.5, color: "#F7B731", marginTop: 3 }}>⚠ {warn}</p>}
    </div>
  );
}

/* ── Collapsible Section ──────────────────────────────── */
function Sec({ title, icon, children, def = false }) {
  const [open, setOpen] = useState(def);
  return (
    <div style={{ background: "#0B1A2B", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, marginBottom: 8, overflow: "hidden" }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "11px 14px", background: "none", border: "none", cursor: "pointer",
        color: "#E8EDF2", fontFamily: "Outfit,sans-serif", fontWeight: 600, fontSize: 13,
      }}>
        <span>{icon} {title}</span>
        <span style={{ color: "#7A90A7", display: "inline-block", transition: "transform .2s", transform: open ? "rotate(180deg)" : "none", fontSize: 12 }}>▾</span>
      </button>
      {open && <div style={{ padding: "0 14px 14px" }}>{children}</div>}
    </div>
  );
}

/* ── Chart Tooltip ────────────────────────────────────── */
function CT({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload; if (!d) return null;
  return (
    <div style={{ background: "#07111E", border: "1px solid rgba(255,255,255,.15)", borderRadius: 8, padding: "10px 14px", fontSize: 11.5, minWidth: 190 }}>
      <b style={{ color: "#E8EDF2", fontSize: 13 }}>Age {label}{d.ret ? " · Retired" : ""}</b>
      <div style={{ marginTop: 6, color: "#16C9A8" }}>Total NW: <b>{Sk(d.total)}</b></div>
      <div style={{ color: "#E8A838", marginBottom: 6 }}>Liquid NW: <b>{Sk(d.liq)}</b></div>
      <div style={{ borderTop: "1px solid rgba(255,255,255,.08)", paddingTop: 6, color: "#7A90A7", lineHeight: 1.75 }}>
        {d.bank > 0 && <div>Bank savings: {Sk(d.bank)}</div>}
        {d.inv > 0 && <div>Investments: {Sk(d.inv)}</div>}
        {d.oa > 0 && <div>CPF OA: {Sk(d.oa)}</div>}
        {(d.sa + d.ra) > 0 && <div>CPF SA / RA: {Sk(d.sa + d.ra)}</div>}
        {d.srs > 0 && <div>SRS: {Sk(d.srs)}</div>}
        {d.eq > 0 && <div>Property equity: {Sk(d.eq)}</div>}
        {d.ma > 0 && <div style={{ color: "#3A4A5A" }}>Medisave: {Sk(d.ma)} (excl.)</div>}
      </div>
    </div>
  );
}

/* ── Summary Card ─────────────────────────────────────── */
function Card({ title, val, sub, color = "#16C9A8", warn }) {
  return (
    <div style={{ background: "#0B1A2B", border: "1px solid rgba(255,255,255,.07)", borderRadius: 10, padding: "12px 14px", flex: "1 1 140px", minWidth: 130 }}>
      <div style={{ fontSize: 9.5, color: "#7A90A7", fontWeight: 600, textTransform: "uppercase", letterSpacing: .5, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color, lineHeight: 1.1 }}>{val}</div>
      {sub && <div style={{ fontSize: 10.5, color: "#7A90A7", marginTop: 4 }}>{sub}</div>}
      {warn && <div style={{ fontSize: 10.5, color: "#F7B731", marginTop: 4 }}>⚠ {warn}</div>}
    </div>
  );
}

/* ── Toggle Button ────────────────────────────────────── */
function Btn({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: "3px 10px", borderRadius: 20, border: "none", cursor: "pointer",
      fontSize: 11.5, fontFamily: "Outfit,sans-serif", fontWeight: 600,
      background: active ? "#16C9A8" : "#1A2E45", color: active ? "#05101E" : "#7A90A7",
      transition: "all .15s",
    }}>{label}</button>
  );
}

/* ── Info Box ─────────────────────────────────────────── */
const Info = ({ children }) => (
  <div style={{ background: "#112030", borderRadius: 7, padding: "8px 10px", fontSize: 11, color: "#7A90A7", lineHeight: 1.6, marginBottom: 10 }}>
    {children}
  </div>
);

/* ── Main App ─────────────────────────────────────────── */
export default function App() {
  // Profile
  const [age, setAge] = useState(35);
  const [couple, setCouple] = useState(false);
  const [real, setReal] = useState(false);
  // Income
  const [sal, setSal] = useState(5000);
  const [salG, setSalG] = useState(1.5);
  // Expenses
  const [expM, setExpM] = useState(2500);
  const [infl, setInfl] = useState(3);
  // Bank
  const [bankBal, setBankBal] = useState(30000);
  const [bankInt, setBankInt] = useState(2.5);
  const [savM, setSavM] = useState(500);
  // Investments
  const [invBal, setInvBal] = useState(10000);
  const [invM, setInvM] = useState(300);
  const [invRet, setInvRet] = useState(5);
  // CPF
  const [cpfOA, setCpfOA] = useState(50000);
  const [cpfSA, setCpfSA] = useState(20000);
  const [cpfMA, setCpfMA] = useState(15000);
  const [cpfLO, setCpfLO] = useState(0);
  // SRS
  const [srsBal, setSrsBal] = useState(0);
  const [srsAnn, setSrsAnn] = useState(0);
  const [srsRet, setSrsRet] = useState(4);
  const [srsDraw, setSrsDraw] = useState(10);
  // Property
  const [hdbV, setHdbV] = useState(500000);
  const [hdbLease, setHdbLease] = useState(75);
  const [mortBal, setMortBal] = useState(200000);
  const [mortM, setMortM] = useState(1200);
  const [hdbApp, setHdbApp] = useState(3);
  // Sale
  const [sale, setSale] = useState(false);
  const [saleAge, setSaleAge] = useState(65);
  const [saleP, setSaleP] = useState(800000);
  const [newP, setNewP] = useState(400000);
  const [newMort, setNewMort] = useState(0);

  // Derived warnings
  const r = cpfR(age);
  const cpfEmpMo = Math.min(sal, CEIL) * r.emp;
  const incWarn = (savM + expM + cpfEmpMo + mortM + invM) > sal;
  const invWarnTxt = invRet > 12 ? "Returns above 12% are unrealistic for most portfolios."
    : invRet > 10 ? "Returns above 10% p.a. are high-risk assumptions." : null;

  // Simulation
  const data = useMemo(() => simulate({
    age, couple, real, sal, salG, expM, infl,
    bankBal, bankInt, savM, invBal, invM, invRet,
    cpfOA, cpfSA, cpfMA, cpfLO, srsBal, srsAnn, srsRet, srsDraw,
    hdbV, hdbLease, mortBal, mortM, hdbApp, sale, saleAge, saleP, newP, newMort,
  }), [age, couple, real, sal, salG, expM, infl,
    bankBal, bankInt, savM, invBal, invM, invRet,
    cpfOA, cpfSA, cpfMA, cpfLO, srsBal, srsAnn, srsRet, srsDraw,
    hdbV, hdbLease, mortBal, mortM, hdbApp, sale, saleAge, saleP, newP, newMort]);

  // Summary reference point
  const dR = age < 65 ? (data.find(d => d.age === 65) || data[data.length - 1]) : data[0];
  const retLbl = age >= 65 ? "Current" : "At 65";

  const cpfLP_mo = dR?.cpfLP || 0;
  const srsMonthly = (dR?.srsNom || 0) / (srsDraw * 12);
  const expAt65 = dR?.expM || expM;
  const surplus = cpfLP_mo + srsMonthly - expAt65;

  let lifespan = "20+ yrs";
  for (const d of data) {
    if (d.age >= 65 && d.nLiq <= 500) { lifespan = `${d.age - 65} yrs post-65`; break; }
  }

  const agePct = ((age - 21) / 49 * 100).toFixed(1);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", fontFamily: "Outfit,sans-serif", background: "#05101E", color: "#E8EDF2" }}>
      <style>{CSS}</style>

      {/* ── Header ── */}
      <div style={{ background: "linear-gradient(135deg,#05101E 0%,#0A1E36 100%)", borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "11px 20px", flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: 20, fontWeight: 600, color: "#E8EDF2", letterSpacing: "-.3px" }}>
            🇸🇬 Singapore Retirement Planner
            <span style={{ fontFamily: "Outfit,sans-serif", fontSize: 11, fontWeight: 400, color: "#7A90A7", marginLeft: 10 }}>2026 · S$ all figures</span>
          </h1>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ fontSize: 12, color: "#7A90A7" }}>Age</span>
              <input type="range" min={21} max={70} value={age} onChange={e => setAge(+e.target.value)}
                style={{ width: 90, background: `linear-gradient(to right,#16C9A8 ${agePct}%,#1A2E45 ${agePct}%)` }} />
              <span style={{ fontSize: 16, fontWeight: 800, color: "#16C9A8", minWidth: 24 }}>{age}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ fontSize: 12, color: "#7A90A7" }}>Household</span>
              <Btn label="Single" active={!couple} onClick={() => setCouple(false)} />
              <Btn label="Couple" active={couple} onClick={() => setCouple(true)} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ fontSize: 12, color: "#7A90A7" }}>Values</span>
              <Btn label="Nominal" active={!real} onClick={() => setReal(false)} />
              <Btn label="Real (2026$)" active={real} onClick={() => setReal(true)} />
            </div>
            <div style={{ fontSize: 12, color: "#7A90A7" }}>
              Retire at <span style={{ color: "#E8A838", fontWeight: 700 }}>65</span>
              {age < 65 && <> · <span style={{ color: "#E8EDF2", fontWeight: 600 }}>{65 - age}</span> yrs away</>}
              {age >= 65 && <span style={{ color: "#34D399" }}> · Already retired</span>}
            </div>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* ── Left: Inputs ── */}
        <div style={{ width: 345, flexShrink: 0, overflowY: "auto", padding: 11, borderRight: "1px solid rgba(255,255,255,0.06)" }}>

          {incWarn && (
            <div style={{ background: "rgba(240,79,88,.13)", border: "1px solid #F04F58", borderRadius: 8, padding: "8px 12px", marginBottom: 8, fontSize: 11.5, color: "#F04F58", lineHeight: 1.4 }}>
              ⚠ Your estimated outgoings exceed your income. Please adjust.
            </div>
          )}

          <Sec title="Monthly Income" icon="💼" def={true}>
            <Sl label="Gross Monthly Salary" val={sal} min={2000} max={30000} step={100} set={setSal} f={S} />
            <Sl label="Annual Salary Growth" val={salG} min={0} max={5} step={.1} set={setSalG} f={v => `${v.toFixed(1)}%`} />
            <Info>
              Employee CPF: <b style={{ color: "#E8EDF2" }}>{S(cpfEmpMo)}/mo</b>
              <span style={{ marginLeft: 10 }}>Employer: </span><b style={{ color: "#E8EDF2" }}>{S(Math.min(sal, CEIL) * r.er)}/mo</b>
              <span style={{ marginLeft: 10 }}>Total rate: </span><b style={{ color: "#16C9A8" }}>{((r.emp + r.er) * 100).toFixed(1)}%</b>
            </Info>
          </Sec>

          <Sec title="Monthly Expenses" icon="🛒" def={true}>
            <Sl label="Monthly Household Expenses" val={expM} min={1000} max={15000} step={100} set={setExpM} f={S} />
            <Sl label="Inflation Rate" val={infl} min={1} max={6} step={.1} set={setInfl} f={v => `${v.toFixed(1)}% p.a.`} />
          </Sec>

          <Sec title="Bank Savings" icon="🏦" def={true}>
            <Sl label="Current Savings Balance" val={bankBal} min={0} max={500000} step={1000} set={setBankBal} f={S} />
            <Sl label="High-Interest Savings / FD Rate" val={bankInt} min={.05} max={5} step={.05} set={setBankInt} f={v => `${v.toFixed(2)}% p.a.`} />
            <Sl label="Monthly Savings Contribution" val={savM} min={0} max={5000} step={50} set={setSavM} f={S} />
          </Sec>

          <Sec title="Investments" icon="📈" def={true}>
            <Sl label="Current Portfolio Value" val={invBal} min={0} max={1000000} step={1000} set={setInvBal} f={S} />
            <Sl label="Monthly Contribution" val={invM} min={0} max={5000} step={50} set={setInvM} f={S} />
            <Sl label="Expected Annual Return" val={invRet} min={0} max={15} step={.5} set={setInvRet} f={v => `${v.toFixed(1)}% p.a.`} warn={invWarnTxt} />
          </Sec>

          <Sec title="CPF Balances" icon="🟢">
            <Info>ℹ CPF contributions are auto-calculated from your salary and age. Tooltip shows your current contribution rates.</Info>
            <Sl label="CPF OA Balance" val={cpfOA} min={0} max={300000} step={1000} set={setCpfOA} f={S} />
            <Sl label={age >= 55 ? "CPF RA Balance" : "CPF SA Balance"}
              val={cpfSA} min={0} max={200000} step={1000} set={setCpfSA} f={S}
              note={age < 55 ? `At 55, transfers to RA up to Full Retirement Sum (est. ${S(FRS0 * Math.pow(1.035, Math.max(0, 55 - age)))})` : "Treated as Retirement Account (SA closed at 55)"} />
            <Sl label="Medisave Balance" val={cpfMA} min={0} max={100000} step={1000} set={setCpfMA} f={S}
              note="Reserved for healthcare. Excluded from all net worth calculations." />
            <Sl label="CPF LIFE Monthly Override" val={cpfLO} min={0} max={3000} step={50} set={setCpfLO}
              f={v => v === 0 ? "Auto (est. RA ÷ 240)" : S(v) + "/mo"} />
          </Sec>

          <Sec title="SRS" icon="💰">
            <Info>ℹ SRS funds accessible from age 63 without penalty. Only 50% of post-retirement withdrawals are taxable.</Info>
            <Sl label="Current SRS Balance" val={srsBal} min={0} max={500000} step={1000} set={setSrsBal} f={S} />
            <Sl label="Annual SRS Contribution" val={srsAnn} min={0} max={15300} step={300} set={setSrsAnn} f={S}
              note="Annual cap: S$15,300 for Singapore Citizens & PRs." />
            <Sl label="SRS Investment Return" val={srsRet} min={0} max={10} step={.25} set={setSrsRet}
              f={v => `${v.toFixed(2)}% p.a.`} note="Uninvested SRS earns only 0.05% p.a." />
            <Sl label="Post-65 Drawdown Period" val={srsDraw} min={5} max={15} step={1} set={setSrsDraw}
              f={v => `${v} years`} />
          </Sec>

          <Sec title="HDB Property" icon="🏘️">
            <Info>ℹ Property equity is included in Total NW but <b>not</b> Liquid NW until the property is sold.</Info>
            <Sl label="Current HDB Value" val={hdbV} min={100000} max={1500000} step={10000} set={setHdbV} f={S} />
            <Sl label="Remaining Lease" val={hdbLease} min={10} max={99} step={1} set={setHdbLease}
              f={v => `${v} years`} warn={hdbLease < 60 ? "Lease below 60 years — bank financing and value may be affected." : null} />
            <Sl label="Outstanding Mortgage" val={mortBal} min={0} max={800000} step={5000} set={setMortBal} f={S} />
            <Sl label="Monthly Mortgage Payment" val={mortM} min={0} max={5000} step={50} set={setMortM} f={S}
              note="Ceases automatically when mortgage is fully paid off." />
            <Sl label="Annual HDB Appreciation" val={hdbApp} min={0} max={6} step={.25} set={setHdbApp}
              f={v => `${v.toFixed(2)}% p.a.`} note="Based on historical HDB resale index trends." />

            <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 10, marginTop: 4 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12.5, color: "#E8EDF2", fontWeight: 500 }}>
                <input type="checkbox" checked={sale} onChange={e => setSale(e.target.checked)}
                  style={{ accentColor: "#16C9A8", width: 14, height: 14 }} />
                Plan to sell & downgrade / upgrade
              </label>
              {sale && (
                <div style={{ marginTop: 10 }}>
                  <Sl label="Age at Sale" val={saleAge} min={45} max={80} step={1} set={setSaleAge}
                    f={v => `Age ${v}`}
                    warn={hdbLease - (saleAge - age) < 40 ? "Lease under 40 years at sale — steep leasehold decay likely." : null} />
                  <Sl label="Expected Sale Price" val={saleP} min={200000} max={2000000} step={10000} set={setSaleP} f={S}
                    note="3.5% transaction costs (agent fee + legal + BSD) deducted automatically." />
                  <Sl label="New Property Purchase Price" val={newP} min={0} max={1500000} step={10000} set={setNewP}
                    f={v => v === 0 ? "No new purchase (full cash-out)" : S(v)} />
                  {newP > 0 && <Sl label="New Outstanding Mortgage" val={newMort} min={0} max={800000} step={5000} set={setNewMort} f={S} />}
                </div>
              )}
            </div>
          </Sec>

          <div style={{ height: 16 }} />
        </div>

        {/* ── Right: Chart + Cards ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "11px 14px", minWidth: 0 }}>

          {/* Chart */}
          <div style={{ background: "#0B1A2B", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "14px 12px 6px", marginBottom: 11 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, flexWrap: "wrap", gap: 6 }}>
              <div>
                <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Net Worth Projection</h2>
                <p style={{ fontSize: 11, color: "#7A90A7", marginTop: 2 }}>
                  Age {age} → 85 · {real ? "Inflation-adjusted (2026 $)" : "Nominal values"}{couple ? " · Couple (2×)" : ""}
                </p>
              </div>
              <div style={{ display: "flex", gap: 14, fontSize: 11, alignItems: "center" }}>
                <span style={{ color: "#16C9A8" }}>⸺ Total NW</span>
                <span style={{ color: "#E8A838" }}>╌╌ Liquid NW</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={290}>
              <LineChart data={data} margin={{ top: 4, right: 10, left: 0, bottom: 2 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="age" stroke="#7A90A7" tick={{ fontSize: 10, fill: "#7A90A7" }} tickLine={false} />
                <YAxis tickFormatter={Sk} stroke="#7A90A7" tick={{ fontSize: 10, fill: "#7A90A7" }} width={58} tickLine={false} axisLine={false} />
                <Tooltip content={<CT />} />
                {age < 55 && (
                  <ReferenceLine x={55} stroke="rgba(255,255,255,0.18)" strokeDasharray="3 3"
                    label={{ value: "55", fill: "#7A90A7", fontSize: 9, position: "insideTopRight" }} />
                )}
                {age < 65 && (
                  <ReferenceLine x={65} stroke="rgba(232,168,56,0.45)" strokeDasharray="3 3"
                    label={{ value: "65 Retire", fill: "#E8A838", fontSize: 9, position: "insideTopRight" }} />
                )}
                <ReferenceArea x1={Math.max(age, 65)} x2={85} fill="rgba(232,168,56,0.03)" stroke="none" />
                <Line type="monotone" dataKey="total" stroke="#16C9A8" strokeWidth={2.5}
                  dot={false} activeDot={{ r: 4, fill: "#16C9A8" }} />
                <Line type="monotone" dataKey="liq" stroke="#E8A838" strokeWidth={2}
                  strokeDasharray="6 3" dot={false} activeDot={{ r: 4, fill: "#E8A838" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Summary Cards */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
            <Card title={`Total NW ${retLbl}`}
              val={Sk(dR?.nTotal || 0)}
              sub={real ? "Shown in 2026 dollars on chart" : "Nominal value"} />
            <Card title={`Liquid NW ${retLbl}`}
              val={Sk(dR?.nLiq || 0)}
              color="#E8A838"
              sub="Bank + Invest + SRS (accessible)" />
            <Card title="CPF LIFE Monthly"
              val={`${S(cpfLP_mo)}/mo`}
              sub={cpfLO > 0 ? "Manual override applied" : "Est. from RA balance ÷ 240"} />
            <Card
              title={surplus >= 0 ? "Monthly Surplus" : "Monthly Shortfall"}
              val={surplus >= 0 ? `+${S(surplus)}/mo` : `-${S(-surplus)}/mo`}
              color={surplus >= 0 ? "#34D399" : "#F04F58"}
              sub={`CPF LIFE + SRS vs expenses ${retLbl.toLowerCase()}`}
              warn={surplus < 0 ? "Projected income may not cover retirement expenses." : null}
            />
            <Card title="Medisave at 65"
              val={Sk(dR?.ma || 0)}
              color="#4A6070"
              sub="Healthcare reserved — excluded from NW" />
            <Card title="Liquid NW Lifespan"
              val={lifespan}
              color={lifespan === "20+ yrs" ? "#34D399" : "#F7B731"}
              sub="Post-65 until liquid assets depleted" />
          </div>

          {/* Retirement income warning */}
          {surplus < 0 && (
            <div style={{ background: "rgba(247,183,49,.09)", border: "1px solid #F7B731", borderRadius: 8, padding: "10px 14px", marginBottom: 10, fontSize: 12, color: "#F7B731" }}>
              ⚠ Projected retirement income may not cover expenses. Consider increasing savings or investments, or adjusting your retirement lifestyle.
            </div>
          )}

          {/* CPF Note */}
          {age < 55 && (
            <div style={{ background: "#0B1A2B", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "9px 14px", marginBottom: 10, fontSize: 11, color: "#7A90A7", lineHeight: 1.6 }}>
              <span style={{ color: "#16C9A8", fontWeight: 600 }}>Key CPF milestones: </span>
              At 55, your SA transfers to RA (up to the Full Retirement Sum). At 65, CPF LIFE monthly payouts begin and CPF OA becomes freely withdrawable.
              The gold shaded region shows your retirement phase.
            </div>
          )}

          {/* Disclaimer */}
          <div style={{ background: "#0B1A2B", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "10px 14px", fontSize: 10.5, color: "#4A5A6A", lineHeight: 1.65 }}>
            <b style={{ color: "rgba(255,255,255,.25)" }}>Disclaimer:</b> This dashboard is for illustrative and planning purposes only. It does not constitute financial advice. Actual outcomes will vary based on market conditions, policy changes, and individual circumstances. CPF rules, FRS thresholds, and SRS limits are based on published 2025–2026 figures and may change. Please consult a licensed financial adviser for personalised guidance.
          </div>
        </div>
      </div>
    </div>
  );
} 