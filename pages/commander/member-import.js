/**
 * Member Import
 * /commander/member-import
 * 
 * Bulk import members from CSV files.
 * Supports column mapping, validation, duplicate detection.
 * Handles files from other poker room management systems.
 */
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import { Upload, Check, AlertTriangle, Loader2, ChevronRight } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync, broadcastChange } from '../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../src/engine/EventBus';
import { commanderFetch } from '../../src/lib/commander/commanderFetch';
import { getVenueId } from '../../src/lib/commander/clientAuth';

const REQUIRED_FIELDS = ['first_name', 'last_name'];
const OPTIONAL_FIELDS = ['phone', 'email', 'member_number', 'membership_tier', 'notes', 'address', 'city', 'state', 'zip'];
const ALL_FIELDS = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];

function parseCSV(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return { headers: [], rows: [] };

  const parseRow = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { inQuotes = !inQuotes; continue; }
      if (line[i] === ',' && !inQuotes) { result.push(current.trim()); current = ''; continue; }
      current += line[i];
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseRow(lines[0]);
  const rows = lines.slice(1).map(l => parseRow(l));
  return { headers, rows };
}

function guessMapping(header) {
  const h = header.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (h.includes('first') || h === 'fname') return 'first_name';
  if (h.includes('last') || h === 'lname') return 'last_name';
  if (h.includes('phone') || h.includes('mobile') || h.includes('cell')) return 'phone';
  if (h.includes('email') || h.includes('mail')) return 'email';
  if (h.includes('member') && h.includes('num') || h.includes('memberid')) return 'member_number';
  if (h.includes('tier') || h.includes('level') || h.includes('status')) return 'membership_tier';
  if (h.includes('note') || h.includes('comment')) return 'notes';
  if (h.includes('addr') || h.includes('street')) return 'address';
  if (h.includes('city')) return 'city';
  if (h.includes('state') || h.includes('province')) return 'state';
  if (h.includes('zip') || h.includes('postal')) return 'zip';
  return '';
}

export default function MemberImport() {
  useCommanderSync(getVenueId(), () => {}, { entities: ['members'] });
  useEffect(() => { busEmit.sessionStart('commander-member-import'); }, []);
  const router = useRouter();
  const fileRef = useRef(null);
  const [step, setStep] = useState(1); // 1: upload, 2: map, 3: preview, 4: importing, 5: done
  const [csvData, setCsvData] = useState({ headers: [], rows: [] });
  const [mapping, setMapping] = useState({});
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState({ imported: 0, skipped: 0, errors: [] });
  const [fileName, setFileName] = useState('');

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target.result;
      const data = parseCSV(text);
      setCsvData(data);
      // Auto-map columns
      const autoMap = {};
      data.headers.forEach((h, i) => {
        const guess = guessMapping(h);
        if (guess) autoMap[i] = guess;
      });
      setMapping(autoMap);
      setStep(2);
    };
    reader.readAsText(file);
  };

  const mappedFields = Object.values(mapping || {}).filter(Boolean);
  const hasRequired = REQUIRED_FIELDS.every(f => mappedFields.includes(f));

  const getMappedRows = () => {
    return csvData.rows.map(row => {
      const obj = {};
      Object.entries(mapping || {}).forEach(([colIdx, field]) => {
        if (field && row[parseInt(colIdx)]) {
          obj[field] = row[parseInt(colIdx)];
        }
      });
      return obj;
    }).filter(r => r.first_name && r.last_name);
  };

  const startImport = async () => {
    setStep(4);
    setImporting(true);
    const rows = getMappedRows();
    let imported = 0, skipped = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      try {
const res = await commanderFetch('/api/commander/members', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' || '' },
          body: JSON.stringify(rows[i])
        });
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const json = await res.json();
        if (json.success) imported++;
        else {
          if (json.error?.includes('duplicate') || json.error?.includes('already exists')) skipped++;
          else errors.push(`Row ${i + 1}: ${json.error || 'Unknown error'}`);
        }
      } catch (err) {
        errors.push(`Row ${i + 1}: ${err.message}`);
      }
      setProgress(Math.round(((i + 1) / rows.length) * 100));
    }

    setResults({ imported, skipped, errors: errors.slice(0, 20) });
    setImporting(false);
    setStep(5);
    if (imported > 0) broadcastChange('members');
  };

  const previewRows = getMappedRows().slice(0, 5);

  return (
    <CommanderLayout title="Import Members" backHref="/commander/dashboard?card=waitlist">
      <>
        <SEOHead
          title="Commander — Member Import"
          description="Club Commander Poker Room Management Tool."
          noindex={true}
        />
        <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter']">

          {/* Header */}
          <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 py-3 flex items-center gap-3">
            <div className="flex-1">
              <h1 className="text-lg font-bold text-white">Import Members</h1>
              <p className="text-xs text-[#B0B3B8]">Step {step} of 5</p>
            </div>
          </div>

          <div className="p-4 max-w-lg mx-auto space-y-4">

            {/* STEP 1: Upload */}
            {step === 1 && (
              <>
                <div className="border-2 border-dashed border-[#3A3B3C] rounded-2xl p-10 text-center"
                  onClick={() => fileRef.current?.click()}>
                  <Upload className="w-12 h-12 text-[#B0B3B8] mx-auto mb-4" />
                  <h2 className="text-xl font-bold text-white mb-2">Upload CSV File</h2>
                  <p className="text-sm text-[#B0B3B8] mb-4">
                    Drag and drop or tap to select a .csv file with member data
                  </p>
                  <button className="px-6 py-3 bg-[#1877F2] text-white rounded-xl font-semibold active:bg-[#1565D8]">
                    Choose File
                  </button>
                  <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFile} />
                </div>

                <div className="bg-[#242526] border border-[#3A3B3C] rounded-xl p-4">
                  <p className="text-xs text-[#B0B3B8] uppercase tracking-wider mb-2">Expected Format</p>
                  <p className="text-sm text-white mb-2">CSV With Headers. Required: First Name, Last Name</p>
                  <p className="text-xs text-[#B0B3B8]">Optional: Phone, Email, Member Number, Tier, Notes, Address</p>
                </div>
              </>
            )}

            {/* STEP 2: Map Columns */}
            {step === 2 && (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold text-white">Map Columns</h2>
                  <span className="text-xs text-[#B0B3B8]">{csvData.rows.length} rows found</span>
                </div>

                <div className="space-y-2">
                  {csvData.headers.map((header, idx) => (
                    <div key={idx} className="flex items-center gap-3 bg-[#242526] border border-[#3A3B3C] rounded-xl px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{header}</p>
                        <p className="text-[10px] text-[#B0B3B8] truncate">
                          e.g. {csvData.rows[0]?.[idx] || '—'}
                        </p>
                      </div>
                      <select value={mapping[idx] || ''}
                        onChange={e => setMapping({ ...mapping, [idx]: e.target.value })}
                        className="bg-[#3A3B3C] border border-[#4A4B4C] rounded-lg px-3 py-2 text-sm text-[#E4E6EB] focus:outline-none focus:border-[#1877F2]">
                        <option value="">Skip</option>
                        {ALL_FIELDS.map(f => (
                          <option key={f} value={f}>{f.replace(/_/g, ' ')}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>

                {!hasRequired && (
                  <div className="bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-xl p-3 flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-[#EF4444] flex-shrink-0" />
                    <p className="text-sm text-[#EF4444]">Map Both First_name And Last_name To Continue</p>
                  </div>
                )}

                <button onClick={() => setStep(3)} disabled={!hasRequired}
                  className="w-full py-4 rounded-xl bg-[#1877F2] text-white text-lg font-semibold flex items-center justify-center gap-2 active:bg-[#1565D8] disabled:opacity-30">
                  Preview <ChevronRight className="w-5 h-5" />
                </button>
              </>
            )}

            {/* STEP 3: Preview */}
            {step === 3 && (
              <>
                <h2 className="text-xl font-bold text-white">Preview Import</h2>
                <p className="text-sm text-[#B0B3B8]">
                  {getMappedRows().length} valid rows will be imported. Showing first 5:
                </p>

                <div className="space-y-2">
                  {previewRows.map((row, i) => (
                    <div key={i} className="bg-[#242526] border border-[#3A3B3C] rounded-xl px-4 py-3">
                      <p className="text-sm font-medium text-white">{row.first_name} {row.last_name}</p>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {row.phone && <span className="text-[10px] text-[#B0B3B8] bg-[#3A3B3C] px-2 py-0.5 rounded">{row.phone}</span>}
                        {row.email && <span className="text-[10px] text-[#B0B3B8] bg-[#3A3B3C] px-2 py-0.5 rounded">{row.email}</span>}
                        {row.member_number && <span className="text-[10px] text-[#B0B3B8] bg-[#3A3B3C] px-2 py-0.5 rounded">#{row.member_number}</span>}
                      </div>
                    </div>
                  ))}
                </div>

                <button onClick={startImport}
                  className="w-full py-4 rounded-xl bg-[#31A24C] text-white text-lg font-semibold flex items-center justify-center gap-2 active:bg-[#28883F]">
                  <Upload className="w-5 h-5" /> Import {getMappedRows().length} Members
                </button>
              </>
            )}

            {/* STEP 4: Importing */}
            {step === 4 && (
              <div className="py-12 text-center">
                <Loader2 className="w-12 h-12 text-[#1877F2] animate-spin mx-auto mb-6" />
                <h2 className="text-xl font-bold text-white mb-2">Importing Members...</h2>
                <div className="w-full bg-[#3A3B3C] rounded-full h-3 mb-2">
                  <div className="bg-[#1877F2] h-3 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
                </div>
                <p className="text-sm text-[#B0B3B8]">{progress}% complete</p>
              </div>
            )}

            {/* STEP 5: Done */}
            {step === 5 && (
              <div className="py-6 text-center space-y-4">
                <div className="w-20 h-20 rounded-full bg-[#31A24C]/20 flex items-center justify-center mx-auto">
                  <Check className="w-10 h-10 text-[#31A24C]" />
                </div>
                <h2 className="text-2xl font-bold text-white">Import Complete</h2>

                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-[#31A24C]/10 border border-[#31A24C]/30 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-[#31A24C]">{results.imported}</p>
                    <p className="text-[10px] text-[#B0B3B8]">Imported</p>
                  </div>
                  <div className="bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-[#F59E0B]">{results.skipped}</p>
                    <p className="text-[10px] text-[#B0B3B8]">Skipped</p>
                  </div>
                  <div className="bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-[#EF4444]">{results.errors.length}</p>
                    <p className="text-[10px] text-[#B0B3B8]">Errors</p>
                  </div>
                </div>

                {results.errors.length > 0 && (
                  <div className="bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-xl p-3 text-left max-h-40 overflow-y-auto">
                    {results.errors.map((e, i) => (
                      <p key={i} className="text-xs text-[#EF4444]">{e}</p>
                    ))}
                  </div>
                )}

                <button onClick={() => router.push('/commander/members')}
                  className="w-full py-4 rounded-xl bg-[#1877F2] text-white text-lg font-semibold active:bg-[#1565D8]">
                  View Members
                </button>
              </div>
            )}
          </div>
        </div>
        <style>{`
`}</style>
      </>
    </CommanderLayout>
  );
}
