/**
 * BlindStructureEditor — Visual editor for tournament blind structures
 * Displays level table with SB/BB/Ante/Duration, break rows, add/remove
 * UI: Dark industrial sci-fi gaming theme, no emojis, Inter font
 */
import { useState } from 'react';
import { Plus, Trash2, Coffee } from 'lucide-react';

export default function BlindStructureEditor({ structure, onChange, readOnly = false }) {
    const [editingIndex, setEditingIndex] = useState(null);

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

    const totalMinutes = structure.reduce((sum, l) => sum + (l.duration || 0), 0);
    const playLevels = structure.filter(l => !l.is_break).length;
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;

    return (
        <div className="space-y-3">
            {/* Summary bar */}
            <div className="flex items-center justify-between px-3 py-2 bg-[#0D192E] rounded-lg">
                <span className="text-sm text-[#94A3B8]">
                    {playLevels} levels, {structure.filter(l => l.is_break).length} breaks
                </span>
                <span className="text-sm font-medium text-[#22D3EE]">
                    Est. duration: ~{hours}h {mins > 0 ? `${mins}m` : ''}
                </span>
            </div>

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
                            {!readOnly && <th className="px-2 py-2 w-20"></th>}
                        </tr>
                    </thead>
                    <tbody>
                        {structure.map((item, idx) => {
                            if (item.is_break) {
                                return (
                                    <tr key={`break-${idx}`} className="bg-[#1E3A5F]/30">
                                        <td colSpan={readOnly ? 5 : 4} className="px-2 py-2">
                                            <div className="flex items-center gap-2">
                                                <Coffee className="w-4 h-4 text-[#F59E0B]" />
                                                <span className="text-[#F59E0B] font-medium">{item.label || 'Break'}</span>
                                            </div>
                                        </td>
                                        <td className="px-2 py-2 text-right text-[#F59E0B]">
                                            {readOnly ? (
                                                `${item.duration}m`
                                            ) : (
                                                <input
                                                    type="number"
                                                    value={item.duration}
                                                    onChange={(e) => updateLevel(idx, 'duration', parseInt(e.target.value) || 5)}
                                                    className="w-14 h-7 bg-[#0D192E] border border-[#1E3A5F] rounded text-center text-[#F59E0B] text-sm"
                                                />
                                            )}
                                        </td>
                                        {!readOnly && (
                                            <td className="px-2 py-2 text-right">
                                                <button
                                                    onClick={() => removeLevel(idx)}
                                                    className="p-1 hover:bg-[#EF4444]/20 rounded transition-colors"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5 text-[#EF4444]" />
                                                </button>
                                            </td>
                                        )}
                                    </tr>
                                );
                            }

                            const isEditing = editingIndex === idx;

                            return (
                                <tr
                                    key={`level-${idx}`}
                                    className={`border-b border-[#1E3A5F]/50 hover:bg-[#132240]/50 transition-colors ${isEditing ? 'bg-[#132240]' : ''}`}
                                    onClick={() => !readOnly && setEditingIndex(isEditing ? null : idx)}
                                >
                                    <td className="px-2 py-2 text-[#64748B] font-mono">{item.level}</td>
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
                                            item.small_blind.toLocaleString()
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
                                            item.big_blind.toLocaleString()
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
                                                value={item.duration}
                                                onChange={(e) => updateLevel(idx, 'duration', parseInt(e.target.value) || 1)}
                                                onClick={(e) => e.stopPropagation()}
                                                className="w-14 h-7 bg-[#0D192E] border border-[#1E3A5F] rounded text-center text-[#22D3EE] text-sm"
                                            />
                                        ) : (
                                            `${item.duration}m`
                                        )}
                                    </td>
                                    {!readOnly && (
                                        <td className="px-2 py-2 text-right">
                                            <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
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
