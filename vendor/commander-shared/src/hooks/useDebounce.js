/* ═══════════════════════════════════════════════════════════════════════════
   USE DEBOUNCE - Delays a value update until the user stops typing
   Prevents API hammering on search inputs.

   Usage:
     const debouncedSearch = useDebounce(searchInput, 300);
     useEffect(() => { if (debouncedSearch) fetchResults(debouncedSearch); }, [debouncedSearch]);
   ═══════════════════════════════════════════════════════════════════════════ */
import { useState, useEffect } from 'react';

export function useDebounce(value, delay = 300) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

export default useDebounce;
