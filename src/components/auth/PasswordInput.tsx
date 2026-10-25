import { useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import './authPresentation.css';

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { id: string };

/** Keeps autofill/paste and the owner's value; visibility is never persisted. */
export function PasswordInput({ id, className = '', disabled, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return <div className="k-auth-password">
    <input {...props} id={id} type={visible ? 'text' : 'password'} disabled={disabled} className={`k-auth-input ${className}`} />
    <button type="button" className="k-auth-reveal" disabled={disabled}
      aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'} aria-controls={id} aria-pressed={visible}
      onClick={() => setVisible(value => !value)}>
      {visible ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
    </button>
  </div>;
}
