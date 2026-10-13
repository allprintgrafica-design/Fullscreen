import { X, LoaderCircle, MonitorPlay, ArrowUpRight } from 'lucide-react';

export const bytes = (n) =>
  n >= 1024 * 1024 * 1024
    ? (n / 1024 / 1024 / 1024).toFixed(1) + ' GB'
    : (n / 1024 / 1024).toFixed(n < 1024 * 1024 ? 2 : 1) + ' MB';
export const date = (value) =>
  new Date(value).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
export const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
export function Button({ children, variant = 'primary', busy, className = '', ...props }) {
  return (
    <button
      className={'btn btn-' + variant + ' ' + className}
      disabled={busy || props.disabled}
      {...props}
    >
      {busy ? <LoaderCircle size={17} className="spin" /> : null}
      {children}
    </button>
  );
}
export function Modal({ title, children, onClose, wide = false }) {
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section
        className={'modal ' + (wide ? 'modal-wide' : '')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Cerrar" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Badge({ children, tone = 'green' }) {
  return (
    <span className={'badge badge-' + tone}>
      <i />
      {children}
    </span>
  );
}
export function Empty({ title, detail, children }) {
  return (
    <div className="empty">
      <MonitorPlay size={36} />
      <h3>{title}</h3>
      <p>{detail}</p>
      {children}
    </div>
  );
}
export function Stat({ icon: Icon, label, value, detail, accent }) {
  return (
    <article className={'stat ' + (accent ? 'stat-accent' : '')}>
      <div className="stat-top">
        <span>{label}</span>
        <Icon size={19} />
      </div>
      <strong>{value}</strong>
      <div className="stat-bottom">
        {detail}
        <ArrowUpRight size={15} />
      </div>
    </article>
  );
}
export function FormError({ error }) {
  return error ? (
    <p role="alert" className="form-error">
      {error}
    </p>
  ) : null;
}
