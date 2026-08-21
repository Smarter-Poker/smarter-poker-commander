import React, { useState, useEffect, useRef } from 'react';

export default function PhotonAutocomplete({ onPlaceSelected, defaultValue, onChange, style, placeholder, required }) {
  const [query, setQuery] = useState(defaultValue || '');
  const [suggestions, setSuggestions] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  
  const wrapperRef = useRef(null);
  const listRef = useRef(null);
  const debounceRef = useRef(null);
  const abortControllerRef = useRef(null);

  useEffect(() => {
    setQuery(defaultValue || '');
  }, [defaultValue]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchSuggestions = async (text) => {
    if (text.length < 3) {
      setSuggestions([]);
      setIsLoading(false);
      return;
    }
    
    // Abort previous request if still in flight
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    
    setIsLoading(true);
    try {
      // Add lang=en for English results
      const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(text)}&limit=5&lang=en`, {
        signal: abortControllerRef.current.signal
      });
      const data = await res.json();
      setSuggestions(data.features || []);
      setSelectedIndex(-1); // Reset selection on new results
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Photon API error:', err);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    setShowDropdown(true);
    if (onChange) onChange(e);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchSuggestions(val);
    }, 300);
  };

  const handleSelect = (place) => {
    const props = place.properties;
    
    // Construct a high quality label
    const addressLabel = [
      props.name, 
      props.housenumber ? `${props.housenumber} ${props.street}` : props.street, 
      props.city || props.town || props.village, 
      props.state, 
      props.country
    ].filter(Boolean).join(', ');

    setQuery(addressLabel);
    setShowDropdown(false);
    setSuggestions([]);
    
    // Fire fake event for onChange if parent is listening
    if (onChange) {
      onChange({ target: { value: addressLabel } });
    }

    // Map Photon props to Google Maps format so handlePlaceSelected works seamlessly
    if (onPlaceSelected) {
      const mappedPlace = {
        name: props.name || '',
        formatted_address: addressLabel,
        address_components: [
          (props.city || props.town || props.village) && { types: ['locality'], long_name: props.city || props.town || props.village },
          props.state && { types: ['administrative_area_level_1'], short_name: props.state, long_name: props.state },
          props.postcode && { types: ['postal_code'], long_name: props.postcode },
          props.housenumber && { types: ['street_number'], long_name: props.housenumber },
          props.street && { types: ['route'], long_name: props.street }
        ].filter(Boolean)
      };
      onPlaceSelected(mappedPlace);
    }
  };

  const handleKeyDown = (e) => {
    if (!showDropdown || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => {
        const next = prev < suggestions.length - 1 ? prev + 1 : prev;
        scrollToItem(next);
        return next;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => {
        const next = prev > 0 ? prev - 1 : 0;
        scrollToItem(next);
        return next;
      });
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault();
      handleSelect(suggestions[selectedIndex]);
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  };

  const scrollToItem = (index) => {
    if (listRef.current && listRef.current.children[index]) {
      const item = listRef.current.children[index];
      item.scrollIntoView({ block: 'nearest' });
    }
  };

  const clearInput = () => {
    setQuery('');
    setSuggestions([]);
    setShowDropdown(false);
    if (onChange) onChange({ target: { value: '' } });
  };

  return (
    <div ref={wrapperRef} style={{ position: 'absolute', top: style?.top, left: style?.left, width: style?.width, height: style?.height, zIndex: style?.zIndex || 10 }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <input
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setShowDropdown(true)}
          placeholder={placeholder || 'Street Address'}
          required={required}
          autoComplete="off"
          style={{
            width: '100%',
            height: '100%',
            background: style?.background || 'transparent',
            border: style?.border || 'none',
            outline: style?.outline || 'none',
            color: style?.color || 'white',
            fontSize: style?.fontSize || 'min(17px, 3vw)',
            fontFamily: style?.fontFamily || 'Inter, sans-serif',
            paddingRight: '40px' // Make room for loader/clear btn
          }}
        />
        
        {/* Loading Spinner or Clear Button */}
        <div style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center' }}>
          {isLoading ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1877F2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}>
              <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
            </svg>
          ) : query ? (
            <button
              type="button"
              onClick={clearInput}
              style={{ background: 'none', border: 'none', color: '#8A8D91', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>

      {/* Dropdown Menu */}
      {showDropdown && (
        <ul ref={listRef} style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          background: '#242526', // Slightly lighter than #18191A page background
          border: '1px solid #3A3B3C',
          borderRadius: '8px',
          marginTop: '6px',
          padding: '6px 0',
          listStyle: 'none',
          maxHeight: '220px',
          overflowY: 'auto',
          boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
          margin: 0,
          zIndex: 100
        }}>
          {suggestions.length > 0 ? (
            suggestions.map((place, idx) => {
              const props = place.properties;
              // Formatting a clean address layout (Primary vs Secondary)
              const primaryLabel = props.name || (props.housenumber ? `${props.housenumber} ${props.street}` : props.street) || props.city || 'Unknown Location';
              const secondaryLabel = [
                props.name ? (props.housenumber ? `${props.housenumber} ${props.street}` : props.street) : null, 
                props.city || props.town || props.village, 
                props.state
              ].filter(Boolean).join(', ');
              
              const isSelected = idx === selectedIndex;
              
              return (
                <li
                  key={idx}
                  onClick={() => handleSelect(place)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  style={{
                    padding: '10px 16px',
                    cursor: 'pointer',
                    background: isSelected ? '#3A3B3C' : 'transparent',
                    borderBottom: idx === suggestions.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.05)',
                    transition: 'background 0.1s ease'
                  }}
                >
                  <div style={{ color: '#E4E6EB', fontSize: '15px', fontWeight: 500, fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {primaryLabel}
                  </div>
                  {secondaryLabel && (
                    <div style={{ color: '#B0B3B8', fontSize: '13px', marginTop: '2px', fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {secondaryLabel}
                    </div>
                  )}
                </li>
              );
            })
          ) : query.length >= 3 && !isLoading ? (
            <li style={{ padding: '12px 16px', color: '#8A8D91', fontSize: '14px', fontFamily: 'Inter, sans-serif', textAlign: 'center' }}>
              No matching addresses found.
            </li>
          ) : query.length > 0 && query.length < 3 ? (
            <li style={{ padding: '12px 16px', color: '#8A8D91', fontSize: '14px', fontFamily: 'Inter, sans-serif', textAlign: 'center' }}>
              Type at least 3 characters to search...
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}
