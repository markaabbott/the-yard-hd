import { useState } from 'react';
import { formatPhone, PHONE_ERROR } from '../lib/phone';

// Phone input that formats to (xxx) xxx-xxxx when you leave the field and
// says so right under it when the number isn't valid. The parent decides
// whether to block saving (use isPhoneOk from lib/phone).
export default function PhoneField({ value, onChange, placeholder = 'Phone', style, autoFocus }) {
  const [touched, setTouched] = useState(false);
  const bad = touched && formatPhone(value) === null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <input
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          setTouched(true);
          const f = formatPhone(value);
          if (f) onChange(f);
        }}
        aria-invalid={bad || undefined}
        style={{ ...style, ...(bad ? { borderColor: '#BA0C2F' } : null) }}
      />
      {bad && <span style={{ fontSize: 12, color: '#BA0C2F', lineHeight: 1.4 }}>{PHONE_ERROR}</span>}
    </div>
  );
}
