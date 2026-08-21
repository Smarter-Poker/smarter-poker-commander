import React, { useState, useEffect, useRef } from 'react';

export default function PhotonAutocomplete({ onPlaceSelected, defaultValue, onChange, style, placeholder, required }) {
  const [query, setQuery] = useState(defaultValue || '');
  const [suggestions, setSuggestions] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const wrapperRef = useRef(null);
  const debounceRef = useRef(null);

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
      return;
    }
    try {
      const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(text)}&limit=5`);
      const data = await res.json();
      setSuggestions(data.features || []);
    } catch (err) {
      console.error('Photon API error:', err);
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
    const addressLabel = [props.name, props.housenumber ? `${props.housenumber} ${props.street}` : props.street, props.city, props.state, props.country]
      .filter(Boolean)
      .join(', ');

    setQuery(addressLabel);
    setShowDropdown(false);
    
    // Fire fake event for onChange if needed
    if (onChange) onChange({ target: { value: addressLabel } });

    // Map Photon props to Google Maps format so handlePlaceSelected works seamlessly
    if (onPlaceSelected) {
      const mappedPlace = {
        name: props.name || '',
        formatted_address: addressLabel,
        address_components: [
          props.city && { types: ['locality'], long_name: props.city },
          props.state && { types: ['administrative_area_level_1'], short_name: props.state, long_name: props.state },
          props.postcode && { types: ['postal_code'], long_name: props.postcode },
          props.housenumber && { types: ['street_number'], long_name: props.housenumber },
          props.street && { types: ['route'], long_name: props.street }
        ].filter(Boolean)
      };
      onPlaceSelected(mappedPlace);
    }
  };

  return (
    <div ref={wrapperRef} style={{ position: 'absolute', top: style?.top, left: style?.left, width: style?.width, height: style?.height, zIndex: style?.zIndex || 10 }}>
      <input
        type="text"
        value={query}
        onChange={handleInputChange}
        onFocus={() => setShowDropdown(true)}
        placeholder={placeholder || 'Street Address'}
        required={required}
        style={{
          width: '100%',
          height: '100%',
          background: style?.background || 'transparent',
          border: style?.border || 'none',
          outline: style?.outline || 'none',
          color: style?.color || 'white',
          fontSize: style?.fontSize || 'min(17px, 3vw)',
          fontFamily: style?.fontFamily || 'Inter, sans-serif'
        }}
      />
      {showDropdown && suggestions.length > 0 && (
        <ul style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          background: '#3A3B3C',
          border: '1px solid #4E4F50',
          borderRadius: '8px',
          marginTop: '4px',
          padding: '8px 0',
          listStyle: 'none',
          maxHeight: '200px',
          overflowY: 'auto',
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          margin: 0
        }}>
          {suggestions.map((place, idx) => {
            const props = place.properties;
            const addressLabel = [props.name, props.housenumber ? `${props.housenumber} ${props.street}` : props.street, props.city, props.state]
              .filter(Boolean)
              .join(', ');
            
            return (
              <li
                key={idx}
                onClick={() => handleSelect(place)}
                style={{
                  padding: '10px 16px',
                  cursor: 'pointer',
                  color: '#E4E6EB',
                  fontSize: '14px',
                  fontFamily: 'Inter, sans-serif',
                  borderBottom: idx === suggestions.length - 1 ? 'none' : '1px solid #4E4F50'
                }}
                onMouseEnter={(e) => e.target.style.background = '#4E4F50'}
                onMouseLeave={(e) => e.target.style.background = 'transparent'}
              >
                {addressLabel}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
