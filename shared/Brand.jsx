export default function Brand({ compact = false }) {
  return <a className="setu-brand" href="/" aria-label="Vishwakarma Setu home">
    <svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true">
      <rect width="48" height="48" rx="13" fill="#123c47" />
      <path d="M10 31V21c0-7 7-10 14-4 7-6 14-3 14 4v10M10 26h28M24 17v14" fill="none" stroke="#fff9ed" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="10" cy="34" r="3" fill="#f4b45f" /><circle cx="38" cy="34" r="3" fill="#f4b45f" />
    </svg>
    {!compact && <span>Vishwakarma <strong>Setu</strong><small>LOCAL SKILL. CONNECTED.</small></span>}
  </a>
}
