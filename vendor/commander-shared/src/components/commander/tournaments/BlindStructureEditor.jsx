/**
 * BlindStructureEditor - Visual editor for tournament blind structures
 * Displays level table with SB/BB/Ante/Duration, break rows, add/remove
 * UI: Dark industrial sci-fi gaming theme, no emojis, Inter font
 *
 * VALIDATION (2026-08-20)
 * The editor runs the shared rule set on every change and shows the result
 * inline: blocking errors in red against the offending row, advisory warnings
 * in amber. It reports the result upward through onValidationChange so the
 * parent form can refuse to save a structure that would break the clock. The
 * same rules run server-side in the tournament create/update routes, so the
 * editor can never offer a save the API will reject.
 */
import { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2, Coffee, ChevronUp, ChevronDown, AlertCircle, AlertTriangle } from 'lucide-react';
import { validateBlindStructure } from '../../../lib/commander/structureValidation';

export default function BlindStructureEditor({ structure, onChange, readOnly = false, onValidationChange }) {
    const [editingIndex, setEditingIndex] = useState(null);

    const validation = useMemo(
        () => validateBlindStructure(Array.isArray(structure) ? structure : []),
        [structure]
    );
    const errorList = validation.errors.filter(e => e.severity === 'error');
    const warningList = validation.errors.filter(e => e.severity === 'warning');

    // Row index -> worst severity on that row, so the table itself shows where
    // the problem is instead of only listing it underneath.
    const rowSeverity = useMemo(() => {
        const map = {};
        validation.errors.forEach(e => {
            if (e.level_index == null) return;
            if (e.severity === 'error' || !map[e.level_index]) map[e.level_index] = e.severity;
        });
        return map;
    }, [validation]);

    // Signature keeps the parent from re-rendering on every identical result.
    const validationSignature = `${validation.valid}|${validation.errors.map(e => `${e.level_index}:${e.code}`).join(',')}`;
    useEffect(() => {
        if (typeof onValidationChange === 'function') onValidationChange(validation);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [validationSignature]);

    function updateLevel(index, field, value) {
        const updated = [...structure];
        updated[index] = { ...updated[index], [field]: value };
        onChange(updated);
    }

    function addLevel() {
        const playLevels = structure.filter(l => !l.is_break);
        const lastPlay = playLevels[playLevels.length - 1];
        const newLevel = {
            level: playLevels.length + 1,
            small_blind: lastPlay ? lastPlay.big_blind : 100,
            big_blind: lastPlay ? lastPlay.big_blind * 2 : 200,
            ante: lastPlay ? Math.round(lastPlay.big_blind * 0.25) : 25,
            duration: lastPlay?.duration || 15,
        };
        onChange([...structure, newLevel]);
    }

    function addBreak(afterIndex) {
        const updated = [...structure];
        updated.splice(afterIndex + 1, 0, { is_break: true, duration: 10, label: 'Break' });
        onChange(updated);
    }

    function removeLevel(index) {
        const updated = structure.filter((_, i) => i !== index);
        // Renumber play levels
        let levelNum = 1;
        const renumbered = updated.map(item => {
            if (item.is_break) return item;
            return { ...item, level: levelNum++ };
        });
        onChange(renumbered);
    }

    function moveLevel(index, direction) {
        if ((direction === -1 && index === 0) || (direction === 1 && index === structure.length - 1)) return;
        const updated = [...structure];
        const temp = updated[index];
        updated[index] = updated[index + direction];
        updated[index + direction] = temp;
        // Renumber play levels
        let levelNum = 1;
        const renumbered = updated.map(item => {
            if (item.is_break) return item;
            return { ...item, level: levelNum++ };
        });
        onChange(renumbered);
    }

    const totalMinutes = structure.reduce((sum, l) => sum + (l.duration ?? l.duration_minutes ?? 0), 0);
    const playLevels = structure.filter(l => !l.is_break).length;
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;

    return (
        <div className="space-y-3">
            {/* Summary bar */}
            <div className="flex items-center justify-between px-3 py-2 bg-[#0D192E] rounded-lg">
                <span className="text-sm text-[#94A3B8]">
                    {playLevels} Levels, {structure.filter(l => l.is_break).length} Breaks
                </span>
                <span className="text-sm font-medium text-[#22D3EE]">
                    Est. Duration: ~{hours}h {mins > 0 ? `${mins}m` : ''}
                </span>
            </div>

            {/* ===== VALIDATION ===== */}
            {errorList.length > 0 && (
                <div className="rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 p-3">
                    <div className="flex items-center gap-2 mb-2">
                        <AlertCircle className="w-4 h-4 text-[#EF4444]" />
                        <span className="text-sm font-semibold text-[#EF4444]">
                            {errorList.length.toLocaleString()} Structure Error{errorList.length === 1 ? '' : 's'}, This Cannot Be Saved
                        </span>
                    </div>
                    <ul className="space-y-1">
                        {errorList.map((e, i) => (
                            <li key={`bse-err-${i}`} className="text-xs text-[#E2E8F0] flex gap-2">
                                <span className="font-mono text-[#EF4444] flex-shrink-0">
                                    {e.level_index == null ? '--' : `#${e.level_index + 1}`}
                                </span>
                                <span>{e.message}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {warningList.length > 0 && (
                <div className="rounded-lg border border-[#F59E0B]/40 bg-[#F59E0B]/10 p-3">
                    <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle className="w-4 h-4 text-[#F59E0B]" />
                        <span className="text-sm font-semibold text-[#F59E0B]">
                            {warningList.length.toLocaleString()} Warning{warningList.length === 1 ? '' : 's'}, Saving Is Still Allowed
                        </span>
                    </div>
                    <ul className="space-y-1">
                        {warningList.map((w, i) => (
                            <li key={`bse-warn-${i}`} className="text-xs text-[#E2E8F0] flex gap-2">
                                <span className="font-mono text-[#F59E0B] flex-shrink-0">
                                    {w.level_index == null ? '--' : `#${w.level_index + 1}`}
                                </span>
                                <span>{w.message}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Level table */}
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-[#1E3A5F]">
                            <th className="px-2 py-2 text-left text-[#64748B] font-medium w-12">Lvl</th>
                            <th className="px-2 py-2 text-right text-[#64748B] font-medium">SB</th>
                            <th className="px-2 py-2 text-right text-[#64748B] font-medium">BB</th>
                            <th className="px-2 py-2 text-right text-[#64748B] font-medium">Ante</th>
                            <th className="px-2 py-2 text-right text-[#64748B] font-medium w-16">Min</th>
                            {!readOnly && <th className="px-2 py-2 w-28"></th>}
                        </tr>
                    </thead>
                    <tbody>
                        {structure.map((item, idx) => {
                            const sev = rowSeverity[idx];
                            // Left rail marks the row the message refers to.
                            const rowFlag = sev === 'error'
                                ? 'border-l-2 border-l-[#EF4444]'
                                : sev === 'warning' ? 'border-l-2 border-l-[#F59E0B]' : '';

                            if (item.is_break) {
                                return (
                                    <tr key={`break-${idx}`} className={`bg-[#1E3A5F]/30 ${rowFlag}`}>
                                        <td colSpan={readOnly ? 5 : 4} className="px-2 py-2">
                                            <div className="flex items-center gap-2">
                                                <Coffee className="w-4 h-4 text-[#F59E0B]" />
                                                <span className="text-[#F59E0B] font-medium">{item.label || 'Break'}</span>
                                            </div>
                                        </td>
                                        <td className="px-2 py-2 text-right text-[#F59E0B]">
                                            {readOnly ? (
                                                `${item.duration ?? item.duration_minutes ?? 0}m`
                                            ) : (
                                                <input
                                                    type="number"
                                                    value={item.duration ?? item.duration_minutes ?? 0}
                                                    onChange={(e) => updateLevel(idx, 'duration', parseInt(e.target.value) || 5)}
                                                    className="w-14 h-7 bg-[#0D192E] border border-[#1E3A5F] rounded text-center text-[#F59E0B] text-sm"
                                                />
                                            )}
                                        </td>
                                        {!readOnly && (
                                            <td className="px-2 py-2 text-right">
                                                <div className="flex items-center justify-end gap-1">
                                                    <button
                                                        onClick={() => moveLevel(idx, -1)}
                                                        className="p-1 hover:bg-[#132240] rounded transition-colors"
                                                        title="Move Up"
                                                    >
                                                        <ChevronUp className="w-3.5 h-3.5 text-[#94A3B8]" />
                                                    </button>
                                                    <button
                                                        onClick={() => moveLevel(idx, 1)}
                                                        className="p-1 hover:bg-[#132240] rounded transition-colors"
                                                        title="Move Down"
                                                    >
                                                        <ChevronDown className="w-3.5 h-3.5 text-[#94A3B8]" />
                                                    </button>
                                                    <button
                                                        onClick={() => removeLevel(idx)}
                                                        className="p-1 hover:bg-[#EF4444]/20 rounded transition-colors"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5 text-[#EF4444]" />
                                                    </button>
                                                </div>
                                            </td>
                                        )}
                                    </tr>
                                );
                            }

                            const isEditing = editingIndex === idx;

                            return (
                                <tr
                                    key={`level-${idx}`}
                                    className={`border-b border-[#1E3A5F]/50 hover:bg-[#132240]/50 transition-colors ${isEditing ? 'bg-[#132240]' : ''} ${rowFlag}`}
                                    onClick={() => !readOnly && setEditingIndex(isEditing ? null : idx)}
                                >
                                    {/* Break-aware fallback: structures saved without a `level` field
                                        get their number by counting non-break rows up to this index */}
                                    <td className="px-2 py-2 text-[#64748B] font-mono">{item.level ?? structure.slice(0, idx + 1).filter(l => !l.is_break).length}</td>
                                    <td className="px-2 py-2 text-right text-white">
                                        {!readOnly && isEditing ? (
                                            <input
                                                type="number"
                                                value={item.small_blind}
                                                onChange={(e) => updateLevel(idx, 'small_blind', parseInt(e.target.value) || 0)}
                                                onClick={(e) => e.stopPropagation()}
                                                className="w-20 h-7 bg-[#0D192E] border border-[#1E3A5F] rounded text-right text-white text-sm px-2"
                                            />
                                        ) : (
                                            (item.small_blind ?? 0).toLocaleString()
                                        )}
                                    </td>
                                    <td className="px-2 py-2 text-right text-white font-medium">
                                        {!readOnly && isEditing ? (
                                            <input
                                                type="number"
                                                value={item.big_blind}
                                                onChange={(e) => updateLevel(idx, 'big_blind', parseInt(e.target.value) || 0)}
                                                onClick={(e) => e.stopPropagation()}
                                                className="w-20 h-7 bg-[#0D192E] border border-[#1E3A5F] rounded text-right text-white text-sm px-2"
                                            />
                                        ) : (
                                            (item.big_blind ?? 0).toLocaleString()
                                        )}
                                    </td>
                                    <td className="px-2 py-2 text-right text-[#94A3B8]">
                                        {!readOnly && isEditing ? (
                                            <input
                                                type="number"
                                                value={item.ante}
                                                onChange={(e) => updateLevel(idx, 'ante', parseInt(e.target.value) || 0)}
                                                onClick={(e) => e.stopPropagation()}
                                                className="w-16 h-7 bg-[#0D192E] border border-[#1E3A5F] rounded text-right text-[#94A3B8] text-sm px-2"
                                            />
                                        ) : (
                                            item.ante > 0 ? item.ante.toLocaleString() : '-'
                                        )}
                                    </td>
                                    <td className="px-2 py-2 text-right text-[#22D3EE]">
                                        {!readOnly && isEditing ? (
                                            <input
                                                type="number"
                                                value={item.duration ?? item.duration_minutes ?? 0}
                                                onChange={(e) => updateLevel(idx, 'duration', parseInt(e.target.value) || 1)}
                                                onClick={(e) => e.stopPropagation()}
                                                className="w-14 h-7 bg-[#0D192E] border border-[#1E3A5F] rounded text-center text-[#22D3EE] text-sm"
                                            />
                                        ) : (
                                            `${item.duration ?? item.duration_minutes ?? 0}m`
                                        )}
                                    </td>
                                    {!readOnly && (
                                        <td className="px-2 py-2 text-right">
                                            <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                                                <button
                                                    onClick={() => moveLevel(idx, -1)}
                                                    className="p-1 hover:bg-[#132240] rounded transition-colors"
                                                    title="Move Up"
                                                >
                                                    <ChevronUp className="w-3.5 h-3.5 text-[#94A3B8]" />
                                                </button>
                                                <button
                                                    onClick={() => moveLevel(idx, 1)}
                                                    className="p-1 hover:bg-[#132240] rounded transition-colors"
                                                    title="Move Down"
                                                >
                                                    <ChevronDown className="w-3.5 h-3.5 text-[#94A3B8]" />
                                                </button>
                                                <button
                                                    onClick={() => addBreak(idx)}
                                                    className="p-1 hover:bg-[#F59E0B]/20 rounded transition-colors"
                                                    title="Insert Break After"
                                                >
                                                    <Coffee className="w-3.5 h-3.5 text-[#F59E0B]" />
                                                </button>
                                                <button
                                                    onClick={() => removeLevel(idx)}
                                                    className="p-1 hover:bg-[#EF4444]/20 rounded transition-colors"
                                                    title="Remove Level"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5 text-[#EF4444]" />
                                                </button>
                                            </div>
                                        </td>
                                    )}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Add level button */}
            {!readOnly && (
                <button
                    onClick={addLevel}
                    className="w-full py-2 border border-dashed border-[#1E3A5F] rounded-lg text-sm text-[#64748B] hover:text-[#22D3EE] hover:border-[#22D3EE] transition-colors flex items-center justify-center gap-2"
                >
                    <Plus className="w-4 h-4" />
                    Add Level
                </button>
            )}
        </div>
    );
}
