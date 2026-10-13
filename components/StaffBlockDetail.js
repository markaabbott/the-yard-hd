import { useState } from 'react';
import { localParts, hmLabel, zonedTimeToUtc, addDaysYmd } from '../lib/facilityTime';
import { staffAction } from '../lib/staffApi';

// Drawer for one block: what it covers, and (admin/owner) edit or remove it.
const RED = '#BA0C2F';
const pad = (n) => String(n).padStart(2, '0');
const at = (ymd, hm, tz) => { const [h, m] = hm.split(':').map(Number); return zonedTimeToUtc(ymd, h, m, tz); };

export default function StaffBlockDetail({ block: b, cages = [], tz, step = 30, canEdit, onClose, onDone }) {
  const s0 = localParts(b.starts_at, tz);
  const e0 = localParts(b.ends_at, tz);
  const wasAllDay = s0.hm === '00:00' && e0.hm === '00:00';
  const [mode, setMode] = useState(null); // null | 'edit' | 'delete'
  const [allDay, setAllDay] = useState(wasAllDay);
  const [sDate, setSDate] = useState(s0.ymd);
  const [sTime, setSTime] = useState(s0.hm);
  const [eDate, setEDate] = useState(wasAllDay ? addDaysYmd(e0.ymd, -1) : e0.ymd);
  const [eTime, setETime] = useState(e0.hm);
  const [reason, setReason] = useState(b.reason || '');
  const [conflicts, setConflicts] = useState(null);
  const [err, setErr] = useState(null);
  const [working, setWorking] = useState(false);

  const where = b.scope === 'facility' ? 'Whole facility' : cages.find((c) => c.id === b.cage_id)?.name || 'Cage';
  const fmt = (d) => new Date(d).toLocaleString([], { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const fmtDay = (ymd) => new Date(at(ymd, '12:00', tz)).toLocaleDateString(undefined, { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' });
  const lastDay = addDaysYmd(e0.ymd, -1);
  const whenText = wasAllDay
    ? (s0.ymd === lastDay ? `${fmtDay(s0.ymd)}, all day` : `${fmtDay(s0.ymd)} through ${fmtDay(lastDay)}`)
    : `${fmt(b.starts_at)} – ${s0.ymd === e0.ymd ? hmLabel(e0.hm) : fmt(b.ends_at)}`;
  const times = Array.from({ length: (24 * 60) / step }, (_, i) => `${pad(Math.floor((i * step) / 60))}:${pad((i * step) % 60)}`);

  async function save() {
    setWorking(true); setErr(null); setConflicts(null);
    try {
      const s = allDay ? at(sDate, '00:00', tz) : at(sDate, sTime, tz);
      const e = allDay ? at(addDaysYmd(eDate, 1), '00:00', tz) : at(eDate, eTime, tz);
      if (e <= s) throw new Error('The block has to end after it starts.');
      const r = await staffAction('block_save', { p_id: b.id, p_cage_ids: null, p_starts_at: s.toISOString(), p_ends_at: e.toISOString(), p_reason: reason.trim() || null });
      if (!r.ok) { setConflicts(r.conflicts || []); setWorking(false); return; }
      onDone(`Block updated · ${where}.`);
    } catch (e) { setErr(e.message); setWorking(false); }
  }

  async function remove() {
    setWorking(true); setErr(null);
    try {
      await staffAction('block_delete', { p_id: b.id });
      onDone(`Block removed. ${where} is open for booking again.`);
    } catch (e) { setErr(e.message); setWorking(false); }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,.35)' }} />
      <aside style={{ position: 'fixed', zIndex: 51, top: 0, right: 0, bottom: 0, width: 420, maxWidth: '100vw', background: '#fff', boxShadow: '-8px 0 32px rgba(0,0,0,.18)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 24px 18px', borderBottom: '1px solid rgba(0,0,0,.08)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 14, height: 14, borderRadius: 3, background: 'repeating-linear-gradient(45deg,#D9D6D1 0 3px,#EFEDE9 3px 6px)' }} />
              <span style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 13, letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(0,0,0,.55)' }}>Blocked · {where}</span>
            </span>
            <button onClick={onClose} aria-label="Close" style={{ width: 32, height: 32, border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, color: 'rgba(0,0,0,.45)' }}>✕</button>
          </div>
          <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 24, lineHeight: 1.15, textTransform: 'uppercase', letterSpacing: '.02em' }}>{b.reason || 'Blocked'}</div>
          <div style={{ fontSize: 14, lineHeight: 1.5 }}>{whenText}</div>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
          {mode === 'edit' ? (
            <>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" maxLength={80} style={field} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> All day
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 8 }}>
                <label style={fieldLabel}>{allDay ? 'From' : 'Starts'}<input type="date" value={sDate} onChange={(e) => { setSDate(e.target.value); if (e.target.value > eDate) setEDate(e.target.value); }} style={field} /></label>
                {!allDay && <label style={fieldLabel}>&nbsp;<select value={sTime} onChange={(e) => setSTime(e.target.value)} style={field}>{times.map((t) => <option key={t} value={t}>{hmLabel(t)}</option>)}</select></label>}
                <label style={fieldLabel}>{allDay ? 'Through' : 'Ends'}<input type="date" value={eDate} min={sDate} onChange={(e) => setEDate(e.target.value)} style={field} /></label>
                {!allDay && <label style={fieldLabel}>&nbsp;<select value={eTime} onChange={(e) => setETime(e.target.value)} style={field}>{times.map((t) => <option key={t} value={t}>{hmLabel(t)}</option>)}</select></label>}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13.5, lineHeight: 1.55, color: 'rgba(0,0,0,.65)' }}>
              Nobody can book {b.scope === 'facility' ? 'any cage' : where} during this time, online or at the desk.
              {!canEdit && ' Only admins and owners can change blocks.'}
            </div>
          )}
          {conflicts && (
            <div style={{ border: '1px solid rgba(186,12,47,.35)', borderRadius: 8, padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: 8, background: 'rgba(186,12,47,.04)' }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: RED }}>{conflicts.length} booking{conflicts.length === 1 ? ' is' : 's are'} in the way. Move or cancel first.</div>
              {conflicts.map((c) => (
                <div key={c.group_id} style={{ fontSize: 13, lineHeight: 1.45 }}><strong>{c.title}</strong><br /><span style={{ color: 'rgba(0,0,0,.6)' }}>{fmt(c.starts_at)} · {c.cages}</span></div>
              ))}
            </div>
          )}
          {err && <div style={{ fontSize: 13, color: RED, lineHeight: 1.5 }}>{err}</div>}
        </div>

        {canEdit && (
          <div style={{ padding: '16px 24px 22px', borderTop: '1px solid rgba(0,0,0,.08)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {mode === 'delete' && <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>Remove this block? {where} opens for booking right away.</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              {mode ? (
                <>
                  <button disabled={working} onClick={() => { setMode(null); setConflicts(null); setErr(null); }} style={secondary}>Back</button>
                  {mode === 'edit'
                    ? <button disabled={working} onClick={save} style={{ ...primary, background: '#000' }}>{working ? 'Saving…' : 'Save block'}</button>
                    : <button disabled={working} onClick={remove} style={primary}>{working ? 'Removing…' : 'Remove block'}</button>}
                </>
              ) : (
                <>
                  <button onClick={() => setMode('edit')} style={{ ...secondary, fontWeight: 700, color: '#111' }}>Edit</button>
                  <button onClick={() => setMode('delete')} style={{ ...secondary, flex: 1.4, fontWeight: 700, color: RED, border: `1px solid ${RED}` }}>Remove block</button>
                </>
              )}
            </div>
          </div>
        )}
      </aside>
    </>
  );
}

const field = { minHeight: 42, padding: '0 10px', border: '1px solid rgba(0,0,0,.2)', borderRadius: 6, fontSize: 14, background: '#fff', color: '#111', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' };
const fieldLabel = { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,.6)', minWidth: 0 };
const secondary = { flex: 1, minHeight: 44, borderRadius: 6, border: '1px solid rgba(0,0,0,.15)', background: '#fff', fontSize: 13.5, cursor: 'pointer' };
const primary = { flex: 1.4, minHeight: 44, borderRadius: 6, border: 'none', background: RED, color: '#fff', fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 14, letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' };
