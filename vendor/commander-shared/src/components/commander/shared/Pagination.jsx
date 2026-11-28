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
                className="px-4 py-2 bg-[#132A42] hover:bg-[#1B3753] text-[#BDD0E2] rounded-lg text-sm disabled:opacity-50 disabled:hover:bg-[#132A42] transition-colors font-medium"
            >
                Previous
            </button>
            <span className="text-sm font-medium text-[#BDD0E2]">
                Page {currentPage} of {totalPages}
            </span>
            <button
                onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage >= totalPages}
                className="px-4 py-2 bg-[#132A42] hover:bg-[#1B3753] text-[#BDD0E2] rounded-lg text-sm disabled:opacity-50 disabled:hover:bg-[#132A42] transition-colors font-medium"
            >
                Next
            </button>
        </div>
    );
}
