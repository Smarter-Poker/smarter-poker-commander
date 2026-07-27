import React from 'react';

/**
 * Shared Commander Pagination Component
 * 
 * @param {number} currentPage - The current active page (1-indexed)
 * @param {number} totalPages - The total number of pages available
 * @param {function} onPageChange - Callback when a new page is requested
 * @param {string} className - Optional wrapper class name
 */
export default function Pagination({ currentPage, totalPages, onPageChange, className = '' }) {
    if (totalPages <= 1) return null;

    return (
        <div className={`flex items-center justify-center gap-3 ${className}`}>
            <button
                onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                disabled={currentPage <= 1}
                className="px-4 py-2 bg-[#3A3B3C] hover:bg-[#4E4F50] text-[#B0B3B8] rounded-lg text-sm disabled:opacity-50 disabled:hover:bg-[#3A3B3C] transition-colors font-medium"
            >
                Previous
            </button>
            <span className="text-sm font-medium text-[#B0B3B8]">
                Page {currentPage} of {totalPages}
            </span>
            <button
                onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage >= totalPages}
                className="px-4 py-2 bg-[#3A3B3C] hover:bg-[#4E4F50] text-[#B0B3B8] rounded-lg text-sm disabled:opacity-50 disabled:hover:bg-[#3A3B3C] transition-colors font-medium"
            >
                Next
            </button>
        </div>
    );
}
